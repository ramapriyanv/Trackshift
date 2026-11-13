// Pure reorder engine.
//
// Spotify's reorder endpoint (PUT /playlists/{id}/tracks) can only move ONE
// contiguous range per call. This module turns any MoveCommand (single track,
// contiguous range, or scattered multi-select) into:
//   1. `newOrder`  — the resulting order, for previewing before anything is applied
//   2. `ops`       — an ordered list of contiguous reorder operations that,
//                    executed sequentially against Spotify, produce that order.

import { isRemoval, type Destination, type MoveCommand, type PlaylistEdit } from "@/types/move-command";

export interface ReorderOp {
  rangeStart: number;
  rangeLength: number;
  insertBefore: number;
}

export interface MovePlan {
  /** Original track indices in their new order. */
  newOrder: number[];
  /** Contiguous Spotify reorder operations, to be applied in sequence. */
  ops: ReorderOp[];
}

function identity(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveInsertAt(
  destination: Destination,
  remaining: number[],
  selectedSet: Set<number>,
): number {
  switch (destination.kind) {
    case "top":
      return 0;
    case "bottom":
      return remaining.length;
    case "position":
      // 1-based final start position of the moved block. The block's final
      // start index equals the number of non-selected tracks placed before it.
      return clamp(destination.position - 1, 0, remaining.length);
    case "before":
    case "after": {
      if (selectedSet.has(destination.anchorIndex)) {
        throw new Error("Anchor track cannot be part of the selection");
      }
      const idx = remaining.indexOf(destination.anchorIndex);
      if (idx === -1) {
        throw new Error("Anchor track not found in playlist");
      }
      return destination.kind === "before" ? idx : idx + 1;
    }
  }
}

/**
 * Plan a move: compute the new order and the contiguous Spotify reorder ops
 * needed to reach it. Throws if the destination anchor is invalid.
 */
export function planMove(length: number, command: MoveCommand): MovePlan {
  const selected = [...new Set(command.selectedIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < length)
    .sort((a, b) => a - b);

  if (selected.length === 0 || selected.length === length) {
    return { newOrder: identity(length), ops: [] };
  }

  const selectedSet = new Set(selected);
  const remaining: number[] = [];
  for (let i = 0; i < length; i++) {
    if (!selectedSet.has(i)) remaining.push(i);
  }

  const insertAt = resolveInsertAt(command.destination, remaining, selectedSet);
  const newOrder = [
    ...remaining.slice(0, insertAt),
    ...selected,
    ...remaining.slice(insertAt),
  ];

  return { newOrder, ops: diffToOps(length, newOrder) };
}

/** Each command addresses positions in the working order left by the previous command. */
export function planMoves(length: number, commands: PlaylistEdit[]): MovePlan & { removedIndices: number[] } {
  let newOrder = identity(length);
  for (const command of commands) {
    if (!command.selectedIndices.length || command.selectedIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= newOrder.length)) {
      throw new Error("Selected tracks no longer match the playlist");
    }
    if (isRemoval(command)) {
      const selected = new Set(command.selectedIndices);
      newOrder = newOrder.filter((_, index) => !selected.has(index));
    } else {
      const step = planMove(newOrder.length, command);
      newOrder = step.newOrder.map((index) => newOrder[index]);
    }
  }
  const retained = new Set(newOrder);
  const remaining = identity(length).filter((index) => retained.has(index));
  const removedIndices = identity(length).filter((index) => !retained.has(index));
  const positions = new Map(remaining.map((original, position) => [original, position]));
  return { newOrder, removedIndices, ops: diffToOps(remaining.length, newOrder.map((index) => positions.get(index)!)) };
}

/**
 * Greedy transform of the identity order into `newOrder` using contiguous
 * block moves. Every op moves a block toward the front, which maps directly
 * onto Spotify's semantics (insert_before is expressed in pre-removal indices;
 * since insertBefore < rangeStart there is no index shift to account for).
 */
export function diffToOps(length: number, newOrder: number[]): ReorderOp[] {
  const current = identity(length);
  const ops: ReorderOp[] = [];

  for (let i = 0; i < length; i++) {
    if (current[i] === newOrder[i]) continue;

    const j = current.indexOf(newOrder[i], i + 1);
    let len = 1;
    while (
      i + len < length &&
      j + len < length &&
      current[j + len] === newOrder[i + len]
    ) {
      len++;
    }

    ops.push({ rangeStart: j, rangeLength: len, insertBefore: i });
    // Simulate the move: remove the block at j, insert it at i (i < j).
    current.splice(i, 0, ...current.splice(j, len));
    i += len - 1;
  }

  return ops;
}
