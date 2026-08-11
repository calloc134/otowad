import { useEffect } from "react";
import type { MidiEditorInteractionPolicy } from "@/app/deviceInteraction.ts";
import { resolvePlayheadKeyTick } from "@/utils/timelineInteractions";
import type { MidiNote } from "@/types";
import { getMidiNoteIndicesInsideWindow } from "@/utils/midiClipWindow.ts";
import type { MidiEditorGridActions } from "./midiEditorInteractionTypes";
import type { MidiClipTiming } from "./midiEditorInteractionTypes";

interface UseMidiEditorKeyboardShortcutsArgs {
  notes: MidiNote[];
  selectedNoteIndices: number[];
  transportPlayheadTick: number;
  playheadStepTicks: number;
  pageStepTicks: number;
  gridTickSize: number;
  isSnapEnabled: boolean;
  interactionPolicy: MidiEditorInteractionPolicy;
  midiClipTiming: MidiClipTiming | null;
  actions: Pick<
    MidiEditorGridActions,
    | "duplicateNotes"
    | "selectNotes"
    | "removeNotes"
    | "moveNotes"
  >;
  setPlayhead: (tick: number) => void;
  closeMidiEditor: () => void;
}

export function useMidiEditorKeyboardShortcuts({
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
}: UseMidiEditorKeyboardShortcutsArgs): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (!interactionPolicy.allowsModifierShortcuts && (event.ctrlKey || event.metaKey)) {
        return;
      }
      const hasSelection = selectedNoteIndices.length > 0;
      const stepTicks = isSnapEnabled ? Math.max(1, gridTickSize) : 1;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && hasSelection) {
        event.preventDefault();
        actions.duplicateNotes(selectedNoteIndices);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const editableIndices = midiClipTiming
          ? getMidiNoteIndicesInsideWindow(notes, midiClipTiming)
          : notes.map((_, index) => index);
        if (editableIndices.length === 0) {
          return;
        }
        event.preventDefault();
        actions.selectNotes(editableIndices);
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && hasSelection) {
        event.preventDefault();
        actions.removeNotes(selectedNoteIndices);
        return;
      }

      const nextPlayheadTick = !hasSelection
        ? resolvePlayheadKeyTick({
            key: event.key,
            currentTick: transportPlayheadTick,
            playheadStepTicks,
            pageStepTicks,
          })
        : null;
      if (nextPlayheadTick !== null) {
        event.preventDefault();
        setPlayhead(nextPlayheadTick);
        return;
      }

      if (hasSelection) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          actions.moveNotes(selectedNoteIndices, 0, 1);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          actions.moveNotes(selectedNoteIndices, 0, -1);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          actions.moveNotes(selectedNoteIndices, -stepTicks, 0);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          actions.moveNotes(selectedNoteIndices, stepTicks, 0);
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeMidiEditor();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    actions,
    closeMidiEditor,
    gridTickSize,
    interactionPolicy.allowsModifierShortcuts,
    isSnapEnabled,
    midiClipTiming,
    notes,
    pageStepTicks,
    playheadStepTicks,
    selectedNoteIndices,
    setPlayhead,
    transportPlayheadTick,
  ]);
}
