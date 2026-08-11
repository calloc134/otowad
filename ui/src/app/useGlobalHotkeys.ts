import { useEffect } from "react";

import { DEFAULT_PPQ } from "@/types";
import { DEFAULT_TIME_SIGNATURE } from "@/grid";
import {
  getPageStepTicks,
  getPlayheadStepTicks,
  resolvePlayheadKeyTick,
} from "@/utils/timelineInteractions";
import {
  buildDeleteSelectionIntent,
  buildDuplicateSelectionIntent,
  buildPitchHotkeyIntent,
  buildSelectAllClipsOfPrimaryKindIntent,
  buildSplitAtPlayheadIntent,
} from "@/intents/hotkeys.ts";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { ProjectActions } from "@/store";
import type { ProjectDocument } from "@/types";

/**
 * Pitch nudges are matched by character, not physical key, so they stay
 * reachable on non-US layouts. The suppression check and the dispatch below
 * read the same constants — defining the set twice is how the clip handle
 * width drifted apart.
 */
const PITCH_HOTKEY_COARSE_INCREASE = ")";
const PITCH_HOTKEY_COARSE_DECREASE = "(";
const PITCH_HOTKEY_FINE_INCREASE = "*";
const PITCH_HOTKEY_FINE_DECREASE = "&";
const PITCH_HOTKEY_CHARACTERS = new Set([
  PITCH_HOTKEY_COARSE_INCREASE,
  PITCH_HOTKEY_COARSE_DECREASE,
  PITCH_HOTKEY_FINE_INCREASE,
  PITCH_HOTKEY_FINE_DECREASE,
]);

interface GlobalHotkeysArgs {
  document: ProjectDocument | null;
  selectedClipIds: string[];
  primaryClipId: string | null;
  playheadTick: number;
  midiEditorOpen: boolean;
  busy: boolean;
  anyDialogOpen: boolean;
  projectDialogOpen: boolean;
  setProjectDialogOpen: (open: boolean) => void;
  isPlaying: boolean;
  actions: ProjectActions;
  saveProjectToBrowser: () => Promise<boolean>;
  refreshBrowserProjects: () => Promise<void>;
  exportWav: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  interactionPolicy: Pick<TimelineInteractionPolicy, "allowsModifierShortcuts">;
}

export function useGlobalHotkeys({
  document,
  selectedClipIds,
  primaryClipId,
  playheadTick,
  midiEditorOpen,
  busy,
  anyDialogOpen,
  projectDialogOpen,
  setProjectDialogOpen,
  isPlaying,
  actions,
  saveProjectToBrowser,
  refreshBrowserProjects,
  exportWav,
  play,
  stop,
  interactionPolicy,
}: GlobalHotkeysArgs): void {
  useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    // Keys that edit clips stay out of reach while a dialog is open;
    // transport and history do not, so BPM and grid can be adjusted against
    // live playback and the result can still be undone.
    const isClipEditingKey = (event: KeyboardEvent) => {
      const withModifier = event.ctrlKey || event.metaKey;
      if (event.key === "Delete" || event.key === "Backspace") return true;
      if (event.key.toLowerCase() === "s" && !withModifier && !event.shiftKey) return true;
      if (event.key.toLowerCase() === "d" && withModifier) return true;
      // Pitch nudges live on Shift + the number row, which is exactly what a
      // numeric dialog field is being typed into.
      if (event.shiftKey && !withModifier && PITCH_HOTKEY_CHARACTERS.has(event.key)) {
        return true;
      }
      return false;
    };

    // Shift and CapsLock both uppercase `event.key`, so comparing against a
    // lowercase literal silently disables the shortcut. That is how
    // Ctrl+Shift+Z and Ctrl+Shift+E stayed unreachable — those two branches
    // could never match a real keyboard event.
    const isKey = (event: KeyboardEvent, key: string) =>
      event.key.toLowerCase() === key;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Mid-composition keystrokes belong to the IME, not to the timeline.
      if (event.isComposing) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }

      if (
        event.key === "Alt" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        return;
      }

      if (anyDialogOpen && isClipEditingKey(event)) {
        return;
      }

      const pitchLinkedAudioTrackIds = new Set(
        document?.edit.pitch_links.map((link) => link.audio_track) ?? [],
      );
      const ppq = document?.edit.tempo.ppq ?? DEFAULT_PPQ;
      const timeSig = document?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;
      const playheadStepTicks = getPlayheadStepTicks({
        snapEnabled: document?.edit.grid.snap_enabled ?? true,
        division: document?.edit.grid.division ?? "Beat",
        ppq,
        timeSig,
      });
      const pageStepTicks = getPageStepTicks(playheadStepTicks, timeSig.num);

      if (busy) {
        if (event.key === " ") {
          event.preventDefault();
        }
        return;
      }

      if (
        interactionPolicy.allowsModifierShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        isKey(event, "z") &&
        !event.shiftKey
      ) {
        event.preventDefault();
        actions.undo();
        return;
      }
      if (
        interactionPolicy.allowsModifierShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        isKey(event, "z") &&
        event.shiftKey
      ) {
        event.preventDefault();
        actions.redo();
        return;
      }
      if (interactionPolicy.allowsModifierShortcuts && (event.ctrlKey || event.metaKey) && isKey(event, "s")) {
        event.preventDefault();
        void saveProjectToBrowser();
        return;
      }
      if (interactionPolicy.allowsModifierShortcuts && (event.ctrlKey || event.metaKey) && isKey(event, "o")) {
        event.preventDefault();
        if (!projectDialogOpen) {
          setProjectDialogOpen(true);
        }
        void refreshBrowserProjects();
        return;
      }
      if (
        interactionPolicy.allowsModifierShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        isKey(event, "a") &&
        !midiEditorOpen
      ) {
        if (!document) {
          return;
        }
        const selectionIntent = buildSelectAllClipsOfPrimaryKindIntent(
          document,
          primaryClipId,
        );
        if (!selectionIntent) {
          return;
        }
        event.preventDefault();
        actions.setClipSelection(selectionIntent.clipIds, selectionIntent.primaryClipId);
        return;
      }
      if (
        interactionPolicy.allowsModifierShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        isKey(event, "e")
      ) {
        event.preventDefault();
        void exportWav();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (isPlaying) {
          stop();
        } else {
          void play();
        }
        return;
      }

      if (midiEditorOpen) {
        return;
      }

      if (event.key === "Escape") {
        // DialogWrapper owns Escape while a dialog is open. Both listeners
        // are on `window`, so this check is what keeps closing a dialog from
        // also discarding the clip selection.
        if (anyDialogOpen) {
          return;
        }
        event.preventDefault();
        if (event.target instanceof HTMLElement) {
          event.target.blur();
        }
        actions.clearSelection();
        return;
      }

      if (
        interactionPolicy.allowsModifierShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        isKey(event, "d")
      ) {
        if (document && selectedClipIds.length > 0) {
          const duplicateIntent = buildDuplicateSelectionIntent(
            document,
            selectedClipIds,
            primaryClipId,
          );
          if (duplicateIntent) {
            event.preventDefault();
            actions.applyCommand(duplicateIntent.command);
            actions.setClipSelection(
              duplicateIntent.duplicatedClipIds,
              duplicateIntent.primaryDuplicateId,
            );
          }
        }
        return;
      }

      const nextPlayheadTick = resolvePlayheadKeyTick({
        key: event.key,
        currentTick: playheadTick,
        playheadStepTicks,
        pageStepTicks,
      });
      if (nextPlayheadTick !== null) {
        event.preventDefault();
        actions.setPlayhead(nextPlayheadTick);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedClipIds.length > 0 && document) {
          const command = buildDeleteSelectionIntent(selectedClipIds);
          if (!command) return;
          event.preventDefault();
          actions.applyCommand(command);
          actions.setClipSelection([], null);
        }
        return;
      }

      if (isKey(event, "s") && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (document) {
          const command = buildSplitAtPlayheadIntent(
            document,
            selectedClipIds,
            primaryClipId,
            playheadTick,
          );
          if (command) {
            event.preventDefault();
            actions.applyCommand(command);
          }
        }
        return;
      }

      const isPitchNudge = event.shiftKey && !event.ctrlKey && !event.metaKey;
      const coarseIncrease = isPitchNudge && event.key === PITCH_HOTKEY_COARSE_INCREASE;
      const coarseDecrease = isPitchNudge && event.key === PITCH_HOTKEY_COARSE_DECREASE;
      const fineIncrease = isPitchNudge && event.key === PITCH_HOTKEY_FINE_INCREASE;
      const fineDecrease = isPitchNudge && event.key === PITCH_HOTKEY_FINE_DECREASE;
      if (!interactionPolicy.allowsModifierShortcuts) {
        return;
      }
      if (!coarseIncrease && !coarseDecrease && !fineIncrease && !fineDecrease) {
        return;
      }
      if (!document || selectedClipIds.length === 0) {
        return;
      }

      const command = buildPitchHotkeyIntent(
        document,
        selectedClipIds,
        pitchLinkedAudioTrackIds,
        coarseIncrease
          ? { kind: "coarse", delta: 1 }
          : coarseDecrease
          ? { kind: "coarse", delta: -1 }
          : fineIncrease
          ? { kind: "fine", delta: 10 }
          : { kind: "fine", delta: -10 },
      );
      if (command) {
        event.preventDefault();
        actions.applyCommand(command);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      if (
        event.key === "Alt" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    actions,
    anyDialogOpen,
    busy,
    document,
    exportWav,
    isPlaying,
    midiEditorOpen,
    play,
    playheadTick,
    primaryClipId,
    projectDialogOpen,
    refreshBrowserProjects,
    saveProjectToBrowser,
    selectedClipIds,
    setProjectDialogOpen,
    stop,
    interactionPolicy,
  ]);
}
