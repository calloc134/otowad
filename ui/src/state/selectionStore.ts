import type { ClipEdit, ClipId, ProjectDocument } from "../types/index.ts";
import {
  normalizeTimeSelectionRange,
  type TimeSelectionRange,
} from "../utils/timelineInteractions.ts";

import type {
  ProjectAction,
  SelectionStoreState,
} from "./projectStoreTypes.ts";
import type { SelectedClipKind } from "@/app/interaction-contracts/selection.ts";

export const initialSelectionStoreState: SelectionStoreState = {
  selectedTrackId: null,
  selectedClipIds: [],
  primaryClipId: null,
  selectedClipKind: null,
  timeSelectionStartTick: null,
  timeSelectionEndTick: null,
};

export function getTimeSelectionRange(
  state: Pick<SelectionStoreState, "timeSelectionStartTick" | "timeSelectionEndTick">,
): TimeSelectionRange | null {
  if (
    state.timeSelectionStartTick === null ||
    state.timeSelectionEndTick === null
  ) {
    return null;
  }

  return {
    startTick: state.timeSelectionStartTick,
    endTick: state.timeSelectionEndTick,
  };
}

export function reconcileClipSelection(
  document: ProjectDocument | null,
  clipIds: ClipId[],
  primaryClipId: ClipId | null,
  selectedClipKind?: SelectedClipKind,
): {
  selectedClipIds: ClipId[];
  primaryClipId: ClipId | null;
  selectedClipKind: SelectedClipKind;
} {
  if (!document) {
    return { selectedClipIds: [], primaryClipId: null, selectedClipKind: null };
  }

  const clipById = new Map(document.edit.clips.map((clip) => [clip.id, clip]));
  const primaryClip = primaryClipId ? clipById.get(primaryClipId) ?? null : null;
  const preferredKind: SelectedClipKind = primaryClip?.kind.clip_type ?? selectedClipKind ?? null;

  const trackOrder = new Map(
    document.edit.tracks.map((track, index) => [track.id, index]),
  );
  const clipOrder = new Map(
    document.edit.clips.map((clip, index) => [clip.id, index]),
  );
  const seen = new Set<ClipId>();
  const selectedClipIds = clipIds
    .filter((clipId) => {
      if (seen.has(clipId)) return false;
      seen.add(clipId);
      const clip = clipById.get(clipId);
      if (!clip) {
        return false;
      }
      if (preferredKind && clip.kind.clip_type !== preferredKind) {
        return false;
      }
      return clipOrder.has(clipId);
    })
    .sort((leftId, rightId) => {
      const leftClip = clipById.get(leftId);
      const rightClip = clipById.get(rightId);
      if (!leftClip || !rightClip) return 0;

      const trackDelta =
        (trackOrder.get(leftClip.track_id) ?? Number.MAX_SAFE_INTEGER) -
        (trackOrder.get(rightClip.track_id) ?? Number.MAX_SAFE_INTEGER);
      if (trackDelta !== 0) return trackDelta;

      const startDelta = leftClip.start - rightClip.start;
      if (startDelta !== 0) return startDelta;

      return (
        (clipOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (clipOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER)
      );
    });

  if (selectedClipIds.length === 0) {
    return { selectedClipIds, primaryClipId: null, selectedClipKind: null };
  }

  const nextPrimaryClipId =
    primaryClipId && selectedClipIds.includes(primaryClipId)
      ? primaryClipId
      : selectedClipIds[0] ?? null;
  const nextPrimaryClip = nextPrimaryClipId ? clipById.get(nextPrimaryClipId) ?? null : null;

  return {
    selectedClipIds,
    primaryClipId: nextPrimaryClipId,
    selectedClipKind: nextPrimaryClip?.kind.clip_type ?? preferredKind ?? null,
  };
}

function resolveSelectedClipKind(
  document: ProjectDocument | null,
  clipIds: ClipId[],
  primaryClipId: ClipId | null,
): SelectedClipKind {
  if (!document) {
    return null;
  }

  const primaryClip = primaryClipId
    ? document.edit.clips.find((clip) => clip.id === primaryClipId) ?? null
    : null;
  if (primaryClip) {
    return primaryClip.kind.clip_type;
  }

  const firstSelectedClip = clipIds
    .map((clipId) => document.edit.clips.find((clip) => clip.id === clipId) ?? null)
    .find((clip): clip is ClipEdit => clip !== null);
  return firstSelectedClip?.kind.clip_type ?? null;
}

export function reduceSelectionStore(
  state: SelectionStoreState,
  action: ProjectAction,
  document: ProjectDocument | null,
): SelectionStoreState {
  switch (action.type) {
    case "SET_PROJECT":
      return {
        ...state,
        selectedTrackId: null,
        selectedClipIds: [],
        primaryClipId: null,
        selectedClipKind: null,
        timeSelectionStartTick: null,
        timeSelectionEndTick: null,
      };

    case "COMMAND_APPLIED":
    case "UNDO_APPLIED":
    case "REDO_APPLIED": {
        const clipSelection = reconcileClipSelection(
          action.document,
          state.selectedClipIds,
          state.primaryClipId,
          state.selectedClipKind,
        );
        return {
          ...state,
        selectedTrackId: action.document.edit.tracks.some(
          (track) => track.id === state.selectedTrackId,
        )
          ? state.selectedTrackId
          : null,
        ...clipSelection,
      };
    }

    case "SELECT_TRACK":
      return { ...state, selectedTrackId: action.trackId };

    case "CLEAR_SELECTION":
      return {
        ...state,
        selectedTrackId: null,
        selectedClipIds: [],
        primaryClipId: null,
        selectedClipKind: null,
        timeSelectionStartTick: null,
        timeSelectionEndTick: null,
      };

    case "SET_CLIP_SELECTION":
      return {
        ...state,
        ...reconcileClipSelection(
          document,
          action.clipIds,
          action.primaryClipId,
          resolveSelectedClipKind(document, action.clipIds, action.primaryClipId),
        ),
      };

    case "SET_TIME_SELECTION": {
      const selection = normalizeTimeSelectionRange(
        action.startTick,
        action.endTick,
      );
      return {
        ...state,
        timeSelectionStartTick: selection?.startTick ?? null,
        timeSelectionEndTick: selection?.endTick ?? null,
      };
    }

    default:
      return state;
  }
}
