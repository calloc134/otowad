import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreparedClipRenderKey,
  buildPreparedPlaybackScheduleFromCompiledPlan,
  canReusePreparedPlaybackSchedule,
  collectPreparedPlaybackRenderKeys,
  createPlaybackPreparationDiagnostics,
  mergeKnownRenderKeys,
  shouldIncludePreparedClipBuffer,
} from "./playbackPreparation.ts";
import { createAudioBufferData } from "./audioBufferData.ts";
import type {
  CompiledPitchPlan,
  F0TrackArtifact,
  PitchMarksArtifact,
  ProjectDocument,
} from "../types/index.ts";

const TEST_F0: F0TrackArtifact = {
  schema_version: 1,
  kind: "f0_track",
  media_id: "media-1",
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
  media_id: "media-1",
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
        snap_strength_permille: 1_000,
      },
      tracks: [{
        id: "track-a",
        name: "Audio",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      }],
      media: [{
        id: "media-1",
        in_zip_path: "media/media-1.wav",
        channels: 1,
        src_sample_rate: 48_000,
        length_src_frames: 48_000,
        hash: null,
        original_name: "voice.wav",
      }],
      contents: [{ id: "content-1", type: "audio", media_id: "media-1", analysis_refs: [] }],
      clips: [
        {
          id: "clip-1",
          track_id: "track-a",
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
              time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
            },
          },
        },
        {
          id: "clip-2",
          track_id: "track-a",
          start: 960,
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
              time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
            },
          },
        },
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

function createCompiledPlan(): CompiledPitchPlan {
  return {
    sample_rate: 48_000,
    audio_clips: [
      {
        clip_id: "clip-1",
        track_id: "track-a",
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
      },
      {
        clip_id: "clip-2",
        track_id: "track-a",
        start_frame: 48_000,
        end_frame: 96_000,
        src_in_frame: 0,
        src_out_frame: 48_000,
        warp_plan: {
          kind: "linear",
          segments: [{
            dst_start_frame: 48_000,
            dst_end_frame: 96_000,
            src_start_frame: 0,
            src_end_frame: 48_000,
          }],
        },
      },
    ],
    pitch_plan: [],
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
      sourceF0Track: content.media_id === "media-1" ? TEST_F0 : null,
      sourcePitchMarks: content.media_id === "media-1" ? TEST_PITCH_MARKS : null,
      analysisSignature: content.media_id === "media-1" ? "sig:media-1" : undefined,
    }),
    getF0: (mediaId: string) => (mediaId === "media-1" ? TEST_F0 : undefined),
    getPitchMarks: (mediaId: string) =>
      mediaId === "media-1" ? TEST_PITCH_MARKS : undefined,
    getAnalysisSignature: (mediaId: string) =>
      mediaId === "media-1" ? "sig:media-1" : undefined,
  };
}

test("canReusePreparedPlaybackSchedule requires matching revision and start tick", () => {
  const schedule = {
    startTick: 240,
    startOffsetSec: 1.5,
    projectRevision: 7,
    clips: [],
  };

  assert.equal(canReusePreparedPlaybackSchedule(schedule, 7, 240), true);
  assert.equal(canReusePreparedPlaybackSchedule(schedule, 8, 240), false);
  assert.equal(canReusePreparedPlaybackSchedule(schedule, 7, 241), false);
  assert.equal(canReusePreparedPlaybackSchedule(null, 7, 240), false);
});

test("buildPreparedClipRenderKey is shared by duplicate clips of the same content", () => {
  const f0: F0TrackArtifact = {
    ...TEST_F0,
    f0_hz_x100: [44_000, 44_100],
    voiced_prob_permille: [900, 880],
  };
  const marks: PitchMarksArtifact = {
    ...TEST_PITCH_MARKS,
    marks_src_frames: [0, 120, 240],
  };

  const first = buildPreparedClipRenderKey({
    mediaIdentity: "sha256-pcm24-v1:same-content",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: `sig:${f0.media_id}:${marks.media_id}`,
    timePitchMode: "Voice",
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
    renderOperation: "bypass",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });
  const second = buildPreparedClipRenderKey({
    mediaIdentity: "sha256-pcm24-v1:same-content",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: `sig:${f0.media_id}:${marks.media_id}`,
    timePitchMode: "Voice",
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
    renderOperation: "bypass",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });

  assert.equal(first, second);
});

test("buildPreparedClipRenderKey changes when time-pitch mode identity changes", () => {
  const first = buildPreparedClipRenderKey({
    mediaIdentity: "media-1",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: "sig:media-1",
    timePitchMode: "Voice",
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
    renderOperation: "bypass",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });
  const second = buildPreparedClipRenderKey({
    mediaIdentity: "media-1",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: "sig:media-1",
    timePitchMode: "Music",
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
    renderOperation: "bypass",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });

  assert.notEqual(first, second);
});

test("buildPreparedClipRenderKey changes when backend identity changes", () => {
  const first = buildPreparedClipRenderKey({
    mediaIdentity: "media-1",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: "sig:media-1",
    timePitchMode: "Music",
    backend: "music_phase_vocoder",
    backendVersion: "music-phase-vocoder-v1",
    renderOperation: "pitch_only",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });
  const second = buildPreparedClipRenderKey({
    mediaIdentity: "media-1",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 0,
    analysisSignature: "sig:media-1",
    timePitchMode: "Music",
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
    renderOperation: "pitch_only",
    preserveFormant: false,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  });

  assert.notEqual(first, second);
});

test("source-native render keys ignore the legacy-only preserveFormant flag", () => {
  const common = {
    mediaIdentity: "media-1",
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    lengthTick: 960,
    totalPitchSemitones: 12,
    analysisSignature: "sig:media-1",
    timePitchMode: "Voice" as const,
    backend: "source_native_tdpsola" as const,
    backendVersion: "source-native-tdpsola-v2-a5-unvoiced-stretch",
    tdPsolaAnalysisPolicy: "voice_monophonic_v2" as const,
    renderOperation: "pitch_only" as const,
    bpm: 120_000_000,
    ppq: 960,
    mediaSampleRate: 48_000,
  };

  assert.equal(
    buildPreparedClipRenderKey({ ...common, preserveFormant: false }),
    buildPreparedClipRenderKey({ ...common, preserveFormant: true }),
  );
});

test("shouldIncludePreparedClipBuffer omits payloads for known render keys", () => {
  assert.equal(shouldIncludePreparedClipBuffer("key-a", new Set(["key-a"])), false);
  assert.equal(shouldIncludePreparedClipBuffer("key-b", new Set(["key-a"])), true);
  assert.equal(shouldIncludePreparedClipBuffer("key-a"), true);
});

test("mergeKnownRenderKeys keeps keys from both engine cache and prepared schedule", () => {
  const merged = mergeKnownRenderKeys(
    new Set(["engine-a", "engine-b"]),
    collectPreparedPlaybackRenderKeys({
      startTick: 0,
      startOffsetSec: 0,
      projectRevision: 1,
      clips: [{
        clipId: "clip-1",
        trackId: "track-a",
        mediaId: "media-1",
        renderKey: "schedule-a",
        whenRelativeSec: 0,
        clipDurationSec: 1,
        clipGain: 1,
        trackGain: 1,
        trackPan: 0,
      }],
    }),
  );

  assert.deepEqual(
    Array.from(merged).sort(),
    ["engine-a", "engine-b", "schedule-a"],
  );
});

test("prepared playback diagnostics reuse cache without emitting rendered buffers on warm rebuild", () => {
  const project = createTestProject();
  const compiledPlan = createCompiledPlan();
  const analysisLookup = createAnalysisLookup();
  const mediaBuffer = createAudioBufferData(1, 48_000, 48_000);
  const mediaLookup = new Map([["media-1", mediaBuffer]]);
  const renderCache = new Map<string, ReturnType<typeof createAudioBufferData>>();

  const firstDiagnostics = createPlaybackPreparationDiagnostics();
  const first = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    {
      diagnostics: firstDiagnostics,
      getCachedBuffer: (renderKey) => renderCache.get(renderKey),
      setCachedBuffer: (renderKey, buffer) => {
        renderCache.set(renderKey, buffer);
      },
    },
  );

  const secondDiagnostics = createPlaybackPreparationDiagnostics();
  const second = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    {
      diagnostics: secondDiagnostics,
      getCachedBuffer: (renderKey) => renderCache.get(renderKey),
      knownRenderKeys: new Set(first.clips.map((clip) => clip.renderKey)),
    },
  );

  assert.equal(first.clips.length, 2);
  assert.equal(second.clips.length, 2);
  assert.equal(secondDiagnostics.renderCacheHitCount, 2);
  assert.equal(secondDiagnostics.renderCacheMissCount, 0);
  assert.equal(secondDiagnostics.metadataOnlyClipCount, 2);
  assert.equal(secondDiagnostics.bufferPayloadIncludedCount, 0);
  assert.equal(secondDiagnostics.renderKeyBuildCount, 2);
  assert.equal(secondDiagnostics.analysisSignatureBuildCount, 2);
});

test("main-owned render keys skip worker rendering without a worker-side rendered cache", () => {
  const project = createTestProject();
  const compiledPlan = createCompiledPlan();
  const analysisLookup = createAnalysisLookup();
  const mediaLookup = new Map([
    ["media-1", createAudioBufferData(1, 48_000, 48_000)],
  ]);
  const cold = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
  );
  const diagnostics = createPlaybackPreparationDiagnostics();

  const warm = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    {
      knownRenderKeys: new Set(cold.clips.map((clip) => clip.renderKey)),
      diagnostics,
    },
  );

  assert.equal(warm.clips.length, cold.clips.length);
  assert.equal(diagnostics.actualRenderClipCount, 0);
  assert.equal(diagnostics.renderCacheMissCount, 0);
  assert.ok(warm.clips.every((clip) => clip.buffer === undefined));
});

test("playback preparation materializes buffers and cache keys at the requested output rate", () => {
  const project = createTestProject();
  project.edit.media[0] = {
    ...project.edit.media[0]!,
    src_sample_rate: 24_000,
    length_src_frames: 12_000,
  };
  for (const clip of project.edit.clips) {
    if (clip.kind.clip_type === "audio") {
      clip.kind.audio.src_out = 12_000;
    }
  }
  const compiledPlan = createCompiledPlan();
  compiledPlan.audio_clips = compiledPlan.audio_clips.map((clip) => ({
    ...clip,
    end_frame: clip.start_frame + 24_000,
    src_out_frame: 12_000,
    warp_plan: {
      kind: "linear",
      segments: [{
        dst_start_frame: clip.start_frame,
        dst_end_frame: clip.start_frame + 24_000,
        src_start_frame: 0,
        src_end_frame: 12_000,
      }],
    },
  }));
  const mediaLookup = new Map([
    ["media-1", createAudioBufferData(1, 12_000, 24_000)],
  ]);
  const at48Khz = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    createAnalysisLookup(),
    compiledPlan,
    { outputSampleRate: 48_000 },
  );
  const at96Khz = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    createAnalysisLookup(),
    compiledPlan,
    { outputSampleRate: 96_000 },
  );

  assert.equal(at48Khz.clips[0]?.buffer?.sampleRate, 48_000);
  assert.equal(at48Khz.clips[0]?.buffer?.length, 24_000);
  assert.notEqual(at48Khz.clips[0]?.renderKey, at96Khz.clips[0]?.renderKey);
});

test("prepared playback progress avoids per-candidate render spam when all buffers are cached", () => {
  const project = createTestProject();
  const compiledPlan = createCompiledPlan();
  const analysisLookup = createAnalysisLookup();
  const mediaBuffer = createAudioBufferData(1, 48_000, 48_000);
  const mediaLookup = new Map([["media-1", mediaBuffer]]);
  const renderCache = new Map<string, ReturnType<typeof createAudioBufferData>>();

  const coldSchedule = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    {
      getCachedBuffer: (renderKey) => renderCache.get(renderKey),
      setCachedBuffer: (renderKey, buffer) => {
        renderCache.set(renderKey, buffer);
      },
    },
  );

  const seenPhases: Array<{ phase: string; progress: number }> = [];
  buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    mediaLookup,
    analysisLookup,
    compiledPlan,
    {
      getCachedBuffer: (renderKey) => renderCache.get(renderKey),
      knownRenderKeys: new Set(coldSchedule.clips.map((clip) => clip.renderKey)),
      onProgress: (progress) => {
        seenPhases.push({ phase: progress.phase, progress: progress.progress });
      },
    },
  );

  assert.deepEqual(
    seenPhases.map((entry) => `${entry.phase}:${entry.progress}`),
    [
      "enumerating_candidates:0",
      "enumerating_candidates:1",
      "building_render_keys:0",
      "building_render_keys:1",
      "finalizing:0",
      "finalizing:1",
      "done:1",
    ],
  );
});

test("prepared playback schedule carries clip and track static mix values", () => {
  const project = createTestProject();
  project.edit.tracks[0] = {
    ...project.edit.tracks[0]!,
    gain_milli_db: -6000,
    pan_permille: 500,
  };
  project.edit.clips[0] = {
    ...project.edit.clips[0]!,
    gain_milli_db: -3000,
  };

  const schedule = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    new Map([["media-1", createAudioBufferData(1, 48_000, 48_000)]]),
    createAnalysisLookup(),
    createCompiledPlan(),
  );

  assert.equal(Number(schedule.clips[0]?.clipGain.toFixed(4)), 0.7079);
  assert.equal(Number(schedule.clips[0]?.trackGain.toFixed(4)), 0.5012);
  assert.equal(schedule.clips[0]?.trackPan, 0.5);
});

test("prepared playback schedule exposes the music backend for Music clips", () => {
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
          manual_coarse_semitones: 1,
        },
      },
    },
  };

  const schedule = buildPreparedPlaybackScheduleFromCompiledPlan(
    project,
    new Map([["media-1", createAudioBufferData(1, 48_000, 48_000)]]),
    createAnalysisLookup(),
    createCompiledPlan(),
  );

  assert.equal(schedule.clips[0]?.renderKey.includes("music_phase_vocoder"), true);
});
