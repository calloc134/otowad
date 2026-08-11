import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePitchLocaVoiceDsp,
  applyPitchSegmentsToBuffer,
  mapPitchMarksToOutput,
  mapPitchTrackToOutput,
  renderAudioClipTdPsola,
  tdpsolaPitchShift,
  tdpsolaTimeStretch,
} from "./tdpsola.ts";
import type { ClipWarpPlan } from "./pitchPlan.ts";
import type {
  PitchTrack,
  TdPsolaRenderDiagnostics,
  TdPsolaSelectionPolicy,
} from "./tdpsola.ts";
import type { F0TrackArtifact, PitchMarksArtifact } from "../types/index.ts";

function makeSine(
  length: number,
  sampleRate: number,
  frequency: number,
  phase = 0,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }
  return out;
}

function makeVoicedComplex(length: number, sampleRate: number, frequency: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    out[i] =
      0.60 * Math.sin(2 * Math.PI * frequency * t) +
      0.25 * Math.sin(2 * Math.PI * frequency * 2 * t + 0.4) +
      0.12 * Math.sin(2 * Math.PI * frequency * 3 * t + 0.9) +
      0.08 * Math.sin(2 * Math.PI * frequency * 4 * t + 0.2);
  }
  return out;
}

function addNoise(input: Float32Array, amount: number): Float32Array {
  const out = new Float32Array(input.length);
  let seed = 0x12345678;
  for (let i = 0; i < input.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = ((seed / 0xffffffff) * 2 - 1) * amount;
    out[i] = (input[i] ?? 0) + noise;
  }
  return out;
}

function scale(input: Float32Array, gain: number): Float32Array {
  return Float32Array.from(input, (sample) => sample * gain);
}

function rms(buffer: Float32Array): number {
  let sum = 0;
  for (const sample of buffer) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

function normalizedDifference(left: Float32Array, right: Float32Array): number {
  let diff = 0;
  let base = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    diff += delta * delta;
    const sample = right[i] ?? 0;
    base += sample * sample;
  }
  return Math.sqrt(diff / Math.max(1e-9, base));
}

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

  copyToChannel(source: Float32Array, index: number): void {
    this.channels[index]!.set(source);
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

function makeSyntheticF0Artifact(
  mediaId: string,
  sampleRate: number,
  length: number,
  frequencyHz: number,
  hopSrcFrames = 128,
): F0TrackArtifact {
  const frameCount = Math.ceil(length / hopSrcFrames) + 1;
  return {
    kind: "f0_track",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    hop_src_frames: hopSrcFrames,
    f0_hz_x100: Array.from({ length: frameCount }, () => Math.round(frequencyHz * 100)),
    voiced_prob_permille: Array.from({ length: frameCount }, () => 1000),
    method: "synthetic",
    params: "{}",
  };
}

function makeSyntheticPitchMarksArtifact(
  mediaId: string,
  sampleRate: number,
  length: number,
  frequencyHz: number,
): PitchMarksArtifact {
  const marks: number[] = [];
  const period = sampleRate / frequencyHz;
  const roundedPeriod = Math.max(1, Math.round(period));
  for (let mark = Math.round(period / 4); mark < length; mark += roundedPeriod) {
    marks.push(mark);
  }

  return {
    kind: "pitch_marks",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    marks_src_frames: marks,
    mark_policy: "synthetic",
    params: "{}",
  };
}

function makePitchMarksArtifactFromMarks(
  mediaId: string,
  sampleRate: number,
  marks: number[],
): PitchMarksArtifact {
  return {
    kind: "pitch_marks",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    marks_src_frames: [...marks],
    mark_policy: "synthetic",
    params: "{}",
  };
}

function makeGappedF0Artifact(
  mediaId: string,
  sampleRate: number,
  length: number,
  frequencyHz: number,
  voicedRanges: Array<[number, number]>,
  hopSrcFrames = 128,
): F0TrackArtifact {
  const frameCount = Math.ceil(length / hopSrcFrames) + 1;
  const f0_hz_x100 = Array.from({ length: frameCount }, () => -1);
  const voiced_prob_permille = Array.from({ length: frameCount }, () => 0);
  for (let frame = 0; frame < frameCount; frame++) {
    const center = frame * hopSrcFrames + hopSrcFrames * 0.5;
    const voiced = voicedRanges.some(([start, end]) => center >= start && center < end);
    if (!voiced) continue;
    f0_hz_x100[frame] = Math.round(frequencyHz * 100);
    voiced_prob_permille[frame] = 1000;
  }
  return {
    kind: "f0_track",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    hop_src_frames: hopSrcFrames,
    f0_hz_x100,
    voiced_prob_permille,
    method: "synthetic",
    params: "{}",
  };
}

function makeTwoPlateauF0Artifact(
  mediaId: string,
  sampleRate: number,
  length: number,
  firstFrequencyHz: number,
  secondFrequencyHz: number,
  transitionSample: number,
  delayFrames = 0,
  hopSrcFrames = 512,
): F0TrackArtifact {
  const frameCount = Math.ceil(length / hopSrcFrames) + 1;
  const delayedTransition = transitionSample + delayFrames * hopSrcFrames;
  return {
    kind: "f0_track",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    hop_src_frames: hopSrcFrames,
    f0_hz_x100: Array.from({ length: frameCount }, (_, frame) => {
      const center = frame * hopSrcFrames + hopSrcFrames * 0.5;
      const frequencyHz = center < delayedTransition ? firstFrequencyHz : secondFrequencyHz;
      return Math.round(frequencyHz * 100);
    }),
    voiced_prob_permille: Array.from({ length: frameCount }, () => 1000),
    method: "synthetic",
    params: "{}",
  };
}

function inferHopFromTrack(track: PitchTrack, sampleRate: number): number {
  if (track.timestamps.length < 2) {
    return 512;
  }
  return Math.max(1, Math.round(((track.timestamps[1] ?? 0) - (track.timestamps[0] ?? 0)) * sampleRate));
}

function makeF0ArtifactFromPitchTrack(
  mediaId: string,
  sampleRate: number,
  track: PitchTrack,
): F0TrackArtifact {
  const hopSrcFrames = inferHopFromTrack(track, sampleRate);
  return {
    kind: "f0_track",
    schema_version: 1,
    media_id: mediaId,
    src_sample_rate: sampleRate,
    created_by: {
      app_version: "test",
      algo_version: "test",
      params_hash: "test",
    },
    hop_src_frames: hopSrcFrames,
    f0_hz_x100: Array.from(track.pitchTrack, (pitch) => pitch > 0 ? Math.round(pitch * 100) : -1),
    voiced_prob_permille: Array.from(track.voicedProbabilities, (value) => Math.round(value * 1000)),
    method: "synthetic",
    params: "{}",
  };
}

function renderTestClip(options: {
  channels: Float32Array[];
  sampleRate: number;
  targetSamples: number;
  totalPitchSemitones: number;
  pitchSegments?: {
    startSample: number;
    endSample: number;
    shiftCents: number;
  }[];
  warpPlan?: ClipWarpPlan;
  sourceF0Track?: F0TrackArtifact;
  sourcePitchMarks?: PitchMarksArtifact;
  renderOperation?: "bypass" | "stretch_only" | "pitch_only" | "combined";
  preserveFormant?: boolean;
  selectionPolicy?: Partial<TdPsolaSelectionPolicy>;
  diagnosticsOut?: { current?: TdPsolaRenderDiagnostics };
}): FakeAudioBuffer {
  const inputBuffer = new FakeAudioBuffer(options.channels, options.sampleRate);
  const rendered = renderAudioClipTdPsola({
    context: new FakeAudioContext() as unknown as BaseAudioContext,
    inputBuffer: inputBuffer as unknown as AudioBuffer,
    sourceInFrame: 0,
    sourceOutFrame: inputBuffer.length,
    targetDurationSec: options.targetSamples / options.sampleRate,
    totalPitchSemitones: options.totalPitchSemitones,
    ...(options.pitchSegments ? { pitchSegments: options.pitchSegments } : {}),
    ...(options.warpPlan ? { warpPlan: options.warpPlan } : {}),
    ...(options.sourceF0Track ? { sourceF0Track: options.sourceF0Track } : {}),
    ...(options.sourcePitchMarks ? { sourcePitchMarks: options.sourcePitchMarks } : {}),
    ...(options.renderOperation ? { renderOperation: options.renderOperation } : {}),
    ...(options.preserveFormant !== undefined ? { preserveFormant: options.preserveFormant } : {}),
    ...(options.selectionPolicy ? { selectionPolicy: options.selectionPolicy } : {}),
    ...(options.diagnosticsOut
      ? {
          diagnosticsCollector: (diagnostics: TdPsolaRenderDiagnostics) => {
            options.diagnosticsOut!.current = diagnostics;
          },
        }
      : {}),
  });

  assert.ok(rendered);
  return rendered as unknown as FakeAudioBuffer;
}

function renderLegacyTwoStage(options: {
  input: Float32Array;
  sampleRate: number;
  targetSamples: number;
  totalPitchSemitones: number;
  warpPlan?: ClipWarpPlan;
  sourceTrack: PitchTrack;
  sourceMarks?: number[];
  pitchSegments?: {
    startSample: number;
    endSample: number;
    shiftCents: number;
  }[];
}): Float32Array {
  const effectiveWarp: ClipWarpPlan = options.warpPlan ?? {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: options.targetSamples,
      sourceStartSample: 0,
      sourceEndSample: options.input.length,
    }],
  };
  const stretched = tdpsolaTimeStretch(
    options.input,
    options.sampleRate,
    options.sourceTrack,
    undefined,
    options.targetSamples,
    options.sourceMarks,
    effectiveWarp,
  );
  const pitchTrack = mapPitchTrackToOutput(options.sourceTrack, options.sampleRate, effectiveWarp);
  const pitchMarks = mapPitchMarksToOutput(options.sourceMarks, effectiveWarp);
  return options.pitchSegments && options.pitchSegments.length > 0
    ? applyPitchSegmentsToBuffer(
        stretched,
        options.sampleRate,
        undefined,
        options.pitchSegments,
        pitchTrack,
        pitchMarks,
      )
    : tdpsolaPitchShift(
        stretched,
        options.sampleRate,
        pitchTrack,
        undefined,
        options.totalPitchSemitones,
        pitchMarks,
      );
}

test("tdpsolaTimeStretch keeps sine output finite, audible, and exact length", () => {
  const sampleRate = 44_100;
  const input = makeSine(4_096, sampleRate, 220);
  const track = analyzePitchLocaVoiceDsp(input, sampleRate);
  const stretched = tdpsolaTimeStretch(
    input,
    sampleRate,
    track,
    undefined,
    6_144,
  );

  assert.equal(stretched.length, 6_144);
  assert.ok(stretched.every(Number.isFinite));
  assert.ok(rms(stretched) > 0.05);
});

test("tdpsolaPitchShift keeps voiced boundaries continuous under full-render scheduling", () => {
  const sampleRate = 44_100;
  const input = new Float32Array(8_192);
  const voiced = makeSine(2_048, sampleRate, 220);
  input.set(voiced, 6_144);

  const shifted = tdpsolaPitchShift(
    input,
    sampleRate,
    analyzePitchLocaVoiceDsp(input, sampleRate),
    undefined,
    3,
  );

  assert.equal(shifted.length, input.length);
  assert.ok(shifted.every(Number.isFinite));
  assert.ok(Math.abs((shifted[6_144] ?? 0) - (shifted[6_144 - 1] ?? 0)) < 0.05);
  assert.ok(Math.abs((shifted[6_144 + 1] ?? 0) - (shifted[6_144] ?? 0)) < 0.05);
});

test("mapPitchTrackToOutput remaps source-domain timing without stretched-wave reanalysis", () => {
  const sampleRate = 44_100;
  const frequency = 220;
  const syntheticTrack: PitchTrack = {
    pitchTrack: new Float32Array(Array.from({ length: 33 }, () => frequency)),
    voicedProbabilities: new Float32Array(Array.from({ length: 33 }, () => 1)),
    timestamps: Float32Array.from(Array.from({ length: 33 }, (_, index) => (index * 128 + 64) / sampleRate)),
  };

  const mapped = mapPitchTrackToOutput(
    syntheticTrack,
    sampleRate,
    {
      kind: "piecewise",
      segments: [{
        outputStartSample: 0,
        outputEndSample: 8_192,
        sourceStartSample: 0,
        sourceEndSample: 4_096,
      }],
    },
  );

  const analyzedHop = (mapped.timestamps[2] ?? 0) - (mapped.timestamps[1] ?? 0);
  const expectedAnalyzedHop = 256 / sampleRate;
  const incorrectlyScaledHop = 512 / sampleRate;

  assert.ok(Math.abs(analyzedHop - expectedAnalyzedHop) < 1e-6);
  assert.ok(Math.abs(analyzedHop - incorrectlyScaledHop) > 0.002);
});

test("mapPitchMarksToOutput remaps source marks through piecewise warp timing", () => {
  const mapped = mapPitchMarksToOutput(
    [0, 1_024, 2_048, 3_072],
    {
      kind: "piecewise",
      segments: [
        {
          outputStartSample: 0,
          outputEndSample: 2_048,
          sourceStartSample: 0,
          sourceEndSample: 1_024,
        },
        {
          outputStartSample: 2_048,
          outputEndSample: 4_096,
          sourceStartSample: 1_024,
          sourceEndSample: 4_096,
        },
      ],
    },
  );

  assert.deepEqual(mapped, [0, 2_048, 2_731, 3_413]);
});

test("renderAudioClipTdPsola pitch-only skips identity stretch and stays closer to direct pitch synthesis", () => {
  const sampleRate = 44_100;
  const frequency = 220;
  const source = makeSine(4_096, sampleRate, frequency);
  const sourceTrack = analyzePitchLocaVoiceDsp(source, sampleRate);

  const idealPitchOnly = tdpsolaPitchShift(
    source,
    sampleRate,
    sourceTrack,
    undefined,
    3,
  );
  const legacyTwoStage = renderLegacyTwoStage({
    input: source,
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    sourceTrack,
  });
  const rendered = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    renderOperation: "pitch_only",
  }).getChannelData(0);

  assert.ok(rms(rendered) > 0.05);
  assert.ok(
    normalizedDifference(rendered, idealPitchOnly) <= 1e-9,
  );
  assert.ok(
    normalizedDifference(rendered, idealPitchOnly) <
      normalizedDifference(legacyTwoStage, idealPitchOnly),
  );
});

test("renderAudioClipTdPsola uses a shared stereo schedule that keeps near-mono output tighter than legacy per-channel staging", () => {
  const sampleRate = 44_100;
  const frequency = 220;
  const left = makeVoicedComplex(4_096, sampleRate, frequency);
  const right = addNoise(scale(left, 0.99), 0.0025);
  const targetSamples = 6_144;
  const warpPlan: ClipWarpPlan = {
    kind: "piecewise",
    segments: [{
      outputStartSample: 0,
      outputEndSample: targetSamples,
      sourceStartSample: 0,
      sourceEndSample: left.length,
    }],
  };

  const legacyLeft = renderLegacyTwoStage({
    input: left,
    sampleRate,
    targetSamples,
    totalPitchSemitones: 3,
    warpPlan,
    sourceTrack: analyzePitchLocaVoiceDsp(left, sampleRate),
  });
  const legacyRight = renderLegacyTwoStage({
    input: right,
    sampleRate,
    targetSamples,
    totalPitchSemitones: 3,
    warpPlan,
    sourceTrack: analyzePitchLocaVoiceDsp(right, sampleRate),
  });

  const rendered = renderTestClip({
    channels: [left, right],
    sampleRate,
    targetSamples,
    totalPitchSemitones: 3,
    warpPlan,
    renderOperation: "combined",
  });
  const newLeft = rendered.getChannelData(0);
  const newRight = rendered.getChannelData(1);

  assert.ok(rms(newLeft) > 0.03);
  assert.ok(rms(newRight) > 0.03);
  assert.ok(
    normalizedDifference(newLeft, newRight) < normalizedDifference(legacyLeft, legacyRight),
  );
});

test("renderAudioClipTdPsola honors piecewise warp timing in stretch-only mode", () => {
  const sampleRate = 44_100;
  const source = new Float32Array(4_096);
  source.fill(0.25, 0, 2_048);
  source.fill(0.75, 2_048);

  const warped = renderAudioClipTdPsola({
    context: new FakeAudioContext() as unknown as BaseAudioContext,
    inputBuffer: new FakeAudioBuffer([source], sampleRate) as unknown as AudioBuffer,
    sourceInFrame: 0,
    sourceOutFrame: source.length,
    targetDurationSec: source.length / sampleRate,
    totalPitchSemitones: 0,
    renderOperation: "stretch_only",
    warpPlan: {
      kind: "piecewise",
      segments: [
        {
          outputStartSample: 0,
          outputEndSample: 3_072,
          sourceStartSample: 0,
          sourceEndSample: 2_048,
        },
        {
          outputStartSample: 3_072,
          outputEndSample: 4_096,
          sourceStartSample: 2_048,
          sourceEndSample: 4_096,
        },
      ],
    },
  }) as unknown as FakeAudioBuffer;
  const channel = warped.getChannelData(0);

  assert.ok(channel.every(Number.isFinite));
  assert.ok((channel[1_536] ?? 0) < 0.45);
  assert.ok((channel[3_584] ?? 0) > 0.55);
});

test("renderAudioClipTdPsola preserveFormant materially changes large-shift voiced output", () => {
  const sampleRate = 44_100;
  const frequency = 220;
  const source = makeVoicedComplex(8_192, sampleRate, frequency);
  const f0 = makeSyntheticF0Artifact("m6", sampleRate, source.length, frequency);
  const marks = makeSyntheticPitchMarksArtifact("m6", sampleRate, source.length, frequency);

  const plain = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 7,
    sourceF0Track: f0,
    sourcePitchMarks: marks,
    renderOperation: "pitch_only",
    preserveFormant: false,
  }).getChannelData(0);
  const preserved = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 7,
    sourceF0Track: f0,
    sourcePitchMarks: marks,
    renderOperation: "pitch_only",
    preserveFormant: true,
  }).getChannelData(0);

  assert.ok(rms(plain) > 0.03);
  assert.ok(rms(preserved) > 0.03);
  assert.ok(normalizedDifference(plain, preserved) > 0.03);
});

test("renderAudioClipTdPsola pitch-only regenerates source marks across repaired voiced gaps", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(2_048, sampleRate, 220);
  const second = makeVoicedComplex(2_048, sampleRate, 220);
  const gap = new Float32Array(1_024);
  const source = new Float32Array(first.length + gap.length + second.length);
  source.set(first, 0);
  source.set(second, first.length + gap.length);

  const voicedRanges: Array<[number, number]> = [
    [0, first.length],
    [first.length + gap.length, source.length],
  ];
  const f0 = makeGappedF0Artifact("gap-pitch", sampleRate, source.length, 220, voicedRanges);
  const validMarks = makeSyntheticPitchMarksArtifact("gap-pitch", sampleRate, source.length, 220);
  const invalidMarks = makePitchMarksArtifactFromMarks(
    "gap-pitch",
    sampleRate,
    validMarks.marks_src_frames.filter((mark) => mark < first.length),
  );

  const regenerated = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 4,
    sourceF0Track: f0,
    renderOperation: "pitch_only",
  }).getChannelData(0);
  const renderedFromInvalidMarks = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 4,
    sourceF0Track: f0,
    sourcePitchMarks: invalidMarks,
    renderOperation: "pitch_only",
  }).getChannelData(0);

  assert.ok(
    normalizedDifference(renderedFromInvalidMarks, regenerated) < 0.02,
  );
  const secondRegionStart = first.length + gap.length + 256;
  const secondRegionEnd = Math.min(source.length, secondRegionStart + 1_024);
  assert.ok(
    normalizedDifference(
      renderedFromInvalidMarks.subarray(secondRegionStart, secondRegionEnd),
      source.subarray(secondRegionStart, secondRegionEnd),
    ) > 0.1,
  );
});

test("renderAudioClipTdPsola stretch-only rejects stale first-island marks and matches regenerated schedule", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(2_048, sampleRate, 220);
  const second = makeVoicedComplex(2_048, sampleRate, 220);
  const gap = new Float32Array(1_024);
  const source = new Float32Array(first.length + gap.length + second.length);
  source.set(first, 0);
  source.set(second, first.length + gap.length);

  const voicedRanges: Array<[number, number]> = [
    [0, first.length],
    [first.length + gap.length, source.length],
  ];
  const f0 = makeGappedF0Artifact("gap-stretch", sampleRate, source.length, 220, voicedRanges);
  const validMarks = makeSyntheticPitchMarksArtifact("gap-stretch", sampleRate, source.length, 220);
  const invalidMarks = makePitchMarksArtifactFromMarks(
    "gap-stretch",
    sampleRate,
    validMarks.marks_src_frames.filter((mark) => mark < first.length),
  );
  const targetSamples = Math.round(source.length * 1.25);

  const regenerated = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples,
    totalPitchSemitones: 0,
    sourceF0Track: f0,
    renderOperation: "stretch_only",
  }).getChannelData(0);
  const renderedFromInvalidMarks = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples,
    totalPitchSemitones: 0,
    sourceF0Track: f0,
    sourcePitchMarks: invalidMarks,
    renderOperation: "stretch_only",
  }).getChannelData(0);

  assert.equal(renderedFromInvalidMarks.length, targetSamples);
  assert.ok(renderedFromInvalidMarks.every(Number.isFinite));
  assert.ok(normalizedDifference(renderedFromInvalidMarks, regenerated) < 0.025);
});

test("renderAudioClipTdPsola combined rejects stale first-island marks and matches regenerated schedule", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(2_048, sampleRate, 220);
  const second = makeVoicedComplex(2_048, sampleRate, 220);
  const gap = new Float32Array(1_024);
  const source = new Float32Array(first.length + gap.length + second.length);
  source.set(first, 0);
  source.set(second, first.length + gap.length);

  const voicedRanges: Array<[number, number]> = [
    [0, first.length],
    [first.length + gap.length, source.length],
  ];
  const f0 = makeGappedF0Artifact("gap-combined", sampleRate, source.length, 220, voicedRanges);
  const validMarks = makeSyntheticPitchMarksArtifact("gap-combined", sampleRate, source.length, 220);
  const invalidMarks = makePitchMarksArtifactFromMarks(
    "gap-combined",
    sampleRate,
    validMarks.marks_src_frames.filter((mark) => mark < first.length),
  );
  const targetSamples = Math.round(source.length * 1.25);

  const regenerated = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples,
    totalPitchSemitones: 4,
    sourceF0Track: f0,
    renderOperation: "combined",
  }).getChannelData(0);
  const renderedFromInvalidMarks = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples,
    totalPitchSemitones: 4,
    sourceF0Track: f0,
    sourcePitchMarks: invalidMarks,
    renderOperation: "combined",
  }).getChannelData(0);

  assert.equal(renderedFromInvalidMarks.length, targetSamples);
  assert.ok(renderedFromInvalidMarks.every(Number.isFinite));
  assert.ok(normalizedDifference(renderedFromInvalidMarks, regenerated) < 0.03);
});

test("renderAudioClipTdPsola prefers conservative local analysis over over-voiced provided F0", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(2_048, sampleRate, 220);
  const second = makeVoicedComplex(2_048, sampleRate, 220);
  const gap = new Float32Array(1_024);
  const source = new Float32Array(first.length + gap.length + second.length);
  source.set(first, 0);
  source.set(second, first.length + gap.length);

  const overVoicedF0 = makeSyntheticF0Artifact("over-voiced", sampleRate, source.length, 220);
  const diagnosticsOut: { current?: TdPsolaRenderDiagnostics } = {};

  const rendered = renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    sourceF0Track: overVoicedF0,
    renderOperation: "pitch_only",
    diagnosticsOut,
  }).getChannelData(0);

  assert.ok(rms(rendered) > 0.03);
  assert.equal(diagnosticsOut.current?.analysisSource, "local");
  assert.equal(diagnosticsOut.current?.reusedProvidedMarks, false);
  assert.equal(
    diagnosticsOut.current?.initialCoverage.voicedInteriorFallbackSamples,
    0,
  );
  assert.ok((diagnosticsOut.current?.voicedRegionCount ?? 0) <= 2);
});

test("renderAudioClipTdPsola keeps local when provided cannot show a clear win", () => {
  const sampleRate = 44_100;
  const source = makeVoicedComplex(4_096, sampleRate, 220);
  const localTrack = analyzePitchLocaVoiceDsp(source, sampleRate);
  const providedF0 = makeF0ArtifactFromPitchTrack("tie-break-local", sampleRate, localTrack);
  const diagnosticsOut: { current?: TdPsolaRenderDiagnostics } = {};

  renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    sourceF0Track: providedF0,
    renderOperation: "pitch_only",
    diagnosticsOut,
  }).getChannelData(0);

  assert.equal(diagnosticsOut.current?.selectionPolicy.tieBreakPreference, "local");
  assert.equal(diagnosticsOut.current?.analysisSource, "local");
  assert.ok(
    diagnosticsOut.current?.selectionDecision.criterion === "analysis_source_tiebreak" ||
      diagnosticsOut.current?.selectionDecision.criterion === "voiced_coverage_conservative" ||
      diagnosticsOut.current?.selectionDecision.criterion === "provided_divergence_reject",
  );
  assert.ok((diagnosticsOut.current?.candidateComparison?.voicedFrameJaccard ?? 0) >= 0.8);
});

test("renderAudioClipTdPsola does not adopt over-voiced provided F0 under default guards", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(4_096, sampleRate, 220);
  const second = makeVoicedComplex(4_096, sampleRate, 220);
  const gap = new Float32Array(8_192);
  const source = new Float32Array(first.length + gap.length + second.length);
  source.set(first, 0);
  source.set(second, first.length + gap.length);
  const providedF0 = makeSyntheticF0Artifact(
    "coverage-hard-reject",
    sampleRate,
    source.length,
    220,
    512,
  );
  const diagnosticsOut: { current?: TdPsolaRenderDiagnostics } = {};

  renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    sourceF0Track: providedF0,
    renderOperation: "pitch_only",
    diagnosticsOut,
  }).getChannelData(0);

  assert.equal(diagnosticsOut.current?.analysisSource, "local");
  assert.equal(diagnosticsOut.current?.selectionPolicy.hardRejectProvidedCoverageInflationRatio, 1.1);
  assert.equal(diagnosticsOut.current?.selectionDecision.criterion, "provided_coverage_hard_reject");
  assert.ok((diagnosticsOut.current?.candidateComparison?.providedEpochCount ?? 0) > 0);
  assert.ok((diagnosticsOut.current?.candidateComparison?.localEpochCount ?? 0) > 0);
});

test("renderAudioClipTdPsola rejects provided contour mismatch after local-grid rebasing", () => {
  const sampleRate = 44_100;
  const first = makeVoicedComplex(8_192, sampleRate, 220);
  const second = makeVoicedComplex(8_192, sampleRate, 330);
  const source = new Float32Array(first.length + second.length);
  source.set(first, 0);
  source.set(second, first.length);
  const providedF0 = makeTwoPlateauF0Artifact(
    "time-base-mismatch",
    sampleRate,
    source.length,
    220,
    330,
    first.length,
    1,
  );
  const diagnosticsOut: { current?: TdPsolaRenderDiagnostics } = {};

  renderTestClip({
    channels: [source],
    sampleRate,
    targetSamples: source.length,
    totalPitchSemitones: 3,
    sourceF0Track: providedF0,
    renderOperation: "pitch_only",
    diagnosticsOut,
  }).getChannelData(0);

  assert.equal(diagnosticsOut.current?.analysisSource, "local");
  assert.equal(diagnosticsOut.current?.selectionDecision.criterion, "provided_divergence_reject");
  assert.ok((diagnosticsOut.current?.candidateComparison?.p95F0CentsError ?? 0) > 250);
  assert.ok((diagnosticsOut.current?.candidateComparison?.f0Correlation ?? 1) < 0.95);
  assert.equal(diagnosticsOut.current?.candidateComparison?.timestampMaxAbsDeltaSec, 0);
});
