import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { MidiEditorInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { MidiNote } from "@/types";
import {
  contentTickFromProjectTick,
} from "@/utils/midiTimeMapping";
import { useMidiEditorViewport } from "./useMidiEditorViewport";
import { useMidiEditorGridPointerInteraction } from "./useMidiEditorGridPointerInteraction";
import { useMidiEditorMiddlePan } from "./useMidiEditorMiddlePan";
import { useMidiEditorKeyboardShortcuts } from "./useMidiEditorKeyboardShortcuts";
import type {
  MidiClipTiming,
  MidiCopyGhostNote,
  MidiEditorGridActions,
  NoteDragState,
} from "./midiEditorInteractionTypes";

export interface UseMidiEditorGridInteractionsArgs {
  notes: MidiNote[];
  selectedNoteIndices: number[];
  transportPlayheadTick: number;
  playheadStepTicks: number;
  pageStepTicks: number;
  pxPerTick: number;
  rowHeight: number;
  gridTickSize: number;
  magnetRangeTicks: number;
  isSnapEnabled: boolean;
  interactionPolicy: MidiEditorInteractionPolicy;
  midiClipTiming: MidiClipTiming | null;
  setPlayhead: (tick: number) => void;
  closeMidiEditor: () => void;
  actions: MidiEditorGridActions;
  snapTick: (tick: number) => number;
  snapTickWithThreshold: (tick: number, thresholdTicks: number) => number;
}

export interface MidiEditorGridInteractionsResult {
  gridScrollRef: React.RefObject<HTMLDivElement | null>;
  pianoScrollRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  handleGridScroll: () => void;
  handleGridPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleGridPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishGridPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleRulerClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleEditorBodyPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleEditorBodyPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishEditorBodyPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleAuxClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  draftNote: MidiNote | null;
  marqueeRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  dragState: NoteDragState | null;
  movingNoteIndexSet: Set<number> | null;
  copyGhostNotes: MidiCopyGhostNote[];
}

export function useMidiEditorGridInteractions({
  notes,
  selectedNoteIndices,
  transportPlayheadTick,
  playheadStepTicks,
  pageStepTicks,
  pxPerTick,
  rowHeight,
  gridTickSize,
  magnetRangeTicks,
  isSnapEnabled,
  interactionPolicy,
  midiClipTiming,
  setPlayhead,
  closeMidiEditor,
  actions,
  snapTick,
  snapTickWithThreshold,
}: UseMidiEditorGridInteractionsArgs): MidiEditorGridInteractionsResult {
  const playheadContentTick = midiClipTiming
    ? contentTickFromProjectTick({
        projectTick: transportPlayheadTick,
        clipStart: midiClipTiming.clipStart,
        contentIn: midiClipTiming.contentIn,
      })
    : null;
  const playheadX = playheadContentTick !== null && playheadContentTick >= 0
    ? playheadContentTick * pxPerTick
    : null;

  const {
    gridScrollRef,
    pianoScrollRef,
    rulerScrollRef,
    getGridContentPoint,
    handleGridScroll,
  } = useMidiEditorViewport({
    pxPerTick,
    rowHeight,
    interactionPolicy,
    playheadX,
    actions,
  });

  const {
    handleGridPointerDown,
    handleGridPointerMove,
    finishGridPointerGesture,
    handleContextMenu,
    handleRulerClick,
    draftNote,
    marqueeRect,
    dragState,
    movingNoteIndexSet,
    copyGhostNotes,
  } = useMidiEditorGridPointerInteraction({
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
  });

  const {
    handleEditorBodyPointerDown,
    handleEditorBodyPointerMove,
    finishEditorBodyPointerGesture,
    handleAuxClick,
  } = useMidiEditorMiddlePan({
    gridScrollRef,
    handleGridScroll,
  });

  useMidiEditorKeyboardShortcuts({
    notes,
    selectedNoteIndices,
    transportPlayheadTick,
    playheadStepTicks,
    pageStepTicks,
    gridTickSize,
    isSnapEnabled,
    interactionPolicy,
    midiClipTiming,
    actions,
    setPlayhead,
    closeMidiEditor,
  });

  return {
    gridScrollRef,
    pianoScrollRef,
    rulerScrollRef,
    handleGridScroll,
    handleGridPointerDown,
    handleGridPointerMove,
    finishGridPointerGesture,
    handleContextMenu,
    handleRulerClick,
    handleEditorBodyPointerDown,
    handleEditorBodyPointerMove,
    finishEditorBodyPointerGesture,
    handleAuxClick,
    draftNote,
    marqueeRect,
    dragState,
    movingNoteIndexSet,
    copyGhostNotes,
  };
}
