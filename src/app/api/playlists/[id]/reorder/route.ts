import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { diffToOps, planMove, planMoves } from "@/lib/reorder";
import { createUndoReceipt, inverseOrder, readUndoReceipt } from "@/lib/move-undo";
import { removalUris } from "@/lib/playlist-removal";
import {
  applyReorderOps,
  getPlaylistMeta,
  getAllPlaylistTracks,
  removePlaylistTracks,
  appendPlaylistTracks,
  SpotifyApiError,
} from "@/lib/spotify";
import type { Destination, MoveCommand, PlaylistEdit } from "@/types/move-command";

const DESTINATION_KINDS = new Set(["top", "bottom", "before", "after", "position"]);

function isValidCommand(body: unknown): body is { command: MoveCommand; snapshotId: string } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.snapshotId !== "string" || b.snapshotId.length === 0) return false;

  const cmd = b.command as MoveCommand | undefined;
  if (typeof cmd !== "object" || cmd === null) return false;
  if (!Array.isArray(cmd.selectedIndices)) return false;
  if (!cmd.selectedIndices.every((i) => Number.isInteger(i))) return false;

  const dest = cmd.destination as Destination | undefined;
  if (typeof dest !== "object" || dest === null) return false;
  if (!DESTINATION_KINDS.has(dest.kind)) return false;
  if (
    (dest.kind === "before" || dest.kind === "after") &&
    !Number.isInteger(dest.anchorIndex)
  ) {
    return false;
  }
  if (dest.kind === "position" && !Number.isInteger(dest.position)) return false;
  return true;
}

function parseMoves(body: unknown): { commands: PlaylistEdit[]; snapshotId: string; trackCount?: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if ("commands" in value) {
    if (!Array.isArray(value.commands) || !value.commands.length || value.commands.length > 500 || !Number.isInteger(value.trackCount) || (value.trackCount as number) < 0) return null;
    if (typeof value.snapshotId !== "string" || !value.snapshotId) return null;
    if (!value.commands.every((command) => {
      if (typeof command === "object" && command !== null && command.kind === "remove") return Array.isArray(command.selectedIndices) && command.selectedIndices.length > 0 && command.selectedIndices.every((index: unknown) => Number.isInteger(index));
      return isValidCommand({ command, snapshotId: value.snapshotId });
    })) return null;
    return { commands: value.commands as PlaylistEdit[], snapshotId: value.snapshotId, trackCount: value.trackCount as number };
  }
  return isValidCommand(body) ? { commands: [body.command], snapshotId: body.snapshotId } : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const undoToken = typeof body === "object" && body !== null && "action" in body && body.action === "undo"
    ? (body as { undoToken?: unknown }).undoToken : null;
  if (undoToken !== null && typeof undoToken !== "string") {
    return NextResponse.json({ error: "Invalid undo request" }, { status: 400 });
  }
  const moves = parseMoves(body);
  if (!undoToken && !moves) {
    return NextResponse.json({ error: "Invalid move command" }, { status: 400 });
  }
  let writeAttempted = false;
  try {
    if (undoToken) {
      let receipt;
      try { receipt = readUndoReceipt(undoToken, id); }
      catch { return NextResponse.json({ error: "Undo is unavailable for this move." }, { status: 400 }); }
      const meta = await getPlaylistMeta(session.accessToken, id);
      if (meta.snapshotId !== receipt.snapshotId || meta.total !== (receipt.trackCount ?? receipt.order.length)) {
        return NextResponse.json({ error: "Playlist changed in Spotify. Undo was cancelled; reload the playlist." }, { status: 409 });
      }
      let snapshot = receipt.snapshotId;
      if (receipt.removedUris?.length) {
        writeAttempted = true;
        snapshot = await appendPlaylistTracks(session.accessToken, id, receipt.removedUris, snapshot);
      }
      const ops = diffToOps(receipt.order.length, receipt.order);
      writeAttempted ||= ops.length > 0;
      const finalSnapshotId = await applyReorderOps(session.accessToken, id, ops, snapshot);
      return NextResponse.json({ snapshotId: finalSnapshotId, order: receipt.order });
    }
    if (!moves) return NextResponse.json({ error: "Invalid move command" }, { status: 400 });
    const { commands, snapshotId, trackCount } = moves;
    // Batch commands refer to positions in a specific starting snapshot.
    // Validate that snapshot before calculating any Spotify writes.
    const meta = await getPlaylistMeta(session.accessToken, id);
    if (trackCount !== undefined && (meta.total !== trackCount || meta.snapshotId !== snapshotId)) {
      return NextResponse.json({ error: "Playlist changed in Spotify. The pending batch was not applied. Reload the latest order." }, { status: 409 });
    }
    let plan: ReturnType<typeof planMoves>;
    try { plan = trackCount === undefined ? { ...planMove(meta.total, commands[0] as MoveCommand), removedIndices: [] } : planMoves(meta.total, commands); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid move batch" }, { status: 400 }); }
    const { removedIndices } = plan;
    let uniqueRemovalUris: string[] = [];
    let restoreUris: string[] = [];
    if (removedIndices.length) {
      const tracks = await getAllPlaylistTracks(session.accessToken, id);
      const latest = await getPlaylistMeta(session.accessToken, id);
      if (latest.snapshotId !== snapshotId || tracks.length !== meta.total) return NextResponse.json({ error: "Playlist changed in Spotify. No changes applied; reload the playlist." }, { status: 409 });
      try { uniqueRemovalUris = removalUris(tracks, removedIndices); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid removal" }, { status: 400 }); }
      restoreUris = removedIndices.map((index) => tracks[index].uri);
    }
    const restoreOrder = inverseOrder([...plan.newOrder, ...removedIndices]);
    const receipt = { playlistId: id, snapshotId, order: restoreOrder, ...(restoreUris.length ? { trackCount: plan.newOrder.length, removedUris: restoreUris } : {}) };
    // Verify signing configuration before making any Spotify changes.
    createUndoReceipt(receipt);
    let currentSnapshot = snapshotId;
    if (uniqueRemovalUris.length) {
      writeAttempted = true;
      currentSnapshot = await removePlaylistTracks(session.accessToken, id, uniqueRemovalUris, currentSnapshot);
    }
    writeAttempted ||= plan.ops.length > 0;
    const finalSnapshotId = await applyReorderOps(
      session.accessToken,
      id,
      plan.ops,
      currentSnapshot,
    );

    return NextResponse.json({
      snapshotId: finalSnapshotId,
      opCount: plan.ops.length + Math.ceil(uniqueRemovalUris.length / 100),
      order: plan.newOrder,
      removedIndices,
      undoToken: writeAttempted ? createUndoReceipt({ ...receipt, snapshotId: finalSnapshotId }) : null,
    });
  } catch (err) {
    const status = err instanceof SpotifyApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message, reloadRequired: writeAttempted }, { status });
  }
}
