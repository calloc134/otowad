import type {
  ClipId,
  Command,
  MidiToAudioPitchLink,
  TimeSignature,
  TrackEdit,
  TrackId,
} from "../types/index.ts";
import { ticksPerBar } from "../grid.ts";
import { toCommandBatch } from "../utils/clipPlacement.ts";

export interface TrackCreateIntent {
  command: Command;
  trackId: TrackId;
}

export function buildTrackCreateIntent(
  type: "audio" | "midi",
  ppq: number,
  timeSig: TimeSignature,
  createId: () => string = () => crypto.randomUUID(),
): TrackCreateIntent {
  const trackId = createId();
  const commands: Command[] = [{
    command: "add_track",
    track: {
      id: trackId,
      name: type === "audio" ? "Audio Track" : "MIDI Track",
      kind: type === "audio"
        ? { track_type: "audio" }
        : {
            track_type: "midi",
            audition_instrument: null,
            render_enabled: false,
          },
      mute: false,
      solo: false,
      gain_milli_db: 0,
      pan_permille: 0,
      fx_chain: [],
      routing: { output: { bus: "master" }, sends: [] },
    },
  }];

  if (type === "midi") {
    const contentId = createId();
    const clipId = createId() as ClipId;
    const clipLength = ticksPerBar(ppq, timeSig) * 4;
    commands.push({
      command: "add_content",
      content: {
        type: "midi",
        id: contentId,
        notes: [],
        ccs: [],
      },
    });
    commands.push({
      command: "add_clip",
      clip: {
        id: clipId,
        track_id: trackId,
        start: 0,
        length: clipLength,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "midi",
          content_id: contentId,
          midi: {
            content_in: 0,
            content_out: clipLength,
            transpose_semitones: 0,
          },
        },
      },
    });
  }

  return {
    command: toCommandBatch(commands)!,
    trackId,
  };
}

export function buildMoveTrackCommand(
  tracks: readonly TrackEdit[],
  trackId: TrackId,
  nextIndex: number,
): Command | null {
  const sourceIndex = tracks.findIndex((track) => track.id === trackId);
  if (sourceIndex < 0) {
    return null;
  }
  const clampedIndex = Math.max(0, Math.min(tracks.length - 1, nextIndex));
  if (clampedIndex === sourceIndex) {
    return null;
  }
  return {
    command: "move_track",
    id: trackId,
    new_index: clampedIndex,
  };
}

export function buildTrackMuteToggleCommand(track: TrackEdit): Command {
  return {
    command: "set_track_mute",
    id: track.id,
    mute: !track.mute,
  };
}

export function buildSetTrackGainCommand(trackId: TrackId, gainMilliDb: number): Command {
  return {
    command: "set_track_gain",
    id: trackId,
    gain_milli_db: Math.round(gainMilliDb),
  };
}

export function buildSetTrackPanCommand(trackId: TrackId, panPermille: number): Command {
  return {
    command: "set_track_pan",
    id: trackId,
    pan_permille: Math.round(panPermille),
  };
}

export function buildTrackSoloToggleCommand(track: TrackEdit): Command {
  return {
    command: "set_track_solo",
    id: track.id,
    solo: !track.solo,
  };
}

export function buildRemoveTrackCommand(trackId: TrackId): Command {
  return {
    command: "remove_track",
    id: trackId,
  };
}

export function buildRenameTrackCommand(trackId: TrackId, name: string): Command {
  return {
    command: "set_track_name",
    id: trackId,
    name,
  };
}

export interface PitchLinkInfo {
  label: string;
  tooltip: string;
}

export function buildTrackBatchCommand(commands: Command[]): Command | null {
  return toCommandBatch(commands);
}

export function getPitchLinkInfo(
  trackId: string,
  pitchLinks: MidiToAudioPitchLink[],
  allTracks: TrackEdit[],
): PitchLinkInfo | null {
  const asSource = pitchLinks.filter((link) => link.midi_track === trackId);
  const asTarget = pitchLinks.filter((link) => link.audio_track === trackId);

  if (asSource.length === 0 && asTarget.length === 0) {
    return null;
  }

  const parts: string[] = [];
  const tooltipParts: string[] = [];

  for (const link of asSource) {
    const targetName = allTracks.find((track) => track.id === link.audio_track)?.name ?? "?";
    parts.push(`-> ${targetName}`);
    tooltipParts.push(`Pitch source for: ${targetName}`);
  }
  for (const link of asTarget) {
    const sourceName = allTracks.find((track) => track.id === link.midi_track)?.name ?? "?";
    parts.push(`<- ${sourceName}`);
    tooltipParts.push(`Pitch target from: ${sourceName}`);
  }

  return {
    label: parts.join(", "),
    tooltip: tooltipParts.join("\n"),
  };
}
