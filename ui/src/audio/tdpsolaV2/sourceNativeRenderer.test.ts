import assert from "node:assert/strict";
import test from "node:test";

import type { ClipWarpPlan } from "../pitchPlan.ts";
import { estimateDominantFrequencyHz } from "../musicPhaseVocoder.ts";
import { renderSourceNativePlan } from "./sourceNativeRenderer.ts";
import { buildSourceNativeSynthesisPlan } from "./synthesisPlan.ts";

const SAMPLE_RATE = 48_000;
const SOURCE_LENGTH = 1_000;
const SOURCE_MARKS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function linearWarp(sourceLength: number, outputLength: number): ClipWarpPlan {
  return {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: outputLength,
      sourceStartSample: 0,
      sourceEndSample: sourceLength,
    }],
  };
}

function makePeriodicCosine(length: number, periodSamples: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => Math.cos((2 * Math.PI * index) / periodSamples),
  );
}

function makeImpulseTrain(length: number, marks: readonly number[]): Float32Array {
  const source = new Float32Array(length);
  for (const mark of marks) {
    if (mark >= 0 && mark < length) source[mark] = 1;
  }
  return source;
}

function peakIndices(input: Float32Array, threshold: number): number[] {
  const indices: number[] = [];
  for (let index = 0; index < input.length; index++) {
    if ((input[index] ?? 0) >= threshold) indices.push(index);
  }
  return indices;
}

function maximumAbsoluteDifference(
  left: Float32Array,
  right: Float32Array,
  start = 0,
  end = Math.min(left.length, right.length),
): number {
  let maximum = 0;
  for (let index = start; index < end; index++) {
    maximum = Math.max(maximum, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
  }
  return maximum;
}

function sinusoidAmplitude(
  samples: Float32Array,
  sampleRate: number,
  frequencyHz: number,
): number {
  const start = Math.floor(samples.length * 0.1);
  const end = Math.ceil(samples.length * 0.9);
  let real = 0;
  let imaginary = 0;
  for (let index = start; index < end; index++) {
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    real += (samples[index] ?? 0) * Math.cos(phase);
    imaginary -= (samples[index] ?? 0) * Math.sin(phase);
  }
  return (2 * Math.hypot(real, imaginary)) / Math.max(1, end - start);
}

test("identity complementary overlap reconstructs a periodic interior", () => {
  const source = makePeriodicCosine(SOURCE_LENGTH, 100);
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, SOURCE_LENGTH),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH,
    sampleRate: SAMPLE_RATE,
  });
  const result = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 128,
  });

  assert.ok(maximumAbsoluteDifference(result.channels[0]!, source, 100, 900) < 1e-6);
  assert.equal(result.channelDiagnostics[0]?.sourceReadStep, 1);
  assert.equal(result.channelDiagnostics[0]?.grainCount, SOURCE_MARKS.length);
  assert.equal(result.channelDiagnostics[0]?.committedOutputSamples, SOURCE_LENGTH);
  assert.ok((result.channelDiagnostics[0]?.maxPendingTailSamples ?? 0) >= 200);
});

test("pitch plans produce impulse periods at synthesis marks", () => {
  const source = makeImpulseTrain(SOURCE_LENGTH, SOURCE_MARKS);
  const pitchUpPlan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, SOURCE_LENGTH),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
  });
  const pitchDownPlan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, SOURCE_LENGTH),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH,
    defaultShiftCents: -1_200,
    sampleRate: SAMPLE_RATE,
  });

  const pitchUp = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan: pitchUpPlan,
    blockSize: 64,
  }).channels[0]!;
  const pitchDown = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan: pitchDownPlan,
    blockSize: 64,
  }).channels[0]!;

  assert.deepEqual(peakIndices(pitchUp, 0.49), [
    100, 150, 200, 250, 300, 350, 400, 450, 500,
    550, 600, 650, 700, 750, 800, 850, 900, 950,
  ]);
  assert.deepEqual(peakIndices(pitchDown, 0.99), [100, 300, 500, 700, 900]);
});

test("220 Hz periodic source reaches 110/440 Hz and survives 1.5x stretch", () => {
  const sampleRate = 44_000;
  const sourceLength = sampleRate;
  const periodSamples = 200;
  const sourceMarks = Array.from(
    { length: Math.floor(sourceLength / periodSamples) - 1 },
    (_, index) => (index + 1) * periodSamples,
  );
  const source = makePeriodicCosine(sourceLength, periodSamples);
  const render = (outputLength: number, shiftCents: number) => {
    const plan = buildSourceNativeSynthesisPlan({
      sourceMarks,
      warpPlan: linearWarp(sourceLength, outputLength),
      outputStartSample: 0,
      outputEndSample: outputLength,
      defaultShiftCents: shiftCents,
      sampleRate,
    });
    const samples = renderSourceNativePlan({
      sourceChannels: [source],
      sourceMarks,
      plan,
      blockSize: 127,
    }).channels[0]!;
    return { samples, plannedF0Hz: plan.diagnostics.medianPlannedF0Hz };
  };
  const pitchDown = render(sourceLength, -1_200);
  const pitchUp = render(sourceLength, 1_200);
  const stretched = render(Math.round(sourceLength * 1.5), 0);
  const interior = (samples: Float32Array) =>
    samples.subarray(Math.floor(samples.length * 0.1), Math.ceil(samples.length * 0.9));
  const stretchHz = estimateDominantFrequencyHz(interior(stretched.samples), sampleRate);

  assert.equal(pitchDown.plannedF0Hz, 110);
  assert.equal(pitchUp.plannedF0Hz, 440);
  assert.equal(stretched.plannedF0Hz, 220);
  // A source-native octave-down keeps the original 220 Hz carrier as the
  // second harmonic. The new 110/330 Hz sidebands prove that this is not an
  // identity render even though 220 Hz remains the strongest FFT bin.
  assert.ok(sinusoidAmplitude(pitchDown.samples, sampleRate, 110) > 0.2);
  assert.ok(sinusoidAmplitude(pitchDown.samples, sampleRate, 330) > 0.2);
  assert.ok(sinusoidAmplitude(pitchUp.samples, sampleRate, 440) > 0.4);
  assert.ok(stretchHz > 190 && stretchHz < 250, `expected ~220 Hz, got ${stretchHz}`);
});

test("time stretch repeats grains while retaining the source period", () => {
  const source = makeImpulseTrain(SOURCE_LENGTH, SOURCE_MARKS);
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, SOURCE_LENGTH * 2),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH * 2,
    sampleRate: SAMPLE_RATE,
  });
  const output = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 127,
  }).channels[0]!;
  const peaks = peakIndices(output, 0.99);

  assert.deepEqual(peaks, [
    200, 300, 400, 500, 600, 700, 800, 900, 1_000,
    1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700, 1_800, 1_900,
  ]);
  assert.ok(peaks.slice(1).every((peak, index) => peak - peaks[index]! === 100));
});

test("render output is exactly invariant to pull block size", () => {
  const source = Float32Array.from({ length: SOURCE_LENGTH }, (_, index) => {
    const fundamental = Math.cos((2 * Math.PI * index) / 100);
    const second = 0.25 * Math.cos((4 * Math.PI * index) / 100 + 0.3);
    return fundamental + second;
  });
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, 1_500),
    outputStartSample: 0,
    outputEndSample: 1_500,
    defaultShiftCents: 700,
    sampleRate: SAMPLE_RATE,
  });

  const oneSampleBlocks = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 1,
  }).channels[0]!;
  const oddBlocks = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 37,
  }).channels[0]!;
  const largeBlocks = renderSourceNativePlan({
    sourceChannels: [source],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 512,
  }).channels[0]!;

  assert.deepEqual(oneSampleBlocks, oddBlocks);
  assert.deepEqual(oneSampleBlocks, largeBlocks);
});

test("channels share one mark plan and retain channel-relative gain", () => {
  const left = makePeriodicCosine(SOURCE_LENGTH, 100);
  const right = Float32Array.from(left, (sample) => sample * 0.25);
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(SOURCE_LENGTH, SOURCE_LENGTH),
    outputStartSample: 0,
    outputEndSample: SOURCE_LENGTH,
    sampleRate: SAMPLE_RATE,
  });
  const result = renderSourceNativePlan({
    sourceChannels: [left, right],
    sourceMarks: SOURCE_MARKS,
    plan,
    blockSize: 128,
  });

  assert.equal(result.channels.length, 2);
  for (let index = 0; index < SOURCE_LENGTH; index++) {
    assert.ok(
      Math.abs((result.channels[1]![index] ?? 0) - (result.channels[0]![index] ?? 0) * 0.25) < 1e-7,
    );
  }
});

test("out-of-source fractional reads are zero padded and diagnosed", () => {
  const sourceMarks = [10, 110, 210] as const;
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks,
    warpPlan: linearWarp(300, 300),
    outputStartSample: 0,
    outputEndSample: 300,
    initialOutputCenterSample: 50,
    sampleRate: SAMPLE_RATE,
  });
  const result = renderSourceNativePlan({
    sourceChannels: [makePeriodicCosine(300, 100)],
    sourceMarks,
    plan,
    blockSize: 32,
  });

  assert.ok((result.channelDiagnostics[0]?.zeroPaddedSourceReadCount ?? 0) > 0);
  assert.ok(result.channels[0]!.every(Number.isFinite));
});
