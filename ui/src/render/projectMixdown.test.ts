import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderProjectToAudioBufferData } from "./projectMixdown.ts";
import {
  buildPreparedPlaybackScheduleFromCompiledPlan,
  preparePlaybackSchedule,
} from "../audio/playbackPreparation.ts";
import { createAudioBufferData } from "../audio/audioBufferData.ts";
import type {
  ClipRenderPlan,
  TdPsolaSynthesisCore,
} from "../audio/clipRenderPlan.ts";
import { renderAudioClipTdPsolaV2Data } from "../audio/tdpsolaV2/v2Adapter.ts";
import { initSync } from "../wasm/otomad_core.js";
import type {
  CompiledPitchPlan,
  F0TrackArtifact,
  PitchMarksArtifact,
  ProjectDocument,
} from "../types/index.ts";

initSync({
  module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
});

const TEST_F0: F0TrackArtifact = {
  schema_version: 1,
  kind: "f0_track",
  media_id: "00000000-0000-0000-0000-0000000000b1",
  src_sample_rate: 48_000,
  created_by: { app_version: "test", algo_version: "1", params_hash: "abc" },
  hop_src_frames: 256,
  f0_hz_x100: [44_000, 44_100, 44_200],
  voiced_prob_permille: [900, 880, 870],
  method: "test",
  params: "{}",
};

const TEST_PITCH_MARKS: PitchMarksArtifact = {
  schema_version: 1,
  kind: "pitch_marks",
  media_id: "00000000-0000-0000-0000-0000000000b1",
  src_sample_rate: 48_000,
  created_by: { app_version: "test", algo_version: "1", params_hash: "def" },
  marks_src_frames: [0, 120, 240, 360],
  mark_policy: "test",
  params: "{}",
};

function createTestProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "test",
      created_at: "2026-03-08T13:03:00Z",
      app_version: "0.1.0",
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
        snap_strength_permille: 1000,
      },
      tracks: [{
        id: "00000000-0000-0000-0000-0000000000a1",
        name: "Audio",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      }, {
        id: "00000000-0000-0000-0000-0000000000f1",
        name: "MIDI Source",
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
      }],
      media: [{
        id: "00000000-0000-0000-0000-0000000000b1",
        in_zip_path: "media/00000000-0000-0000-0000-0000000000b1.wav",
        channels: 1,
        src_sample_rate: 48_000,
        length_src_frames: 48_000,
        hash: null,
        original_name: "voice.wav",
      }],
      contents: [{ id: "00000000-0000-0000-0000-0000000000c1", type: "audio", media_id: "00000000-0000-0000-0000-0000000000b1", analysis_refs: [] }],
      clips: [{
        id: "00000000-0000-0000-0000-0000000000d1",
        track_id: "00000000-0000-0000-0000-0000000000a1",
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio",
          content_id: "00000000-0000-0000-0000-0000000000c1",
          audio: {
            src_in: 0,
            src_out: 48_000,
            warp: { warp_type: "none" },
            pitch: {
              mode: "ManualPlusFollow",
              manual_coarse_semitones: 1,
              manual_fine_cents: 0,
            },
            fades: { fade_in: 0, fade_out: 0 },
            time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
          },
        },
      }],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [{
        id: "00000000-0000-0000-0000-0000000000e1",
        midi_track: "00000000-0000-0000-0000-0000000000f1",
        audio_track: "00000000-0000-0000-0000-0000000000a1",
        no_note_behavior: "KeepOriginal",
        no_pitch_behavior: "Bypass",
        priority: "Highest",
      }],
    },
  };
}

function createCompiledPlan(): CompiledPitchPlan {
  return {
    sample_rate: 48_000,
    audio_clips: [{
      clip_id: "00000000-0000-0000-0000-0000000000d1",
      track_id: "00000000-0000-0000-0000-0000000000a1",
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
    pitch_plan: [{
      clip_id: "00000000-0000-0000-0000-0000000000d1",
      audio_track: "00000000-0000-0000-0000-0000000000a1",
      start_frame: 0,
      end_frame: 48_000,
      shift_cents: 200,
    }],
  };
}

function createAnalysisLookup() {
  return {
    ensureForProject: async () => {},
    buildCompileInput: (project: ProjectDocument) => ({
      project,
      analysisJson: "{}",
    }),
    resolveForAudioContent: (content: { media_id: string }) => ({
      sourceF0Track: content.media_id === "00000000-0000-0000-0000-0000000000b1" ? TEST_F0 : null,
      sourcePitchMarks: content.media_id === "00000000-0000-0000-0000-0000000000b1"
        ? TEST_PITCH_MARKS
        : null,
      analysisSignature: content.media_id === "00000000-0000-0000-0000-0000000000b1"
        ? "sig:media-1"
        : undefined,
    }),
    getF0: (mediaId: string) =>
      mediaId === "00000000-0000-0000-0000-0000000000b1" ? TEST_F0 : undefined,
    getPitchMarks: (mediaId: string) =>
      mediaId === "00000000-0000-0000-0000-0000000000b1" ? TEST_PITCH_MARKS : undefined,
    getAnalysisSignature: (mediaId: string) =>
      mediaId === "00000000-0000-0000-0000-0000000000b1" ? "sig:media-1" : undefined,
  };
}

test("playback preparation and offline render interpret pitch and time ranges consistently", async () => {
  const project = createTestProject();
  const compiledPlan = createCompiledPlan();
  const analysisLookup = createAnalysisLookup();
  const mediaBuffer = createAudioBufferData(1, 48_000, 48_000);
  const mediaLookup = new Map([["00000000-0000-0000-0000-0000000000b1", mediaBuffer]]);

  const prepared = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    { startTick: 0, projectRevision: 3 },
  );

  const rendered = await renderProjectToAudioBufferData(
    project,
    mediaLookup,
    analysisLookup,
    { sampleRate: 48_000, channels: 2, startTick: 0, endTick: 960 },
  );

  assert.equal(prepared.startTick, 0);
  assert.equal(prepared.projectRevision, 3);
  assert.equal(prepared.clips.length, 1);
  assert.equal(prepared.clips[0]?.clipDurationSec, 0.5);
  assert.equal(rendered.sampleRate, 48_000);
  assert.equal(rendered.numberOfChannels, 2);
  assert.equal(rendered.length, 24_000);
});

test("playback and offline rendering produce identical pre-mix PCM for every backend", async (t) => {
  const scenarios: Array<{
    name: string;
    backend: ClipRenderPlan["backend"];
    tdPsolaCore: TdPsolaSynthesisCore;
    configure: (project: ProjectDocument) => void;
  }> = [{
    name: "direct",
    backend: "direct",
    tdPsolaCore: "legacy_v1",
    configure: (project) => {
      const clip = project.edit.clips[0];
      if (!clip || clip.kind.clip_type !== "audio") throw new Error("expected audio clip");
      clip.kind.audio.src_out = 4_800;
      clip.kind.audio.pitch.mode = "ManualOnly";
      clip.kind.audio.pitch.manual_coarse_semitones = 0;
    },
  }, {
    name: "legacy TD-PSOLA",
    backend: "voice_tdpsola",
    tdPsolaCore: "legacy_v1",
    configure: () => {},
  }, {
    name: "source-native TD-PSOLA",
    backend: "source_native_tdpsola",
    tdPsolaCore: "source_native_v2",
    configure: () => {},
  }, {
    name: "music phase vocoder",
    backend: "music_phase_vocoder",
    tdPsolaCore: "legacy_v1",
    configure: (project) => {
      const clip = project.edit.clips[0];
      if (!clip || clip.kind.clip_type !== "audio") throw new Error("expected audio clip");
      clip.kind.audio.time_pitch = { mode: "Music" };
    },
  }];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const project = createTestProject();
      project.edit.pitch_links = [];
      const clip = project.edit.clips[0];
      if (!clip || clip.kind.clip_type !== "audio") throw new Error("expected audio clip");
      clip.length = 192;
      clip.kind.audio.src_out = 9_600;
      scenario.configure(project);
      const mediaBuffer = createAudioBufferData(1, 9_600, 48_000);
      for (let index = 0; index < mediaBuffer.length; index++) {
        mediaBuffer.channels[0]![index] = 0.7 * Math.sin((2 * Math.PI * 220 * index) / 48_000) +
          0.2 * Math.sin((2 * Math.PI * 330 * index) / 48_000);
      }
      const mediaLookup = new Map([
        ["00000000-0000-0000-0000-0000000000b1", mediaBuffer],
      ]);
      const analysisLookup = createAnalysisLookup();

      const prepared = await preparePlaybackSchedule(
        project,
        mediaLookup,
        analysisLookup,
        { startTick: 0, tdPsolaCore: scenario.tdPsolaCore },
      );
      const offline = await renderProjectToAudioBufferData(
        project,
        mediaLookup,
        analysisLookup,
        {
          sampleRate: 48_000,
          channels: 1,
          startTick: 0,
          endTick: 192,
          tdPsolaCore: scenario.tdPsolaCore,
        },
      );

      const playbackBuffer = prepared.clips[0]?.buffer;
      assert.ok(playbackBuffer);
      assert.equal(prepared.clips[0]?.clipGain, 1);
      assert.equal(prepared.clips[0]?.trackGain, 1);
      assert.equal(prepared.clips[0]?.trackPan, 0);
      assert.ok(
        prepared.clips[0]?.renderKey.includes(`|${scenario.backend}|`),
        `expected ${scenario.backend} render key`,
      );
      assert.ok(
        playbackBuffer.channels[0]?.some((sample) => Math.abs(sample) > 0.01),
        "expected a non-silent fixture",
      );
      assert.equal(offline.sampleRate, playbackBuffer.sampleRate);
      assert.equal(offline.numberOfChannels, playbackBuffer.numberOfChannels);
      assert.equal(offline.length, playbackBuffer.length);
      assert.deepEqual(offline.channels, playbackBuffer.channels);
    });
  }
});

test("offline product mix matches StereoPanner gain, pan, and resample semantics", async () => {
  const project = createTestProject();
  project.edit.pitch_links = [];
  project.edit.tracks[0] = {
    ...project.edit.tracks[0]!,
    gain_milli_db: -6000,
    pan_permille: 500,
  };
  const clip = project.edit.clips[0];
  if (!clip || clip.kind.clip_type !== "audio") {
    throw new Error("expected audio clip");
  }
  project.edit.clips[0] = {
    ...clip,
    gain_milli_db: -3000,
    kind: {
      ...clip.kind,
      audio: {
        ...clip.kind.audio,
        src_out: 12_000,
        pitch: {
          ...clip.kind.audio.pitch,
          mode: "ManualOnly",
          manual_coarse_semitones: 0,
        },
      },
    },
  };
  project.edit.media[0] = {
    ...project.edit.media[0]!,
    channels: 2,
    src_sample_rate: 24_000,
    length_src_frames: 12_000,
  };

  const mediaBuffer = createAudioBufferData(2, 12_000, 24_000);
  for (let index = 0; index < mediaBuffer.length; index++) {
    mediaBuffer.channels[0]![index] = index % 2;
    mediaBuffer.channels[1]![index] = 1 - (index % 2);
  }
  const mediaLookup = new Map([
    ["00000000-0000-0000-0000-0000000000b1", mediaBuffer],
  ]);
  const analysisLookup = createAnalysisLookup();
  const prepared = await preparePlaybackSchedule(
    project,
    mediaLookup,
    analysisLookup,
    { startTick: 0 },
  );
  const preparedClip = prepared.clips[0];
  assert.ok(preparedClip?.buffer);
  assert.equal(preparedClip.buffer.sampleRate, 48_000);
  assert.equal(preparedClip.buffer.length, 24_000);
  assert.equal(preparedClip.buffer.channels[0]?.[1], 0.5);
  assert.equal(preparedClip.buffer.channels[1]?.[1], 0.5);
  assert.equal(preparedClip.buffer.channels[0]?.[2], 1);
  assert.equal(preparedClip.buffer.channels[1]?.[2], 0);
  assert.equal(preparedClip.trackPan, 0.5);
  assert.deepEqual(clip.kind.audio.fades, { fade_in: 0, fade_out: 0 });

  const rendered = await renderProjectToAudioBufferData(
    project,
    mediaLookup,
    analysisLookup,
    { sampleRate: 48_000, channels: 2, startTick: 0, endTick: 960 },
  );

  const totalGain = preparedClip.clipGain * preparedClip.trackGain;
  const equalPower = Math.SQRT1_2;
  assert.equal(rendered.length, 24_000);
  assert.equal(
    Number((rendered.channels[0]?.[1] ?? 0).toFixed(6)),
    Number((0.5 * equalPower * totalGain).toFixed(6)),
  );
  assert.equal(
    Number((rendered.channels[1]?.[1] ?? 0).toFixed(6)),
    Number(((0.5 + 0.5 * equalPower) * totalGain).toFixed(6)),
  );
  assert.equal(
    Number((rendered.channels[0]?.[2] ?? 0).toFixed(6)),
    Number((equalPower * totalGain).toFixed(6)),
  );
  assert.equal(
    Number((rendered.channels[1]?.[2] ?? 0).toFixed(6)),
    Number((equalPower * totalGain).toFixed(6)),
  );
});

test("offline render dispatches Music clips through the phase vocoder backend", async () => {
  const project = createTestProject();
  const clip = project.edit.clips[0];
  if (!clip || clip.kind.clip_type !== "audio") {
    throw new Error("expected audio clip");
  }
  project.edit.clips[0] = {
    ...clip,
    kind: {
      ...clip.kind,
      audio: {
        ...clip.kind.audio,
        time_pitch: { mode: "Music" },
        pitch: {
          ...clip.kind.audio.pitch,
          mode: "ManualOnly",
          manual_coarse_semitones: 1,
        },
      },
    },
  };

  const rendered = await renderProjectToAudioBufferData(
    project,
    new Map([["00000000-0000-0000-0000-0000000000b1", createAudioBufferData(1, 48_000, 48_000)]]),
    createAnalysisLookup(),
    { sampleRate: 48_000, channels: 2, startTick: 0, endTick: 960 },
  );

  assert.equal(rendered.sampleRate, 48_000);
  assert.equal(rendered.numberOfChannels, 2);
});

test("offline source-native v2 shares synthesis while keeping Legacy/Voice analysis policy explicit", async () => {
  const sampleRate = 48_000;
  const mediaId = "00000000-0000-0000-0000-0000000000b1";
  const f0: F0TrackArtifact = {
    ...TEST_F0,
    hop_src_frames: 512,
    f0_hz_x100: Array.from({ length: Math.ceil(sampleRate / 512) + 1 }, () => 22_000),
    voiced_prob_permille: Array.from({ length: Math.ceil(sampleRate / 512) + 1 }, () => 950),
    created_by: {
      app_version: "test",
      algo_version: "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2",
      params_hash: "profile=tdpsola_monophonic_v2,max_f0=1200",
    },
  };
  const period = sampleRate / 220;
  const marks: number[] = [];
  for (let position = period; position < sampleRate; position += period) {
    const mark = Math.round(position);
    if (mark < sampleRate) marks.push(mark);
  }
  const pitchMarks: PitchMarksArtifact = {
    ...TEST_PITCH_MARKS,
    marks_src_frames: marks,
  };
  const ensureOptions: unknown[] = [];
  const analysisLookup = {
    ensureForProject: async (_project: ProjectDocument, _media: unknown, options?: unknown) => {
      ensureOptions.push(options);
    },
    buildCompileInput: (project: ProjectDocument) => ({ project, analysisJson: "{}" }),
    resolveForAudioContent: () => ({
      sourceF0Track: f0,
      sourcePitchMarks: pitchMarks,
      analysisSignature: "source-native-v2-test",
    }),
    getF0: () => f0,
    getPitchMarks: () => pitchMarks,
    getAnalysisSignature: () => "source-native-v2-test",
  };
  const mediaBuffer = createAudioBufferData(1, sampleRate, sampleRate);
  for (let index = 0; index < sampleRate; index++) {
    mediaBuffer.channels[0]![index] = Math.cos((2 * Math.PI * 220 * index) / sampleRate);
  }

  const makeProject = (analysis: "Local" | "Source") => {
    const project = createTestProject();
    project.edit.pitch_links = [];
    const clip = project.edit.clips[0];
    if (!clip || clip.kind.clip_type !== "audio") throw new Error("expected audio clip");
    clip.length = 1_920;
    clip.kind.audio.time_pitch = {
      mode: "Voice",
      analysis,
      preserve_formant: true,
    };
    clip.kind.audio.pitch = {
      mode: "ManualOnly",
      manual_coarse_semitones: 12,
      manual_fine_cents: 0,
    };
    return project;
  };
  const options = {
    sampleRate,
    channels: 1,
    startTick: 0,
    endTick: 1_920,
    tdPsolaCore: "source_native_v2" as const,
  };
  const legacy = await renderProjectToAudioBufferData(
    makeProject("Local"),
    new Map([[mediaId, mediaBuffer]]),
    analysisLookup,
    options,
  );
  const voice = await renderProjectToAudioBufferData(
    makeProject("Source"),
    new Map([[mediaId, mediaBuffer]]),
    analysisLookup,
    options,
  );

  assert.ok((legacy.channels[0] ?? []).every(Number.isFinite));
  assert.ok((voice.channels[0] ?? []).every(Number.isFinite));
  assert.equal(ensureOptions[0], undefined);
  assert.deepEqual(ensureOptions[1], {
    profile: "tdpsola_monophonic_v2",
    refreshIfProfileMismatch: true,
  });
  let harmonic440Real = 0;
  let harmonic440Imaginary = 0;
  const evaluationStart = Math.floor(voice.length * 0.1);
  const evaluationEnd = Math.ceil(voice.length * 0.9);
  for (let index = evaluationStart; index < evaluationEnd; index++) {
    const phase = (2 * Math.PI * 440 * index) / sampleRate;
    harmonic440Real += (voice.channels[0]![index] ?? 0) * Math.cos(phase);
    harmonic440Imaginary -= (voice.channels[0]![index] ?? 0) * Math.sin(phase);
  }
  const harmonic440Amplitude = 2 * Math.hypot(harmonic440Real, harmonic440Imaginary) /
    (evaluationEnd - evaluationStart);
  assert.ok(harmonic440Amplitude > 0.2, `expected 440 Hz output energy, got ${harmonic440Amplitude}`);
  const outputPeaks = voice.channels[0]!.reduce((count, sample, index, channel) => {
    const isPeak = sample > 0.25 &&
      sample >= (channel[index - 1] ?? Number.NEGATIVE_INFINITY) &&
      sample > (channel[index + 1] ?? Number.NEGATIVE_INFINITY);
    return count + (isPeak ? 1 : 0);
  }, 0);
  assert.ok(outputPeaks > marks.length * 1.5, `expected repeated output grains, got ${outputPeaks}`);

  const directLegacy = renderAudioClipTdPsolaV2Data({
    inputBuffer: mediaBuffer,
    sourceInFrame: 0,
    sourceOutFrame: sampleRate,
    targetDurationSec: 1,
    totalPitchSemitones: 12,
    sourceF0Track: f0,
    sourcePitchMarks: pitchMarks,
    preserveFormant: true,
    analysisPolicy: "legacy_local",
  });
  const directVoice = renderAudioClipTdPsolaV2Data({
    inputBuffer: mediaBuffer,
    sourceInFrame: 0,
    sourceOutFrame: sampleRate,
    targetDurationSec: 1,
    totalPitchSemitones: 12,
    sourceF0Track: f0,
    sourcePitchMarks: pitchMarks,
    preserveFormant: true,
    analysisPolicy: "voice_monophonic_v2",
  });
  assert.ok(directLegacy);
  assert.ok(directVoice);
  assert.deepEqual(legacy.channels, directLegacy.channels);
  assert.deepEqual(voice.channels, directVoice.channels);
});
