import assert from "node:assert/strict";
import test from "node:test";

import { ensureTestWasmReady } from "../test/ensureTestWasm.ts";
import { create_project, compile_pitch_plan_json } from "../wasm/otomad_core.js";
import { AnalysisStore } from "./analysisStore.ts";
import { buildAnalysisSignature } from "./analysisResolution.ts";
import type {
  AnalysisArtifact,
  AnalysisId,
  F0TrackArtifact,
  PitchMarksArtifact,
  ProjectDocument,
} from "../types/index.ts";

ensureTestWasmReady();

const TEST_F0: F0TrackArtifact = {
  schema_version: 1,
  kind: "f0_track",
  media_id: "media-1",
  src_sample_rate: 48_000,
  created_by: { app_version: "test", algo_version: "1", params_hash: "f0-hash" },
  hop_src_frames: 256,
  f0_hz_x100: [44_000, 44_100],
  voiced_prob_permille: [900, 880],
  method: "test",
  params: "{}",
};

const TEST_PITCH_MARKS: PitchMarksArtifact = {
  schema_version: 1,
  kind: "pitch_marks",
  media_id: "media-1",
  src_sample_rate: 48_000,
  created_by: { app_version: "test", algo_version: "1", params_hash: "marks-hash" },
  marks_src_frames: [0, 120, 240],
  mark_policy: "test",
  params: "{}",
};

test("analysis signatures depend on analysis content, not media identity", () => {
  const original = buildAnalysisSignature(TEST_F0, TEST_PITCH_MARKS);
  const duplicate = buildAnalysisSignature(
    { ...TEST_F0, media_id: "media-duplicate" },
    { ...TEST_PITCH_MARKS, media_id: "media-duplicate" },
  );

  assert.equal(duplicate, original);
});

test("analysis signatures include source-native pitch-mark features", () => {
  const withFeatures = {
    ...TEST_PITCH_MARKS,
    mark_features: [{
      transient_value: 0.1,
      onset_value: 0.2,
      cycle_energy: 0.3,
      tonality: 0.4,
      confidence: 0.5,
      epoch_strength: 0.6,
      gci_quality: 0.7,
      left_period_samples: 100,
      right_period_samples: 101,
      excitation_balance: 0.8,
      expression_baseline_hz_x100: 22_000,
      expression_deviation_cents: 12,
      local_pitch_hz_x100: 22_100,
    }],
  };
  const changedFeatures = {
    ...withFeatures,
    mark_features: [{ ...withFeatures.mark_features[0]!, gci_quality: 0.9 }],
  };

  assert.notEqual(
    buildAnalysisSignature(TEST_F0, withFeatures),
    buildAnalysisSignature(TEST_F0, changedFeatures),
  );
});

function createProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "analysis-test",
      created_at: "2026-03-09T00:00:00Z",
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
      tracks: [],
      media: [{
        id: "media-1",
        in_zip_path: "media/media-1.wav",
        channels: 1,
        src_sample_rate: 48_000,
        length_src_frames: 48_000,
        hash: null,
        original_name: "voice.wav",
      }],
      contents: [{
        type: "audio",
        id: "content-1",
        media_id: "media-1",
        analysis_refs: [],
      }],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

test("buildCompileInput injects analysis_refs and serializes registry by AnalysisId", () => {
  const store = new AnalysisStore();
  const pitchMarksId = "00000000-0000-0000-0000-000000000001" as AnalysisId;
  const f0Id = "00000000-0000-0000-0000-000000000002" as AnalysisId;

  store.setPitchMarks("media-1", TEST_PITCH_MARKS, pitchMarksId);
  store.setF0("media-1", TEST_F0, f0Id);

  const compileInput = store.buildCompileInput(createProject());
  const content = compileInput.project.edit.contents[0];
  if (!content || content.type !== "audio") {
    throw new Error("expected audio content");
  }

  assert.deepEqual(content.analysis_refs, [f0Id, pitchMarksId]);

  const registry = JSON.parse(compileInput.analysisJson) as Record<string, AnalysisArtifact>;
  assert.equal(registry[f0Id]?.kind, "f0_track");
  assert.equal(registry[pitchMarksId]?.kind, "pitch_marks");
});

test("resolveForAudioContent and buildCompileInput respect explicit analysis refs over media fallback", () => {
  const store = new AnalysisStore();
  const fallbackF0Id = "00000000-0000-0000-0000-000000000010" as AnalysisId;
  const explicitF0Id = "00000000-0000-0000-0000-000000000020" as AnalysisId;
  const pitchMarksId = "00000000-0000-0000-0000-000000000030" as AnalysisId;
  const explicitF0: F0TrackArtifact = {
    ...TEST_F0,
    created_by: { ...TEST_F0.created_by, params_hash: "explicit-f0" },
  };

  store.setF0("media-1", TEST_F0, fallbackF0Id);
  store.setPitchMarks("media-1", TEST_PITCH_MARKS, pitchMarksId);
  store.getStore().set(explicitF0Id, explicitF0);

  const project = createProject();
  const content = project.edit.contents[0];
  if (!content || content.type !== "audio") {
    throw new Error("expected audio content");
  }
  content.analysis_refs = [explicitF0Id];

  const resolved = store.resolveForAudioContent(content);
  assert.equal(resolved.sourceF0Track?.created_by.params_hash, "explicit-f0");
  assert.equal(resolved.sourcePitchMarks?.kind, "pitch_marks");

  const compileInput = store.buildCompileInput(project);
  const normalizedContent = compileInput.project.edit.contents[0];
  if (!normalizedContent || normalizedContent.type !== "audio") {
    throw new Error("expected normalized audio content");
  }

  assert.deepEqual(normalizedContent.analysis_refs, [explicitF0Id, pitchMarksId]);
});

test("ensureForBuffer normalizes wasm-generated artifacts to include kind before compile", async () => {
  class FakeAudioBuffer {
    readonly sampleRate: number;
    readonly length: number;
    readonly numberOfChannels = 1;
    private readonly mono: Float32Array;

    constructor(mono: Float32Array, sampleRate: number) {
      this.mono = mono;
      this.sampleRate = sampleRate;
      this.length = mono.length;
    }

    getChannelData(channel: number): Float32Array {
      if (channel !== 0) {
        throw new RangeError(`Missing channel ${channel}`);
      }
      return this.mono;
    }
  }

  const sampleRate = 48_000;
  const sampleCount = sampleRate;
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }

  const store = new AnalysisStore();
  const result = await store.ensureForBuffer(
    "00000000-0000-0000-0000-0000000000aa",
    new FakeAudioBuffer(samples, sampleRate),
  );

  assert.ok(result.analysisRefs.length >= 1);
  assert.equal(
    result.f0.created_by.algo_version,
    "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2",
  );
  assert.match(result.f0.params, /profile=tdpsola_monophonic_v2/);
  assert.match(result.f0.params, /max_f0=1200/);
  assert.equal(
    result.pitchMarks?.created_by.algo_version,
    "peak-refinement-v3-monophonic-gap-repair",
  );
  assert.match(result.pitchMarks?.params ?? "", /f0_algo_version=.*tdpsola-monophonic-v2/);

  const compileInput = store.buildCompileInput(createProject());
  const registry = JSON.parse(compileInput.analysisJson) as Record<string, AnalysisArtifact>;
  for (const artifact of Object.values(registry)) {
    assert.ok(artifact.kind);
  }

  assert.doesNotThrow(() =>
    compile_pitch_plan_json(
      create_project("analysis-generated", 120, sampleRate),
      compileInput.analysisJson,
    )
  );
});

test("ensureForBuffer can still request the legacy analysis profile explicitly", async () => {
  const sampleRate = 48_000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }
  const buffer = {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData(channel: number): Float32Array {
      if (channel !== 0) throw new RangeError(`Missing channel ${channel}`);
      return samples;
    },
  };

  const result = await new AnalysisStore().ensureForBuffer(
    "00000000-0000-0000-0000-0000000000ab",
    buffer,
    { profile: "legacy_default" },
  );

  assert.equal(result.f0.created_by.algo_version, "loqa-voice-dsp-0.5.0-pyin");
  assert.doesNotMatch(result.f0.params, /profile=/);
  assert.match(result.f0.params, /max_f0=500/);
});

test("ensureForBuffer refreshes stale F0 and dependent pitch marks for v2", async () => {
  const sampleRate = 48_000;
  const mediaId = "00000000-0000-0000-0000-0000000000ac";
  const samples = new Float32Array(sampleRate);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * 700 * index) / sampleRate);
  }
  const buffer = {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
  const f0Id = "00000000-0000-0000-0000-0000000000ad" as AnalysisId;
  const marksId = "00000000-0000-0000-0000-0000000000ae" as AnalysisId;
  const store = new AnalysisStore();
  store.setF0(mediaId, {
    ...TEST_F0,
    media_id: mediaId,
    created_by: {
      app_version: "0.1.0",
      algo_version: "loqa-voice-dsp-0.5.0-pyin",
      params_hash: "min_f0=60,max_f0=500,frame_size=2048,hop_size=512,voiced_threshold=0.6",
    },
    params: "min_f0=60,max_f0=500,frame_size=2048,hop_size=512,voiced_threshold=0.6",
  }, f0Id);
  store.setPitchMarks(mediaId, {
    ...TEST_PITCH_MARKS,
    media_id: mediaId,
    created_by: {
      app_version: "0.1.0",
      algo_version: "peak-refinement-v1",
      params_hash: "",
    },
    params: "",
  }, marksId);

  const result = await store.ensureForBuffer(mediaId, buffer, {
    profile: "tdpsola_monophonic_v2",
    refreshIfProfileMismatch: true,
  });

  assert.equal(
    result.f0.created_by.algo_version,
    "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2",
  );
  assert.ok(result.f0.f0_hz_x100.some((value) => value > 50_000));
  assert.equal(
    result.pitchMarks?.created_by.algo_version,
    "peak-refinement-v3-monophonic-gap-repair",
  );
  assert.match(result.pitchMarks?.params ?? "", /f0_algo_version=.*tdpsola-monophonic-v2/);
  assert.deepEqual(result.analysisRefs, [f0Id, marksId]);
});

test("ensureForBuffer never reuses artifacts from a different source sample rate", async () => {
  const mediaId = "00000000-0000-0000-0000-0000000000af";
  const sampleRate = 48_000;
  const samples = new Float32Array(4_096);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate);
  }
  const store = new AnalysisStore();
  store.setF0(mediaId, { ...TEST_F0, media_id: mediaId, src_sample_rate: 44_100 });
  store.setPitchMarks(mediaId, {
    ...TEST_PITCH_MARKS,
    media_id: mediaId,
    src_sample_rate: 44_100,
  });

  const result = await store.ensureForBuffer(mediaId, {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  });

  assert.equal(result.f0.src_sample_rate, sampleRate);
  assert.equal(result.pitchMarks?.src_sample_rate, sampleRate);
});
