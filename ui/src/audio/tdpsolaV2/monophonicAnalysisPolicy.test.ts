import assert from "node:assert/strict";
import test from "node:test";

import { applyMonophonicPitchRangePolicy } from "./monophonicAnalysisPolicy.ts";

test("range policy rejects interpolation residue before pitch-mark generation", () => {
  const sourcePitch = new Float32Array([0, 0.000064, 336.64, 700, 1_201, Number.NaN]);
  const sourceProbabilities = new Float32Array([0.9, 0.81, 0.8, 0.99, 0.95, 0.9]);
  const result = applyMonophonicPitchRangePolicy({
    track: {
      pitchTrack: sourcePitch,
      voicedProbabilities: sourceProbabilities,
      timestamps: new Float32Array([0, 1, 2, 3, 4, 5]),
    },
    minimumF0Hz: 60,
    maximumF0Hz: 1_200,
  });

  assert.deepEqual(Array.from(result.track.pitchTrack), [0, 0, 336.6400146484375, 700, 0, 0]);
  assert.deepEqual(Array.from(result.track.voicedProbabilities), [0, 0, 0.800000011920929, 0.9900000095367432, 0, 0]);
  assert.deepEqual(result.diagnostics, {
    rejectedUnvoicedFrames: 2,
    rejectedBelowMinimumFrames: 1,
    rejectedAboveMaximumFrames: 1,
    acceptedVoicedFrames: 2,
  });
  assert.deepEqual(Array.from(sourcePitch).slice(0, 5), [0, 0.00006399999983841553, 336.6400146484375, 700, 1_201]);
  assert.equal(sourceProbabilities[1], 0.8100000023841858);
});

test("range policy rejects inconsistent array contracts", () => {
  assert.throws(() => applyMonophonicPitchRangePolicy({
    track: {
      pitchTrack: new Float32Array([220]),
      voicedProbabilities: new Float32Array(),
      timestamps: new Float32Array([0]),
    },
    minimumF0Hz: 60,
    maximumF0Hz: 1_200,
  }), /equal lengths/);
});
