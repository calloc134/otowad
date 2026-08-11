import type { MidiNote, NoteId } from "@/types";

export const NOTE_RESIZE_HANDLE = 6;
export const NOTE_START_MAGNET_MULTIPLIER = 1.25;

export interface NoteCreateState {
  noteId: NoteId;
  anchorTick: number;
  currentTick: number;
  key: number;
}

export interface PendingGridClick {
  anchorTick: number;
  key: number;
  seekProjectTick: number;
  startMouseX: number;
}

export interface MoveDragNoteSnapshot {
  index: number;
  note: MidiNote;
}

export interface NoteMoveDragState {
  type: "move";
  copy: boolean;
  noteIndices: number[];
  originalNotes: MoveDragNoteSnapshot[];
  clickedIndex: number;
  startMouseX: number;
  startMouseY: number;
  anchorStart: number;
  hasStarted: boolean;
  clickMode: "immediate" | "toggle";
  currentTickDelta: number;
  currentKeyDelta: number;
}

export interface NoteResizeDragState {
  type: "resize";
  noteIndex: number;
  startMouseX: number;
  origLength: number;
  currentLength: number;
}

export type NoteDragState = NoteMoveDragState | NoteResizeDragState;

export interface MarqueeState {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
}

export interface GridPointerSession {
  pointerId: number;
  mode: "marquee" | "pending-create" | "drag";
}

export interface MiddlePanPointerState {
  pointerId: number;
  startMouseX: number;
  startMouseY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

export interface MidiClipTiming {
  clipStart: number;
  contentIn: number;
  contentOut: number;
}

export interface MidiEditorGridActions {
  selectNote: (index: number | null) => void;
  selectNotes: (indices: number[]) => void;
  toggleNoteSelection: (index: number) => void;
  clearSelection: () => void;
  addNote: (note: MidiNote) => void;
  removeNotes: (indices: number[]) => void;
  moveNotes: (indices: number[], tickDelta: number, keyDelta: number) => void;
  duplicateNotes: (
    indices: number[],
    options?: { tickDelta?: number; keyDelta?: number },
  ) => void;
  resizeNote: (index: number, newLength: number) => void;
  setZoomX: (value: number) => void;
  setScrollFromEvent: (x: number, y: number) => void;
}

export interface MidiCopyGhostNote {
  index: number;
  start: number;
  key: number;
  length: number;
}
