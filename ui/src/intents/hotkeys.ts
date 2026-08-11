import type { ClipId, Command, ProjectDocument } from "../types/index.ts";
import { buildDuplicatePlan, toCommandBatch } from "../utils/clipPlacement.ts";
import {
  buildDeleteClipsCommand,
  buildPitchAdjustmentCommand,
  buildSplitClipCommand,
  type PitchAdjustment,
} from "./clipCommands.ts";

export interface DuplicateSelectionIntent {
  command: Command;
  duplicatedClipIds: ClipId[];
  primaryDuplicateId: ClipId | null;
}

export interface SelectAllClipsOfPrimaryKindIntent {
  clipIds: ClipId[];
  primaryClipId: ClipId;
  clipKind: "audio" | "midi";
}

export function buildDuplicateSelectionIntent(
  document: ProjectDocument,
  selectedClipIds: ClipId[],
  primaryClipId: ClipId | null,
  createId: () => string = () => crypto.randomUUID(),
): DuplicateSelectionIntent | null {
  const duplicatePlan = buildDuplicatePlan(
    document,
    selectedClipIds,
    primaryClipId,
    { type: "adjacent" },
    createId,
  );
  const command = duplicatePlan
    ? toCommandBatch(duplicatePlan.commands)
    : null;
  if (!command || !duplicatePlan) {
    return null;
  }

  return {
    command,
    duplicatedClipIds: duplicatePlan.duplicatedClipIds,
    primaryDuplicateId: duplicatePlan.primaryDuplicateId,
  };
}

export function buildDuplicateClipIntent(
  document: ProjectDocument,
  clipId: ClipId,
  createId: () => string = () => crypto.randomUUID(),
): DuplicateSelectionIntent | null {
  return buildDuplicateSelectionIntent(document, [clipId], clipId, createId);
}

export function buildSelectAllClipsOfPrimaryKindIntent(
  document: ProjectDocument,
  primaryClipId: ClipId | null,
): SelectAllClipsOfPrimaryKindIntent | null {
  if (!primaryClipId) {
    return null;
  }

  const primaryClip = document.edit.clips.find((clip) => clip.id === primaryClipId);
  if (!primaryClip) {
    return null;
  }

  const clipKind = primaryClip.kind.clip_type;
  const clipIds = document.edit.clips
    .filter((clip) => clip.kind.clip_type === clipKind)
    .map((clip) => clip.id);
  if (clipIds.length === 0) {
    return null;
  }

  return {
    clipIds,
    primaryClipId,
    clipKind,
  };
}

export function buildDeleteSelectionIntent(
  selectedClipIds: ClipId[],
): Command | null {
  return buildDeleteClipsCommand(selectedClipIds);
}

export function buildSplitAtPlayheadIntent(
  document: ProjectDocument,
  selectedClipIds: ClipId[],
  primaryClipId: ClipId | null,
  playheadTick: number,
  createId: () => string = () => crypto.randomUUID(),
): Command | null {
  if (!primaryClipId || selectedClipIds.length !== 1) {
    return null;
  }

  const clip = document.edit.clips.find((candidate) => candidate.id === primaryClipId);
  if (!clip) {
    return null;
  }

  return buildSplitClipCommand(
    document,
    primaryClipId,
    playheadTick - clip.start,
    createId,
  );
}

export function buildPitchHotkeyIntent(
  document: ProjectDocument,
  selectedClipIds: ClipId[],
  pitchLinkedAudioTrackIds: ReadonlySet<string>,
  adjustment: PitchAdjustment,
): Command | null {
  return buildPitchAdjustmentCommand(
    document,
    selectedClipIds,
    pitchLinkedAudioTrackIds,
    adjustment,
  );
}
