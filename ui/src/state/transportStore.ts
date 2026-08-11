import type { ProjectAction, SelectionStoreState, TransportStoreState } from "./projectStoreTypes.ts";

function normalizeTick(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function hasTimeSelection(
  state: Pick<SelectionStoreState, "timeSelectionStartTick" | "timeSelectionEndTick">,
): boolean {
  return state.timeSelectionStartTick !== null && state.timeSelectionEndTick !== null;
}

export const initialTransportStoreState: TransportStoreState = {
  playheadTick: 0,
  loopEnabled: false,
  isPlaying: false,
  error: null,
  busyTask: null,
};

export function reduceTransportStore(
  state: TransportStoreState,
  action: ProjectAction,
  selectionState: Pick<SelectionStoreState, "timeSelectionStartTick" | "timeSelectionEndTick">,
): TransportStoreState {
  switch (action.type) {
    case "SET_PROJECT":
      return {
        ...state,
        loopEnabled: false,
        error: null,
      };

    case "COMMAND_APPLIED":
    case "UNDO_APPLIED":
    case "REDO_APPLIED":
      return {
        ...state,
        error: null,
      };

    case "SET_PLAYHEAD":
      return { ...state, playheadTick: normalizeTick(action.tick) };

    case "CLEAR_SELECTION":
      return {
        ...state,
        loopEnabled: false,
      };

    case "SET_TIME_SELECTION":
      return {
        ...state,
        loopEnabled: hasTimeSelection(selectionState) ? state.loopEnabled : false,
      };

    case "SET_LOOP_ENABLED":
      return {
        ...state,
        loopEnabled: hasTimeSelection(selectionState) ? action.enabled : false,
      };

    case "SET_PLAYING":
      return { ...state, isPlaying: action.playing };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "SET_BUSY_TASK":
      return { ...state, busyTask: action.busyTask };

    case "CLEAR_BUSY_TASK":
      return { ...state, busyTask: null };

    default:
      return state;
  }
}
