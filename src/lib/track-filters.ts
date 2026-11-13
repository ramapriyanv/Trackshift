import type { PlaylistTrack } from "@/types/spotify";

export type TrackFilters = { query: string; artist: string; album: string; year: string };
export const emptyFilters: TrackFilters = { query: "", artist: "", album: "", year: "" };

export function parseYears(value: string): [number, number] | null {
  const match = value.trim().match(/^(\d{4})(?:\s*-\s*(\d{4}))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return from <= to ? [from, to] : null;
}

export function filterTrackIndices(tracks: PlaylistTrack[], filters: TrackFilters): number[] {
  const query = filters.query.trim().toLowerCase();
  const artist = filters.artist.trim().toLowerCase();
  const album = filters.album.trim().toLowerCase();
  const yearInput = filters.year.trim();
  const years = parseYears(yearInput);
  return tracks.flatMap((track, index) => {
    const year = track.releaseDate?.match(/^\d{4}/)?.[0];
    if (query && !`${track.name} ${track.artists.join(" ")} ${track.album} ${year ?? ""}`.toLowerCase().includes(query)) return [];
    if (artist && !track.artists.some((name) => name.toLowerCase().includes(artist))) return [];
    if (album && !track.album.toLowerCase().includes(album)) return [];
    if (yearInput && (!years || !year || Number(year) < years[0] || Number(year) > years[1])) return [];
    return [index];
  });
}
