import type { Destination } from "@/types/move-command";

export const TRACK_ROW_HEIGHT = 56;
export type TrackDropTarget = Extract<Destination, { kind: "before" | "after" }>;

export function draggedTrackIndices(source: number, selection: Set<number>): number[] {
  return selection.has(source) ? [...selection].sort((a, b) => a - b) : [source];
}

/** Resolve a drop against original indices, never positions in filtered results. */
export function trackDropTarget(order: number[], dragged: number[], offsetY: number): TrackDropTarget | null {
  if (!order.length || !Number.isFinite(offsetY)) return null;
  const row = Math.max(0, Math.min(order.length - 1, Math.floor(offsetY / TRACK_ROW_HEIGHT)));
  const anchorIndex = order[row];
  if (dragged.includes(anchorIndex)) return null;
  return {
    kind: offsetY - row * TRACK_ROW_HEIGHT < TRACK_ROW_HEIGHT / 2 ? "before" : "after",
    anchorIndex,
  };
}

/** Per-frame scroll speed while dragging near the visible list edges. */
export function dragScrollSpeed(clientY: number, top: number, height: number): number {
  if (clientY < top || clientY > top + height || height <= 0) return 0;
  const edge = Math.min(48, height / 3);
  if (clientY < top + edge) return -Math.ceil(16 * (1 - (clientY - top) / edge));
  if (clientY > top + height - edge) return Math.ceil(16 * (1 - (top + height - clientY) / edge));
  return 0;
}
