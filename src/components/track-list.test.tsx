import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TrackList from "./track-list";
import type { PlaylistTrack } from "@/types/spotify";

vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => Array.from({ length: endIndex - startIndex + 1 }, (_, index) => startIndex + index),
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 56,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 56 })),
  }),
}));

const tracks: PlaylistTrack[] = Array.from({ length: 9 }, (_, i) => ({ uri: `track:${i}`, id: String(i), name: `Song ${i}`, artists: ["Artist"], album: "Album", albumImageUrl: null, releaseDate: "2015", durationMs: 1000, isLocal: false }));

describe("track positions", () => {
  it("renders original playlist positions in filtered results", () => {
    const html = renderToStaticMarkup(<TrackList tracks={tracks} order={[3, 7]} selection={new Set()} movedSet={null} onRowClick={() => {}} />);
    expect(html).toContain(">4</span>");
    expect(html).toContain(">8</span>");
    expect(html).not.toContain(">1</span>");
    expect(html).not.toContain(">2</span>");
  });
  it("renders new positions during preview and highlights matching metadata", () => {
    const sourceOrder = [7, 3, 0, 1, 2, 4, 5, 6, 8];
    const html = renderToStaticMarkup(<TrackList tracks={sourceOrder.map((index) => tracks[index])} order={[0, 1]} selection={new Set()} movedSet={new Set([0, 1])} sourceOrder={sourceOrder} metadataHighlights={{ artist: true, album: true, year: true }} onRowClick={() => {}} />);
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    expect(html).toContain("text-spotify-bright");
  });
  it("allows dragging and selecting in a pending draft, but disables dragging during apply", () => {
    const render = (disabled: boolean, movedSet: Set<number> | null) => renderToStaticMarkup(<TrackList tracks={tracks} order={[3, 7]} selection={new Set([3])} movedSet={movedSet} disabled={disabled} onDropTracks={() => {}} onRowClick={() => {}} />);
    expect(render(false, null)).toContain('draggable="true"');
    expect(render(true, null)).not.toContain('draggable="true"');
    expect(render(false, new Set([3]))).toContain('draggable="true"');
    expect(render(false, new Set([3]))).toContain('aria-pressed="true"');
  });
  it("shows full working positions when a pending batch is filtered", () => {
    const sourceOrder = [7, 3, 0, 1, 2, 4, 5, 6, 8];
    const html = renderToStaticMarkup(<TrackList tracks={sourceOrder.map((index) => tracks[index])} order={[1, 4]} selection={new Set([4])} movedSet={new Set([1, 4])} sourceOrder={sourceOrder} onDropTracks={() => {}} onRowClick={() => {}} />);
    expect(html).toContain(">2</span>");
    expect(html).toContain(">5</span>");
    expect(html).not.toContain(">1</span>");
    expect(html).toContain("4 → 2");
    expect(html).toContain("3 → 5");
    expect(html).toContain('draggable="true"');
  });
});
