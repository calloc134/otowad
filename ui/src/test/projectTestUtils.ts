import { readFileSync } from "node:fs";
import path from "node:path";

import type { Command, ProjectDocument } from "../types/index.ts";
import {
  apply_command_json,
  create_project,
  initSync,
} from "../wasm/otomad_core.js";

let wasmInitialized = false;

function ensureTestWasmReady() {
  if (wasmInitialized) {
    return;
  }

  initSync({
    module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
  });
  wasmInitialized = true;
}

export function createTestProject(name = "Test Project"): ProjectDocument {
  ensureTestWasmReady();
  return JSON.parse(create_project(name, 120, 44_100)) as ProjectDocument;
}

export function applyCommand(document: ProjectDocument, command: Command): ProjectDocument {
  ensureTestWasmReady();
  const result = JSON.parse(
    apply_command_json(JSON.stringify(document), JSON.stringify(command)),
  ) as { project: ProjectDocument };
  return result.project;
}

export function createBaseTimelineProject(): ProjectDocument {
  let document = createTestProject();
  const audioTrackId = crypto.randomUUID();
  const midiTrackId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const audioContentId = crypto.randomUUID();
  const midiContentId = crypto.randomUUID();
  const audioClipId = crypto.randomUUID();
  const midiClipId = crypto.randomUUID();

  const commands: Command[] = [
    {
      command: "add_track",
      track: {
        id: audioTrackId,
        name: "Audio Track",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      },
    },
    {
      command: "add_track",
      track: {
        id: midiTrackId,
        name: "MIDI Track",
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
      },
    },
    {
      command: "add_media_asset",
      asset: {
        id: mediaId,
        in_zip_path: `media/${mediaId}.wav`,
        channels: 1,
        src_sample_rate: 44_100,
        length_src_frames: 44_100,
        hash: null,
        original_name: "voice.wav",
      },
    },
    {
      command: "add_content",
      content: {
        type: "audio",
        id: audioContentId,
        media_id: mediaId,
        analysis_refs: [],
      },
    },
    {
      command: "add_content",
      content: {
        type: "midi",
        id: midiContentId,
        notes: [
          { id: crypto.randomUUID(), start: 0, length: 240, key: 60, vel: 100 },
          { id: crypto.randomUUID(), start: 480, length: 240, key: 64, vel: 100 },
        ],
        ccs: [],
      },
    },
    {
      command: "add_clip",
      clip: {
        id: audioClipId,
        track_id: audioTrackId,
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio",
          content_id: audioContentId,
          audio: {
            src_in: 0,
            src_out: 44_100,
            warp: { warp_type: "none" },
            pitch: {
              mode: "ManualOnly",
              manual_coarse_semitones: 0,
              manual_fine_cents: 0,
            },
            fades: { fade_in: 0, fade_out: 0 },
            time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
          },
        },
      },
    },
    {
      command: "add_clip",
      clip: {
        id: midiClipId,
        track_id: midiTrackId,
        start: 960,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "midi",
          content_id: midiContentId,
          midi: {
            content_in: 0,
            content_out: 960,
            transpose_semitones: 0,
          },
        },
      },
    },
  ];

  for (const command of commands) {
    document = applyCommand(document, command);
  }

  return document;
}

export function createAudioBufferStub(length = 44_100, sampleRate = 44_100): AudioBuffer {
  const channelData = new Float32Array(length);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    duration: length / sampleRate,
    getChannelData: () => channelData,
    copyToChannel: (source: Float32Array) => {
      channelData.set(source.subarray(0, channelData.length));
    },
    copyFromChannel: (destination: Float32Array) => {
      destination.set(channelData.subarray(0, destination.length));
    },
  } as unknown as AudioBuffer;
}
