import type { AudioBufferData, AudioBufferSource } from "./audioBufferData.ts";
import {
  createAudioBufferData,
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "./audioBufferData.ts";
import type { ClipRenderPlan } from "./clipRenderPlan.ts";
import type { F0TrackArtifact, PitchMarksArtifact } from "../types/index.ts";
import type { ClipWarpPlan, PitchSegment } from "./pitchPlan.ts";
import { normalizeWarpPlan, renderWarpedLinear } from "./tdpsolaWarp.ts";

const TWO_PI = Math.PI * 2;
const MIN_FFT_SIZE = 256;
const MAX_FFT_SIZE = 2048;
const HOP_DIVISOR = 4;
const MIN_PHASE_VOCODER_SAMPLES = 192;
const MAX_BLEND_SAMPLES = 256;
const PITCH_EPSILON_CENTS = 0.5;

interface RenderMusicChannelsOptions {
  sourceChannels: Float32Array[];
  targetLength: number;
  warpPlan: ClipWarpPlan;
  pitchSegments?: PitchSegment[];
  totalPitchSemitones: number;
}

interface PositiveSpectrum {
  magnitudes: Float32Array;
  phases: Float32Array;
}

interface CoverageSegment {
  startSample: number;
  endSample: number;
  shiftCents: number;
}

export interface RenderMusicPhaseVocoderOptions {
  inputBuffer: AudioBufferSource;
  sourceInFrame: number;
  sourceOutFrame: number;
  targetDurationSec: number;
  renderPlan: ClipRenderPlan;
  sourceF0Track?: F0TrackArtifact | null;
  sourcePitchMarks?: PitchMarksArtifact | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function principalPhase(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= TWO_PI;
  while (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

function floorPowerOfTwo(value: number): number {
  let power = 1;
  while (power * 2 <= value) {
    power *= 2;
  }
  return power;
}

function resolveFftSize(inputLength: number, targetLength: number): number {
  const available = Math.max(MIN_FFT_SIZE, Math.min(MAX_FFT_SIZE, Math.max(inputLength, targetLength)));
  return clamp(floorPowerOfTwo(available), MIN_FFT_SIZE, MAX_FFT_SIZE);
}

function buildHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / (size - 1));
  }
  return window;
}

function sampleLinear(source: Float32Array, position: number): number {
  if (source.length === 0) return 0;
  if (source.length === 1) return source[0] ?? 0;
  const clamped = clamp(position, 0, source.length - 1);
  const left = Math.floor(clamped);
  const right = Math.min(source.length - 1, left + 1);
  const fraction = clamped - left;
  const leftValue = source[left] ?? 0;
  const rightValue = source[right] ?? leftValue;
  return leftValue + (rightValue - leftValue) * fraction;
}

function resampleLinear(source: Float32Array, targetLength: number): Float32Array {
  const resolvedLength = Math.max(1, Math.round(targetLength));
  const output = new Float32Array(resolvedLength);
  if (source.length === 0) {
    return output;
  }
  if (source.length === 1 || resolvedLength === 1) {
    output.fill(source[0] ?? 0);
    return output;
  }
  const scale = (source.length - 1) / (resolvedLength - 1);
  for (let i = 0; i < resolvedLength; i++) {
    output[i] = sampleLinear(source, i * scale);
  }
  return output;
}

function resampleLinearChannels(channels: Float32Array[], targetLength: number): Float32Array[] {
  return channels.map((channel) => resampleLinear(channel, targetLength));
}

function buildReferenceChannel(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const reference = new Float32Array(length);
  if (channels.length === 0 || length === 0) {
    return reference;
  }

  const inverse = 1 / channels.length;
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
    const channel = channels[channelIndex] ?? new Float32Array(length);
    for (let i = 0; i < length; i++) {
      reference[i] = (reference[i] ?? 0) + (channel[i] ?? 0) * inverse;
    }
  }
  return reference;
}

function extractWindowedFrame(
  source: Float32Array,
  startSample: number,
  window: Float32Array,
): Float32Array {
  const frame = new Float32Array(window.length);
  for (let i = 0; i < window.length; i++) {
    frame[i] = sampleLinear(source, startSample + i) * (window[i] ?? 0);
  }
  return frame;
}

function fftInPlace(real: Float32Array, imag: Float32Array, inverse: boolean): void {
  const size = real.length;
  let j = 0;
  for (let i = 1; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realValue = real[i] ?? 0;
      real[i] = real[j] ?? 0;
      real[j] = realValue;
      const imagValue = imag[i] ?? 0;
      imag[i] = imag[j] ?? 0;
      imag[j] = imagValue;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const halfLength = length >> 1;
    const angleStep = (inverse ? TWO_PI : -TWO_PI) / length;
    for (let offset = 0; offset < size; offset += length) {
      for (let i = 0; i < halfLength; i++) {
        const angle = angleStep * i;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const evenIndex = offset + i;
        const oddIndex = evenIndex + halfLength;
        const oddReal = real[oddIndex] ?? 0;
        const oddImag = imag[oddIndex] ?? 0;
        const twiddleReal = cosine * oddReal - sine * oddImag;
        const twiddleImag = cosine * oddImag + sine * oddReal;
        const evenReal = real[evenIndex] ?? 0;
        const evenImag = imag[evenIndex] ?? 0;
        real[oddIndex] = evenReal - twiddleReal;
        imag[oddIndex] = evenImag - twiddleImag;
        real[evenIndex] = evenReal + twiddleReal;
        imag[evenIndex] = evenImag + twiddleImag;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < size; i++) {
      real[i] = (real[i] ?? 0) / size;
      imag[i] = (imag[i] ?? 0) / size;
    }
  }
}

function analyzePositiveSpectrum(frame: Float32Array): PositiveSpectrum {
  const real = Float32Array.from(frame);
  const imag = new Float32Array(frame.length);
  fftInPlace(real, imag, false);

  const positiveBins = Math.floor(frame.length / 2);
  const magnitudes = new Float32Array(positiveBins + 1);
  const phases = new Float32Array(positiveBins + 1);
  for (let bin = 0; bin <= positiveBins; bin++) {
    const re = real[bin] ?? 0;
    const im = imag[bin] ?? 0;
    magnitudes[bin] = Math.hypot(re, im);
    phases[bin] = Math.atan2(im, re);
  }
  return { magnitudes, phases };
}

function findPeakBins(magnitudes: Float32Array): number[] {
  if (magnitudes.length <= 2) {
    return [0];
  }

  let maximum = 0;
  for (let bin = 1; bin < magnitudes.length - 1; bin++) {
    maximum = Math.max(maximum, magnitudes[bin] ?? 0);
  }
  const threshold = maximum * 0.1;
  const peaks: number[] = [];
  for (let bin = 1; bin < magnitudes.length - 1; bin++) {
    const current = magnitudes[bin] ?? 0;
    if (current < threshold) continue;
    if (current >= (magnitudes[bin - 1] ?? 0) && current > (magnitudes[bin + 1] ?? 0)) {
      peaks.push(bin);
    }
  }

  if (peaks.length === 0) {
    let bestBin = 1;
    let bestMagnitude = magnitudes[1] ?? 0;
    for (let bin = 2; bin < magnitudes.length - 1; bin++) {
      const current = magnitudes[bin] ?? 0;
      if (current > bestMagnitude) {
        bestMagnitude = current;
        bestBin = bin;
      }
    }
    peaks.push(bestBin);
  }

  return peaks;
}

function buildPeakOwners(binCount: number, peaks: number[]): Int32Array {
  const owners = new Int32Array(binCount);
  if (peaks.length === 0) {
    for (let bin = 0; bin < binCount; bin++) {
      owners[bin] = bin;
    }
    return owners;
  }

  let peakIndex = 0;
  for (let bin = 0; bin < binCount; bin++) {
    while (
      peakIndex + 1 < peaks.length &&
      Math.abs((peaks[peakIndex + 1] ?? bin) - bin) <= Math.abs((peaks[peakIndex] ?? bin) - bin)
    ) {
      peakIndex++;
    }
    owners[bin] = peaks[peakIndex] ?? bin;
  }
  return owners;
}

function buildLockedSpectrum(
  magnitudes: Float32Array,
  phases: Float32Array,
  referencePhases: Float32Array,
  referenceLockedPhases: Float32Array,
  peakOwners: Int32Array,
  fftSize: number,
): { real: Float32Array; imag: Float32Array } {
  const halfBins = Math.floor(fftSize / 2);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let bin = 0; bin <= halfBins; bin++) {
    const owner = peakOwners[bin] ?? bin;
    const ownerOffset = principalPhase((phases[owner] ?? 0) - (referencePhases[owner] ?? 0));
    const lockedOwnerPhase = (referenceLockedPhases[owner] ?? 0) + ownerOffset;
    const phase = bin === 0 || bin === halfBins
      ? 0
      : lockedOwnerPhase + principalPhase((phases[bin] ?? 0) - (phases[owner] ?? 0));
    const magnitude = magnitudes[bin] ?? 0;
    real[bin] = magnitude * Math.cos(phase);
    imag[bin] = magnitude * Math.sin(phase);
  }

  for (let bin = 1; bin < halfBins; bin++) {
    real[fftSize - bin] = real[bin] ?? 0;
    imag[fftSize - bin] = -(imag[bin] ?? 0);
  }

  return { real, imag };
}

function overlapAddFrame(
  output: Float32Array,
  weights: Float32Array,
  frame: Float32Array,
  window: Float32Array,
  outputStart: number,
  updateWeights: boolean,
): void {
  for (let i = 0; i < frame.length; i++) {
    const outIndex = outputStart + i;
    if (outIndex < 0 || outIndex >= output.length) continue;
    const weight = window[i] ?? 0;
    output[outIndex] = (output[outIndex] ?? 0) + (frame[i] ?? 0) * weight;
    if (updateWeights) {
      weights[outIndex] = (weights[outIndex] ?? 0) + weight * weight;
    }
  }
}

function phaseVocoderTimeStretchChannels(
  channels: Float32Array[],
  targetLength: number,
): Float32Array[] {
  const resolvedTargetLength = Math.max(1, Math.round(targetLength));
  const inputLength = channels[0]?.length ?? 0;
  if (channels.length === 0) {
    return [];
  }
  if (inputLength <= 1 || resolvedTargetLength <= 1) {
    return resampleLinearChannels(channels, resolvedTargetLength);
  }
  if (
    inputLength < MIN_PHASE_VOCODER_SAMPLES ||
    resolvedTargetLength < MIN_PHASE_VOCODER_SAMPLES
  ) {
    return resampleLinearChannels(channels, resolvedTargetLength);
  }

  const fftSize = resolveFftSize(inputLength, resolvedTargetLength);
  const synthesisHop = Math.max(64, Math.round(fftSize / HOP_DIVISOR));
  const analysisHop = synthesisHop * (inputLength / resolvedTargetLength);
  const window = buildHannWindow(fftSize);
  const outputLength = resolvedTargetLength + fftSize * 2;
  const accumulators = channels.map(() => new Float32Array(outputLength));
  const weights = new Float32Array(outputLength);
  const fallback = resampleLinearChannels(channels, resolvedTargetLength);
  const reference = buildReferenceChannel(channels);

  let previousReferencePhases: Float32Array | null = null;
  let previousLockedPhases: Float32Array | null = null;
  let previousAnalysisStart = 0;
  const frameCount = Math.max(2, Math.ceil((resolvedTargetLength + fftSize) / synthesisHop) + 1);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const outputStart = frameIndex * synthesisHop;
    const analysisStart = frameIndex * analysisHop;
    if (outputStart >= outputLength && analysisStart >= inputLength + fftSize) {
      break;
    }

    const referenceFrame = extractWindowedFrame(reference, analysisStart, window);
    const referenceSpectrum = analyzePositiveSpectrum(referenceFrame);
    const peaks = findPeakBins(referenceSpectrum.magnitudes);
    const peakOwners = buildPeakOwners(referenceSpectrum.magnitudes.length, peaks);
    const lockedReferencePhases = new Float32Array(referenceSpectrum.phases.length);

    if (!previousReferencePhases || !previousLockedPhases) {
      lockedReferencePhases.set(referenceSpectrum.phases);
    } else {
      const usedAnalysisHop = Math.max(1e-6, analysisStart - previousAnalysisStart);
      for (let bin = 0; bin < referenceSpectrum.phases.length; bin++) {
        const owner = peakOwners[bin] ?? bin;
        if (owner !== bin) continue;
        const expectedAdvance = (TWO_PI * owner * usedAnalysisHop) / fftSize;
        const delta = principalPhase(
          (referenceSpectrum.phases[owner] ?? 0) -
            (previousReferencePhases[owner] ?? 0) -
            expectedAdvance,
        );
        const instantaneousFrequency = (TWO_PI * owner) / fftSize + delta / usedAnalysisHop;
        lockedReferencePhases[owner] = (previousLockedPhases[owner] ?? 0) + instantaneousFrequency * synthesisHop;
      }

      for (let bin = 0; bin < referenceSpectrum.phases.length; bin++) {
        const owner = peakOwners[bin] ?? bin;
        lockedReferencePhases[bin] = owner === bin
          ? lockedReferencePhases[owner] ?? 0
          : (lockedReferencePhases[owner] ?? 0) + principalPhase(
              (referenceSpectrum.phases[bin] ?? 0) - (referenceSpectrum.phases[owner] ?? 0),
            );
      }
    }

    previousReferencePhases = referenceSpectrum.phases;
    previousLockedPhases = lockedReferencePhases;
    previousAnalysisStart = analysisStart;

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const channelFrame = extractWindowedFrame(
        channels[channelIndex] ?? new Float32Array(inputLength),
        analysisStart,
        window,
      );
      const channelSpectrum = analyzePositiveSpectrum(channelFrame);
      const lockedSpectrum = buildLockedSpectrum(
        channelSpectrum.magnitudes,
        channelSpectrum.phases,
        referenceSpectrum.phases,
        lockedReferencePhases,
        peakOwners,
        fftSize,
      );
      fftInPlace(lockedSpectrum.real, lockedSpectrum.imag, true);
      overlapAddFrame(
        accumulators[channelIndex] ?? new Float32Array(outputLength),
        weights,
        lockedSpectrum.real,
        window,
        outputStart,
        channelIndex === 0,
      );
    }
  }

  return accumulators.map((accumulator, channelIndex) => {
    const output = new Float32Array(resolvedTargetLength);
    const fallbackChannel = fallback[channelIndex] ?? new Float32Array(resolvedTargetLength);
    for (let i = 0; i < resolvedTargetLength; i++) {
      const weight = weights[i] ?? 0;
      output[i] = weight > 1e-6 ? (accumulator[i] ?? 0) / weight : (fallbackChannel[i] ?? 0);
    }
    return output;
  });
}

function createBoundaryFadeLengths(lengths: number[]): number[] {
  const fades: number[] = [];
  for (let index = 0; index < lengths.length - 1; index++) {
    const left = lengths[index] ?? 0;
    const right = lengths[index + 1] ?? 0;
    fades.push(Math.max(0, Math.min(MAX_BLEND_SAMPLES, Math.floor(Math.min(left, right) / 4))));
  }
  return fades;
}

function fadeInWeight(sampleIndex: number, fadeLength: number): number {
  if (fadeLength <= 0) return 1;
  const ratio = clamp((sampleIndex + 1) / fadeLength, 0, 1);
  return Math.sin((ratio * Math.PI) / 2) ** 2;
}

function fadeOutWeight(samplesFromEnd: number, fadeLength: number): number {
  if (fadeLength <= 0) return 1;
  const ratio = clamp(samplesFromEnd / fadeLength, 0, 1);
  return Math.sin((ratio * Math.PI) / 2) ** 2;
}

function finalizeBlend(
  accumulators: Float32Array[],
  weights: Float32Array,
  fallback: Float32Array[],
  targetLength: number,
): Float32Array[] {
  return accumulators.map((accumulator, channelIndex) => {
    const output = new Float32Array(targetLength);
    const fallbackChannel = fallback[channelIndex] ?? new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const weight = weights[i] ?? 0;
      output[i] = weight > 1e-6 ? (accumulator[i] ?? 0) / weight : (fallbackChannel[i] ?? 0);
    }
    return output;
  });
}

function renderWarpedPhaseVocoderChannels(
  sourceChannels: Float32Array[],
  targetLength: number,
  warpPlan: ClipWarpPlan,
): Float32Array[] {
  const fallback = sourceChannels.map((channel) => renderWarpedLinear(channel, targetLength, warpPlan));
  if (warpPlan.segments.length === 0) {
    return fallback;
  }
  if (warpPlan.segments.length === 1) {
    const segment = warpPlan.segments[0]!;
    const sourceSlice = sourceChannels.map((channel) =>
      channel.subarray(segment.sourceStartSample, segment.sourceEndSample)
    );
    return phaseVocoderTimeStretchChannels(
      sourceSlice.map((slice) => Float32Array.from(slice)),
      targetLength,
    );
  }

  const accumulators = sourceChannels.map(() => new Float32Array(targetLength));
  const weights = new Float32Array(targetLength);
  const outputLengths = warpPlan.segments.map((segment) => segment.outputEndSample - segment.outputStartSample);
  const fades = createBoundaryFadeLengths(outputLengths);
  const sourceLength = sourceChannels[0]?.length ?? 0;

  for (let index = 0; index < warpPlan.segments.length; index++) {
    const segment = warpPlan.segments[index]!;
    const outputStart = segment.outputStartSample;
    const outputEnd = segment.outputEndSample;
    const outputSpan = outputEnd - outputStart;
    const sourceSpan = segment.sourceEndSample - segment.sourceStartSample;
    if (outputSpan <= 0 || sourceSpan <= 0) {
      continue;
    }

    const startFade = index > 0 ? (fades[index - 1] ?? 0) : 0;
    const endFade = index + 1 < warpPlan.segments.length ? (fades[index] ?? 0) : 0;
    const slope = sourceSpan / outputSpan;
    const extendedOutputStart = Math.max(0, outputStart - startFade);
    const extendedOutputEnd = Math.min(targetLength, outputEnd + endFade);
    const extendedOutputLength = extendedOutputEnd - extendedOutputStart;
    if (extendedOutputLength <= 0) {
      continue;
    }

    const extendedSourceStart = clamp(
      Math.round(segment.sourceStartSample - (outputStart - extendedOutputStart) * slope),
      0,
      sourceLength,
    );
    const extendedSourceEnd = clamp(
      Math.round(segment.sourceEndSample + (extendedOutputEnd - outputEnd) * slope),
      extendedSourceStart + 1,
      sourceLength,
    );
    if (extendedSourceEnd <= extendedSourceStart) {
      continue;
    }

    const rendered = phaseVocoderTimeStretchChannels(
      sourceChannels.map((channel) => Float32Array.from(channel.subarray(extendedSourceStart, extendedSourceEnd))),
      extendedOutputLength,
    );
    const leftBlendLength = outputStart - extendedOutputStart;
    const rightBlendLength = extendedOutputEnd - outputEnd;

    for (let sampleIndex = 0; sampleIndex < extendedOutputLength; sampleIndex++) {
      const outIndex = extendedOutputStart + sampleIndex;
      if (outIndex < 0 || outIndex >= targetLength) continue;
      let weight = 1;
      if (sampleIndex < leftBlendLength) {
        weight *= fadeInWeight(sampleIndex, leftBlendLength);
      }
      if (sampleIndex >= extendedOutputLength - rightBlendLength) {
        weight *= fadeOutWeight(extendedOutputLength - sampleIndex, rightBlendLength);
      }
      for (let channelIndex = 0; channelIndex < rendered.length; channelIndex++) {
        const accumulator = accumulators[channelIndex];
        if (!accumulator) continue;
        accumulator[outIndex] = (accumulator[outIndex] ?? 0) +
          (rendered[channelIndex]?.[sampleIndex] ?? 0) * weight;
      }
      weights[outIndex] = (weights[outIndex] ?? 0) + weight;
    }
  }

  return finalizeBlend(accumulators, weights, fallback, targetLength);
}

function buildPitchCoverageSegments(
  targetLength: number,
  pitchSegments: PitchSegment[] | undefined,
  totalPitchSemitones: number,
): CoverageSegment[] {
  if (!pitchSegments || pitchSegments.length === 0) {
    return [{
      startSample: 0,
      endSample: targetLength,
      shiftCents: totalPitchSemitones * 100,
    }];
  }

  if (Math.abs(totalPitchSemitones) >= PITCH_EPSILON_CENTS / 100) {
    return [{
      startSample: 0,
      endSample: targetLength,
      shiftCents: totalPitchSemitones * 100,
    }];
  }

  const boundaries = new Set<number>([0, targetLength]);
  for (const segment of pitchSegments) {
    boundaries.add(clamp(Math.round(segment.startSample), 0, targetLength));
    boundaries.add(clamp(Math.round(segment.endSample), 0, targetLength));
  }

  const sorted = [...boundaries].sort((left, right) => left - right);
  const segments: CoverageSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const startSample = sorted[index] ?? 0;
    const endSample = sorted[index + 1] ?? startSample;
    if (endSample <= startSample) continue;
    const matching = pitchSegments.find(
      (segment) => startSample >= segment.startSample && endSample <= segment.endSample,
    );
    const shiftCents = matching?.shiftCents ?? 0;
    const previous = segments[segments.length - 1];
    if (previous && previous.endSample === startSample && previous.shiftCents === shiftCents) {
      previous.endSample = endSample;
      continue;
    }
    segments.push({ startSample, endSample, shiftCents });
  }
  return segments.length > 0 ? segments : [{ startSample: 0, endSample: targetLength, shiftCents: 0 }];
}

function applyPitchShiftToChannels(
  sourceChannels: Float32Array[],
  shiftCents: number,
): Float32Array[] {
  if (Math.abs(shiftCents) < PITCH_EPSILON_CENTS) {
    return sourceChannels.map((channel) => Float32Array.from(channel));
  }
  const inputLength = sourceChannels[0]?.length ?? 0;
  if (inputLength <= 1) {
    return sourceChannels.map((channel) => Float32Array.from(channel));
  }
  const pitchFactor = Math.pow(2, shiftCents / 1200);
  const resampledLength = Math.max(32, Math.round(inputLength / pitchFactor));
  const resampled = resampleLinearChannels(sourceChannels, resampledLength);
  return phaseVocoderTimeStretchChannels(resampled, inputLength);
}

function applyPitchCoverageToChannels(
  baseChannels: Float32Array[],
  coverageSegments: CoverageSegment[],
): Float32Array[] {
  const targetLength = baseChannels[0]?.length ?? 0;
  if (targetLength === 0 || coverageSegments.length === 0) {
    return baseChannels.map((channel) => Float32Array.from(channel));
  }

  if (
    coverageSegments.length === 1 &&
    Math.abs((coverageSegments[0]?.shiftCents ?? 0)) < PITCH_EPSILON_CENTS
  ) {
    return baseChannels.map((channel) => Float32Array.from(channel));
  }

  const accumulators = baseChannels.map(() => new Float32Array(targetLength));
  const weights = new Float32Array(targetLength);
  const lengths = coverageSegments.map((segment) => segment.endSample - segment.startSample);
  const fades = createBoundaryFadeLengths(lengths);

  for (let index = 0; index < coverageSegments.length; index++) {
    const segment = coverageSegments[index]!;
    const segmentLength = segment.endSample - segment.startSample;
    if (segmentLength <= 0) {
      continue;
    }
    const startFade = index > 0 ? (fades[index - 1] ?? 0) : 0;
    const endFade = index + 1 < coverageSegments.length ? (fades[index] ?? 0) : 0;
    const extendedStart = Math.max(0, segment.startSample - startFade);
    const extendedEnd = Math.min(targetLength, segment.endSample + endFade);
    const extendedLength = extendedEnd - extendedStart;
    if (extendedLength <= 0) {
      continue;
    }

    const shifted = applyPitchShiftToChannels(
      baseChannels.map((channel) => Float32Array.from(channel.subarray(extendedStart, extendedEnd))),
      segment.shiftCents,
    );
    const leftBlendLength = segment.startSample - extendedStart;
    const rightBlendLength = extendedEnd - segment.endSample;

    for (let sampleIndex = 0; sampleIndex < extendedLength; sampleIndex++) {
      const outIndex = extendedStart + sampleIndex;
      if (outIndex < 0 || outIndex >= targetLength) continue;
      let weight = 1;
      if (sampleIndex < leftBlendLength) {
        weight *= fadeInWeight(sampleIndex, leftBlendLength);
      }
      if (sampleIndex >= extendedLength - rightBlendLength) {
        weight *= fadeOutWeight(extendedLength - sampleIndex, rightBlendLength);
      }
      for (let channelIndex = 0; channelIndex < shifted.length; channelIndex++) {
        const accumulator = accumulators[channelIndex];
        if (!accumulator) continue;
        accumulator[outIndex] = (accumulator[outIndex] ?? 0) +
          (shifted[channelIndex]?.[sampleIndex] ?? 0) * weight;
      }
      weights[outIndex] = (weights[outIndex] ?? 0) + weight;
    }
  }

  return finalizeBlend(accumulators, weights, baseChannels, targetLength);
}

function applyFinalSafetyLimiter(channels: Float32Array[]): void {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      peak = Math.max(peak, Math.abs(channel[i] ?? 0));
    }
  }
  if (peak <= 1) return;
  const scale = 0.98 / peak;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      channel[i] = (channel[i] ?? 0) * scale;
    }
  }
}

function renderMusicPhaseVocoderChannels({
  sourceChannels,
  targetLength,
  warpPlan,
  pitchSegments,
  totalPitchSemitones,
}: RenderMusicChannelsOptions): Float32Array[] {
  const coverageSegments = buildPitchCoverageSegments(targetLength, pitchSegments, totalPitchSemitones);
  const hasPitchShift = coverageSegments.some(
    (segment) => Math.abs(segment.shiftCents) >= PITCH_EPSILON_CENTS,
  );
  const baseChannels = renderWarpedPhaseVocoderChannels(sourceChannels, targetLength, warpPlan);
  const rendered = hasPitchShift
    ? applyPitchCoverageToChannels(baseChannels, coverageSegments)
    : baseChannels.map((channel) => Float32Array.from(channel));
  applyFinalSafetyLimiter(rendered);
  return rendered;
}

export function renderMusicPhaseVocoderBufferData(
  options: RenderMusicPhaseVocoderOptions,
): AudioBufferData | null {
  const inputLength = getAudioBufferLength(options.inputBuffer);
  if (inputLength <= 0 || options.targetDurationSec <= 0) {
    return null;
  }

  const sampleRate = getAudioBufferSampleRate(options.inputBuffer);
  const start = clamp(Math.round(options.sourceInFrame), 0, Math.max(0, inputLength - 1));
  const end = clamp(Math.round(options.sourceOutFrame), start + 1, inputLength);
  const sourceLength = end - start;
  if (sourceLength <= 1) {
    return null;
  }

  const targetLength = Math.max(1, Math.round(options.targetDurationSec * sampleRate));
  const sourceChannels = Array.from({ length: getAudioBufferChannelCount(options.inputBuffer) }, (_, channelIndex) =>
    Float32Array.from(getAudioBufferChannelData(options.inputBuffer, channelIndex).subarray(start, end))
  );
  const warpPlan = normalizeWarpPlan(options.renderPlan.warpPlan, sourceLength, targetLength);
  const renderedChannels = renderMusicPhaseVocoderChannels({
    sourceChannels,
    targetLength,
    warpPlan,
    pitchSegments: options.renderPlan.pitchSegments,
    totalPitchSemitones: options.renderPlan.totalPitchSemitones,
  });

  const rendered = createAudioBufferData(sourceChannels.length, targetLength, sampleRate);
  for (let channelIndex = 0; channelIndex < renderedChannels.length; channelIndex++) {
    rendered.channels[channelIndex]?.set(renderedChannels[channelIndex] ?? new Float32Array(targetLength));
  }
  return rendered;
}

export function estimateDominantFrequencyHz(
  signal: Float32Array,
  sampleRate: number,
): number {
  if (signal.length < 32 || sampleRate <= 0) {
    return 0;
  }

  const fftSize = resolveFftSize(signal.length, signal.length);
  const window = buildHannWindow(fftSize);
  const frame = extractWindowedFrame(signal, 0, window);
  const spectrum = analyzePositiveSpectrum(frame);
  let bestBin = 1;
  let bestMagnitude = 0;
  for (let bin = 1; bin < spectrum.magnitudes.length - 1; bin++) {
    const magnitude = spectrum.magnitudes[bin] ?? 0;
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestBin = bin;
    }
  }
  return (bestBin * sampleRate) / fftSize;
}
