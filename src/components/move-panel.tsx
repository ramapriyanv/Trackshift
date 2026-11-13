"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Destination, PlaylistEdit } from "@/types/move-command";
import type { PlaylistTrack } from "@/types/spotify";
import { MusicIcon, SearchIcon, TrackShiftLogo, XIcon } from "./icons";

interface MovePanelProps {
  tracks: PlaylistTrack[] | null;
  selection: Set<number>;
  preview: { commands: PlaylistEdit[]; newOrder: number[] } | null;
  applying: boolean;
  onMove: (destination: Destination) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onApply: () => void;
  onCancelPreview: () => void;
  onUndoPendingMove: () => void;
  onSelectIndices: (indices: number[], mode: "replace" | "add") => void;
  canUndoSelection: boolean;
  onUndoSelection: () => void;
  onRemoveSelected?: () => void;
  pendingRemovals?: PlaylistTrack[];
}

interface MoveSuggestion {
  key: string;
  title: string;
  detail: string;
  destination: Destination;
}

/** Longest run of consecutive playlist indices in a sorted index list. */
function largestCluster(sorted: number[]): number[] {
  let best: number[] = [];
  let run: number[] = [];
  for (const i of sorted) {
    if (run.length === 0 || i === run[run.length - 1] + 1) run.push(i);
    else {
      if (run.length > best.length) best = run;
      run = [i];
    }
  }
  return run.length > best.length ? run : best;
}

/**
 * Destination suggestions for the current selection: move it next to the
 * other songs sharing the selection's artist, album, or release year.
 */
function computeMoveSuggestions(
  tracks: PlaylistTrack[],
  selection: Set<number>,
): MoveSuggestion[] {
  if (selection.size === 0) return [];
  const selected = [...selection].map((i) => tracks[i]).filter(Boolean);
  if (selected.length === 0) return [];

  const shared = <T,>(get: (t: PlaylistTrack) => T | undefined): T | null => {
    const first = get(selected[0]);
    if (first === undefined || first === null || first === "") return null;
    return selected.every((t) => get(t) === first) ? first : null;
  };

  const attrs: {
    key: string;
    matches: (t: PlaylistTrack) => boolean;
    describe: (count: number) => string;
  }[] = [];

  const artist = shared((t) => t.artists[0]);
  if (artist) {
    attrs.push({
      key: `artist-${artist}`,
      matches: (t) => t.artists[0] === artist,
      describe: (n) => `${n} other song${n === 1 ? "" : "s"} by ${artist}`,
    });
  }
  const album = shared((t) => t.album);
  if (album) {
    attrs.push({
      key: `album-${album}`,
      matches: (t) => t.album === album,
      describe: (n) => `${n} other song${n === 1 ? "" : "s"} from “${album}”`,
    });
  }
  const year = shared((t) => t.releaseDate?.slice(0, 4));
  if (year) {
    attrs.push({
      key: `year-${year}`,
      matches: (t) => t.releaseDate?.slice(0, 4) === year,
      describe: (n) => `${n} other song${n === 1 ? "" : "s"} from ${year}`,
    });
  }

  const out: MoveSuggestion[] = [];
  for (const attr of attrs) {
    const matching: number[] = [];
    for (let i = 0; i < tracks.length; i++) {
      if (!selection.has(i) && attr.matches(tracks[i])) matching.push(i);
    }
    if (matching.length === 0) continue;
    const cluster = largestCluster(matching);
    const anchor = cluster[cluster.length - 1];
    out.push({
      key: attr.key,
      title: `Group with ${attr.describe(matching.length)}`,
      detail: `after “${tracks[anchor].name}”`,
      destination: { kind: "after", anchorIndex: anchor },
    });
  }
  return out;
}

interface TrackGroup {
  kind: "artist" | "album";
  name: string;
  indices: number[];
  /** True if the group's songs are not one contiguous block. */
  scattered: boolean;
}

function computeGroups(tracks: PlaylistTrack[]): TrackGroup[] {
  const byArtist = new Map<string, number[]>();
  const byAlbum = new Map<string, { name: string; indices: number[] }>();

  tracks.forEach((t, i) => {
    const artist = t.artists[0];
    if (artist) {
      const list = byArtist.get(artist);
      if (list) list.push(i);
      else byArtist.set(artist, [i]);
    }
    if (t.album) {
      const key = `${t.album}\u0000${t.artists[0] ?? ""}`;
      const entry = byAlbum.get(key);
      if (entry) entry.indices.push(i);
      else byAlbum.set(key, { name: t.album, indices: [i] });
    }
  });

  const groups: TrackGroup[] = [];
  for (const [name, indices] of byArtist) {
    if (indices.length < 2) continue;
    groups.push({
      kind: "artist",
      name,
      indices,
      scattered: indices[indices.length - 1] - indices[0] + 1 !== indices.length,
    });
  }
  for (const { name, indices } of byAlbum.values()) {
    if (indices.length < 2) continue;
    groups.push({
      kind: "album",
      name,
      indices,
      scattered: indices[indices.length - 1] - indices[0] + 1 !== indices.length,
    });
  }
  return groups.sort((a, b) => b.indices.length - a.indices.length);
}

const ANCHOR_ROW_HEIGHT = 48;

export default function MovePanel({
  tracks,
  selection,
  preview,
  applying,
  onMove,
  onRemove,
  onClear,
  onApply,
  onCancelPreview,
  onUndoPendingMove,
  onSelectIndices,
  canUndoSelection,
  onUndoSelection,
  onRemoveSelected,
  pendingRemovals = [],
}: MovePanelProps) {
  const [anchorMode, setAnchorMode] = useState<"before" | "after" | null>(null);
  const [anchorQuery, setAnchorQuery] = useState("");
  const [position, setPosition] = useState("");
  const anchorListRef = useRef<HTMLDivElement>(null);

  const selectedIndices = useMemo(
    () => [...selection].sort((a, b) => a - b),
    [selection],
  );

  const groups = useMemo(
    () => (tracks ? computeGroups(tracks) : []),
    [tracks],
  );

  const moveSuggestions = useMemo(
    () => (tracks ? computeMoveSuggestions(tracks, selection) : []),
    [tracks, selection],
  );

  const anchorResults = useMemo(() => {
    if (!tracks || !anchorMode) return [];
    const q = anchorQuery.trim().toLowerCase();
    const out: { index: number; track: PlaylistTrack }[] = [];
    for (let i = 0; i < tracks.length; i++) {
      if (selection.has(i)) continue;
      const t = tracks[i];
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !t.artists.join(" ").toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({ index: i, track: t });
    }
    return out;
  }, [tracks, anchorMode, anchorQuery, selection]);

  const anchorVirtualizer = useVirtualizer({
    count: anchorResults.length,
    getScrollElement: () => anchorListRef.current,
    estimateSize: () => ANCHOR_ROW_HEIGHT,
    overscan: 10,
  });

  const submitPosition = () => {
    const n = Number.parseInt(position, 10);
    if (Number.isNaN(n)) return;
    setPosition("");
    onMove({ kind: "position", position: n });
  };

  const pickAnchor = (index: number) => {
    const mode = anchorMode;
    setAnchorMode(null);
    setAnchorQuery("");
    if (mode) onMove({ kind: mode, anchorIndex: index });
  };

  const destBtn =
    "rounded-md bg-white/10 px-3 py-2 text-sm font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10";

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded-lg bg-elevated">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
        <h2 className="text-base font-bold">
          Move songs
        </h2>
        <button type="button" onClick={onUndoSelection} disabled={!canUndoSelection || applying}
          className="text-xs font-semibold text-subtle hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Undo selection</button>
      </div>

      {/* ---- Preview state -------------------------------------------- */}
      {preview && tracks && (
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/10 p-4">
          <p className="text-sm font-bold text-spotify-bright" role="status">
            {preview.commands.length} pending change{preview.commands.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-subtle">
            Keep arranging or removing songs. Spotify changes only when you apply this batch.
          </p>
          {pendingRemovals.length > 0 && <details className="text-xs text-red-300">
            <summary className="cursor-pointer font-semibold">{pendingRemovals.length} song{pendingRemovals.length === 1 ? "" : "s"} to remove from this playlist</summary>
            <ul className="mt-2 max-h-24 overflow-y-auto rounded bg-black/20 p-2">
              {pendingRemovals.map((track, index) => <li key={`${track.uri}-${index}`} className="truncate py-1">{track.name} · {track.artists.join(", ")}</li>)}
            </ul>
          </details>}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={applying}
              className="flex items-center justify-center gap-2 rounded-full bg-spotify py-3 text-sm font-bold text-black transition hover:bg-spotify-bright disabled:opacity-60"
            >
              {applying && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              )}
              {applying ? "Applying…" : "Apply all changes"}
            </button>
            <button
              type="button"
              onClick={onUndoPendingMove}
              disabled={applying}
              className="rounded-full bg-white/10 py-3 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"
            >
              Undo pending change
            </button>
            <button type="button" onClick={onCancelPreview} disabled={applying} className="py-1 text-xs font-semibold text-subtle hover:text-white disabled:opacity-40">Discard all changes</button>
          </div>
        </div>
      )}

      {/* ---- No playlist state ------------------------------------------ */}
      {!tracks && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
            <TrackShiftLogo className="h-6 w-6 text-spotify" />
          </span>
          <p className="text-sm font-semibold">No playlist open</p>
          <p className="text-xs leading-relaxed text-subtle">
            Pick a playlist from your library to start rearranging.
          </p>
        </div>
      )}

      {/* ---- Main state: move controls always visible ------------------- */}
      {tracks && !anchorMode && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-bold tabular-nums ${
                selection.size > 0 ? "text-spotify-bright" : "text-subtle"
              }`}
            >
              {selection.size > 0
                ? `${selection.size} selected`
                : "No songs selected"}
            </span>
            {selection.size > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs font-semibold text-subtle transition hover:text-white"
              >
                Clear all
              </button>
            )}
          </div>

          {onRemoveSelected && <button type="button" onClick={onRemoveSelected} disabled={!selection.size || applying}
            title="Mark the selected songs for removal from this playlist. Nothing is removed from Spotify until Apply all changes."
            className="rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40">
            Remove selected from playlist{selection.size ? ` (${selection.size})` : ""}
          </button>}

          {/* Move to — always visible, activates with a selection */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
              Move to
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={destBtn}
                disabled={selection.size === 0}
                onClick={() => onMove({ kind: "top" })}
              >
                Top
              </button>
              <button
                type="button"
                className={destBtn}
                disabled={selection.size === 0}
                onClick={() => onMove({ kind: "bottom" })}
              >
                Bottom
              </button>
              <button
                type="button"
                className={destBtn}
                disabled={selection.size === 0}
                onClick={() => setAnchorMode("before")}
              >
                Before a song…
              </button>
              <button
                type="button"
                className={destBtn}
                disabled={selection.size === 0}
                onClick={() => setAnchorMode("after")}
              >
                After a song…
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={position}
                onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && submitPosition()}
                placeholder={`Position (1–${tracks.length})`}
                inputMode="numeric"
                disabled={selection.size === 0}
                className="min-w-0 flex-1 rounded-md bg-black/40 px-3 py-2 text-sm tabular-nums outline-none ring-1 ring-white/15 placeholder:text-subtle/60 focus:ring-spotify disabled:cursor-not-allowed disabled:opacity-40"
              />
              <button
                type="button"
                onClick={submitPosition}
                disabled={position === "" || selection.size === 0}
                className="rounded-md bg-spotify px-4 py-2 text-sm font-bold text-black transition hover:bg-spotify-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                Go
              </button>
            </div>
            {selection.size === 0 && (
              <p className="mt-2 text-xs leading-relaxed text-subtle">
                Click songs in the playlist to activate — Ctrl+Click to add,
                Shift+Click for a range.
              </p>
            )}
          </div>

          {/* Suggested moves — group with matching artist/album/year */}
          {selection.size > 0 && moveSuggestions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
                Suggested moves
              </p>
              <ul className="flex flex-col gap-1">
                {moveSuggestions.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => onMove(s.destination)}
                      className="flex w-full flex-col gap-0.5 rounded-md bg-spotify/10 px-3 py-2 text-left ring-1 ring-spotify/30 transition hover:bg-spotify/20"
                    >
                      <span className="truncate text-sm font-semibold text-spotify-bright">
                        {s.title}
                      </span>
                      <span className="truncate text-xs text-subtle">
                        {s.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Selection details OR quick-select suggestions */}
          {selection.size > 0 ? (
            <>
              <ul className="min-h-0 flex-1 overflow-y-auto rounded-md bg-black/20 p-2">
                {selectedIndices.map((i) => (
                  <li
                    key={i}
                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5"
                  >
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-subtle">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {tracks[i]?.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      title="Remove from selection"
                      className="shrink-0 text-subtle opacity-0 transition group-hover:opacity-100 hover:text-white"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              {groups.length === 0 ? (
                <p className="text-xs text-subtle">
                  No artist or album groups found in this playlist.
                </p>
              ) : (
                (["artist", "album"] as const).map((kind) => {
                  const list = groups
                    .filter((g) => g.kind === kind)
                    .slice(0, 20);
                  if (list.length === 0) return null;
                  return (
                    <section key={kind}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
                        {kind === "artist" ? "Same artist" : "Same album"}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {list.map((g) => (
                          <li key={`${g.kind}-${g.name}`}>
                            <button
                              type="button"
                              onClick={() =>
                                onSelectIndices(g.indices, "replace")
                              }
                              className="flex w-full items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-left transition hover:bg-white/15"
                            >
                              <MusicIcon className="h-3.5 w-3.5 shrink-0 text-spotify" />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {g.name}
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-subtle">
                                {g.indices.length} songs
                                {g.scattered ? " · scattered" : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Anchor picking state --------------------------------------- */}
      {tracks && selection.size > 0 && anchorMode && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">
              Move {anchorMode} which song?
            </span>
            <button
              type="button"
              onClick={() => {
                setAnchorMode(null);
                setAnchorQuery("");
              }}
              className="text-xs font-semibold text-subtle transition hover:text-white"
            >
              ← Back
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-md bg-highlight px-3 py-2">
            <SearchIcon className="h-4 w-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={anchorQuery}
              onChange={(e) => setAnchorQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAnchorMode(null);
                  setAnchorQuery("");
                }
              }}
              placeholder="Search songs"
              className="w-full bg-transparent text-sm outline-none placeholder:text-subtle/60"
            />
          </div>

          <div
            ref={anchorListRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-md bg-black/20 p-1"
          >
            {anchorResults.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-subtle">
                No matching songs
              </p>
            ) : (
              <div
                className="relative w-full"
                style={{ height: anchorVirtualizer.getTotalSize() }}
              >
                {anchorVirtualizer.getVirtualItems().map((row) => {
                  const { index, track } = anchorResults[row.index];
                  const year = track.releaseDate?.slice(0, 4);
                  return (
                    <button
                      key={`${track.uri}-${index}`}
                      type="button"
                      onClick={() => pickAnchor(index)}
                      className="absolute left-0 top-0 flex w-full items-center gap-2 rounded px-2 text-left transition hover:bg-white/10"
                      style={{
                        height: ANCHOR_ROW_HEIGHT,
                        transform: `translateY(${row.start}px)`,
                      }}
                    >
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-subtle">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {track.name}
                        </span>
                        <span className="block truncate text-xs text-subtle">
                          {track.artists.join(", ")}
                          {year ? ` · ${year}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
