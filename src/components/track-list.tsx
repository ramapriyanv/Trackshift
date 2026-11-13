"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { draggedTrackIndices, dragScrollSpeed, trackDropTarget, TRACK_ROW_HEIGHT, type TrackDropTarget } from "@/lib/drag-move";
import type { MoveCommand } from "@/types/move-command";
import type { PlaylistTrack } from "@/types/spotify";
import { MusicIcon } from "./icons";

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Album release year, e.g. "2019". */
export function formatReleaseDate(date: string | null): string {
  if (!date) return "—";
  return date.slice(0, 4);
}

interface TrackListProps {
  tracks: PlaylistTrack[];
  /** Original track indices in display order. */
  order: number[];
  selection: Set<number>;
  /** Non-null while previewing: the set of moved (selected) original indices. */
  movedSet: Set<number> | null;
  /** Current working position -> original Spotify position, while a batch is pending. */
  sourceOrder?: number[];
  metadataHighlights?: { artist: boolean; album: boolean; year: boolean };
  disabled?: boolean;
  onDropTracks?: (command: MoveCommand) => void;
  onRowClick: (
    originalIndex: number,
    rowPos: number,
    e: React.MouseEvent,
  ) => void;
}

const ROW_HEIGHT = TRACK_ROW_HEIGHT;

export default function TrackList({
  tracks,
  order,
  selection,
  movedSet,
  sourceOrder,
  metadataHighlights,
  disabled = false,
  onDropTracks,
  onRowClick,
}: TrackListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ source: number; indices: number[] } | null>(null);
  const pointerY = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState<{ source: number; indices: number[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<TrackDropTarget | null>(null);
  const canDrag = !disabled && Boolean(onDropTracks);
  const sourceRow = dragging ? order.indexOf(dragging.source) : -1;
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => order[index],
    // Keep the native drag source mounted while the virtual list scrolls.
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      return sourceRow >= 0 ? [...new Set([...visible, sourceRow])].sort((a, b) => a - b) : visible;
    },
  });

  useEffect(() => {
    if (!dragging || !canDrag) return;
    let frame: number;
    const scroll = () => {
      const parent = parentRef.current;
      if (parent && pointerY.current !== null && dragRef.current) {
        const rect = parent.getBoundingClientRect();
        parent.scrollTop += dragScrollSpeed(pointerY.current, rect.top, rect.height);
        const next = trackDropTarget(order, dragRef.current.indices, parent.scrollTop + pointerY.current - rect.top);
        setDropTarget((current) => current?.kind === next?.kind && current?.anchorIndex === next?.anchorIndex ? current : next);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, canDrag, order]);

  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

  const finishDrag = () => {
    dragRef.current = null;
    pointerY.current = null;
    setDragging(null);
    setDropTarget(null);
    // Browsers may dispatch a click immediately after dragend.
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { suppressClick.current = false; }, 100);
  };

  const resolveDrop = (clientY: number) => {
    const parent = parentRef.current;
    return parent && dragRef.current ? trackDropTarget(order, dragRef.current.indices, parent.scrollTop + clientY - parent.getBoundingClientRect().top) : null;
  };

  const dropRow = dropTarget ? order.indexOf(dropTarget.anchorIndex) : -1;
  const dropOffset = dropRow >= 0 ? (dropRow + (dropTarget?.kind === "after" ? 1 : 0)) * ROW_HEIGHT : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Column headers */}
      <div className="grid grid-cols-[3.5rem_minmax(0,5fr)_minmax(0,4fr)_4rem_5rem] items-center gap-3 border-b border-white/10 px-4 pb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
        <span className="text-right">#</span>
        <span>Title</span>
        <span className="hidden md:block">Album</span>
        <span className="hidden lg:block">Year</span>
        <span className="text-right">Time</span>
      </div>

      {canDrag && <p className="px-4 py-2 text-xs text-subtle">Drag a song or selected group above or below another track, then confirm the preview.</p>}
      <div role="status" aria-live="polite" className={dragging ? "px-4 pb-2 text-xs text-spotify-bright" : "sr-only"}>
        {dragging && (dropTarget ? `Move ${dragging.indices.length} song${dragging.indices.length === 1 ? "" : "s"} ${dropTarget.kind} #${dropTarget.anchorIndex + 1} ${tracks[dropTarget.anchorIndex].name}` : `Dragging ${dragging.indices.length} song${dragging.indices.length === 1 ? "" : "s"}. Drop above or below an unselected track.`)}
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto"
        onDragOver={(event) => {
          if (!canDrag || !dragRef.current) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          pointerY.current = event.clientY;
          const next = resolveDrop(event.clientY);
          setDropTarget((current) => current?.kind === next?.kind && current?.anchorIndex === next?.anchorIndex ? current : next);
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { pointerY.current = null; setDropTarget(null); }
        }}
        onDrop={(event) => {
          if (!canDrag || !dragRef.current) return;
          event.preventDefault();
          const destination = resolveDrop(event.clientY);
          const selectedIndices = dragRef.current.indices;
          finishDrag();
          if (destination) onDropTracks?.({ selectedIndices, destination });
        }}>
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const originalIndex = order[row.index];
            const track = tracks[originalIndex];
            const isSelected = selection.has(originalIndex);
            const isMoved = movedSet?.has(originalIndex) ?? false;

            return (
              <button
                type="button"
                aria-pressed={isSelected}
                key={row.key}
                draggable={canDrag}
                onDragStart={(event) => {
                  if (!canDrag) { event.preventDefault(); return; }
                  const indices = draggedTrackIndices(originalIndex, selection);
                  const drag = { source: originalIndex, indices };
                  dragRef.current = drag;
                  setDragging(drag);
                  suppressClick.current = true;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-trackshift-tracks", JSON.stringify(indices));
                  event.dataTransfer.setData("text/plain", `${indices.length} TrackShift song(s)`);
                }}
                onDragEnd={finishDrag}
                onClick={(e) => { if (!suppressClick.current && !disabled) onRowClick(originalIndex, row.index, e); }}
                className={`absolute left-0 top-0 grid w-full select-none grid-cols-[3.5rem_minmax(0,5fr)_minmax(0,4fr)_4rem_5rem] items-center gap-3 rounded px-4 text-left transition-colors ${
                  isSelected
                    ? "bg-white/15"
                    : isMoved
                      ? "bg-spotify/15 shadow-[inset_3px_0_0_0_var(--color-spotify)]"
                      : "hover:bg-white/5"
                }`}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${row.start}px)`,
                  opacity: dragging?.indices.includes(originalIndex) ? 0.45 : 1,
                  cursor: canDrag ? "grab" : undefined,
                }}
              >
                <span
                  className={`text-right text-sm tabular-nums ${
                    isSelected || isMoved ? "text-spotify-bright" : "text-subtle"
                  }`}
                >
                  {originalIndex + 1}
                </span>

                <span className="flex min-w-0 items-center gap-3">
                  {track.albumImageUrl ? (
                    <Image
                      src={track.albumImageUrl}
                      alt=""
                      draggable={false}
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-highlight">
                      <MusicIcon className="h-4 w-4 text-subtle" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm font-medium ${
                        isSelected || isMoved ? "text-spotify-bright" : "text-white"
                      }`}
                    >
                      {track.name}
                    </span>
                    <span className={`block truncate text-xs ${metadataHighlights?.artist ? "text-spotify-bright" : "text-subtle"}`}>
                      {track.artists.join(", ") || (track.isLocal ? "Local file" : "—")}
                    </span>
                  </span>
                </span>

                <span className={`hidden truncate text-sm md:block ${metadataHighlights?.album ? "text-spotify-bright" : "text-subtle"}`}>
                  {track.album}
                </span>

                <span className={`hidden truncate text-sm tabular-nums lg:block ${metadataHighlights?.year ? "text-spotify-bright" : "text-subtle"}`}>
                  {formatReleaseDate(track.releaseDate)}
                </span>

                <span className="flex items-center justify-end gap-2">
                  {isMoved && sourceOrder && (
                    <span className="rounded-full bg-spotify px-2 py-0.5 text-[10px] font-bold tabular-nums text-black">
                      {sourceOrder[originalIndex] + 1} → {originalIndex + 1}
                    </span>
                  )}
                  <span className="text-sm tabular-nums text-subtle">
                    {formatDuration(track.durationMs)}
                  </span>
                </span>
              </button>
            );
          })}
          {dropTarget && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-spotify-bright shadow-[0_0_8px_var(--color-spotify)]"
            style={{ top: dropOffset === virtualizer.getTotalSize() ? dropOffset - 2 : dropOffset }} />}
        </div>
      </div>
    </div>
  );
}
