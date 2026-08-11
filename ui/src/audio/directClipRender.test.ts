import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyClipTdPsolaOperation,
  renderDirectClipBuffer,
  shouldBypassClipTdPsola,
} from "./directClipRender.ts";
import type { ClipWarpPlan } from "./pitchPlan.ts";

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(channels: Float32Array[], sampleRate: number) {
    this.channels = channels.map((channel) => Float32Array.from(channel));
    this.numberOfChannels = channels.length;
    this.length = channels[0]?.length ?? 0;
    this.sampleRate = sampleRate;
    this.duration = this.length / sampleRate;
  }

  getChannelData(index: number): Float32Array {
    return this.channels[index]!;
  }
}

class FakeAudioContext {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(
      Array.from({ length: numberOfChannels }, () => new Float32Array(length)),
      sampleRate,
    ) as unknown as AudioBuffer;
  }
}

function makeSine(length: number, sampleRate: number, frequency: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

const LINEAR_WARP: ClipWarpPlan = {
  kind: "linear",
  segments: [{
    outputStartSample: 0,
    outputEndSample: 7_460_850,
    sourceStartSample: 0,
    sourceEndSample: 7_460_851,
  }],
};

test("classifyClipTdPsolaOperation separates bypass, stretch-only, pitch-only, and combined", () => {
  const base = {
    sourceInFrame: 0,
    sourceOutFrame: 4_800,
    sampleRate: 48_000,
    targetDurationSec: 4_800 / 48_000,
    totalPitchSemitones: 0,
    microBpm: 120_000_000,
    ppq: 480,
  };

  assert.equal(classifyClipTdPsolaOperation(base), "bypass");
  assert.equal(classifyClipTdPsolaOperation({ ...base, totalPitchSemitones: 3 }), "pitch_only");
  assert.equal(
    classifyClipTdPsolaOperation({
      ...base,
      targetDurationSec: 5_600 / 48_000,
      warpPlan: {
        kind: "piecewise",
        segments: [{
          outputStartSample: 0,
          outputEndSample: 5_600,
          sourceStartSample: 0,
          sourceEndSample: 4_800,
        }],
      },
    }),
    "stretch_only",
  );
  assert.equal(
    classifyClipTdPsolaOperation({
      ...base,
      targetDurationSec: 5_600 / 48_000,
      totalPitchSemitones: 3,
      warpPlan: {
        kind: "piecewise",
        segments: [{
          outputStartSample: 0,
          outputEndSample: 5_600,
          sourceStartSample: 0,
          sourceEndSample: 4_800,
        }],
      },
    }),
    "combined",
  );
});

test("shouldBypassClipTdPsola allows untouched clips within half-tick rounding", () => {
  assert.equal(shouldBypassClipTdPsola({
    sourceInFrame: 0,
    sourceOutFrame: 7_460_851,
    sampleRate: 48_000,
    targetDurationSec: 7_460_850 / 48_000,
    totalPitchSemitones: 0,
    warpPlan: LINEAR_WARP,
    microBpm: 120_000_000,
    ppq: 480,
  }), true);
});

test("shouldBypassClipTdPsola keeps TD-PSOLA for pitch or non-identity warp", () => {
  assert.equal(shouldBypassClipTdPsola({
    sourceInFrame: 0,
    sourceOutFrame: 4_800,
    sampleRate: 48_000,
    targetDurationSec: 4_800 / 48_000,
    totalPitchSemitones: 1,
    microBpm: 120_000_000,
    ppq: 480,
  }), false);

  assert.equal(shouldBypassClipTdPsola({
    sourceInFrame: 0,
    sourceOutFrame: 4_800,
    sampleRate: 48_000,
    targetDurationSec: 5_600 / 48_000,
    totalPitchSemitones: 0,
    warpPlan: {
      kind: "piecewise",
      segments: [{
        outputStartSample: 0,
        outputEndSample: 5_600,
        sourceStartSample: 0,
        sourceEndSample: 4_800,
      }],
    },
    microBpm: 120_000_000,
    ppq: 480,
  }), false);
});

test("classifyClipTdPsolaOperation keeps slight duration drift in the combined path when pitch is active", () => {
  assert.equal(classifyClipTdPsolaOperation({
    sourceInFrame: 0,
    sourceOutFrame: 4_800,
    sampleRate: 48_000,
    targetDurationSec: 4_799 / 48_000,
    totalPitchSemitones: 3,
    microBpm: 120_000_000,
    ppq: 480,
  }), "combined");
});

test("renderDirectClipBuffer preserves stereo samples for rounded untouched clips", () => {
  const sampleRate = 48_000;
  const source = makeSine(4_096, sampleRate, 220);
  const input = new FakeAudioBuffer([source, source], sampleRate);

  const rendered = renderDirectClipBuffer(
    new FakeAudioContext() as unknown as BaseAudioContext,
    input as unknown as AudioBuffer,
    0,
    source.length,
    (source.length - 1) / sampleRate,
  ) as unknown as FakeAudioBuffer;

  assert.ok(rendered);
  assert.equal(rendered.length, source.length - 1);
  assert.deepEqual(
    Array.from(rendered.getChannelData(0)),
    Array.from(source.subarray(0, source.length - 1)),
  );
  assert.deepEqual(
    Array.from(rendered.getChannelData(1)),
    Array.from(source.subarray(0, source.length - 1)),
  );
});
