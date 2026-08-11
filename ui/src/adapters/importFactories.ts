import type {
  AudioClipEdit,
  AudioContentEdit,
  ClipEdit,
  Command,
  MediaAsset,
  MidiContentEdit,
  TrackEdit,
} from "../types/index.ts";
import type { MidiImportGroup } from "../utils/midiSmf.ts";

export interface ImportedAudioCommandArgs {
  mediaId: string;
  contentId: string;
  clipId: string;
  fileName: string;
  trackId: string;
  startTick: number;
  audioBuffer: AudioBuffer;
  analysisRefs: string[];
  contentHash: string;
  reuseMediaAsset: boolean;
  microBpm: number;
  ppq: number;
}

function durationTicksFromAudio(
  lengthFrames: number,
  sampleRate: number,
  microBpm: number,
  ppq: number,
): number {
  const durationSec = lengthFrames / sampleRate;
  return Math.max(
    1,
    Math.round((durationSec * microBpm * ppq) / (60 * 1_000_000)),
  );
}

export function createImportedAudioTrack(trackId: string, name: string): TrackEdit {
  return {
    id: trackId,
    name,
    kind: {
      track_type: "audio",
    },
    mute: false,
    solo: false,
    gain_milli_db: 0,
    pan_permille: 0,
    fx_chain: [],
    routing: { output: { bus: "master" }, sends: [] },
  };
}

export function createImportedMidiTrack(trackId: string, name: string): TrackEdit {
  return {
    id: trackId,
    name,
    kind: {
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
  };
}

export function buildImportedMidiGroupCommands(
  group: MidiImportGroup,
  trackId: string,
  startTick: number,
  createId: () => string = () => crypto.randomUUID(),
): Command[] {
  const contentId = createId();
  const clipId = createId();
  const clipLength = Math.max(
    1,
    group.notes.reduce(
      (max, note) => Math.max(max, note.start + note.length),
      group.ccs.reduce((max, cc) => Math.max(max, cc.at + 1), 0),
    ),
  );

  const content: MidiContentEdit = {
    type: "midi",
    id: contentId,
    notes: group.notes.map((note) => ({ id: createId(), ...note })),
    ccs: group.ccs.map((cc) => ({ ...cc })),
  };
  const clip: ClipEdit = {
    id: clipId,
    track_id: trackId,
    start: Math.max(0, Math.round(startTick)),
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
  };

  return [
    { command: "add_content", content },
    { command: "add_clip", clip },
  ];
}

export function buildImportedAudioCommands(
  args: ImportedAudioCommandArgs,
  buildMediaArchivePath: (mediaId: string) => string,
): Command[] {
  const asset: MediaAsset = {
    id: args.mediaId,
    in_zip_path: buildMediaArchivePath(args.mediaId),
    channels: args.audioBuffer.numberOfChannels,
    src_sample_rate: args.audioBuffer.sampleRate,
    length_src_frames: args.audioBuffer.length,
    hash: args.contentHash,
    original_name: args.fileName,
  };
  const content: AudioContentEdit = {
    type: "audio",
    id: args.contentId,
    media_id: args.mediaId,
    analysis_refs: args.analysisRefs,
  };
  const audio: AudioClipEdit = {
    src_in: 0,
    src_out: args.audioBuffer.length,
    warp: { warp_type: "none" },
    pitch: {
      mode: "ManualOnly",
      manual_coarse_semitones: 0,
      manual_fine_cents: 0,
    },
    fades: { fade_in: 0, fade_out: 0 },
    time_pitch: {
      mode: "Voice",
      analysis: "Source",
      preserve_formant: true,
    },
  };
  const clip: ClipEdit = {
    id: args.clipId,
    track_id: args.trackId,
    start: Math.max(0, Math.round(args.startTick)),
    length: durationTicksFromAudio(
      args.audioBuffer.length,
      args.audioBuffer.sampleRate,
      args.microBpm,
      args.ppq,
    ),
    lane: 0,
    muted: false,
    gain_milli_db: 0,
    kind: {
      clip_type: "audio",
      content_id: args.contentId,
      audio,
    },
  };

  return [
    ...(args.reuseMediaAsset ? [] : [{ command: "add_media_asset", asset } as const]),
    { command: "add_content", content },
    { command: "add_clip", clip },
  ];
}
