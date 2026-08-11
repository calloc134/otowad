import type {
  ClipId,
  Command,
  ProjectDocument,
  TimePitchModeEdit,
  TimePitchSelection,
} from "../types/index.ts";
import { toCommandBatch } from "../utils/clipPlacement.ts";

export type PitchAdjustment =
  | { kind: "coarse"; delta: number }
  | { kind: "fine"; delta: number };

export interface MoveClipsIntentArgs {
  clipIds: readonly ClipId[];
  deltaTicks: number;
  originalStarts: Readonly<Record<string, number>>;
  originalTrackIds: Readonly<Record<string, string>>;
  previewTrackIds?: Readonly<Record<string, string>>;
}

export interface AudioBlueStretchIntentArgs {
  clipId: ClipId;
  originalStart: number;
  originalLength: number;
  newStart: number;
  newLength: number;
}

export interface AudioRedTrimIntentArgs {
  clipId: ClipId;
  originalStart: number;
  originalLength: number;
  originalSrcIn: number;
  originalSrcOut: number;
  newStart: number;
  newLength: number;
  newSrcIn: number;
  newSrcOut: number;
}

export interface MidiRedTrimIntentArgs {
  clipId: ClipId;
  originalStart: number;
  originalLength: number;
  originalContentIn: number;
  originalContentOut: number;
  newStart: number;
  newLength: number;
  newContentIn: number;
  newContentOut: number;
}

export function buildDeleteClipsCommand(clipIds: ClipId[]): Command | null {
  return toCommandBatch(
    clipIds.map((clipId) => ({
      command: "remove_clip" as const,
      clip_id: clipId,
    })),
  );
}

export function buildSplitClipCommand(
  document: ProjectDocument,
  clipId: ClipId,
  tickInClip: number,
  createId: () => string = () => crypto.randomUUID(),
): Command | null {
  const clip = document.edit.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return null;
  }

  if (tickInClip <= 0 || tickInClip >= clip.length) {
    return null;
  }

  return {
    command: "split_clip",
    clip_id: clipId,
    tick_in_clip: tickInClip,
    new_clip_id: createId(),
  };
}

export function buildAddWarpAnchorAtTickCommand(
  document: ProjectDocument,
  clipId: ClipId,
  tickInClip: number,
): Command | null {
  const clip = document.edit.clips.find((candidate) => candidate.id === clipId);
  if (!clip || clip.kind.clip_type !== "audio") {
    return null;
  }

  if (tickInClip <= 0 || tickInClip >= clip.length) {
    return null;
  }

  return {
    command: "add_warp_anchor_at_tick",
    clip_id: clipId,
    tick_in_clip: tickInClip,
  };
}

export function buildMoveClipsCommand({
  clipIds,
  deltaTicks,
  originalStarts,
  originalTrackIds,
  previewTrackIds = {},
}: MoveClipsIntentArgs): Command | null {
  const normalizedDelta = Math.round(deltaTicks);
  const commands: Command[] = [];

  for (const clipId of clipIds) {
    const originalTrackId = originalTrackIds[clipId];
    const targetTrackId = previewTrackIds[clipId];
    if (targetTrackId && targetTrackId !== originalTrackId) {
      commands.push({
        command: "move_clip_to_track",
        clip_id: clipId,
        new_track_id: targetTrackId,
      });
    }

    const originalStart = originalStarts[clipId];
    if (normalizedDelta === 0 || originalStart === undefined) {
      continue;
    }

    commands.push({
      command: "move_clip",
      clip_id: clipId,
      new_start: Math.round(originalStart + normalizedDelta),
    });
  }

  return toCommandBatch(commands);
}

export function buildAudioBlueStretchCommand({
  clipId,
  originalStart,
  originalLength,
  newStart,
  newLength,
}: AudioBlueStretchIntentArgs): Command | null {
  if (newStart === originalStart && newLength === originalLength) {
    return null;
  }

  return {
    command: "audio_blue_stretch",
    clip_id: clipId,
    new_start: newStart,
    new_length: newLength,
  };
}

export function buildAudioRedTrimCommand({
  clipId,
  originalStart,
  originalLength,
  originalSrcIn,
  originalSrcOut,
  newStart,
  newLength,
  newSrcIn,
  newSrcOut,
}: AudioRedTrimIntentArgs): Command | null {
  if (
    newStart === originalStart &&
    newLength === originalLength &&
    newSrcIn === originalSrcIn &&
    newSrcOut === originalSrcOut
  ) {
    return null;
  }

  return {
    command: "audio_red_trim",
    clip_id: clipId,
    new_src_in: newSrcIn,
    new_src_out: newSrcOut,
    new_start: newStart,
    new_length: newLength,
  };
}

export function buildMidiRedTrimCommand({
  clipId,
  originalStart,
  originalLength,
  originalContentIn,
  originalContentOut,
  newStart,
  newLength,
  newContentIn,
  newContentOut,
}: MidiRedTrimIntentArgs): Command | null {
  if (
    newStart === originalStart &&
    newLength === originalLength &&
    newContentIn === originalContentIn &&
    newContentOut === originalContentOut
  ) {
    return null;
  }

  return {
    command: "midi_red_trim",
    clip_id: clipId,
    new_start: newStart,
    new_content_in: newContentIn,
    new_content_out: newContentOut,
  };
}

export function buildPitchAdjustmentCommand(
  document: ProjectDocument,
  clipIds: ClipId[],
  pitchLinkedAudioTrackIds: ReadonlySet<string>,
  adjustment: PitchAdjustment,
): Command | null {
  const commands: Command[] = [];

  for (const clipId of clipIds) {
    const clip = document.edit.clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      continue;
    }

    if (clip.kind.clip_type === "midi") {
      if (adjustment.kind !== "coarse") {
        continue;
      }
      commands.push({
        command: "set_midi_transpose" as const,
        clip_id: clipId,
        semitones: clip.kind.midi.transpose_semitones + adjustment.delta,
      });
      continue;
    }

    if (pitchLinkedAudioTrackIds.has(clip.track_id)) {
      continue;
    }

    if (adjustment.kind === "coarse") {
      commands.push({
        command: "set_pitch_coarse" as const,
        clip_id: clipId,
        semitones: clip.kind.audio.pitch.manual_coarse_semitones + adjustment.delta,
      });
      continue;
    }

    commands.push({
      command: "set_pitch_fine" as const,
      clip_id: clipId,
      cents: clip.kind.audio.pitch.manual_fine_cents + adjustment.delta,
    });
  }

  return toCommandBatch(commands);
}

export function getTimePitchSelection(
  timePitch: TimePitchModeEdit,
): TimePitchSelection {
  if (timePitch.mode === "Music") return "Music";
  return timePitch.analysis === "Local" ? "Local" : "Voice";
}

export function buildSetTimePitchCommand(
  document: ProjectDocument,
  clipId: ClipId,
  selection: TimePitchSelection,
): Command | null {
  const clip = document.edit.clips.find((candidate) => candidate.id === clipId);
  if (!clip || clip.kind.clip_type !== "audio") {
    return null;
  }

  const currentTimePitch = clip.kind.audio.time_pitch;
  if (getTimePitchSelection(currentTimePitch) === selection) {
    return null;
  }

  const nextTimePitch: TimePitchModeEdit = selection === "Music"
    ? { mode: "Music" }
    : selection === "Local"
    ? { mode: "Voice", analysis: "Local", preserve_formant: false }
    : { mode: "Voice", analysis: "Source", preserve_formant: true };

  return {
    command: "set_time_pitch",
    clip_id: clipId,
    time_pitch: nextTimePitch,
  };
}
