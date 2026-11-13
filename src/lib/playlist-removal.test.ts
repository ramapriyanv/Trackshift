import { describe, expect, it } from "vitest";
import { removalUris } from "./playlist-removal";
import { planMoves } from "./reorder";
import { inverseOrder } from "./move-undo";

const tracks = ["A", "B", "A", "C", "D", "E"].map((id) => ({ uri: `spotify:track:${id}`, name: id, isLocal: false }));

describe("playlist removal planning", () => {
  it("rejects removal of one duplicate without expanding the selection", () => {
    expect(() => removalUris(tracks, [0])).toThrow(/all copies/);
    expect(tracks).toHaveLength(6);
  });
  it("allows all duplicate copies while sending only one URI", () => {
    expect(removalUris(tracks, [0, 2])).toEqual(["spotify:track:A"]);
  });
  it("blocks local, unavailable, and invalid selections", () => {
    expect(() => removalUris([{ uri: "spotify:local:A", name: "Local", isLocal: true }], [0])).toThrow(/Local/);
    expect(() => removalUris([{ uri: "", name: "Unavailable", isLocal: false }], [0])).toThrow();
    expect(() => removalUris(tracks, [99])).toThrow();
  });
  it("composes moves and removals using the changing working positions", () => {
    const plan = planMoves(6, [
      { selectedIndices: [5], destination: { kind: "top" } },
      { kind: "remove", selectedIndices: [1, 3] },
      { selectedIndices: [3], destination: { kind: "position", position: 2 } },
    ]);
    expect(plan.newOrder).toEqual([5, 4, 1, 3]);
    expect(plan.removedIndices).toEqual([0, 2]);
    const retainedOriginal = [1, 3, 4, 5];
    for (const op of plan.ops) retainedOriginal.splice(op.insertBefore, 0, ...retainedOriginal.splice(op.rangeStart, op.rangeLength));
    expect(retainedOriginal).toEqual(plan.newOrder);
    const available = [...plan.newOrder, ...plan.removedIndices];
    expect(inverseOrder(available).map((index) => available[index])).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("supports removing everything and undoing a pending removal", () => {
    const commands = [{ kind: "remove" as const, selectedIndices: [0, 1, 2] }];
    expect(planMoves(3, commands)).toEqual({ newOrder: [], removedIndices: [0, 1, 2], ops: [] });
    expect(planMoves(3, commands.slice(0, -1)).newOrder).toEqual([0, 1, 2]);
  });
  it("validates later moves against the reduced playlist length", () => {
    expect(() => planMoves(3, [
      { kind: "remove", selectedIndices: [1] },
      { selectedIndices: [2], destination: { kind: "top" } },
    ])).toThrow();
  });
});
