// Server-side Spotify Web API client. Access tokens never reach the browser.
import type { PlaylistSummary, PlaylistTrack } from "@/types/spotify";
import type { ReorderOp } from "@/lib/reorder";

const API = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

async function spotifyFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Spotify API error (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new SpotifyApiError(res.status, message);
  }
  return (await res.json()) as T;
}

interface Paged<T> {
  items: T[];
  next: string | null;
}

interface RawPlaylist {
  id: string;
  name: string;
  images: { url: string }[] | null;
  /** Legacy shape. */
  tracks?: { total: number } | null;
  /** New shape (Spotify renamed "tracks" to "items" on playlist objects). */
  items?: { total: number } | null;
  owner: { id: string; display_name: string | null } | null;
  collaborative: boolean;
}

/**
 * Spotify is migrating playlist content endpoints from
 * `/playlists/{id}/tracks` to `/playlists/{id}/items` (old endpoint returns
 * 403 for new apps). Try the new segment first and remember which one works.
 */
let contentSegment: "items" | "tracks" | null = null;

async function playlistContentFetch<T>(
  token: string,
  playlistId: string,
  buildPath: (segment: "items" | "tracks") => string,
  init?: RequestInit,
): Promise<T> {
  const candidates: readonly ("items" | "tracks")[] = contentSegment
    ? [contentSegment]
    : ["items", "tracks"];
  let lastError: unknown;
  for (const segment of candidates) {
    try {
      const result = await spotifyFetch<T>(token, buildPath(segment), init);
      contentSegment = segment;
      return result;
    } catch (err) {
      lastError = err;
      if (
        err instanceof SpotifyApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** Playlists the current user can actually reorder (owned or collaborative). */
export async function getEditablePlaylists(
  token: string,
): Promise<PlaylistSummary[]> {
  const me = await spotifyFetch<{ id: string }>(token, "/me");

  const out: PlaylistSummary[] = [];
  let url: string | null = "/me/playlists?limit=50";
  while (url) {
    const page: Paged<RawPlaylist | null> = await spotifyFetch(token, url);
    for (const p of page.items ?? []) {
      if (!p) continue;
      if (p.owner?.id !== me.id && !p.collaborative) continue;
      out.push({
        id: p.id,
        name: p.name,
        imageUrl: p.images?.[0]?.url ?? null,
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
        ownerName: p.owner?.display_name ?? "",
      });
    }
    url = page.next;
  }
  return out;
}

export interface PlaylistMeta {
  name: string;
  snapshotId: string;
  total: number;
}

export async function getPlaylistMeta(
  token: string,
  playlistId: string,
): Promise<PlaylistMeta> {
  const data = await spotifyFetch<{
    name: string;
    snapshot_id: string;
    tracks?: { total: number };
    items?: { total: number };
  }>(
    token,
    `/playlists/${playlistId}?fields=name,snapshot_id,items.total,tracks.total`,
  );
  return {
    name: data.name,
    snapshotId: data.snapshot_id,
    total: data.items?.total ?? data.tracks?.total ?? 0,
  };
}

interface RawTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[] | null;
  album: {
    name: string;
    images: { url: string }[] | null;
    release_date?: string | null;
  } | null;
}

interface RawPlaylistItem {
  is_local: boolean;
  /** Legacy key. */
  track?: RawTrack | null;
  /** Possible new key on the /items endpoint. */
  item?: RawTrack | null;
}

export async function getAllPlaylistTracks(
  token: string,
  playlistId: string,
): Promise<PlaylistTrack[]> {
  const tracks: PlaylistTrack[] = [];
  let page: Paged<RawPlaylistItem | null> = await playlistContentFetch(
    token,
    playlistId,
    (segment) => `/playlists/${playlistId}/${segment}?limit=100`,
  );

  for (;;) {
    for (const item of page.items ?? []) {
      const t = item?.track ?? item?.item;
      tracks.push({
        uri: t?.uri ?? "",
        id: t?.id ?? null,
        name: t?.name ?? "(unavailable)",
        artists: t?.artists?.map((a) => a.name) ?? [],
        album: t?.album?.name ?? "",
        albumImageUrl: t?.album?.images?.at(-1)?.url ?? null,
        releaseDate: t?.album?.release_date ?? null,
        durationMs: t?.duration_ms ?? 0,
        isLocal: item?.is_local ?? false,
      });
    }
    if (!page.next) break;
    page = await spotifyFetch(token, page.next);
  }
  return tracks;
}

/**
 * Execute a sequence of contiguous reorder operations, threading the
 * snapshot_id returned by each call into the next one.
 */
export async function applyReorderOps(
  token: string,
  playlistId: string,
  ops: ReorderOp[],
  snapshotId: string,
): Promise<string> {
  let snapshot = snapshotId;
  for (const op of ops) {
    const res = await playlistContentFetch<{ snapshot_id: string }>(
      token,
      playlistId,
      (segment) => `/playlists/${playlistId}/${segment}`,
      {
        method: "PUT",
        body: JSON.stringify({
          range_start: op.rangeStart,
          range_length: op.rangeLength,
          insert_before: op.insertBefore,
          snapshot_id: snapshot,
        }),
      },
    );
    snapshot = res.snapshot_id;
  }
  return snapshot;
}

/** Only called on Apply; each request removes at most 100 distinct URIs. */
export async function removePlaylistTracks(token: string, playlistId: string, uris: string[], snapshotId: string): Promise<string> {
  let snapshot = snapshotId;
  for (let start = 0; start < uris.length; start += 100) {
    const result = await spotifyFetch<{ snapshot_id: string }>(token, `/playlists/${playlistId}/items`, {
      method: "DELETE",
      body: JSON.stringify({ items: uris.slice(start, start + 100).map((uri) => ({ uri })), snapshot_id: snapshot }),
    });
    snapshot = result.snapshot_id;
  }
  return snapshot;
}

/** Undo re-adds removed occurrences, then the reorder engine restores their positions. */
export async function appendPlaylistTracks(token: string, playlistId: string, uris: string[], snapshotId: string): Promise<string> {
  let snapshot = snapshotId;
  for (let start = 0; start < uris.length; start += 100) {
    const meta = await getPlaylistMeta(token, playlistId);
    if (meta.snapshotId !== snapshot) throw new SpotifyApiError(409, "Playlist changed in Spotify. Restore stopped; reload the playlist.");
    const result = await spotifyFetch<{ snapshot_id: string }>(token, `/playlists/${playlistId}/items`, {
      method: "POST", body: JSON.stringify({ uris: uris.slice(start, start + 100) }),
    });
    snapshot = result.snapshot_id;
  }
  return snapshot;
}
