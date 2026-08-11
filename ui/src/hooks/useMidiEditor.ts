import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useProjectActions } from "@/store";
import { useGridSnap } from "@/hooks/useGridSnap";
import type { MidiNote, ContentId, ProjectDocument } from "@/types";
import {
  buildAddNotesCommand,
  buildRemoveNotesCommand,
  buildReplaceNotesCommand,
  findMatchingNoteIndices,
  getDuplicateNoteDelta,
  shiftNotesByDelta,
} from "@/utils/midiEditorEditing";
import {
  clampMidiNoteLengthToWindow,
  clampMidiNoteMoveDeltaToWindow,
  isMidiNoteInsideWindow,
  type MidiContentWindow,
} from "@/utils/midiClipWindow.ts";

// =============================================================================
// State
// =============================================================================

export interface MidiEditorState {
  selectedNoteIndices: number[];
  zoomX: number; // pixels per tick
  zoomY: number; // pixels per key (row height)
  scrollX: number;
  scrollY: number;
}

const INITIAL_ZOOM_X = 0.15;
const INITIAL_ZOOM_Y = 16;
// Default scroll to center around middle C (key 60).
// Keys are drawn from 127 (top) to 0 (bottom). Middle C = key 60.
// Offset to place key 60 roughly in center of a 600px viewport.
const INITIAL_SCROLL_Y = (127 - 60) * INITIAL_ZOOM_Y - 300;

const initialState: MidiEditorState = {
  selectedNoteIndices: [],
  zoomX: INITIAL_ZOOM_X,
  zoomY: INITIAL_ZOOM_Y,
  scrollX: 0,
  scrollY: Math.max(0, INITIAL_SCROLL_Y),
};

function normalizeSelectedNoteIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((left, right) => left - right);
}

// =============================================================================
// Actions
// =============================================================================

type MidiEditorAction =
  | { type: "SELECT_NOTES"; indices: number[] }
  | { type: "SET_ZOOM_X"; value: number }
  | { type: "SET_ZOOM_Y"; value: number }
  | { type: "SET_SCROLL"; x: number; y: number };

function midiEditorReducer(
  state: MidiEditorState,
  action: MidiEditorAction,
): MidiEditorState {
  switch (action.type) {
    case "SELECT_NOTES":
      return {
        ...state,
        selectedNoteIndices: normalizeSelectedNoteIndices(action.indices),
      };
    case "SET_ZOOM_X":
      return { ...state, zoomX: action.value };
    case "SET_ZOOM_Y":
      return { ...state, zoomY: action.value };
    case "SET_SCROLL":
      return { ...state, scrollX: action.x, scrollY: action.y };
  }
}

// =============================================================================
// Hook
// =============================================================================

const MIN_ZOOM_X = 0.01;
const MAX_ZOOM_X = 1.0;

export interface MidiEditorActions {
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

interface UseMidiEditorArgs {
  contentId: ContentId;
  document: ProjectDocument | null;
  contentWindow?: MidiContentWindow | null;
}

export function useMidiEditor({ contentId, document, contentWindow }: UseMidiEditorArgs) {
  const projectActions = useProjectActions();
  const {
    snapTick,
    snapTickWithThreshold,
    gridTickSize,
    magnetRangeTicks,
    isSnapEnabled,
  } = useGridSnap();

  const [editorState, editorDispatch] = useReducer(
    midiEditorReducer,
    initialState,
  );
  const pendingSelectionRef = useRef<readonly MidiNote[] | null>(null);

  // Resolve the MIDI content from the project (array lookup)
  const content = document?.edit.contents.find(
    (c) => c.id === contentId,
  );
  const midiContent =
    content && content.type === "midi" ? content : null;
  const notes: MidiNote[] = midiContent?.notes ?? [];

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      return;
    }
    editorDispatch({
      type: "SELECT_NOTES",
      indices: findMatchingNoteIndices(notes, pendingSelection),
    });
    pendingSelectionRef.current = null;
  }, [notes]);

  const selectNotes = useCallback((indices: number[]) => {
    editorDispatch({ type: "SELECT_NOTES", indices });
  }, []);

  const selectNote = useCallback(
    (index: number | null) => {
      editorDispatch({
        type: "SELECT_NOTES",
        indices: index === null ? [] : [index],
      });
    },
    [],
  );

  const toggleNoteSelection = useCallback(
    (index: number) => {
      const selected = editorState.selectedNoteIndices;
      editorDispatch({
        type: "SELECT_NOTES",
        indices: selected.includes(index)
          ? selected.filter((selectedIndex) => selectedIndex !== index)
          : [...selected, index],
      });
    },
    [editorState.selectedNoteIndices],
  );

  const clearSelection = useCallback(() => {
    editorDispatch({ type: "SELECT_NOTES", indices: [] });
  }, []);

  const addNote = useCallback(
    (note: MidiNote) => {
      if (contentWindow && !isMidiNoteInsideWindow(note, contentWindow)) {
        return;
      }
      const command = buildAddNotesCommand(contentId, [note]);
      if (!command) {
        return;
      }
      projectActions.applyCommand(command);
    },
    [contentId, contentWindow, projectActions],
  );

  const removeNotes = useCallback(
    (indices: number[]) => {
      const selectedNotes = normalizeSelectedNoteIndices(indices).flatMap((index) => {
        const note = notes[index];
        return note && (!contentWindow || isMidiNoteInsideWindow(note, contentWindow))
          ? [note]
          : [];
      });
      const command = buildRemoveNotesCommand(contentId, selectedNotes);
      if (!command) {
        return;
      }
      pendingSelectionRef.current = null;
      projectActions.applyCommand(command);
      editorDispatch({ type: "SELECT_NOTES", indices: [] });
    },
    [contentId, contentWindow, notes, projectActions],
  );

  const moveNotes = useCallback(
    (indices: number[], tickDelta: number, keyDelta: number) => {
      const normalizedIndices = normalizeSelectedNoteIndices(indices);
      const selectedNotes = normalizedIndices.flatMap((index) => {
        const note = notes[index];
        return note && (!contentWindow || isMidiNoteInsideWindow(note, contentWindow))
          ? [note]
          : [];
      });
      if (selectedNotes.length === 0) {
        return;
      }

      const windowedTickDelta = contentWindow
        ? clampMidiNoteMoveDeltaToWindow(selectedNotes, tickDelta, contentWindow)
        : tickDelta;
      const nextNotes = shiftNotesByDelta(selectedNotes, windowedTickDelta, keyDelta);
      const changed = nextNotes.some((note, index) => {
        const original = selectedNotes[index];
        return original
          ? note.start !== original.start || note.key !== original.key
          : false;
      });
      if (!changed) {
        return;
      }

      const command = buildReplaceNotesCommand(contentId, selectedNotes, nextNotes);
      if (!command) {
        return;
      }

      pendingSelectionRef.current = nextNotes;
      projectActions.applyCommand(command);
    },
    [contentId, contentWindow, notes, projectActions],
  );

  const duplicateNotes = useCallback(
    (
      indices: number[],
      options?: { tickDelta?: number; keyDelta?: number },
    ) => {
      const normalizedIndices = normalizeSelectedNoteIndices(indices);
      const selectedNotes = normalizedIndices.flatMap((index) => {
        const note = notes[index];
        return note && (!contentWindow || isMidiNoteInsideWindow(note, contentWindow))
          ? [note]
          : [];
      });
      if (selectedNotes.length === 0) {
        return;
      }

      const minimumTickDelta = isSnapEnabled ? Math.max(1, gridTickSize) : 1;
      const requestedTickDelta = options?.tickDelta ??
        getDuplicateNoteDelta(selectedNotes, minimumTickDelta);
      const windowedTickDelta = contentWindow
        ? clampMidiNoteMoveDeltaToWindow(
            selectedNotes,
            requestedTickDelta,
            contentWindow,
          )
        : requestedTickDelta;
      const nextNotes = shiftNotesByDelta(
        selectedNotes,
        windowedTickDelta,
        options?.keyDelta ?? 0,
      ).map((note) => ({ ...note, id: crypto.randomUUID() }));
      const changed = nextNotes.some((note, index) => {
        const original = selectedNotes[index];
        return original
          ? note.start !== original.start || note.key !== original.key
          : false;
      });
      if (!changed) {
        return;
      }

      const command = buildAddNotesCommand(contentId, nextNotes);
      if (!command) {
        return;
      }

      pendingSelectionRef.current = nextNotes;
      projectActions.applyCommand(command);
    },
    [contentId, contentWindow, notes, projectActions, isSnapEnabled, gridTickSize],
  );

  const resizeNote = useCallback(
    (index: number, newLength: number) => {
      const note = notes[index];
      if (!note || (contentWindow && !isMidiNoteInsideWindow(note, contentWindow))) {
        return;
      }

      const requestedLength = Math.max(
        isSnapEnabled ? gridTickSize : 1,
        snapTick(newLength),
      );
      const snappedLength = contentWindow
        ? clampMidiNoteLengthToWindow(
            note.start,
            requestedLength,
            isSnapEnabled ? gridTickSize : 1,
            contentWindow,
          )
        : requestedLength;
      if (snappedLength === note.length) {
        return;
      }

      const nextNote: MidiNote = {
        ...note,
        length: snappedLength,
      };
      const command = buildReplaceNotesCommand(contentId, [note], [nextNote]);
      if (!command) {
        return;
      }

      pendingSelectionRef.current = [nextNote];
      projectActions.applyCommand(command);
    },
    [
      contentId,
      contentWindow,
      notes,
      projectActions,
      snapTick,
      gridTickSize,
      isSnapEnabled,
    ],
  );

  const setZoomX = useCallback((value: number) => {
    const clamped = Math.max(MIN_ZOOM_X, Math.min(MAX_ZOOM_X, value));
    editorDispatch({ type: "SET_ZOOM_X", value: clamped });
  }, []);

  const setScrollFromEvent = useCallback((x: number, y: number) => {
    editorDispatch({
      type: "SET_SCROLL",
      x: Math.max(0, x),
      y: Math.max(0, y),
    });
  }, []);

  const actions: MidiEditorActions = useMemo(
    () => ({
      selectNote,
      selectNotes,
      toggleNoteSelection,
      clearSelection,
      addNote,
      removeNotes,
      moveNotes,
      duplicateNotes,
      resizeNote,
      setZoomX,
      setScrollFromEvent,
    }),
    [
      selectNote,
      selectNotes,
      toggleNoteSelection,
      clearSelection,
      addNote,
      removeNotes,
      moveNotes,
      duplicateNotes,
      resizeNote,
      setZoomX,
      setScrollFromEvent,
    ],
  );

  return {
    editorState,
    notes,
    gridTickSize,
    magnetRangeTicks,
    snapTick,
    snapTickWithThreshold,
    isSnapEnabled,
    actions,
  };
}
