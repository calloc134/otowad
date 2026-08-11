import assert from "node:assert/strict";
import test from "node:test";

import { createAudioBufferData } from "./audioBufferData.ts";
import type { ClipRenderPlan } from "./clipRenderPlan.ts";
import { renderClipFromPlan } from "./clipRenderDispatch.ts";

const DIRECT_PLAN: ClipRenderPlan = {
  totalPitchSemitones: 0,
  preserveFormant: false,
  renderOperation: "bypass",
  useDirectRender: true,
  timePitchMode: "Voice",
  tdPsolaCore: "legacy_v1",
  tdPsolaAnalysisPolicy: "legacy_local",
  backend: "direct",
  backendVersion: "direct-v1",
};

test("renderClipFromPlan dispatches direct plans without changing PCM", () => {
  const input = createAudioBufferData(1, 4, 4);
  input.channels[0]?.set([0.25, -0.5, 0.75, -1]);

  const rendered = renderClipFromPlan({
    mediaId: "media-1",
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: 4,
    targetDurationSec: 1,
    renderPlan: DIRECT_PLAN,
    sourceF0Track: null,
    sourcePitchMarks: null,
  });

  assert.deepEqual(rendered?.channels[0], input.channels[0]);
});

test("renderClipFromPlan rejects a source-native plan without an applicable policy", () => {
  const input = createAudioBufferData(1, 64, 48_000);
  assert.throws(() => renderClipFromPlan({
    mediaId: "media-1",
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: input.length,
    targetDurationSec: input.length / input.sampleRate,
    renderPlan: {
      ...DIRECT_PLAN,
      totalPitchSemitones: 1,
      renderOperation: "pitch_only",
      useDirectRender: false,
      tdPsolaCore: "source_native_v2",
      tdPsolaAnalysisPolicy: "not_applicable",
      backend: "source_native_tdpsola",
      backendVersion: "source-native-tdpsola-v2-a5-unvoiced-stretch",
    },
    sourceF0Track: null,
    sourcePitchMarks: null,
  }), /analysis policy/i);
});

test("renderClipFromPlan rejects analysis artifacts from a different source contract", () => {
  const input = createAudioBufferData(1, 4_800, 48_000);
  assert.throws(() => renderClipFromPlan({
    mediaId: "media-1",
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: input.length,
    targetDurationSec: input.length / input.sampleRate,
    renderPlan: {
      ...DIRECT_PLAN,
      totalPitchSemitones: 1,
      renderOperation: "pitch_only",
      useDirectRender: false,
      timePitchMode: "Voice",
      tdPsolaCore: "source_native_v2",
      tdPsolaAnalysisPolicy: "voice_monophonic_v2",
      backend: "source_native_tdpsola",
      backendVersion: "source-native-tdpsola-v2-a5-unvoiced-stretch",
    },
    sourceF0Track: {
      kind: "f0_track",
      schema_version: 1,
      media_id: "media-1",
      src_sample_rate: 44_100,
      created_by: { app_version: "test", algo_version: "1", params_hash: "f0" },
      hop_src_frames: 240,
      f0_hz_x100: [22_000],
      voiced_prob_permille: [900],
      method: "test",
      params: "{}",
    },
    sourcePitchMarks: null,
  }), /source contract/i);
});
