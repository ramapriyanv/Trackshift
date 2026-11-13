import type { PlaylistTrack } from "@/types/spotify";

/** URI removal can affect every duplicate. Reject partial-copy removal before any write. */
export function removalUris(tracks: Pick<PlaylistTrack, "uri" | "isLocal" | "name">[], indices: number[]): string[] {
  const selected = new Set(indices);
  if (!indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= tracks.length)) throw new Error("Select available songs to remove.");
  const uris = new Set<string>();
  for (const index of selected) {
    const track = tracks[index];
    if (track.isLocal || !/^spotify:(track|episode):[A-Za-z0-9]+$/.test(track.uri)) throw new Error("Local files and unavailable songs cannot be removed with restore support.");
    uris.add(track.uri);
  }
  const retainedCopy = tracks.find((track, index) => uris.has(track.uri) && !selected.has(index));
  if (retainedCopy) throw new Error(`“${retainedCopy.name}” has other copies in this playlist. Select all copies to remove it safely.`);
  return [...uris];
}
