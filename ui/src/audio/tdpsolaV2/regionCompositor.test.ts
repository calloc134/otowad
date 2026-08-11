import assert from "node:assert/strict";
import test from "node:test";

import type { ClipWarpPlan } from "../pitchPlan.ts";
import { estimateDominantFrequencyHz } from "../musicPhaseVocoder.ts";
import { renderSourceNativeRegions } from "./regionCompositor.ts";

const SAMPLE_RATE = 48_000;

function identityWarp(length: number): ClipWarpPlan {
  return {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: length,
      sourceStartSample: 0,
      sourceEndSample: length,
    }],
  };
}

function makeImpulseSource(length: number, marks: readonly number[]): Float32Array {
  const source = Float32Array.from(
    { length },
    (_, index) => 0.05 * Math.sin((2 * Math.PI * index) / 37),
  );
  for (const mark of marks) source[mark] = 1;
  return source;
}

test("voiced media edges use nearest-cycle completion while the unvoiced gap stays fallback", () => {
  const sourceMarks = [100, 200, 300, 700, 800, 900] as const;
  const source = makeImpulseSource(1_000, sourceMarks);
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks,
    voicedRegions: [
      { startSample: 0, endSample: 400 },
      { startSample: 600, endSample: 1_000 },
    ],
    warpPlan: identityWarp(1_000),
    outputLength: 1_000,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
    blockSize: 64,
  });
  const output = result.channels[0]!;

  assert.equal(output[500], source[500]);
  assert.notEqual(output[0], source[0]);
  assert.notEqual(output[999], source[999]);
  assert.ok((output[150] ?? 0) > 0.4);
  assert.ok((output[750] ?? 0) > 0.4);
  assert.equal(result.diagnostics.renderedRegionCount, 2);
  assert.equal(result.diagnostics.skippedRegionCount, 0);
  assert.ok(result.diagnostics.fallbackSampleCount >= 200);
  assert.equal(result.diagnostics.regions[0]?.leftEdgeCompletion, "nearest_cycle");
  assert.equal(result.diagnostics.regions[1]?.rightEdgeCompletion, "nearest_cycle");
  assert.equal(result.channelDiagnostics[0]?.sourceReadStep, 1);
  assert.equal(result.channelDiagnostics[0]?.grainCount, 16);
});

test("pitch-down nearest-cycle completion covers the physical media end", () => {
  const sourceMarks = [10, 110, 210, 310, 410, 510, 610, 710, 810, 910];
  const source = makeImpulseSource(1_000, sourceMarks);
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks,
    voicedRegions: [{ startSample: 0, endSample: 1_000 }],
    warpPlan: identityWarp(1_000),
    outputLength: 1_000,
    defaultShiftCents: -1_200,
    sampleRate: SAMPLE_RATE,
    blockSize: 64,
  });

  assert.equal(result.diagnostics.fallbackSampleCount, 0);
  assert.equal(result.diagnostics.regions[0]?.leftEdgeCompletion, "nearest_cycle");
  assert.equal(result.diagnostics.regions[0]?.rightEdgeCompletion, "nearest_cycle");
  assert.equal(result.channelDiagnostics[0]?.zeroPaddedSourceReadCount, 0);
  assert.notDeepEqual(result.channels[0]?.slice(0, 64), source.slice(0, 64));
  assert.notEqual(result.channels[0]?.[999], source[999]);
});

test("regions without two accepted marks stay on deterministic fallback", () => {
  const source = makeImpulseSource(300, [100]);
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks: [100],
    voicedRegions: [{ startSample: 0, endSample: 150 }],
    warpPlan: identityWarp(300),
    outputLength: 300,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
    blockSize: 32,
  });

  assert.deepEqual(result.channels[0], source);
  assert.equal(result.diagnostics.renderedRegionCount, 0);
  assert.equal(result.diagnostics.skippedRegionCount, 1);
  assert.equal(result.diagnostics.fallbackSampleCount, 300);
});

test("unvoiced stretch base preserves spectral pitch instead of resampling", () => {
  const sourceLength = 4_800;
  const outputLength = 7_200;
  const source = Float32Array.from(
    { length: sourceLength },
    (_, index) => Math.cos((2 * Math.PI * 240 * index) / SAMPLE_RATE),
  );
  const warpPlan: ClipWarpPlan = {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: outputLength,
      sourceStartSample: 0,
      sourceEndSample: sourceLength,
    }],
  };
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks: [],
    voicedRegions: [],
    warpPlan,
    outputLength,
    sampleRate: SAMPLE_RATE,
    blockSize: 64,
  });
  const output = result.channels[0]!;
  const interior = output.subarray(1_200, output.length - 1_200);
  const outputF0 = estimateDominantFrequencyHz(interior, SAMPLE_RATE);

  const sourceF0 = estimateDominantFrequencyHz(source, SAMPLE_RATE);
  assert.ok(Math.abs(outputF0 - sourceF0) < 12, `output F0: ${outputF0}`);
  assert.equal(result.diagnostics.fallbackSampleCount, outputLength);

  const differentBlockSize = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks: [],
    voicedRegions: [],
    warpPlan,
    outputLength,
    sampleRate: SAMPLE_RATE,
    blockSize: 257,
  });
  assert.deepEqual(differentBlockSize.channels, result.channels);
});

test("unvoiced stretch shares one grain schedule across stereo channels", () => {
  const sourceLength = 3_200;
  const outputLength = 4_800;
  const left = Float32Array.from(
    { length: sourceLength },
    (_, index) =>
      0.6 * Math.sin((2 * Math.PI * 311 * index) / SAMPLE_RATE) +
      0.2 * Math.sin((2 * Math.PI * 1_117 * index) / SAMPLE_RATE),
  );
  const right = Float32Array.from(left, (sample) => sample * -0.375);
  const result = renderSourceNativeRegions({
    sourceChannels: [left, right],
    sourceMarks: [],
    voicedRegions: [],
    warpPlan: {
      kind: "linear",
      segments: [{
        outputStartSample: 0,
        outputEndSample: outputLength,
        sourceStartSample: 0,
        sourceEndSample: sourceLength,
      }],
    },
    outputLength,
    sampleRate: SAMPLE_RATE,
    blockSize: 37,
  });

  let maximumRelationError = 0;
  for (let index = 0; index < outputLength; index++) {
    maximumRelationError = Math.max(
      maximumRelationError,
      Math.abs((result.channels[1]?.[index] ?? 0) +
        (result.channels[0]?.[index] ?? 0) * 0.375),
    );
  }
  assert.ok(maximumRelationError < 1e-6, `stereo relation error: ${maximumRelationError}`);
});

test("unvoiced base keeps pitch across piecewise compression and stretch", () => {
  const sourceLength = 9_600;
  const outputLength = 9_600;
  const source = Float32Array.from(
    { length: sourceLength },
    (_, index) => Math.sin((2 * Math.PI * 240 * index) / SAMPLE_RATE),
  );
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks: [],
    voicedRegions: [],
    warpPlan: {
      kind: "piecewise",
      segments: [
        {
          outputStartSample: 0,
          outputEndSample: 3_200,
          sourceStartSample: 0,
          sourceEndSample: 4_800,
        },
        {
          outputStartSample: 3_200,
          outputEndSample: outputLength,
          sourceStartSample: 4_800,
          sourceEndSample: sourceLength,
        },
      ],
    },
    outputLength,
    sampleRate: SAMPLE_RATE,
    blockSize: 128,
  });
  const expectedF0 = estimateDominantFrequencyHz(source.subarray(1_000, 3_000), SAMPLE_RATE);
  const compressedF0 = estimateDominantFrequencyHz(
    result.channels[0]!.subarray(800, 2_800),
    SAMPLE_RATE,
  );
  const stretchedF0 = estimateDominantFrequencyHz(
    result.channels[0]!.subarray(5_000, 7_000),
    SAMPLE_RATE,
  );

  assert.ok(Math.abs(compressedF0 - expectedF0) < 24, `compressed F0: ${compressedF0}`);
  assert.ok(Math.abs(stretchedF0 - expectedF0) < 24, `stretched F0: ${stretchedF0}`);
});

test("a short voiced region can render one core mark when adjacent guards exist", () => {
  const sourceMarks = [50, 100, 150];
  const source = makeImpulseSource(240, sourceMarks);
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceMarks,
    voicedRegions: [{ startSample: 90, endSample: 120 }],
    warpPlan: identityWarp(240),
    outputLength: 240,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
    blockSize: 32,
  });

  assert.equal(result.diagnostics.renderedRegionCount, 1);
  assert.equal(result.diagnostics.skippedRegionCount, 0);
  assert.equal(result.diagnostics.regions[0]?.sourceMarkCount, 1);
  assert.equal(result.diagnostics.regions[0]?.leftGuardMarkCount, 1);
  assert.equal(result.diagnostics.regions[0]?.rightGuardMarkCount, 1);
});

test("region compositor is block-size invariant", () => {
  const sourceMarks = [100, 200, 300, 400, 500, 600, 700] as const;
  const source = makeImpulseSource(800, sourceMarks);
  const base = {
    sourceChannels: [source],
    sourceMarks,
    voicedRegions: [{ startSample: 0, endSample: 800 }],
    warpPlan: identityWarp(800),
    outputLength: 800,
    defaultShiftCents: 700,
    sampleRate: SAMPLE_RATE,
  } as const;

  const tiny = renderSourceNativeRegions({ ...base, blockSize: 1 });
  const large = renderSourceNativeRegions({ ...base, blockSize: 257 });
  assert.deepEqual(tiny.channels, large.channels);
  assert.deepEqual(tiny.diagnostics, large.diagnostics);
});

test("context guard marks keep physical clip edges on the source-native path", () => {
  const sourceOffsetSamples = 100;
  const clipLength = 1_000;
  const sourceMarks = [-50, 50, 150, 250, 350, 450, 550, 650, 750, 850, 950, 1_050];
  const source = makeImpulseSource(
    1_200,
    sourceMarks.map((mark) => mark + sourceOffsetSamples),
  );
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceOffsetSamples,
    sourceMarks,
    voicedRegions: [{ startSample: 0, endSample: clipLength }],
    warpPlan: identityWarp(clipLength),
    outputLength: clipLength,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
    blockSize: 64,
  });

  assert.equal(result.diagnostics.renderedRegionCount, 1);
  assert.equal(result.diagnostics.fallbackSampleCount, 0);
  assert.equal(result.diagnostics.regions[0]?.leftGuardMarkCount, 1);
  assert.equal(result.diagnostics.regions[0]?.rightGuardMarkCount, 1);
  assert.equal(result.channelDiagnostics[0]?.zeroPaddedSourceReadCount, 0);
  assert.notEqual(result.channels[0]?.[0], source[sourceOffsetSamples]);
  assert.notEqual(
    result.channels[0]?.[clipLength - 1],
    source[sourceOffsetSamples + clipLength - 1],
  );
});

test("stretch keeps edge F0 when source context is available", () => {
  const clipLength = 4_800;
  const outputLength = 7_200;
  const sourceOffsetSamples = 600;
  const periodSamples = 200;
  const source = Float32Array.from(
    { length: 6_000 },
    (_, index) => Math.cos((2 * Math.PI * index) / periodSamples),
  );
  const sourceMarks: number[] = [];
  for (let mark = -400; mark <= 5_200; mark += periodSamples) {
    sourceMarks.push(mark);
  }
  const result = renderSourceNativeRegions({
    sourceChannels: [source],
    sourceOffsetSamples,
    sourceMarks,
    voicedRegions: [{ startSample: 0, endSample: clipLength }],
    warpPlan: {
      kind: "linear",
      segments: [{
        outputStartSample: 0,
        outputEndSample: outputLength,
        sourceStartSample: 0,
        sourceEndSample: clipLength,
      }],
    },
    outputLength,
    sampleRate: SAMPLE_RATE,
    blockSize: 128,
  });
  const output = result.channels[0]!;
  const edgeLength = Math.round(SAMPLE_RATE * 0.05);
  const startF0 = estimateDominantFrequencyHz(
    output.subarray(0, edgeLength),
    SAMPLE_RATE,
  );
  const endF0 = estimateDominantFrequencyHz(
    output.subarray(output.length - edgeLength),
    SAMPLE_RATE,
  );

  assert.ok(Math.abs(startF0 - 240) < 15, `start F0: ${startF0}`);
  assert.ok(Math.abs(endF0 - 240) < 15, `end F0: ${endF0}`);
});
