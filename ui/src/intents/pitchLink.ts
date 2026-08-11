import type {
  Command,
  MidiToAudioPitchLink,
  NoNoteBehavior,
  NotePriority,
  ProjectDocument,
} from "../types/index.ts";
import { toCommandBatch } from "../utils/clipPlacement.ts";

interface AddPitchLinkIntentArgs {
  document: ProjectDocument;
  midiTrackId: string;
  audioTrackId: string;
  noNoteBehavior: NoNoteBehavior;
  notePriority: NotePriority;
  createId?: () => string;
}

export function buildAddPitchLinkIntent({
  document,
  midiTrackId,
  audioTrackId,
  noNoteBehavior,
  notePriority,
  createId = () => crypto.randomUUID(),
}: AddPitchLinkIntentArgs): Command | null {
  if (!midiTrackId || !audioTrackId) {
    return null;
  }

  const midiTrack = document.edit.tracks.find((track) => track.id === midiTrackId);
  const audioTrack = document.edit.tracks.find((track) => track.id === audioTrackId);
  if (
    midiTrack?.kind.track_type !== "midi" ||
    audioTrack?.kind.track_type !== "audio" ||
    document.edit.pitch_links.some((link) => link.audio_track === audioTrackId)
  ) {
    return null;
  }

  const linkId = createId();
  if (document.edit.pitch_links.some((link) => link.id === linkId)) {
    return null;
  }

  const link: MidiToAudioPitchLink = {
    id: linkId,
    midi_track: midiTrackId,
    audio_track: audioTrackId,
    no_note_behavior: noNoteBehavior,
    no_pitch_behavior: "Bypass",
    priority: notePriority,
  };

  const modeCommands = document.edit.clips.flatMap((clip) => {
    if (
      clip.track_id !== audioTrackId ||
      clip.kind.clip_type !== "audio" ||
      clip.kind.audio.pitch.mode !== "ManualOnly"
    ) {
      return [];
    }

    return [{
      command: "set_pitch_mode" as const,
      clip_id: clip.id,
      mode: "FollowMidiOnly" as const,
    }];
  });

  return toCommandBatch([
    { command: "add_pitch_link", link },
    ...modeCommands,
  ]);
}

export function buildRemovePitchLinkIntent(
  document: ProjectDocument,
  linkId: string,
): Command | null {
  const link = document.edit.pitch_links.find((candidate) => candidate.id === linkId);
  if (!link) {
    return null;
  }

  const modeCommands = document.edit.clips.flatMap((clip) => {
    if (
      clip.track_id !== link.audio_track ||
      clip.kind.clip_type !== "audio" ||
      clip.kind.audio.pitch.mode !== "FollowMidiOnly"
    ) {
      return [];
    }

    return [{
      command: "set_pitch_mode" as const,
      clip_id: clip.id,
      mode: "ManualOnly" as const,
    }];
  });

  return toCommandBatch([
    { command: "remove_pitch_link", id: linkId },
    ...modeCommands,
  ]);
}
