import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MovePanel from "./move-panel";
import type { PlaylistTrack } from "@/types/spotify";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({ getTotalSize: () => 0, getVirtualItems: () => [] }),
}));

const tracks: PlaylistTrack[] = Array.from({ length: 4 }, (_, index) => ({
  uri: `track:${index}`, id: String(index), name: `Song ${index}`, artists: ["Artist"], album: "Album", albumImageUrl: null, releaseDate: "2015", durationMs: 1000, isLocal: false,
}));

describe("batch move panel", () => {
  it("keeps move controls available alongside one batch confirmation", () => {
    const html = renderToStaticMarkup(<MovePanel tracks={tracks} selection={new Set([1])}
      preview={{ commands: [{ selectedIndices: [3], destination: { kind: "top" } }], newOrder: [3, 0, 1, 2] }}
      applying={false} onMove={() => {}} onRemove={() => {}} onClear={() => {}} onApply={() => {}} onCancelPreview={() => {}}
      onUndoPendingMove={() => {}} onSelectIndices={() => {}} canUndoSelection={true} onUndoSelection={() => {}} />);
    expect(html).toContain("1 pending change");
    expect(html).toContain("Apply all changes");
    expect(html).toContain("Undo pending change");
    expect(html).toContain("Discard all changes");
    expect(html).toContain("Top</button>");
    expect(html).toContain("Bottom</button>");
    expect(html).toContain("1 selected");
  });
  it("shows a distinct removal button and review list alongside the batch confirmation", () => {
    const html = renderToStaticMarkup(<MovePanel tracks={tracks.slice(1)} selection={new Set([1])}
      preview={{ commands: [{ kind: "remove", selectedIndices: [0] }], newOrder: [1, 2, 3] }}
      applying={false} onMove={() => {}} onRemove={() => {}} onClear={() => {}} onApply={() => {}} onCancelPreview={() => {}}
      onUndoPendingMove={() => {}} onSelectIndices={() => {}} canUndoSelection={false} onUndoSelection={() => {}}
      onRemoveSelected={() => {}} pendingRemovals={[tracks[0]]} />);
    expect(html).toContain("Remove selected from playlist (1)");
    expect(html).toContain("1 song to remove from this playlist");
    expect(html).toContain("Song 0");
    expect(html).toContain("Apply all changes");
  });
});
