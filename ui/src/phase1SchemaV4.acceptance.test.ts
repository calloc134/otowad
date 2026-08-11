import assert from "node:assert/strict";
import test from "node:test";

import { buildSetTimePitchCommand } from "./intents/clipCommands.ts";
import { buildImportedAudioCommands } from "./adapters/importFactories.ts";
import { buildClipRenderPlan } from "./audio/clipRenderPlan.ts";
import {
  resolveTdPsolaV2AnalysisPolicy,
  resolveTdPsolaV2AnalysisSource,
} from "./audio/tdpsolaV2/analysisPolicy.ts";
import type { AudioClipEdit, ProjectDocument } from "./types/index.ts";

function createDocument(timePitch: unknown): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "schema-v4-acceptance",
      created_at: "2026-08-11T00:00:00Z",
      app_version: "test",
      project_sample_rate: 48_000,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
      },
      grid: {
        snap_enabled: true,
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [{
        id: "track-1",
        name: "Audio",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      }],
      media: [],
      contents: [],
      clips: [{
        id: "clip-1",
        track_id: "track-1",
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio",
          content_id: "content-1",
          audio: {
            src_in: 0,
            src_out: 48_000,
            warp: { warp_type: "none" },
            pitch: {
              mode: "ManualOnly",
              manual_coarse_semitones: 0,
              manual_fine_cents: 0,
            },
            fades: { fade_in: 0, fade_out: 0 },
            time_pitch: timePitch,
          },
        },
      }],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  } as unknown as ProjectDocument;
}

test("schema v4 maps the Local, Voice, and Music UI choices into the persisted model", () => {
  const document = createDocument({
    mode: "Voice",
    analysis: "Source",
    preserve_formant: true,
  });

  assert.deepEqual(buildSetTimePitchCommand(document, "clip-1", "Local"), {
    command: "set_time_pitch",
    clip_id: "clip-1",
    time_pitch: {
      mode: "Voice",
      analysis: "Local",
      preserve_formant: false,
    },
  });
  assert.equal(buildSetTimePitchCommand(document, "clip-1", "Voice"), null);
  assert.deepEqual(buildSetTimePitchCommand(document, "clip-1", "Music"), {
    command: "set_time_pitch",
    clip_id: "clip-1",
    time_pitch: { mode: "Music" },
  });
});

test("new audio import defaults to Voice/Source and falls back to local analysis", () => {
  const commands = buildImportedAudioCommands({
    mediaId: "media-1",
    contentId: "content-1",
    clipId: "clip-1",
    fileName: "voice.wav",
    trackId: "track-1",
    startTick: 0,
    audioBuffer: {
      numberOfChannels: 1,
      sampleRate: 48_000,
      length: 48_000,
    } as AudioBuffer,
    analysisRefs: [],
    contentHash: "sha256-pcm24-v1:acceptance",
    reuseMediaAsset: false,
    microBpm: 120_000_000,
    ppq: 960,
  }, (mediaId) => `media/${mediaId}.wav`);
  const addClip = commands.find((command) => command.command === "add_clip");
  assert.equal(addClip?.command, "add_clip");
  if (addClip?.command !== "add_clip" || addClip.clip.kind.clip_type !== "audio") {
    throw new Error("expected imported audio clip");
  }

  const audio = addClip.clip.kind.audio as unknown as Record<string, unknown>;
  assert.deepEqual(audio.time_pitch, {
    mode: "Voice",
    analysis: "Source",
    preserve_formant: true,
  });

  const renderPlan = buildClipRenderPlan({
    compiledPlan: {
      sample_rate: 48_000,
      audio_clips: [{
        clip_id: "clip-1",
        track_id: "track-1",
        start_frame: 0,
        end_frame: 48_000,
        src_in_frame: 0,
        src_out_frame: 48_000,
        warp_plan: {
          kind: "linear",
          segments: [{
            dst_start_frame: 0,
            dst_end_frame: 48_000,
            src_start_frame: 0,
            src_end_frame: 48_000,
          }],
        },
      }],
      pitch_plan: [],
    },
    clipId: "clip-1",
    trackId: "track-1",
    audio: addClip.clip.kind.audio as unknown as AudioClipEdit,
    clipDurationSec: 1,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });
  assert.equal(renderPlan.tdPsolaAnalysisPolicy, "voice_monophonic_v2");

  const policy = resolveTdPsolaV2AnalysisPolicy("voice_monophonic_v2");
  assert.deepEqual(resolveTdPsolaV2AnalysisSource({
    policy,
    hasProvidedTrack: false,
  }), {
    requestedSource: "provided",
    actualSource: "local",
    fallbackReason: "provided_artifact_missing",
  });
});
