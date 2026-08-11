import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisArtifactMatchesSource,
  normalizeAnalysisArtifact,
} from "./analysisArtifact.ts";
import type { F0TrackArtifact, PitchMarksArtifact } from "../types/index.ts";

test("normalizeAnalysisArtifact preserves explicit kind", () => {
  const artifact = normalizeAnalysisArtifact({
    kind: "f0_track",
    schema_version: 1,
    media_id: "media-1",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "1", params_hash: "hash" },
    hop_src_frames: 240,
    f0_hz_x100: [44_000],
    voiced_prob_permille: [900],
    method: "test",
    params: "{}",
  });

  assert.equal(artifact.kind, "f0_track");
});

test("normalizeAnalysisArtifact infers legacy bare f0 payloads", () => {
  const artifact = normalizeAnalysisArtifact({
    schema_version: 1,
    media_id: "media-1",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "1", params_hash: "hash" },
    hop_src_frames: 240,
    f0_hz_x100: [44_000],
    voiced_prob_permille: [900],
    method: "test",
    params: "{}",
  });

  assert.equal(artifact.kind, "f0_track");
});

test("normalizeAnalysisArtifact infers legacy bare pitch-mark payloads", () => {
  const artifact = normalizeAnalysisArtifact({
    schema_version: 1,
    media_id: "media-1",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "1", params_hash: "hash" },
    marks_src_frames: [0, 120, 240],
    mark_policy: "test",
    params: "{}",
  });

  assert.equal(artifact.kind, "pitch_marks");
  assert.deepEqual("mark_features" in artifact ? artifact.mark_features : undefined, []);
});

test("normalizeAnalysisArtifact preserves source-native pitch-mark features", () => {
  const feature = {
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
    future_hint: "preserve-me",
  };
  const artifact = normalizeAnalysisArtifact({
    kind: "pitch_marks",
    schema_version: 1,
    media_id: "media-1",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "1", params_hash: "hash" },
    marks_src_frames: [120],
    mark_features: [feature],
    mark_policy: "test",
    params: "{}",
  });

  assert.equal(artifact.kind, "pitch_marks");
  assert.deepEqual("mark_features" in artifact ? artifact.mark_features : undefined, [feature]);
});

test("source artifact validation rejects coordinate and feature mismatches", () => {
  const source = { mediaId: "media-1", sampleRate: 48_000, sourceLengthFrames: 1_000 };
  const f0: F0TrackArtifact = {
    kind: "f0_track",
    schema_version: 1,
    media_id: source.mediaId,
    src_sample_rate: source.sampleRate,
    created_by: { app_version: "test", algo_version: "1", params_hash: "f0" },
    hop_src_frames: 240,
    f0_hz_x100: [22_000, 22_100],
    voiced_prob_permille: [900, 901],
    method: "test",
    params: "{}",
  };
  const marks: PitchMarksArtifact = {
    kind: "pitch_marks",
    schema_version: 1,
    media_id: source.mediaId,
    src_sample_rate: source.sampleRate,
    created_by: { app_version: "test", algo_version: "1", params_hash: "marks" },
    marks_src_frames: [100, 200],
    mark_features: [],
    mark_policy: "test",
    params: "{}",
  };

  assert.equal(analysisArtifactMatchesSource(f0, source), true);
  assert.equal(analysisArtifactMatchesSource(marks, source), true);
  assert.equal(analysisArtifactMatchesSource(
    { ...f0, voiced_prob_permille: [900] },
    source,
  ), false);
  assert.equal(analysisArtifactMatchesSource(
    { ...marks, marks_src_frames: [200, 100] },
    source,
  ), false);
  assert.equal(analysisArtifactMatchesSource(
    {
      ...marks,
      mark_features: [{
        transient_value: 0,
        onset_value: 0,
        cycle_energy: 0,
        tonality: 1,
        confidence: 1,
      }],
    },
    source,
  ), false);
});
