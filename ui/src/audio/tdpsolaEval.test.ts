import assert from "node:assert/strict";
import test from "node:test";

import type { ClipWarpPlan } from "./pitchPlan.ts";
import {
  evaluateTargetFundamental,
  harmonicSpectralEnvelopeDistanceDb,
  normalizedWaveformDifference,
} from "./tdpsolaEval.ts";
import { renderSourceNativePlan } from "./tdpsolaV2/sourceNativeRenderer.ts";
import { buildSourceNativeSynthesisPlan } from "./tdpsolaV2/synthesisPlan.ts";

const SAMPLE_RATE = 44_000;
const SOURCE_F0_HZ = 220;
const SOURCE_PERIOD_SAMPLES = SAMPLE_RATE / SOURCE_F0_HZ;
const SOURCE_LENGTH = SAMPLE_RATE;
const SOURCE_MARKS = Array.from(
  { length: Math.floor(SOURCE_LENGTH / SOURCE_PERIOD_SAMPLES) - 1 },
  (_, index) => (index + 1) * SOURCE_PERIOD_SAMPLES,
);

function linearWarp(): ClipWarpPlan {
  return {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: SOURCE_LENGTH,
      sourceStartSample: 0,
      sourceEndSample: SOURCE_LENGTH,
    }],
  };
}

function renderPitchUp(source: Float32Array): Float32Array {
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
  });
  return renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 127,
  }).channels[0]!;
}

function makePureCosine(): Float32Array {
  return Float32Array.from(
    { length: SOURCE_LENGTH },
    (_, index) => Math.cos((2 * Math.PI * SOURCE_F0_HZ * index) / SAMPLE_RATE),
  );
}

function formantGain(frequencyHz: number): number {
  const gaussian = (centerHz: number, widthHz: number, gain: number) =>
    gain * Math.exp(-0.5 * ((frequencyHz - centerHz) / widthHz) ** 2);
  return 0.04 +
    gaussian(700, 180, 1) +
    gaussian(1_300, 240, 0.8) +
    gaussian(2_600, 380, 0.55);
}

function makeFormantHarmonicSignal(): Float32Array {
  const output = new Float32Array(SOURCE_LENGTH);
  const harmonicCount = Math.floor(8_000 / SOURCE_F0_HZ);
  for (let harmonic = 1; harmonic <= harmonicCount; harmonic++) {
    const frequencyHz = harmonic * SOURCE_F0_HZ;
    const amplitude = formantGain(frequencyHz);
    const phaseOffset = harmonic * 0.173;
    for (let index = 0; index < output.length; index++) {
      output[index] = (output[index] ?? 0) +
        amplitude * Math.cos((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE + phaseOffset);
    }
  }
  const peak = output.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
  const gain = peak > 0 ? 0.8 / peak : 1;
  for (let index = 0; index < output.length; index++) {
    output[index] = (output[index] ?? 0) * gain;
  }
  return output;
}

function wrongResampledPitchUp(source: Float32Array): Float32Array {
  return Float32Array.from(
    { length: source.length },
    (_, index) => source[(index * 2) % source.length] ?? 0,
  );
}

test("target F0 and identity gates reject the pre-fix octave-up cancellation", () => {
  const source = makePureCosine();
  const rendered = renderPitchUp(source);
  const sourceAtTarget = evaluateTargetFundamental(source, SAMPLE_RATE, 440);
  const renderedAtTarget = evaluateTargetFundamental(rendered, SAMPLE_RATE, 440);

  assert.ok(sourceAtTarget.amplitudeToAcRmsRatio < 1e-4);
  assert.ok(renderedAtTarget.amplitudeToAcRmsRatio > 0.5);
  assert.ok(Math.abs(renderedAtTarget.centsError) < 5);
  assert.ok(normalizedWaveformDifference(source, source) < 1e-7);
  assert.ok(normalizedWaveformDifference(source, rendered) > 0.5);
});

test("source-native pitch-up retains the fixed formant envelope better than resampling", () => {
  const source = makeFormantHarmonicSignal();
  const sourceNative = renderPitchUp(source);
  const resampled = wrongResampledPitchUp(source);
  const sourceNativeDistance = harmonicSpectralEnvelopeDistanceDb({
    reference: source,
    referenceF0Hz: SOURCE_F0_HZ,
    candidate: sourceNative,
    candidateF0Hz: SOURCE_F0_HZ * 2,
    sampleRate: SAMPLE_RATE,
  });
  const resampledDistance = harmonicSpectralEnvelopeDistanceDb({
    reference: source,
    referenceF0Hz: SOURCE_F0_HZ,
    candidate: resampled,
    candidateF0Hz: SOURCE_F0_HZ * 2,
    sampleRate: SAMPLE_RATE,
  });

  assert.ok(Number.isFinite(sourceNativeDistance));
  assert.ok(Number.isFinite(resampledDistance));
  assert.ok(
    sourceNativeDistance < resampledDistance * 0.75,
    `expected source-native ${sourceNativeDistance} dB < resampled ${resampledDistance} dB`,
  );
});
