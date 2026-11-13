import { describe, expect, it } from "vitest";
import { planMove, planMoves, type ReorderOp } from "./reorder";
import { inverseOrder } from "./move-undo";
import type { MoveCommand } from "@/types/move-command";

/** Apply Spotify reorder semantics to an array (for verifying ops). */
function applyOps<T>(items: T[], ops: ReorderOp[]): T[] {
  const arr = [...items];
  for (const { rangeStart, rangeLength, insertBefore } of ops) {
    const block = arr.splice(rangeStart, rangeLength);
    const at = insertBefore > rangeStart ? insertBefore - rangeLength : insertBefore;
    arr.splice(at, 0, ...block);
  }
  return arr;
}

function run(length: number, command: MoveCommand) {
  const plan = planMove(length, command);
  // Ops must reproduce exactly the previewed order when applied like Spotify does.
  expect(applyOps(Array.from({ length }, (_, i) => i), plan.ops)).toEqual(plan.newOrder);
  return plan;
}

describe("planMove", () => {
  it("moves a single track to the top", () => {
    const plan = run(5, { selectedIndices: [3], destination: { kind: "top" } });
    expect(plan.newOrder).toEqual([3, 0, 1, 2, 4]);
    expect(plan.ops).toHaveLength(1);
  });

  it("moves a single track to the bottom", () => {
    const plan = run(5, { selectedIndices: [1], destination: { kind: "bottom" } });
    expect(plan.newOrder).toEqual([0, 2, 3, 4, 1]);
    expect(plan.ops).toHaveLength(1);
  });

  it("moves a contiguous range before an anchor", () => {
    const plan = run(6, {
      selectedIndices: [3, 4],
      destination: { kind: "before", anchorIndex: 1 },
    });
    expect(plan.newOrder).toEqual([0, 3, 4, 1, 2, 5]);
    expect(plan.ops).toHaveLength(1);
  });

  it("moves a contiguous range after an anchor further down", () => {
    const plan = run(6, {
      selectedIndices: [0, 1],
      destination: { kind: "after", anchorIndex: 4 },
    });
    expect(plan.newOrder).toEqual([2, 3, 4, 0, 1, 5]);
    expect(plan.ops).toHaveLength(1);
  });

  it("gathers a scattered selection into one block at the destination", () => {
    const plan = run(8, {
      selectedIndices: [1, 4, 6],
      destination: { kind: "top" },
    });
    expect(plan.newOrder).toEqual([1, 4, 6, 0, 2, 3, 5, 7]);
  });

  it("moves a scattered selection after an anchor", () => {
    const plan = run(8, {
      selectedIndices: [0, 5],
      destination: { kind: "after", anchorIndex: 7 },
    });
    expect(plan.newOrder).toEqual([1, 2, 3, 4, 6, 7, 0, 5]);
  });

  it("moves to a specific 1-based position", () => {
    const plan = run(5, {
      selectedIndices: [4],
      destination: { kind: "position", position: 2 },
    });
    expect(plan.newOrder).toEqual([0, 4, 1, 2, 3]);
  });

  it("clamps out-of-range positions", () => {
    const low = run(5, { selectedIndices: [2], destination: { kind: "position", position: 0 } });
    expect(low.newOrder).toEqual([2, 0, 1, 3, 4]);
    const high = run(5, { selectedIndices: [2], destination: { kind: "position", position: 99 } });
    expect(high.newOrder).toEqual([0, 1, 3, 4, 2]);
  });

  it("is a no-op when the selection is already in place", () => {
    const plan = run(5, { selectedIndices: [0, 1], destination: { kind: "top" } });
    expect(plan.newOrder).toEqual([0, 1, 2, 3, 4]);
    expect(plan.ops).toEqual([]);
  });

  it("is a no-op for an empty or full selection", () => {
    expect(run(4, { selectedIndices: [], destination: { kind: "top" } }).ops).toEqual([]);
    expect(
      run(4, { selectedIndices: [0, 1, 2, 3], destination: { kind: "bottom" } }).ops,
    ).toEqual([]);
  });

  it("ignores duplicate and out-of-range indices", () => {
    const plan = run(5, {
      selectedIndices: [3, 3, -1, 42],
      destination: { kind: "top" },
    });
    expect(plan.newOrder).toEqual([3, 0, 1, 2, 4]);
  });

  it("rejects an anchor that is part of the selection", () => {
    expect(() =>
      planMove(5, {
        selectedIndices: [1, 2],
        destination: { kind: "before", anchorIndex: 2 },
      }),
    ).toThrow(/anchor/i);
  });

  it("handles a large scattered move with multiple ops correctly", () => {
    const plan = run(20, {
      selectedIndices: [2, 7, 8, 13, 19],
      destination: { kind: "position", position: 5 },
    });
    const moved = plan.newOrder.slice(4, 9);
    expect(moved).toEqual([2, 7, 8, 13, 19]);
  });
});

describe("batch moves", () => {
  const commands: MoveCommand[] = [
    { selectedIndices: [4], destination: { kind: "top" } },
    { selectedIndices: [2, 5], destination: { kind: "after", anchorIndex: 3 } },
    { selectedIndices: [4, 5], destination: { kind: "position", position: 2 } },
  ];

  it("composes moves using positions in each intermediate working order", () => {
    // Start ABCDEF; stage EABCDF, then EACBFD, then EFDACB.
    const first = planMoves(6, commands.slice(0, 1));
    const second = planMoves(6, commands.slice(0, 2));
    const final = planMoves(6, commands);
    expect(first.newOrder).toEqual([4, 0, 1, 2, 3, 5]);
    expect(second.newOrder).toEqual([4, 0, 2, 1, 5, 3]);
    expect(final.newOrder).toEqual([4, 5, 3, 0, 2, 1]);
    expect(applyOps([0, 1, 2, 3, 4, 5], final.ops)).toEqual(final.newOrder);
    expect(new Set(final.newOrder).size).toBe(6);
  });

  it("undoes pending moves by replaying the remaining prefix", () => {
    expect(planMoves(6, commands.slice(0, -1)).newOrder).toEqual([4, 0, 2, 1, 5, 3]);
    expect(planMoves(6, []).newOrder).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("can undo the entire applied batch with one inverse order", () => {
    const final = planMoves(6, commands);
    const undo = planMoves(6, []);
    // diffToOps receives the inverse permutation of the whole batch.
    const inverse = inverseOrder(final.newOrder);
    const restored = inverse.map((index) => final.newOrder[index]);
    expect(restored).toEqual(undo.newOrder);
  });

  it("supports re-moving the same track and batches that cancel out", () => {
    const result = planMoves(4, [
      { selectedIndices: [3], destination: { kind: "top" } },
      { selectedIndices: [0], destination: { kind: "bottom" } },
    ]);
    expect(result.newOrder).toEqual([0, 1, 2, 3]);
    expect(result.ops).toEqual([]);
  });

  it("rejects invalid indices in any pending command", () => {
    expect(() => planMoves(6, [...commands, { selectedIndices: [6], destination: { kind: "top" } }])).toThrow();
    expect(() => planMoves(6, [{ selectedIndices: [], destination: { kind: "bottom" } }])).toThrow();
  });
});
