import { afterEach, describe, expect, it, vi } from "vitest";
import { appendPlaylistTracks, removePlaylistTracks } from "./spotify";

afterEach(() => vi.unstubAllGlobals());
const uris = Array.from({ length: 205 }, (_, i) => `spotify:track:T${i}`);

describe("Spotify removal and restore requests", () => {
  it("splits removals into 100-object chunks and threads each returned snapshot", async () => {
    let count = 0;
    const requests: { items: { uri: string }[]; snapshot_id: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("DELETE");
      const body = JSON.parse(init.body as string);
      expect(body.snapshot_id).toBe(`s${count}`);
      requests.push(body);
      return new Response(JSON.stringify({ snapshot_id: `s${++count}` }));
    }));
    expect(await removePlaylistTracks("token", "playlist", uris, "s0")).toBe("s3");
    expect(requests.map((request) => request.items.length)).toEqual([100, 100, 5]);
    expect(requests.flatMap((request) => request.items.map((item) => item.uri))).toEqual(uris);
  });
  it("restores in 100-item chunks in the same order and checks the snapshot before every append", async () => {
    let snapshot = "s0";
    const added: string[][] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return new Response(JSON.stringify({ snapshot_id: snapshot, name: "Playlist", items: { total: added.flat().length } }));
      const body = JSON.parse(init.body as string);
      added.push(body.uris);
      snapshot = `s${added.length}`;
      return new Response(JSON.stringify({ snapshot_id: snapshot }));
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await appendPlaylistTracks("token", "playlist", uris, "s0")).toBe("s3");
    expect(added.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(added.flat()).toEqual(uris);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it("does not append after an external change", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ snapshot_id: "external", name: "Playlist", items: { total: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(appendPlaylistTracks("token", "playlist", uris, "expected")).rejects.toThrow(/changed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
