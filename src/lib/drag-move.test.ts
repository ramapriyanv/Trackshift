import { describe, expect, it } from "vitest";
import { draggedTrackIndices, dragScrollSpeed, trackDropTarget, TRACK_ROW_HEIGHT } from "./drag-move";
import { planMove } from "./reorder";
import { filterTrackIndices, emptyFilters } from "./track-filters";
import type { PlaylistTrack } from "@/types/spotify";

describe("dragging filtered playlist tracks", () => {
  const visible = [1, 4, 7];

  it("uses the full-playlist anchor before a filtered result", () => {
    const destination = trackDropTarget(visible, [7], TRACK_ROW_HEIGHT + 5)!;
    expect(destination).toEqual({ kind: "before", anchorIndex: 4 });
    const plan = planMove(9, { selectedIndices: [7], destination });
    expect(plan.newOrder).toEqual([0, 1, 2, 3, 7, 4, 5, 6, 8]);
    expect(plan.newOrder.filter((index) => ![1, 4, 7].includes(index))).toEqual([0, 2, 3, 5, 6, 8]);
  });

  it("uses the full-playlist anchor after the bottom half of a filtered row", () => {
    const destination = trackDropTarget(visible, [7], TRACK_ROW_HEIGHT - 4)!;
    expect(destination).toEqual({ kind: "after", anchorIndex: 1 });
    expect(planMove(9, { selectedIndices: [7], destination }).newOrder).toEqual([0, 1, 7, 2, 3, 4, 5, 6, 8]);
  });

  it("moves the whole selected group in original order, including selected tracks hidden by a filter", () => {
    const selectedIndices = draggedTrackIndices(1, new Set([6, 1]));
    expect(selectedIndices).toEqual([1, 6]);
    const destination = trackDropTarget(visible, selectedIndices, 3 * TRACK_ROW_HEIGHT)!;
    const plan = planMove(9, { selectedIndices, destination });
    expect(plan.newOrder).toEqual([0, 2, 3, 4, 5, 7, 1, 6, 8]);
    expect(new Set(plan.newOrder).size).toBe(9);
  });

  it("drags just the source when it is outside the selection", () => {
    expect(draggedTrackIndices(4, new Set([1, 6]))).toEqual([4]);
  });

  it("does not target a selected row or an empty list", () => {
    expect(trackDropTarget(visible, [4, 7], TRACK_ROW_HEIGHT + 5)).toBeNull();
    expect(trackDropTarget([], [4], 10)).toBeNull();
    expect(trackDropTarget(visible, [7], Number.NaN)).toBeNull();
  });

  it("anchors whitespace drops to the first or last visible track", () => {
    expect(trackDropTarget(visible, [3], -10)).toEqual({ kind: "before", anchorIndex: 1 });
    expect(trackDropTarget(visible, [3], 1000)).toEqual({ kind: "after", anchorIndex: 7 });
  });

  it("keeps original indices when artist, album, and year filters are combined", () => {
    const tracks: PlaylistTrack[] = Array.from({ length: 9 }, (_, index) => ({
      uri: `track:${index}`, id: String(index), name: `Song ${index}`, artists: [visible.includes(index) ? "Match" : "Other"],
      album: "Album", albumImageUrl: null, releaseDate: "2015", durationMs: 1000, isLocal: false,
    }));
    const order = filterTrackIndices(tracks, { ...emptyFilters, artist: "match", album: "album", year: "2015-2018" });
    expect(order).toEqual(visible);
    expect(trackDropTarget(order, [7], 10)).toEqual({ kind: "before", anchorIndex: 1 });
  });
});

describe("drag edge scrolling", () => {
  it("scrolls up/down at edges and stays still in the middle or outside the list", () => {
    expect(dragScrollSpeed(101, 100, 400)).toBeLessThan(0);
    expect(dragScrollSpeed(499, 100, 400)).toBeGreaterThan(0);
    expect(dragScrollSpeed(300, 100, 400)).toBe(0);
    expect(dragScrollSpeed(99, 100, 400)).toBe(0);
    expect(dragScrollSpeed(501, 100, 400)).toBe(0);
    expect(dragScrollSpeed(100, 100, 0)).toBe(0);
  });
});
