import type { MidiEditorInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { MidiNote } from "@/types";
import { projectTickFromContentTick } from "@/utils/midiTimeMapping";
import { findNoteHit } from "@/utils/midiEditorEditing";
import {
  clampMidiDraftToWindow,
  clampMidiNoteLengthToWindow,
  clampMidiNoteMoveDeltaToWindow,
  isContentTickInMidiWindow,
  isMidiNoteInsideWindow,
} from "@/utils/midiClipWindow.ts";
import {
  resolveMidiCreationDraft,
  resolveMidiMarqueePreview,
  resolveMidiMoveDragPreview,
  shouldStartMidiNoteCreation,
  shouldStartMidiNoteMove,
} from "@/components/midiEditorGesture";
import {
  NOTE_RESIZE_HANDLE,
  NOTE_START_MAGNET_MULTIPLIER,
  type GridPointerSession,
  type MarqueeState,
  type MidiClipTiming,
  type MidiEditorGridActions,
  type NoteCreateState,
  type NoteDragState,
} from "./midiEditorInteractionTypes";

export interface PendingGridClickState {
  anchorTick: number;
  key: number;
  seekProjectTick: number;
  startMouseX: number;
}

export interface MidiEditorPointerSessionState {
  dragState: NoteDragState | null;
  marqueeState: MarqueeState | null;
  createState: NoteCreateState | null;
  pendingGridClick: PendingGridClickState | null;
  gridPointerSession: GridPointerSession | null;
  noteDragStarted: boolean;
}

export interface MidiEditorPointerSessionInput {
  createId: () => string;
  notes: MidiNote[];
  selectedNoteIndices: number[];
  selectedNoteIndexSet: Set<number>;
  pxPerTick: number;
  rowHeight: number;
  gridTickSize: number;
  magnetRangeTicks: number;
  isSnapEnabled: boolean;
  interactionPolicy: MidiEditorInteractionPolicy;
  midiClipTiming: MidiClipTiming | null;
  snapTick: (tick: number) => number;
  snapTickWithThreshold: (tick: number, thresholdTicks: number) => number;
}

export function createEmptyMidiEditorPointerSessionState(): MidiEditorPointerSessionState {
  return {
    dragState: null,
    marqueeState: null,
    createState: null,
    pendingGridClick: null,
    gridPointerSession: null,
    noteDragStarted: false,
  };
}

export function buildDraftNoteFromSession(
  createState: NoteCreateState,
  input: MidiEditorPointerSessionInput,
): MidiNote {
  const minimumDraftLength = input.isSnapEnabled ? Math.max(1, input.gridTickSize) : 1;
  const noteStartSnapThreshold = input.magnetRangeTicks * NOTE_START_MAGNET_MULTIPLIER;
  const snapNoteStartTick = (tick: number) =>
    input.snapTickWithThreshold(tick, noteStartSnapThreshold);

  const draft = resolveMidiCreationDraft({
    id: createState.noteId,
    anchorTick: createState.anchorTick,
    currentTick: createState.currentTick,
    key: createState.key,
    minimumLength: minimumDraftLength,
    snapStartTick: snapNoteStartTick,
    snapEndTick: input.snapTick,
  });
  return input.midiClipTiming
    ? clampMidiDraftToWindow(draft, minimumDraftLength, input.midiClipTiming)
    : draft;
}

export function beginGridPointerSession(args: {
  input: MidiEditorPointerSessionInput;
  state: MidiEditorPointerSessionState;
  event: Pick<PointerEvent, "button" | "pointerType" | "pointerId" | "clientX" | "clientY" | "ctrlKey" | "metaKey">;
  getGridContentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
  actions: Pick<
    MidiEditorGridActions,
    "selectNote" | "selectNotes" | "clearSelection"
  >;
}): MidiEditorPointerSessionState {
  const { input, state, event, getGridContentPoint, actions } = args;
  if (event.pointerType === "touch") {
    return state;
  }

  const point = getGridContentPoint(event.clientX, event.clientY);
  if (!point) {
    return state;
  }

  if (event.button === 2) {
    return {
      ...state,
      marqueeState: {
        anchorX: point.x,
        anchorY: point.y,
        currentX: point.x,
        currentY: point.y,
      },
      gridPointerSession: {
        pointerId: event.pointerId,
        mode: "marquee",
      },
    };
  }

  if (event.button !== 0) {
    return state;
  }

  const tick = Math.max(0, point.x / input.pxPerTick);
  const keyFromTop = Math.floor(point.y / input.rowHeight);
  const key = 127 - keyFromTop;
  if (key < 0 || key > 127) {
    return state;
  }
  if (
    input.midiClipTiming &&
    !isContentTickInMidiWindow(tick, input.midiClipTiming)
  ) {
    return state;
  }

  const noteHit = findNoteHit(
    input.notes,
    point.x,
    point.y,
    input.pxPerTick,
    input.rowHeight,
    NOTE_RESIZE_HANDLE,
  );
  if (noteHit) {
    const note = input.notes[noteHit.index];
    if (!note) {
      return state;
    }
    if (
      input.midiClipTiming &&
      !isMidiNoteInsideWindow(note, input.midiClipTiming)
    ) {
      return state;
    }

    if (noteHit.onResizeHandle) {
      actions.selectNote(noteHit.index);
      return {
        ...state,
        dragState: {
          type: "resize",
          noteIndex: noteHit.index,
          startMouseX: event.clientX,
          origLength: note.length,
          currentLength: note.length,
        },
        gridPointerSession: {
          pointerId: event.pointerId,
          mode: "drag",
        },
      };
    }

    const dragIndices =
      input.selectedNoteIndexSet.has(noteHit.index) && input.selectedNoteIndices.length > 1
        ? input.selectedNoteIndices
        : [noteHit.index];
    const originalNotes = dragIndices.flatMap((index) => {
      const selectedNote = input.notes[index];
      return selectedNote ? [{ index, note: selectedNote }] : [];
    });
    const anchorNote = originalNotes.find((item) => item.index === noteHit.index) ?? originalNotes[0];
    if (!anchorNote) {
      return state;
    }

    const isToggle = event.ctrlKey || event.metaKey;
    if (!isToggle) {
      actions.selectNotes(dragIndices);
    }

    return {
      ...state,
      noteDragStarted: false,
      dragState: {
        type: "move",
        copy: isToggle,
        noteIndices: dragIndices,
        originalNotes,
        clickedIndex: noteHit.index,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        anchorStart: anchorNote.note.start,
        hasStarted: !isToggle,
        clickMode: isToggle ? "toggle" : "immediate",
        currentTickDelta: 0,
        currentKeyDelta: 0,
      },
      gridPointerSession: {
        pointerId: event.pointerId,
        mode: "drag",
      },
    };
  }

  if (!input.midiClipTiming) {
    return state;
  }

  actions.clearSelection();
  return {
    ...state,
    pendingGridClick: {
      anchorTick: Math.max(0, tick),
      key,
      seekProjectTick: Math.max(
        0,
        Math.round(
          projectTickFromContentTick({
            contentTick: tick,
            clipStart: input.midiClipTiming.clipStart,
            contentIn: input.midiClipTiming.contentIn,
          }),
        ),
      ),
      startMouseX: event.clientX,
    },
    createState: null,
    gridPointerSession: {
      pointerId: event.pointerId,
      mode: "pending-create",
    },
  };
}

export function updateGridPointerSession(args: {
  input: MidiEditorPointerSessionInput;
  state: MidiEditorPointerSessionState;
  event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "ctrlKey" | "metaKey">;
  getGridContentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
  actions: Pick<MidiEditorGridActions, "selectNotes">;
}): MidiEditorPointerSessionState {
  const { input, state, event, getGridContentPoint, actions } = args;
  const session = state.gridPointerSession;
  if (!session || session.pointerId !== event.pointerId) {
    return state;
  }

  if (session.mode === "marquee") {
    const currentPoint = getGridContentPoint(event.clientX, event.clientY);
    if (!currentPoint || !state.marqueeState) {
      return state;
    }
    return {
      ...state,
      marqueeState: {
        ...state.marqueeState,
        currentX: currentPoint.x,
        currentY: currentPoint.y,
      },
    };
  }

  if (session.mode === "pending-create") {
    const pending = state.pendingGridClick;
    if (!pending) {
      return state;
    }

    if (!state.createState && !shouldStartMidiNoteCreation({
      policy: input.interactionPolicy,
      anchorClientX: pending.startMouseX,
      currentClientX: event.clientX,
    })) {
      return state;
    }

    const currentPoint = getGridContentPoint(event.clientX, event.clientY);
    if (!currentPoint) {
      return state;
    }

    const currentTick = input.midiClipTiming
      ? Math.min(
          input.midiClipTiming.contentOut,
          Math.max(input.midiClipTiming.contentIn, currentPoint.x / input.pxPerTick),
        )
      : Math.max(0, currentPoint.x / input.pxPerTick);
    return {
      ...state,
      createState: state.createState
        ? { ...state.createState, currentTick }
        : {
            noteId: input.createId(),
            anchorTick: pending.anchorTick,
            currentTick,
            key: pending.key,
          },
    };
  }

  const currentDragState = state.dragState;
  if (!currentDragState) {
    return state;
  }

  if (currentDragState.type === "move") {
    const dx = event.clientX - currentDragState.startMouseX;
    const dy = event.clientY - currentDragState.startMouseY;
    if (!currentDragState.hasStarted && !shouldStartMidiNoteMove({
      policy: input.interactionPolicy,
      startClientX: currentDragState.startMouseX,
      startClientY: currentDragState.startMouseY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
    })) {
      return state;
    }

    const noteStartSnapThreshold = input.magnetRangeTicks * NOTE_START_MAGNET_MULTIPLIER;
    const snappedAnchorStart = input.snapTickWithThreshold(
      currentDragState.anchorStart + dx / input.pxPerTick,
      noteStartSnapThreshold,
    );
    const rawTickDelta = snappedAnchorStart - currentDragState.anchorStart;
    const rawKeyDelta = -Math.round(dy / input.rowHeight);
    const clampedDelta = resolveMidiMoveDragPreview({
      notes: currentDragState.originalNotes.map((item) => item.note),
      rawTickDelta,
      rawKeyDelta,
    });
    const windowedTickDelta = input.midiClipTiming
      ? clampMidiNoteMoveDeltaToWindow(
          currentDragState.originalNotes.map((item) => item.note),
          clampedDelta.tickDelta,
          input.midiClipTiming,
        )
      : clampedDelta.tickDelta;

    if (!currentDragState.hasStarted && !state.noteDragStarted) {
      actions.selectNotes(currentDragState.noteIndices);
    }

    return {
      ...state,
      noteDragStarted: true,
      dragState: {
        ...currentDragState,
        hasStarted: true,
        copy: event.ctrlKey || event.metaKey,
        currentTickDelta: windowedTickDelta,
        currentKeyDelta: clampedDelta.keyDelta,
      },
    };
  }

  const dx = event.clientX - currentDragState.startMouseX;
  const tickDelta = dx / input.pxPerTick;
  const newLength = input.snapTick(currentDragState.origLength + tickDelta);
  const resizedNote = input.notes[currentDragState.noteIndex];
  const minimumLength = input.isSnapEnabled ? input.gridTickSize : 1;
  const windowedLength =
    input.midiClipTiming && resizedNote
      ? clampMidiNoteLengthToWindow(
          resizedNote.start,
          newLength,
          minimumLength,
          input.midiClipTiming,
        )
      : Math.max(minimumLength, newLength);
  return {
    ...state,
    dragState: {
      ...currentDragState,
      currentLength: windowedLength,
    },
  };
}

export function finishGridPointerSession(args: {
  input: MidiEditorPointerSessionInput;
  state: MidiEditorPointerSessionState;
  event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "type">;
  getGridContentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
  actions: Pick<
    MidiEditorGridActions,
    "selectNotes" | "toggleNoteSelection" | "duplicateNotes" | "moveNotes" | "resizeNote" | "addNote" | "clearSelection"
  >;
  setPlayhead: (tick: number) => void;
}): MidiEditorPointerSessionState {
  const { input, state, event, getGridContentPoint, actions, setPlayhead } = args;
  const session = state.gridPointerSession;
  if (!session || session.pointerId !== event.pointerId) {
    return state;
  }

  const isCancel = event.type === "pointercancel";

  if (session.mode === "marquee") {
    if (!isCancel && state.marqueeState) {
      const currentPoint = getGridContentPoint(event.clientX, event.clientY);
      const marqueeSelection = resolveMidiMarqueePreview({
        notes: input.notes,
        anchorX: state.marqueeState.anchorX,
        anchorY: state.marqueeState.anchorY,
        currentX: currentPoint?.x ?? state.marqueeState.currentX,
        currentY: currentPoint?.y ?? state.marqueeState.currentY,
        pxPerTick: input.pxPerTick,
        rowHeight: input.rowHeight,
      });
      actions.selectNotes(
        marqueeSelection.selectedIndices.filter((index) => {
          const note = input.notes[index];
          return (
            note &&
            (!input.midiClipTiming ||
              isMidiNoteInsideWindow(note, input.midiClipTiming))
          );
        }),
      );
    }
    return {
      ...state,
      marqueeState: null,
      gridPointerSession: null,
    };
  }

  if (session.mode === "pending-create") {
    if (!isCancel) {
      if (state.createState) {
        actions.addNote(buildDraftNoteFromSession(state.createState, input));
        actions.clearSelection();
      } else if (state.pendingGridClick) {
        setPlayhead(state.pendingGridClick.seekProjectTick);
      }
    }
    return {
      ...state,
      createState: null,
      pendingGridClick: null,
      gridPointerSession: null,
    };
  }

  if (!isCancel && state.dragState) {
    if (state.dragState.type === "move") {
      if (!state.dragState.hasStarted && state.dragState.clickMode === "toggle") {
        actions.toggleNoteSelection(state.dragState.clickedIndex);
      } else if (
        state.dragState.currentTickDelta !== 0 ||
        state.dragState.currentKeyDelta !== 0
      ) {
        if (state.dragState.copy) {
          actions.duplicateNotes(state.dragState.noteIndices, {
            tickDelta: state.dragState.currentTickDelta,
            keyDelta: state.dragState.currentKeyDelta,
          });
        } else {
          actions.moveNotes(
            state.dragState.noteIndices,
            state.dragState.currentTickDelta,
            state.dragState.currentKeyDelta,
          );
        }
      }
    } else if (state.dragState.currentLength !== state.dragState.origLength) {
      actions.resizeNote(state.dragState.noteIndex, state.dragState.currentLength);
    }
  }

  return {
    ...state,
    dragState: null,
    gridPointerSession: null,
    noteDragStarted: false,
  };
}
