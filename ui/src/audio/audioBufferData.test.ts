import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneAudioBufferSource,
  createAudioBufferData,
  mixAudioBufferIntoTarget,
  resampleAudioBufferData,
} from "./audioBufferData.ts";

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
    return this.channels[index] ?? new Float32Array(this.length);
  }
}

test("cloneAudioBufferSource copies channel data into serializable arrays", () => {
  const source = new FakeAudioBuffer([
    new Float32Array([0.1, 0.2, 0.3]),
    new Float32Array([0.4, 0.5, 0.6]),
  ], 48_000);

  const cloned = cloneAudioBufferSource(source);
  const round = (value: number) => Number(value.toFixed(4));

  assert.equal(cloned.numberOfChannels, 2);
  assert.equal(cloned.sampleRate, 48_000);
  assert.deepEqual(Array.from(cloned.channels[0] ?? []).map(round), [0.1, 0.2, 0.3]);
  assert.deepEqual(Array.from(cloned.channels[1] ?? []).map(round), [0.4, 0.5, 0.6]);
});

test("mixAudioBufferIntoTarget duplicates mono sources across stereo outputs", () => {
  const target = createAudioBufferData(2, 4, 4);
  const source = new FakeAudioBuffer([new Float32Array([0.25, 0.5, 0.75, 1])], 4);

  mixAudioBufferIntoTarget({
    source,
    target,
    targetStartSample: 0,
    gain: 1,
  });

  assert.deepEqual(Array.from(target.channels[0] ?? []), [0.25, 0.5, 0.75, 1]);
  assert.deepEqual(Array.from(target.channels[1] ?? []), [0.25, 0.5, 0.75, 1]);
});

test("mixAudioBufferIntoTarget resamples source buffers onto the target sample rate", () => {
  const target = createAudioBufferData(1, 8, 8);
  const source = new FakeAudioBuffer([new Float32Array([0, 1, 0, 1])], 4);

  mixAudioBufferIntoTarget({
    source,
    target,
    targetStartSample: 0,
    gain: 1,
  });

  assert.deepEqual(
    Array.from(target.channels[0] ?? []).map((sample) => Number(sample.toFixed(4))),
    [0, 0.5, 1, 0.5, 0, 0.5, 1, 0],
  );
});

test("mixAudioBufferIntoTarget applies the mono StereoPanner matrix", () => {
  const target = createAudioBufferData(2, 2, 2);
  const source = new FakeAudioBuffer([new Float32Array([1, 1])], 2);

  mixAudioBufferIntoTarget({
    source,
    target,
    targetStartSample: 0,
    gain: 1,
    stereoPan: 0,
  });

  assert.deepEqual(
    Array.from(target.channels[0] ?? []).map((value) => Number(value.toFixed(4))),
    [0.7071, 0.7071],
  );
  assert.deepEqual(
    Array.from(target.channels[1] ?? []).map((value) => Number(value.toFixed(4))),
    [0.7071, 0.7071],
  );
});

test("mixAudioBufferIntoTarget preserves stereo input at center pan", () => {
  const target = createAudioBufferData(2, 2, 2);
  const source = new FakeAudioBuffer([
    new Float32Array([1, 0.5]),
    new Float32Array([0.25, 0.75]),
  ], 2);

  mixAudioBufferIntoTarget({
    source,
    target,
    targetStartSample: 0,
    stereoPan: 0,
  });

  assert.deepEqual(Array.from(target.channels[0] ?? []), [1, 0.5]);
  assert.deepEqual(Array.from(target.channels[1] ?? []), [0.25, 0.75]);
});

test("resampleAudioBufferData materializes the shared linear sample-rate conversion", () => {
  const source = new FakeAudioBuffer([new Float32Array([0, 1, 0, 1])], 4);

  const resampled = resampleAudioBufferData(source, 8);

  assert.equal(resampled.sampleRate, 8);
  assert.equal(resampled.length, 8);
  assert.deepEqual(
    Array.from(resampled.channels[0] ?? []).map((sample) => Number(sample.toFixed(4))),
    [0, 0.5, 1, 0.5, 0, 0.5, 1, 0],
  );
});
