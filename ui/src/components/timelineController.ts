import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { ClipEdit, ProjectDocument, TrackEdit } from "../types/index.ts";
import type { ProjectActions, ProjectState } from "../store/index.ts";

import {
  buildCreateEmptyMidiClipIntent,
  buildDeleteClipIntent,
} from "../intents/timeline.ts";
import { buildDuplicateClipIntent } from "../intents/hotkeys.ts";
import { buildPitchAdjustmentCommand, buildSplitClipCommand } from "../intents/clipCommands.ts";
import { resolveClipSelection } from "../utils/timelineInteractions.ts";

type ClipSelectionTriggerEvent = Pick<ReactMouseEvent | ReactPointerEvent, "ctrlKey" | "metaKey">;

export function createTimelineController(args: {
  document: ProjectDocument | null;
  tracks: TrackEdit[];
  clips: ClipEdit[];
  state: Pick<ProjectState, "selectedClipIds" | "primaryClipId" | "selectedClipKind">;
  actions: Pick<ProjectActions, "applyCommand" | "selectTrack" | "setClipSelection" | "setPlayhead">;
  snapTick: (tick: number) => number;
  ticksPerBar: number;
  pitchLinkedAudioTrackIds: ReadonlySet<string>;
}) {
  const { document, tracks, clips, state, actions, snapTick, ticksPerBar, pitchLinkedAudioTrackIds } = args;
  const selectedClipIdSet = new Set(state.selectedClipIds);

  return {
    handleClipSelect(
      clipId: string,
      event: ClipSelectionTriggerEvent,
      intent?: { clickTick?: number; selectionMode?: "default" | "preserve_clicked" },
    ) {
      const clickedClip = clips.find((clip) => clip.id === clipId);
      if (!clickedClip) return;

      actions.selectTrack(clickedClip.track_id);
      const nextSelection = resolveClipSelection({
        clipId,
        selectedClipIds: state.selectedClipIds,
        primaryClipId: state.primaryClipId,
        isToggle: event.ctrlKey || event.metaKey,
        clickedClipKind: clickedClip.kind.clip_type,
        currentSelectionKind: state.selectedClipKind,
        mode: intent?.selectionMode,
      });
      actions.setClipSelection(nextSelection.clipIds, nextSelection.primaryClipId);
      if (intent?.clickTick !== undefined) {
        actions.setPlayhead(intent.clickTick);
      }
    },

    createEmptyMidiClip(trackId: string, startTick: number) {
      if (!document) return;
      const intent = buildCreateEmptyMidiClipIntent({
        document,
        trackId,
        startTick,
        clipLength: ticksPerBar * 4,
        snapTick,
      });
      if (!intent) return;
      actions.applyCommand(intent.command);
      actions.selectTrack(trackId);
      actions.setClipSelection([intent.clipId], intent.clipId);
    },

    handleDeleteClip(clipId: string) {
      const command = buildDeleteClipIntent(
        clipId,
        state.selectedClipIds,
        selectedClipIdSet.has(clipId),
      );
      if (!command) return;
      actions.applyCommand(command);
      actions.setClipSelection([], null);
    },

    handleDuplicateClip(clipId: string) {
      if (!document) return;
      const duplicateIntent = buildDuplicateClipIntent(document, clipId);
      if (!duplicateIntent) return;
      actions.applyCommand(duplicateIntent.command);
      actions.setClipSelection(
        duplicateIntent.duplicatedClipIds,
        duplicateIntent.primaryDuplicateId,
      );
    },

    handlePitchChange(clipId: string, delta: number) {
      if (!document) return;
      const targetClipIds = selectedClipIdSet.has(clipId) ? state.selectedClipIds : [clipId];
      const command = buildPitchAdjustmentCommand(
        document,
        targetClipIds,
        pitchLinkedAudioTrackIds,
        { kind: "coarse", delta },
      );
      if (command) {
        actions.applyCommand(command);
      }
    },

    handleFinePitchChange(clipId: string, delta: number) {
      if (!document) return;
      const targetClipIds = selectedClipIdSet.has(clipId) ? state.selectedClipIds : [clipId];
      const command = buildPitchAdjustmentCommand(
        document,
        targetClipIds,
        pitchLinkedAudioTrackIds,
        { kind: "fine", delta },
      );
      if (command) {
        actions.applyCommand(command);
      }
    },

    handleSplitClip(clipId: string, tickInClip: number) {
      if (!document) return;
      const command = buildSplitClipCommand(document, clipId, tickInClip);
      if (command) {
        actions.applyCommand(command);
      }
    },

    findTrackAtIndex(trackIndex: number) {
      return tracks[trackIndex] ?? null;
    },
  };
}
