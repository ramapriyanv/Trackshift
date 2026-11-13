// Shared contract for all move requests.
// The manual UI (and a future AI command parser) both emit MoveCommand objects.
// A MoveCommand is only ever applied after the user confirms a preview.

export type Destination =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "before"; anchorIndex: number }
  | { kind: "after"; anchorIndex: number }
  /** 1-based final position the first moved track should end up at. */
  | { kind: "position"; position: number };

export interface MoveCommand {
  /** Zero-based positions in the working order immediately before this move.
   * In a batch, commands are interpreted sequentially, not against the starting order.
   */
  selectedIndices: number[];
  destination: Destination;
}

export interface RemoveCommand {
  kind: "remove";
  selectedIndices: number[];
}

export type PlaylistEdit = MoveCommand | RemoveCommand;

export function isRemoval(command: PlaylistEdit): command is RemoveCommand {
  return "kind" in command && command.kind === "remove";
}
