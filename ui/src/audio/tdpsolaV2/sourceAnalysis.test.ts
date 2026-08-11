import assert from "node:assert/strict";
import test from "node:test";

import { prepareSourcePlan, type PitchTrack } from "./sourceAnalysis.ts";

const SAMPLE_RATE = 1_000;

function makeSource(length: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => Math.cos((2 * Math.PI * index) / 5),
  );
}

function makeTrack(
  pitch: readonly number[],
  timestamps: readonly number[],
  probabilities: readonly number[] = pitch.map((value) => value > 0 ? 1 : 0),
): PitchTrack {
  return {
    pitchTrack: Float32Array.from(pitch),
    voicedProbabilities: Float32Array.from(probabilities),
    timestamps: Float32Array.from(timestamps),
  };
}

test("bounded edge repair extends short analysis gaps to media boundaries", () => {
  const sourceLength = 70;
  const plan = prepareSourcePlan({
    monoSource: makeSource(sourceLength),
    track: makeTrack(
      [0, 200, 200, 0],
      [0.02, 0.03, 0.04, 0.05],
      [0.5, 1, 1, 0.5],
    ),
    sampleRate: SAMPLE_RATE,
    providedMarks: undefined,
    voicedThreshold: 0.6,
    maximumGapSeconds: 0.03,
    minimumVoicedRunSeconds: 0.001,
    edgeContinuationThreshold: 0.45,
  });

  assert.equal(plan.repairedTrack.pitchTrack[0], 200);
  assert.equal(plan.repairedTrack.pitchTrack[3], 200);
  assert.deepEqual(
    plan.voicedRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
    [{ startSample: 0, endSample: sourceLength }],
  );
});

test("bounded edge repair preserves long leading and trailing unvoiced runs", () => {
  const sourceLength = 100;
  const plan = prepareSourcePlan({
    monoSource: makeSource(sourceLength),
    track: makeTrack(
      [0, 0, 0, 200, 0, 0, 0],
      [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08],
    ),
    sampleRate: SAMPLE_RATE,
    providedMarks: undefined,
    voicedThreshold: 0.6,
    maximumGapSeconds: 0.015,
    minimumVoicedRunSeconds: 0.001,
    edgeContinuationThreshold: 0.45,
  });

  assert.equal(plan.repairedTrack.pitchTrack[0], 0);
  assert.equal(plan.repairedTrack.pitchTrack[6], 0);
  assert.deepEqual(
    plan.voicedRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
    [{ startSample: 45, endSample: 55 }],
  );
});

test("provided F0 keeps its values while local periodicity supplies edge evidence", () => {
  const sourceLength = 70;
  const plan = prepareSourcePlan({
    monoSource: makeSource(sourceLength),
    track: makeTrack(
      [0, 200, 200, 0],
      [0.02, 0.03, 0.04, 0.05],
      [0, 1, 1, 0],
    ),
    edgeEvidenceTrack: makeTrack(
      [0, 210, 210, 0],
      [0.02, 0.03, 0.04, 0.05],
      [0.5, 1, 1, 0.5],
    ),
    sampleRate: SAMPLE_RATE,
    providedMarks: undefined,
    voicedThreshold: 0.6,
    maximumGapSeconds: 0.03,
    minimumVoicedRunSeconds: 0.001,
    edgeContinuationThreshold: 0.45,
  });

  assert.deepEqual(Array.from(plan.repairedTrack.pitchTrack), [200, 200, 200, 200]);
  assert.deepEqual(
    plan.voicedRegions.map(({ startSample, endSample }) => ({ startSample, endSample })),
    [{ startSample: 0, endSample: sourceLength }],
  );
});
