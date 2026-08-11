import assert from "node:assert/strict";
import test from "node:test";

import { createAudioBufferData } from "./audioBufferData.ts";
import {
  estimateDominantFrequencyHz,
  renderMusicPhaseVocoderBufferData,
} from "./musicPhaseVocoder.ts";
import type { ClipRenderPlan } from "./clipRenderPlan.ts";

function makeSine(length: number, sampleRate: number, frequency: number, phase = 0): Float32Array {
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    output[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }
  return output;
}

function createPlan(overrides?: Partial<ClipRenderPlan>): ClipRenderPlan {
  return {
    totalPitchSemitones: 0,
    preserveFormant: false,
    renderOperation: "combined",
    useDirectRender: false,
    timePitchMode: "Music",
    tdPsolaCore: "legacy_v1",
    tdPsolaAnalysisPolicy: "not_applicable",
    backend: "music_phase_vocoder",
    backendVersion: "music-phase-vocoder-v1",
    ...overrides,
  };
}

function normalizedDifference(left: Float32Array, right: Float32Array): number {
  let diff = 0;
  let base = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    diff += delta * delta;
    base += (right[i] ?? 0) * (right[i] ?? 0);
  }
  return Math.sqrt(diff / Math.max(1e-9, base));
}

test("music phase vocoder renders deterministic output with explicit backend identity", () => {
  const input = createAudioBufferData(1, 48_000, 48_000);
  input.channels[0]?.set(makeSine(48_000, 48_000, 220));

  const first = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    targetDurationSec: 1,
    renderPlan: createPlan({ totalPitchSemitones: 3 }),
  });
  const second = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: 48_000,
    targetDurationSec: 1,
    renderPlan: createPlan({ totalPitchSemitones: 3 }),
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first?.sampleRate, 48_000);
  assert.equal(first?.length, 48_000);
  assert.deepEqual(Array.from(first?.channels[0] ?? []), Array.from(second?.channels[0] ?? []));
});

test("music phase vocoder stretches duration without falling back to source length", () => {
  const input = createAudioBufferData(1, 24_000, 48_000);
  input.channels[0]?.set(makeSine(24_000, 48_000, 220));

  const output = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: 24_000,
    targetDurationSec: 1,
    renderPlan: createPlan({ renderOperation: "stretch_only" }),
  });

  assert.ok(output);
  assert.equal(output?.length, 48_000);
  assert.ok((output?.channels[0]?.some((sample) => Math.abs(sample) > 1e-4) ?? false));
});

test("music phase vocoder pitch shift raises dominant frequency for monophonic material", () => {
  const sampleRate = 48_000;
  const input = createAudioBufferData(1, sampleRate, sampleRate);
  input.channels[0]?.set(makeSine(sampleRate, sampleRate, 220));

  const output = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: sampleRate,
    targetDurationSec: 1,
    renderPlan: createPlan({ totalPitchSemitones: 12, renderOperation: "pitch_only" }),
  });

  assert.ok(output);
  const sourceHz = estimateDominantFrequencyHz(input.channels[0] ?? new Float32Array(), sampleRate);
  const renderedHz = estimateDominantFrequencyHz(output?.channels[0] ?? new Float32Array(), sampleRate);
  assert.ok(sourceHz > 200 && sourceHz < 240);
  assert.ok(renderedHz > 400 && renderedHz < 500);
});

test("music phase vocoder preserves stereo phase relation by sharing locked peaks", () => {
  const sampleRate = 48_000;
  const input = createAudioBufferData(2, sampleRate, sampleRate);
  input.channels[0]?.set(makeSine(sampleRate, sampleRate, 330, 0));
  input.channels[1]?.set(makeSine(sampleRate, sampleRate, 330, Math.PI / 3));

  const output = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: sampleRate,
    targetDurationSec: 1,
    renderPlan: createPlan({ totalPitchSemitones: 7, renderOperation: "pitch_only" }),
  });

  assert.ok(output);
  const diff = normalizedDifference(
    output?.channels[0] ?? new Float32Array(),
    output?.channels[1] ?? new Float32Array(),
  );
  assert.ok(diff > 0.1);
  assert.ok(diff < 1.6);
});

test("music phase vocoder respects pitch segments across the rendered clip", () => {
  const sampleRate = 48_000;
  const input = createAudioBufferData(1, sampleRate, sampleRate);
  input.channels[0]?.set(makeSine(sampleRate, sampleRate, 220));

  const output = renderMusicPhaseVocoderBufferData({
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: sampleRate,
    targetDurationSec: 1,
    renderPlan: createPlan({
      totalPitchSemitones: 0,
      pitchSegments: [
        { startSample: 0, endSample: 24_000, shiftCents: 0 },
        { startSample: 24_000, endSample: 48_000, shiftCents: 1200 },
      ],
    }),
  });

  assert.ok(output);
  const firstHalf = output?.channels[0]?.subarray(0, 24_000) ?? new Float32Array();
  const secondHalf = output?.channels[0]?.subarray(24_000, 48_000) ?? new Float32Array();
  const firstHz = estimateDominantFrequencyHz(firstHalf, sampleRate);
  const secondHz = estimateDominantFrequencyHz(secondHalf, sampleRate);
  assert.ok(firstHz > 180 && firstHz < 260);
  assert.ok(secondHz > 380 && secondHz < 500);
});
