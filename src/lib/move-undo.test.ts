import { afterEach, describe, expect, it, vi } from "vitest";
import { createUndoReceipt, inverseOrder, readUndoReceipt } from "./move-undo";
import { diffToOps, planMove } from "./reorder";

afterEach(() => vi.unstubAllEnvs());
describe("move undo", () => {
  it.each([
    [3], [1, 2], [0, 3, 5],
  ])("reverses a move of indices %j using only reorder operations", (...indices) => {
    const plan = planMove(6, { selectedIndices: indices, destination: { kind: "bottom" } });
    const inverse = inverseOrder(plan.newOrder);
    const current = [...plan.newOrder];
    for (const op of diffToOps(6, inverse)) current.splice(op.insertBefore, 0, ...current.splice(op.rangeStart, op.rangeLength));
    expect(current).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("signs restore data bound to a playlist and snapshot", () => {
    vi.stubEnv("AUTH_SECRET", "undo-test-secret");
    const receipt = { playlistId: "p1", snapshotId: "after-move", order: [1, 0, 2] };
    const token = createUndoReceipt(receipt);
    expect(readUndoReceipt(token, "p1")).toEqual(receipt);
    expect(() => readUndoReceipt(token, "p2")).toThrow();
    expect(() => readUndoReceipt(`x${token}`, "p1")).toThrow();
  });
  it("rejects non-permutation restore orders", () => {
    expect(() => inverseOrder([0, 0])).toThrow();
    expect(() => inverseOrder([0, 3])).toThrow();
  });
});
