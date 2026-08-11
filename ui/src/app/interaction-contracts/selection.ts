import type { ClipId, TrackId } from "@/types";

export type SelectedClipKind = "audio" | "midi" | null;

export interface TrackSelectionState {
  selectedTrackId: TrackId | null;
}

export interface ClipSelectionState {
  selectedClipIds: ClipId[];
  primaryClipId: ClipId | null;
  selectedClipKind: SelectedClipKind;
}

export interface TimeRangeSelectionState {
  timeSelectionStartTick: number | null;
  timeSelectionEndTick: number | null;
}

export interface EditorSelectionState
  extends TrackSelectionState,
    ClipSelectionState {
  timeSelectionStartTick: number | null;
  timeSelectionEndTick: number | null;
}
