import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUndoReceipt } from "@/lib/move-undo";
import type { ReorderOp } from "@/lib/reorder";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), meta: vi.fn(), apply: vi.fn(), tracks: vi.fn(), remove: vi.fn(), append: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/spotify", () => ({
  getPlaylistMeta: mocks.meta,
  applyReorderOps: mocks.apply,
  getAllPlaylistTracks: mocks.tracks,
  removePlaylistTracks: mocks.remove,
  appendPlaylistTracks: mocks.append,
  SpotifyApiError: class extends Error { constructor(public status: number, message: string) { super(message); } },
}));
import { POST } from "./route";

const send = (body: unknown, id = "playlist") => POST(new Request("http://local/api/reorder", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "route-test-secret");
  mocks.auth.mockResolvedValue({ accessToken: "test-only-token" });
  mocks.meta.mockResolvedValue({ total: 6, snapshotId: "after" });
  mocks.apply.mockResolvedValue("restored");
  mocks.tracks.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ uri: `spotify:track:T${index}`, name: `Song ${index}`, isLocal: false })));
  mocks.remove.mockResolvedValue("deleted");
  mocks.append.mockResolvedValue("appended");
});

describe("batch apply endpoint", () => {
  const commands = [
    { selectedIndices: [4], destination: { kind: "top" } },
    { selectedIndices: [2, 5], destination: { kind: "after", anchorIndex: 3 } },
  ];

  it("applies the composed batch once and restores its starting order on undo", async () => {
    const actual = [0, 1, 2, 3, 4, 5];
    let snapshot = "before";
    mocks.meta.mockImplementation(async () => ({ total: actual.length, snapshotId: snapshot }));
    mocks.apply.mockImplementation(async (_token: string, _id: string, ops: ReorderOp[], expected: string) => {
      expect(expected).toBe(snapshot);
      for (const op of ops) actual.splice(op.insertBefore, 0, ...actual.splice(op.rangeStart, op.rangeLength));
      snapshot += "-updated";
      return snapshot;
    });
    const response = await send({ commands, snapshotId: "before", trackCount: 6 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.order).toEqual([4, 0, 2, 1, 5, 3]);
    expect(actual).toEqual(body.order);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    const undoResponse = await send({ action: "undo", undoToken: body.undoToken });
    expect(undoResponse.status).toBe(200);
    expect(actual).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("rejects a changed starting snapshot or length without making writes", async () => {
    expect((await send({ commands, snapshotId: "before", trackCount: 6 })).status).toBe(409);
    expect((await send({ commands, snapshotId: "after", trackCount: 7 })).status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("validates every command before applying any part of the batch", async () => {
    mocks.meta.mockResolvedValue({ total: 6, snapshotId: "before" });
    expect((await send({ commands: [...commands, { selectedIndices: [99], destination: { kind: "bottom" } }], snapshotId: "before", trackCount: 6 })).status).toBe(400);
    expect((await send({ commands: [...commands, { selectedIndices: [1] }], snapshotId: "before", trackCount: 6 })).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

describe("removal batches", () => {
  beforeEach(() => { mocks.meta.mockResolvedValue({ total: 6, snapshotId: "before" }); });

  it("removes selected songs, reorders survivors, and restores duplicates on undo", async () => {
    const original = ["A", "B", "A", "C", "D", "E"].map((id) => `spotify:track:${id}`);
    const actual = [...original];
    let snapshot = "before";
    mocks.meta.mockImplementation(async () => ({ total: actual.length, snapshotId: snapshot }));
    mocks.tracks.mockImplementation(async () => actual.map((uri) => ({ uri, name: uri, isLocal: false })));
    mocks.remove.mockImplementation(async (_token: string, _id: string, uris: string[], expected: string) => {
      expect(expected).toBe(snapshot);
      actual.splice(0, actual.length, ...actual.filter((uri) => !uris.includes(uri)));
      snapshot += "-delete";
      return snapshot;
    });
    mocks.append.mockImplementation(async (_token: string, _id: string, uris: string[], expected: string) => {
      expect(expected).toBe(snapshot);
      actual.push(...uris);
      snapshot += "-add";
      return snapshot;
    });
    mocks.apply.mockImplementation(async (_token: string, _id: string, ops: ReorderOp[], expected: string) => {
      expect(expected).toBe(snapshot);
      for (const op of ops) actual.splice(op.insertBefore, 0, ...actual.splice(op.rangeStart, op.rangeLength));
      snapshot += "-order";
      return snapshot;
    });
    const response = await send({ commands: [
      { kind: "remove", selectedIndices: [0, 2] },
      { selectedIndices: [3], destination: { kind: "top" } },
    ], snapshotId: "before", trackCount: 6 });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.order).toEqual([5, 1, 3, 4]);
    expect(result.removedIndices).toEqual([0, 2]);
    expect(actual).toEqual([original[5], original[1], original[3], original[4]]);
    expect(mocks.remove.mock.calls[0][2]).toEqual(["spotify:track:A"]);
    const undone = await send({ action: "undo", undoToken: result.undoToken });
    expect(undone.status).toBe(200);
    expect(actual).toEqual(original);
    expect(mocks.append.mock.calls[0][2]).toEqual(["spotify:track:A", "spotify:track:A"]);
  });

  it("does not write anything when only one duplicate or a local file is selected", async () => {
    const duplicate = { uri: "spotify:track:Duplicate", name: "Duplicate", isLocal: false };
    mocks.tracks.mockResolvedValue([duplicate, duplicate, ...Array.from({ length: 4 }, (_, i) => ({ uri: `spotify:track:T${i}`, name: "Song", isLocal: false }))]);
    const body = { commands: [{ kind: "remove", selectedIndices: [0] }], snapshotId: "before", trackCount: 6 };
    expect((await send(body)).status).toBe(400);
    mocks.tracks.mockResolvedValue([{ uri: "spotify:local:file", name: "Local", isLocal: true }, ...Array.from({ length: 5 }, (_, i) => ({ uri: `spotify:track:T${i}`, name: "Song", isLocal: false }))]);
    expect((await send(body)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("rejects an externally changed snapshot before removing or re-adding anything", async () => {
    mocks.meta.mockResolvedValue({ total: 4, snapshotId: "external" });
    expect((await send({ commands: [{ kind: "remove", selectedIndices: [0] }], snapshotId: "before", trackCount: 6 })).status).toBe(409);
    const token = createUndoReceipt({ playlistId: "playlist", snapshotId: "saved", order: [0, 4, 1, 2, 5, 3], trackCount: 4, removedUris: ["spotify:track:A", "spotify:track:B"] });
    expect((await send({ action: "undo", undoToken: token })).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("allows removing the entire playlist while retaining a restorable receipt", async () => {
    const response = await send({ commands: [{ kind: "remove", selectedIndices: [0, 1, 2, 3, 4, 5] }], snapshotId: "before", trackCount: 6 });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.order).toEqual([]);
    expect(result.removedIndices).toHaveLength(6);
    expect(typeof result.undoToken).toBe("string");
  });

  it("reports an uncertain partial batch failure for recovery instead of success", async () => {
    mocks.apply.mockRejectedValue(new Error("Lost connection after removal"));
    const response = await send({ commands: [{ kind: "remove", selectedIndices: [0] }], snapshotId: "before", trackCount: 6 });
    expect(response.status).toBe(500);
    expect((await response.json()).reloadRequired).toBe(true);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});

describe("undo endpoint", () => {
  it("restores the signed order when Spotify still has the expected snapshot", async () => {
    const order = [0, 2, 3, 1, 4, 5];
    const undoToken = createUndoReceipt({ playlistId: "playlist", snapshotId: "after", order });
    const response = await send({ action: "undo", undoToken });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshotId: "restored", order });
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.calls[0][3]).toBe("after");
  });
  it("rejects undo without any writes after an external snapshot change", async () => {
    mocks.meta.mockResolvedValue({ total: 6, snapshotId: "external-change" });
    const undoToken = createUndoReceipt({ playlistId: "playlist", snapshotId: "after", order: [0, 2, 3, 1, 4, 5] });
    expect((await send({ action: "undo", undoToken })).status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("rejects a changed playlist length, another playlist, and tampered data", async () => {
    const undoToken = createUndoReceipt({ playlistId: "playlist", snapshotId: "after", order: [1, 0] });
    expect((await send({ action: "undo", undoToken })).status).toBe(409);
    expect((await send({ action: "undo", undoToken }, "other")).status).toBe(400);
    expect((await send({ action: "undo", undoToken: `invalid${undoToken}` })).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("requires a signed-in session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await send({ action: "undo", undoToken: "anything" })).status).toBe(401);
    expect(mocks.meta).not.toHaveBeenCalled();
  });
  it("returns a server-generated inverse receipt after applying a move", async () => {
    const response = await send({ command: { selectedIndices: [1, 4], destination: { kind: "top" } }, snapshotId: "before" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.order).toEqual([1, 4, 0, 2, 3, 5]);
    expect(typeof body.undoToken).toBe("string");
  });
  it("marks uncertain failures for a reload instead of claiming no changes occurred", async () => {
    mocks.apply.mockRejectedValue(new Error("Network connection lost"));
    const undoToken = createUndoReceipt({ playlistId: "playlist", snapshotId: "after", order: [1, 0, 2, 3, 4, 5] });
    const response = await send({ action: "undo", undoToken });
    expect(response.status).toBe(500);
    expect((await response.json()).reloadRequired).toBe(true);
  });
});
