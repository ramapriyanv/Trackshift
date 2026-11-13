import { describe, expect, it } from "vitest";
import { emptySelection, selectionReducer } from "./selection";

describe("undo selection", () => {
  it("restores a selection and its range anchor after clearing", () => {
    const selected = selectionReducer(emptySelection, { type: "change", indices: [1, 4], anchor: 1 });
    const cleared = selectionReducer(selected, { type: "change", indices: [], anchor: null });
    expect(selectionReducer(cleared, { type: "undo" })).toEqual({ indices: [1, 4], anchor: 1, previous: null });
  });
  it("restores the previous state after selecting filtered matches", () => {
    const one = selectionReducer(emptySelection, { type: "change", indices: [3], anchor: 3 });
    const matches = selectionReducer(one, { type: "change", indices: [1, 3, 7], anchor: null });
    expect(selectionReducer(matches, { type: "undo" }).indices).toEqual([3]);
  });
  it("deduplicates and sorts positions and does not overwrite history on a no-op", () => {
    const selected = selectionReducer(emptySelection, { type: "change", indices: [4, 1, 4], anchor: 4 });
    const unchanged = selectionReducer(selected, { type: "change", indices: [1, 4], anchor: null });
    expect(unchanged.indices).toEqual([1, 4]);
    expect(selectionReducer(unchanged, { type: "undo" }).indices).toEqual([]);
  });
  it("clears undo history on playlist load or successful move", () => {
    const selected = selectionReducer(emptySelection, { type: "change", indices: [2], anchor: 2 });
    expect(selectionReducer(selected, { type: "reset" })).toEqual(emptySelection);
  });
});
