import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAllPlaylistTracks,
  getPlaylistMeta,
  SpotifyApiError,
} from "@/lib/spotify";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [meta, tracks] = await Promise.all([
      getPlaylistMeta(session.accessToken, id),
      getAllPlaylistTracks(session.accessToken, id),
    ]);
    return NextResponse.json({
      id,
      name: meta.name,
      snapshotId: meta.snapshotId,
      tracks,
    });
  } catch (err) {
    console.error("[tracks] Spotify error for playlist", id, err);
    const status = err instanceof SpotifyApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status });
  }
}
