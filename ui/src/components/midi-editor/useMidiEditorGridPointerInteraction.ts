import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MidiEditorInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { MidiNote } from "@/types";
import { projectTickFromContentTick } from "@/utils/midiTimeMapping";
import { isContentTickInMidiWindow } from "@/utils/midiClipWindow.ts";
import {
  type NoteSelectionRect,
} from "@/utils/midiEditorEditing";
import {
  resolveMidiMarqueePreview,
} from "@/components/midiEditorGesture";
import {
  type MidiClipTiming,
  type MidiCopyGhostNote,
  type MidiEditorGridActions,
  type NoteDragState,
} from "./midiEditorInteractionTypes";
import {
  beginGridPointerSession,
  buildDraftNoteFromSession,
  createEmptyMidiEditorPointerSessionState,
  finishGridPointerSession,
  updateGridPointerSession,
} from "./midiEditorGridPointerSessions";

interface UseMidiEditorGridPointerInteractionArgs {
  notes: MidiNote[];
  selectedNoteIndices: number[];
  pxPerTick: number;
  rowHeight: number;
  gridTickSize: number;
  magnetRangeTicks: number;
  isSnapEnabled: boolean;
  interactionPolicy: MidiEditorInteractionPolicy;
  midiClipTiming: MidiClipTiming | null;
  setPlayhead: (tick: number) => void;
  actions: Pick<
    MidiEditorGridActions,
    | "selectNote"
    | "selectNotes"
    | "toggleNoteSelection"
    | "clearSelection"
    | "addNote"
    | "moveNotes"
    | "duplicateNotes"
    | "resizeNote"
  >;
  snapTick: (tick: number) => number;
  snapTickWithThreshold: (tick: number, thresholdTicks: number) => number;
  getGridContentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

interface MidiEditorGridPointerInteractionResult {
  handleGridPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleGridPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishGridPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleRulerClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  draftNote: MidiNote | null;
  marqueeRect: NoteSelectionRect | null;
  dragState: NoteDragState | null;
  movingNoteIndexSet: Set<number> | null;
  copyGhostNotes: MidiCopyGhostNote[];
}

export function useMidiEditorGridPointerInteraction({
  notes,
  selectedNoteIndices,
  pxPerTick,
  rowHeight,
  gridTickSize,
  magnetRangeTicks,
  isSnapEnabled,
  interactionPolicy,
  midiClipTiming,
  setPlayhead,
  actions,
  snapTick,
  snapTickWithThreshold,
  getGridContentPoint,
}: UseMidiEditorGridPointerInteractionArgs): MidiEditorGridPointerInteractionResult {
  const selectedNoteIndexSet = useMemo(
    () => new Set(selectedNoteIndices),
    [selectedNoteIndices],
  );
  const [sessionState, setSessionState] = useState(createEmptyMidiEditorPointerSessionState);
  const sessionStateRef = useRef(sessionState);

  useLayoutEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const seekToContentTick = useCallback(
    (contentTick: number) => {
      if (!midiClipTiming) {
        return;
      }
      if (!isContentTickInMidiWindow(contentTick, midiClipTiming)) {
        return;
      }

      const projectTick = Math.max(
        0,
        Math.round(projectTickFromContentTick({
          contentTick,
          clipStart: midiClipTiming.clipStart,
          contentIn: midiClipTiming.contentIn,
        })),
      );
      setPlayhead(projectTick);
    },
    [midiClipTiming, setPlayhead],
  );

  const draftNote = useMemo(() => {
    if (!sessionState.createState) {
      return null;
    }
    return buildDraftNoteFromSession(sessionState.createState, {
      createId: () => crypto.randomUUID(),
      notes,
      selectedNoteIndices,
      selectedNoteIndexSet,
      pxPerTick,
      rowHeight,
      gridTickSize,
      magnetRangeTicks,
      isSnapEnabled,
      interactionPolicy,
      midiClipTiming,
      snapTick,
      snapTickWithThreshold,
    });
  }, [
    gridTickSize,
    interactionPolicy,
    isSnapEnabled,
    magnetRangeTicks,
    midiClipTiming,
    notes,
    pxPerTick,
    rowHeight,
    selectedNoteIndexSet,
    selectedNoteIndices,
    sessionState.createState,
    snapTick,
    snapTickWithThreshold,
  ]);

  const handleGridPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const nextState = beginGridPointerSession({
        input: {
          createId: () => crypto.randomUUID(),
          notes,
          selectedNoteIndices,
          selectedNoteIndexSet,
          pxPerTick,
          rowHeight,
          gridTickSize,
          magnetRangeTicks,
          isSnapEnabled,
          interactionPolicy,
          midiClipTiming,
          snapTick,
          snapTickWithThreshold,
        },
        state: sessionStateRef.current,
        event,
        getGridContentPoint,
        actions,
      });
      sessionStateRef.current = nextState;
      setSessionState(nextState);
    },
    [
      actions,
      getGridContentPoint,
      gridTickSize,
      interactionPolicy,
      isSnapEnabled,
      magnetRangeTicks,
      midiClipTiming,
      notes,
      pxPerTick,
      rowHeight,
      selectedNoteIndexSet,
      selectedNoteIndices,
      snapTick,
      snapTickWithThreshold,
    ],
  );

  const handleGridPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const nextState = updateGridPointerSession({
        input: {
          createId: () => crypto.randomUUID(),
          notes,
          selectedNoteIndices,
          selectedNoteIndexSet,
          pxPerTick,
          rowHeight,
          gridTickSize,
          magnetRangeTicks,
          isSnapEnabled,
          interactionPolicy,
          midiClipTiming,
          snapTick,
          snapTickWithThreshold,
        },
        state: sessionStateRef.current,
        event,
        getGridContentPoint,
        actions,
      });
      sessionStateRef.current = nextState;
      setSessionState(nextState);
    },
    [
      actions,
      getGridContentPoint,
      gridTickSize,
      interactionPolicy,
      isSnapEnabled,
      pxPerTick,
      rowHeight,
      midiClipTiming,
      snapTick,
      snapTickWithThreshold,
    ],
  );

  const finishGridPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const nextState = finishGridPointerSession({
        input: {
          createId: () => crypto.randomUUID(),
          notes,
          selectedNoteIndices,
          selectedNoteIndexSet,
          pxPerTick,
          rowHeight,
          gridTickSize,
          magnetRangeTicks,
          isSnapEnabled,
          interactionPolicy,
          midiClipTiming,
          snapTick,
          snapTickWithThreshold,
        },
        state: sessionStateRef.current,
        event,
        getGridContentPoint,
        actions,
        setPlayhead,
      });
      sessionStateRef.current = nextState;
      setSessionState(nextState);

      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [
      actions,
      getGridContentPoint,
      gridTickSize,
      interactionPolicy,
      isSnapEnabled,
      magnetRangeTicks,
      midiClipTiming,
      notes,
      pxPerTick,
      rowHeight,
      setPlayhead,
      selectedNoteIndexSet,
      selectedNoteIndices,
      snapTick,
      snapTickWithThreshold,
    ],
  );

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleRulerClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const contentTick = Math.max(0, (event.clientX - rect.left) / pxPerTick);
      seekToContentTick(contentTick);
    },
    [pxPerTick, seekToContentTick],
  );

  const marqueeRect = useMemo<NoteSelectionRect | null>(() => {
    if (!sessionState.marqueeState) {
      return null;
    }
    return resolveMidiMarqueePreview({
      notes,
      anchorX: sessionState.marqueeState.anchorX,
      anchorY: sessionState.marqueeState.anchorY,
      currentX: sessionState.marqueeState.currentX,
      currentY: sessionState.marqueeState.currentY,
      pxPerTick,
      rowHeight,
    }).rect;
  }, [notes, pxPerTick, rowHeight, sessionState.marqueeState]);

  const movingNoteIndexSet = useMemo(() => {
    return sessionState.dragState?.type === "move" && sessionState.dragState.hasStarted
      ? new Set(sessionState.dragState.noteIndices)
      : null;
  }, [sessionState.dragState]);

  const copyGhostNotes = useMemo<MidiCopyGhostNote[]>(() => {
    const moveDragState = sessionState.dragState?.type === "move"
      ? sessionState.dragState
      : null;
    if (!moveDragState || !moveDragState.hasStarted || !moveDragState.copy) {
      return [];
    }
    return moveDragState.originalNotes.map(({ index, note }) => ({
      index,
      start: note.start + moveDragState.currentTickDelta,
      key: note.key + moveDragState.currentKeyDelta,
      length: note.length,
    }));
  }, [sessionState.dragState]);

  return {
    handleGridPointerDown,
    handleGridPointerMove,
    finishGridPointerGesture,
    handleContextMenu,
    handleRulerClick,
    draftNote,
    marqueeRect,
    dragState: sessionState.dragState,
    movingNoteIndexSet,
    copyGhostNotes,
  };
}
