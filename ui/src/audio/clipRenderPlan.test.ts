import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClipRenderPlan,
  DEFAULT_TDPSOLA_CORE,
} from "./clipRenderPlan.ts";
import type { AudioClipEdit, CompiledPitchPlan } from "../types/index.ts";

function createCompiledPlan(overrides?: Partial<CompiledPitchPlan>): CompiledPitchPlan {
  return {
    sample_rate: 48_000,
    audio_clips: [{
      clip_id: "clip-a",
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
    }],
    pitch_plan: [],
    ...overrides,
  };
}

function createAudioClipEdit(overrides?: Partial<AudioClipEdit>): AudioClipEdit {
  return {
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
    ...overrides,
  };
}

test("buildClipRenderPlan returns bypass for unchanged linear clips", () => {
  const plan = buildClipRenderPlan({
    compiledPlan: createCompiledPlan(),
    clipId: "clip-a",
    trackId: "track-a",
    audio: createAudioClipEdit(),
    clipDurationSec: 1,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });

  assert.equal(plan.totalPitchSemitones, 0);
  assert.equal(plan.timePitchMode, "Voice");
  assert.equal(plan.backend, "direct");
  assert.equal(plan.backendVersion, "direct-v1");
  assert.equal(plan.renderOperation, "bypass");
  assert.equal(plan.useDirectRender, true);
  assert.equal(plan.preserveFormant, false);
});

test("buildClipRenderPlan defaults pitch work to the source-native backend", () => {
  const plan = buildClipRenderPlan({
    compiledPlan: createCompiledPlan({
      pitch_plan: [{
        clip_id: "clip-a",
        audio_track: "track-a",
        start_frame: 0,
        end_frame: 48_000,
        shift_cents: 200,
      }],
    }),
    clipId: "clip-a",
    trackId: "track-a",
    audio: createAudioClipEdit({
      pitch: {
        mode: "ManualPlusFollow",
        manual_coarse_semitones: 1,
        manual_fine_cents: 0,
      },
      time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: true },
    }),
    clipDurationSec: 1,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });

  assert.equal(plan.totalPitchSemitones, 3);
  assert.equal(plan.timePitchMode, "Voice");
  assert.equal(DEFAULT_TDPSOLA_CORE, "source_native_v2");
  assert.equal(plan.tdPsolaCore, "source_native_v2");
  assert.equal(plan.backend, "source_native_tdpsola");
  assert.equal(plan.backendVersion, "source-native-tdpsola-v2-a5-unvoiced-stretch");
  assert.equal(plan.renderOperation, "pitch_only");
  assert.equal(plan.useDirectRender, false);
  assert.equal(plan.preserveFormant, true);
});

test("source-native v2 routes Local and Source analysis through one synthesis backend", () => {
  const plans = (["Local", "Source"] as const).map((analysis) =>
    buildClipRenderPlan({
      compiledPlan: createCompiledPlan(),
      clipId: "clip-a",
      trackId: "track-a",
      audio: createAudioClipEdit({
        time_pitch: { mode: "Voice", analysis, preserve_formant: true },
        pitch: {
          mode: "ManualOnly",
          manual_coarse_semitones: 12,
          manual_fine_cents: 0,
        },
      }),
      clipDurationSec: 1,
      mediaSampleRate: 48_000,
      microBpm: 120_000_000,
      ppq: 960,
      tdPsolaCore: "source_native_v2",
    })
  );

  for (const plan of plans) {
    assert.equal(plan.tdPsolaCore, "source_native_v2");
    assert.equal(plan.backend, "source_native_tdpsola");
    assert.equal(plan.backendVersion, "source-native-tdpsola-v2-a5-unvoiced-stretch");
    assert.equal(plan.renderOperation, "pitch_only");
  }
  assert.equal(plans[0]?.timePitchMode, plans[1]?.timePitchMode);
  assert.equal(plans[0]?.tdPsolaAnalysisPolicy, "legacy_local");
  assert.equal(plans[1]?.tdPsolaAnalysisPolicy, "voice_monophonic_v2");
});

test("buildClipRenderPlan keeps stretch-only clips off the bypass path", () => {
  const plan = buildClipRenderPlan({
    compiledPlan: createCompiledPlan(),
    clipId: "clip-a",
    trackId: "track-a",
    audio: createAudioClipEdit(),
    clipDurationSec: 0.5,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });

  assert.equal(plan.totalPitchSemitones, 0);
  assert.equal(plan.timePitchMode, "Voice");
  assert.equal(plan.backend, "source_native_tdpsola");
    assert.equal(plan.backendVersion, "source-native-tdpsola-v2-a5-unvoiced-stretch");
  assert.equal(plan.renderOperation, "stretch_only");
  assert.equal(plan.useDirectRender, false);
});

test("buildClipRenderPlan threads Source analysis identity without changing a bypass backend", () => {
  const plan = buildClipRenderPlan({
    compiledPlan: createCompiledPlan(),
    clipId: "clip-a",
    trackId: "track-a",
    audio: createAudioClipEdit({
      time_pitch: { mode: "Voice", analysis: "Source", preserve_formant: false },
    }),
    clipDurationSec: 1,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });

  assert.equal(plan.timePitchMode, "Voice");
  assert.equal(plan.tdPsolaAnalysisPolicy, "voice_monophonic_v2");
  assert.equal(plan.backend, "direct");
  assert.equal(plan.backendVersion, "direct-v1");
});

test("buildClipRenderPlan exposes the music backend identity", () => {
  const plan = buildClipRenderPlan({
    compiledPlan: createCompiledPlan(),
    clipId: "clip-a",
    trackId: "track-a",
    audio: createAudioClipEdit({
      time_pitch: { mode: "Music" },
      pitch: {
        mode: "ManualOnly",
        manual_coarse_semitones: 1,
        manual_fine_cents: 0,
      },
    }),
    clipDurationSec: 1,
    mediaSampleRate: 48_000,
    microBpm: 120_000_000,
    ppq: 960,
  });

  assert.equal(plan.timePitchMode, "Music");
  assert.equal(plan.backend, "music_phase_vocoder");
  assert.equal(plan.backendVersion, "music-phase-vocoder-v1");
  assert.equal(plan.useDirectRender, false);
});
