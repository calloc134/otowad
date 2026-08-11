import type { ClipId, ContentId, ProjectDocument, TrackId } from "../types/index.ts";
import type { EditorSelectionState } from "@/app/interaction-contracts/selection.ts";
import type { ViewportState } from "@/app/interaction-contracts/viewport.ts";

export interface MidiEditorTarget {
  contentId: ContentId;
  clipId: ClipId;
}

export interface BusyTask {
  kind: "opening" | "saving" | "exporting" | "importing" | "preparing-playback";
  title: string;
  detail: string | null;
  progress: number | null;
}

export interface DocumentStoreState {
  document: ProjectDocument | null;
  projectRevision: number;
  undoStack: string[];
  redoStack: string[];
  hasUnsavedChanges: boolean;
}

export interface SelectionStoreState extends EditorSelectionState {}

export interface ViewportStoreState extends ViewportState {}

export interface TransportStoreState {
  playheadTick: number;
  loopEnabled: boolean;
  isPlaying: boolean;
  error: string | null;
  busyTask: BusyTask | null;
}

export interface MidiEditorStoreState {
  midiEditorTarget: MidiEditorTarget | null;
}

export interface ProjectState
  extends DocumentStoreState,
    SelectionStoreState,
    ViewportStoreState,
    TransportStoreState,
    MidiEditorStoreState {
  wasmReady: boolean;
}

export type ProjectAction =
  | { type: "INIT_WASM" }
  | { type: "SET_PROJECT"; document: ProjectDocument; revision?: number }
  | {
      type: "COMMAND_APPLIED";
      document: ProjectDocument;
      inverse: string;
    }
  | {
      type: "UNDO_APPLIED";
      document: ProjectDocument;
      inverse: string;
      undoneCommand: string;
    }
  | {
      type: "REDO_APPLIED";
      document: ProjectDocument;
      inverse: string;
      redoneCommand: string;
    }
  | { type: "SELECT_TRACK"; trackId: TrackId | null }
  | { type: "CLEAR_SELECTION" }
  | {
      type: "SET_CLIP_SELECTION";
      clipIds: ClipId[];
      primaryClipId: ClipId | null;
    }
  | { type: "SET_PLAYHEAD"; tick: number }
  | { type: "SET_ZOOM"; x: number; y: number }
  | { type: "SET_SCROLL"; x: number; y: number }
  | { type: "SET_TIME_SELECTION"; startTick: number | null; endTick: number | null }
  | { type: "SET_LOOP_ENABLED"; enabled: boolean }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "OPEN_MIDI_EDITOR"; contentId: ContentId; clipId: ClipId }
  | { type: "CLOSE_MIDI_EDITOR" }
  | { type: "SET_HAS_UNSAVED_CHANGES"; value: boolean }
  | { type: "MARK_SAVED" }
  | { type: "SET_BUSY_TASK"; busyTask: BusyTask }
  | { type: "CLEAR_BUSY_TASK" };
