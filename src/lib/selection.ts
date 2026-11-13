export type SelectionState = {
  indices: number[];
  anchor: number | null;
  previous: { indices: number[]; anchor: number | null } | null;
};
export const emptySelection: SelectionState = { indices: [], anchor: null, previous: null };
type Action = { type: "change"; indices: number[]; anchor: number | null } | { type: "undo" | "reset" };

export function selectionReducer(state: SelectionState, action: Action): SelectionState {
  if (action.type === "reset") return emptySelection;
  if (action.type === "undo") return state.previous ? { ...state.previous, previous: null } : state;
  if (action.type !== "change") return state;
  const indices = [...new Set(action.indices)].sort((a, b) => a - b);
  if (indices.length === state.indices.length && indices.every((value, index) => value === state.indices[index])) return { ...state, anchor: action.anchor };
  return { indices, anchor: action.anchor, previous: { indices: state.indices, anchor: state.anchor } };
}
