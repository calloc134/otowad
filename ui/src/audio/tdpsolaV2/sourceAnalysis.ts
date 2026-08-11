import type { AudioBufferSource } from "../audioBufferData.ts";
import {
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
} from "../audioBufferData.ts";
import type { F0TrackArtifact } from "../../types/index.ts";
import type { ClipTdPsolaOperation } from "../directClipRender.ts";
import type { ClipWarpPlan, PitchSegment } from "../pitchPlan.ts";

export interface LocaVoiceDspConfig {
  minF0: number;
  maxF0: number;
  frameSize: number;
  hopSize: number;
  voicedThreshold: number;
  minRms: number;
}

export interface PitchTrack {
  pitchTrack: Float32Array;
  voicedProbabilities: Float32Array;
  timestamps: Float32Array;
}

export interface VoicedRegion {
  startSample: number;
  endSample: number;
  frameStart: number;
  frameEnd: number;
}

export interface PreparedSourcePlan {
  repairedTrack: PitchTrack;
  sourceMarks: number[] | undefined;
  voicedRegions: VoicedRegion[];
  reusedProvidedMarks: boolean;
  voicedThreshold: number;
}

interface PitchTrackGridComparison {
  sharedVoicedFrames: number;
  voicedFrameJaccard: number;
  voicedFrameDisagreement: number;
  medianF0CentsError: number;
  p95F0CentsError: number;
  f0Correlation: number;
}

const DEFAULT_CONFIG: LocaVoiceDspConfig = {
  minF0: 60,
  maxF0: 500,
  frameSize: 2048,
  hopSize: 512,
  voicedThreshold: 0.6,
  minRms: 0.005,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveConfig(
  config?: Partial<LocaVoiceDspConfig>,
): LocaVoiceDspConfig {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return {
    minF0: Math.max(20, merged.minF0),
    maxF0: Math.max(merged.minF0 + 1, merged.maxF0),
    frameSize: Math.max(64, Math.round(merged.frameSize)),
    hopSize: Math.max(16, Math.round(merged.hopSize)),
    voicedThreshold: clamp(merged.voicedThreshold, 0, 1),
    minRms: Math.max(0, merged.minRms),
  };
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

export function summarizeSourceMarkIntervals(
  marks: readonly number[] | undefined,
  voicedRegions: readonly VoicedRegion[],
): {
  minimumSamples: number;
  medianSamples: number;
  p95Samples: number;
  maximumSamples: number;
  maximumToMedianRatio: number;
  maximumIntervalStartSample: number;
  maximumIntervalEndSample: number;
} {
  if (!marks || marks.length < 2) {
    return emptySourceMarkIntervalSummary();
  }
  const intervals: Array<{ length: number; start: number; end: number }> = [];
  for (const region of voicedRegions) {
    const regionMarks = marks.filter(
      (mark) => mark >= region.startSample && mark < region.endSample,
    );
    for (let index = 1; index < regionMarks.length; index++) {
      intervals.push({
        length: regionMarks[index]! - regionMarks[index - 1]!,
        start: regionMarks[index - 1]!,
        end: regionMarks[index]!,
      });
    }
  }
  if (intervals.length === 0) {
    return emptySourceMarkIntervalSummary();
  }
  const intervalLengths = intervals.map((interval) => interval.length);
  const maximumInterval = intervals.reduce(
    (maximum, interval) => interval.length > maximum.length ? interval : maximum,
    intervals[0]!,
  );
  const medianSamples = percentile(intervalLengths, 0.5);
  const maximumSamples = maximumInterval.length;
  return {
    minimumSamples: Math.min(...intervalLengths),
    medianSamples,
    p95Samples: percentile(intervalLengths, 0.95),
    maximumSamples,
    maximumToMedianRatio: medianSamples > 0 ? maximumSamples / medianSamples : 0,
    maximumIntervalStartSample: maximumInterval.start,
    maximumIntervalEndSample: maximumInterval.end,
  };
}

function emptySourceMarkIntervalSummary() {
  return {
    minimumSamples: 0,
    medianSamples: 0,
    p95Samples: 0,
    maximumSamples: 0,
    maximumToMedianRatio: 0,
    maximumIntervalStartSample: 0,
    maximumIntervalEndSample: 0,
  };
}

export function summarizePreparedSourcePitch(
  preparedSource: PreparedSourcePlan,
): { minimum: number; median: number; p95: number; maximum: number } {
  const voicedPitch = Array.from(preparedSource.repairedTrack.pitchTrack).filter(
    (pitch, index) => pitch > 0 &&
      (preparedSource.repairedTrack.voicedProbabilities[index] ?? 0) >=
        preparedSource.voicedThreshold,
  );
  if (voicedPitch.length === 0) {
    return { minimum: 0, median: 0, p95: 0, maximum: 0 };
  }
  return {
    minimum: Math.min(...voicedPitch),
    median: percentile(voicedPitch, 0.5),
    p95: percentile(voicedPitch, 0.95),
    maximum: Math.max(...voicedPitch),
  };
}

function correlationOf(pairs: Array<{ x: number; y: number }>): number {
  if (pairs.length < 2) return 0;
  const meanX = meanOf(pairs.map((pair) => pair.x));
  const meanY = meanOf(pairs.map((pair) => pair.y));
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (const pair of pairs) {
    const dx = pair.x - meanX;
    const dy = pair.y - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denominator = Math.sqrt(denomX * denomY);
  return denominator > 1e-9 ? numerator / denominator : 0;
}

function hzToCentsRatio(referenceHz: number, otherHz: number): number {
  if (referenceHz <= 0 || otherHz <= 0) return 0;
  return Math.abs(1200 * Math.log2(otherHz / referenceHz));
}

function floorPowerOfTwo(value: number): number {
  let power = 1;
  while (power * 2 <= value) power *= 2;
  return power;
}

export function fitConfigToTargetLength(
  config: LocaVoiceDspConfig,
  targetSamples: number,
): LocaVoiceDspConfig {
  if (targetSamples >= config.frameSize) return config;
  const fittedFrameSize = Math.max(
    64,
    Math.min(config.frameSize, floorPowerOfTwo(Math.max(64, targetSamples))),
  );
  const fittedHopSize = Math.max(
    16,
    Math.min(config.hopSize, Math.max(16, Math.floor(fittedFrameSize / 4))),
  );
  return resolveConfig({
    ...config,
    frameSize: fittedFrameSize,
    hopSize: fittedHopSize,
  });
}

export function extractMonoSegment(
  inputBuffer: AudioBufferSource,
  startFrame: number,
  endFrame: number,
): Float32Array {
  const length = Math.max(0, endFrame - startFrame);
  const mono = new Float32Array(length);
  if (length === 0) return mono;
  const channels = getAudioBufferChannelCount(inputBuffer);
  for (let channel = 0; channel < channels; channel++) {
    const data = getAudioBufferChannelData(inputBuffer, channel);
    for (let index = 0; index < length; index++) {
      mono[index] = (mono[index] ?? 0) + (data[startFrame + index] ?? 0);
    }
  }
  const inverseChannelCount = 1 / Math.max(1, channels);
  for (let index = 0; index < mono.length; index++) {
    mono[index] = (mono[index] ?? 0) * inverseChannelCount;
  }
  return mono;
}

export function pitchTrackFromF0Artifact(
  f0Track: F0TrackArtifact,
  sourceInFrame: number,
  sourceOutFrame: number,
): PitchTrack {
  const hop = Math.max(1, f0Track.hop_src_frames);
  const paddedStart = Math.max(0, sourceInFrame - hop);
  const paddedEnd = sourceOutFrame + hop;
  const pitch: number[] = [];
  const voiced: number[] = [];
  const timestamps: number[] = [];
  for (let index = 0; index < f0Track.f0_hz_x100.length; index++) {
    const center = index * hop + hop * 0.5;
    if (center < paddedStart || center > paddedEnd) continue;
    const raw = f0Track.f0_hz_x100[index] ?? -1;
    pitch.push(raw > 0 ? raw / 100 : 0);
    voiced.push(
      f0Track.voiced_prob_permille?.[index] !== undefined
        ? (f0Track.voiced_prob_permille[index] ?? 0) / 1000
        : raw > 0 ? 1 : 0,
    );
    timestamps.push((center - sourceInFrame) / f0Track.src_sample_rate);
  }
  return {
    pitchTrack: Float32Array.from(pitch),
    voicedProbabilities: Float32Array.from(voiced),
    timestamps: Float32Array.from(timestamps),
  };
}

function inferTrackHopSamples(track: PitchTrack, sampleRate: number): number {
  if (track.timestamps.length < 2) return 1;
  let minDelta = Number.POSITIVE_INFINITY;
  for (let index = 1; index < track.timestamps.length; index++) {
    const delta = (track.timestamps[index] ?? 0) - (track.timestamps[index - 1] ?? 0);
    if (delta > 0 && delta < minDelta) minDelta = delta;
  }
  return Number.isFinite(minDelta) ? Math.max(1, Math.round(minDelta * sampleRate)) : 1;
}

function inferTrackHopSeconds(track: PitchTrack, sampleRate: number): number {
  return inferTrackHopSamples(track, sampleRate) / sampleRate;
}

function interpolateTrackArray(
  values: Float32Array,
  timestamps: Float32Array,
  positionSec: number,
): number {
  const length = Math.min(values.length, timestamps.length);
  if (length === 0) return 0;
  if (length === 1) return values[0] ?? 0;
  if (positionSec <= (timestamps[0] ?? 0)) return values[0] ?? 0;
  if (positionSec >= (timestamps[length - 1] ?? 0)) return values[length - 1] ?? 0;
  let index = 1;
  while (index < length && (timestamps[index] ?? 0) < positionSec) index++;
  const leftIndex = Math.max(0, index - 1);
  const rightIndex = Math.min(length - 1, index);
  const leftTime = timestamps[leftIndex] ?? 0;
  const rightTime = timestamps[rightIndex] ?? leftTime;
  const leftValue = values[leftIndex] ?? 0;
  const rightValue = values[rightIndex] ?? leftValue;
  if (Math.abs(rightTime - leftTime) < 1e-9) return leftValue;
  const ratio = clamp((positionSec - leftTime) / (rightTime - leftTime), 0, 1);
  return leftValue + (rightValue - leftValue) * ratio;
}

function interpolateTrackArrayWithinBounds(
  values: Float32Array,
  timestamps: Float32Array,
  positionSec: number,
): number {
  const length = Math.min(values.length, timestamps.length);
  if (length === 0) return 0;
  const start = timestamps[0] ?? 0;
  const end = timestamps[length - 1] ?? start;
  if (positionSec < start || positionSec > end) return 0;
  return interpolateTrackArray(values, timestamps, positionSec);
}

function regridPitchTrackOntoTimestamps(
  track: PitchTrack,
  targetTimestamps: Float32Array,
  offsetSec = 0,
): PitchTrack {
  const pitchTrack = new Float32Array(targetTimestamps.length);
  const voicedProbabilities = new Float32Array(targetTimestamps.length);
  for (let index = 0; index < targetTimestamps.length; index++) {
    const positionSec = (targetTimestamps[index] ?? 0) - offsetSec;
    pitchTrack[index] = interpolateTrackArrayWithinBounds(
      track.pitchTrack,
      track.timestamps,
      positionSec,
    );
    voicedProbabilities[index] = interpolateTrackArrayWithinBounds(
      track.voicedProbabilities,
      track.timestamps,
      positionSec,
    );
  }
  return {
    pitchTrack,
    voicedProbabilities,
    timestamps: Float32Array.from(targetTimestamps),
  };
}

function comparePitchTracksOnGrid(
  localTrack: PitchTrack,
  providedTrack: PitchTrack,
  voicedThreshold: number,
): PitchTrackGridComparison {
  const sharedFrameCount = Math.min(
    localTrack.pitchTrack.length,
    localTrack.voicedProbabilities.length,
    providedTrack.pitchTrack.length,
    providedTrack.voicedProbabilities.length,
  );
  let sharedVoicedFrames = 0;
  let unionVoicedFrames = 0;
  let voicedFrameDisagreement = 0;
  const centsErrors: number[] = [];
  const correlationPairs: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < sharedFrameCount; index++) {
    const localPitch = localTrack.pitchTrack[index] ?? 0;
    const providedPitch = providedTrack.pitchTrack[index] ?? 0;
    const localVoiced = localPitch > 0 &&
      (localTrack.voicedProbabilities[index] ?? 0) >= voicedThreshold;
    const providedVoiced = providedPitch > 0 &&
      (providedTrack.voicedProbabilities[index] ?? 0) >= voicedThreshold;
    if (localVoiced || providedVoiced) unionVoicedFrames++;
    if (localVoiced !== providedVoiced) voicedFrameDisagreement++;
    if (localVoiced && providedVoiced) {
      sharedVoicedFrames++;
      centsErrors.push(hzToCentsRatio(localPitch, providedPitch));
      correlationPairs.push({ x: localPitch, y: providedPitch });
    }
  }
  return {
    sharedVoicedFrames,
    voicedFrameJaccard: unionVoicedFrames > 0 ? sharedVoicedFrames / unionVoicedFrames : 1,
    voicedFrameDisagreement,
    medianF0CentsError: percentile(centsErrors, 0.5),
    p95F0CentsError: percentile(centsErrors, 0.95),
    f0Correlation: correlationOf(correlationPairs),
  };
}

function isBetterProvidedAlignment(
  candidate: PitchTrackGridComparison & { offsetAbsSec: number },
  current: PitchTrackGridComparison & { offsetAbsSec: number },
): boolean {
  if (candidate.voicedFrameDisagreement !== current.voicedFrameDisagreement) {
    return candidate.voicedFrameDisagreement < current.voicedFrameDisagreement;
  }
  if (candidate.sharedVoicedFrames !== current.sharedVoicedFrames) {
    return candidate.sharedVoicedFrames > current.sharedVoicedFrames;
  }
  if (Math.abs(candidate.f0Correlation - current.f0Correlation) > 1e-6) {
    return candidate.f0Correlation > current.f0Correlation;
  }
  if (Math.abs(candidate.p95F0CentsError - current.p95F0CentsError) > 1e-6) {
    return candidate.p95F0CentsError < current.p95F0CentsError;
  }
  if (Math.abs(candidate.medianF0CentsError - current.medianF0CentsError) > 1e-6) {
    return candidate.medianF0CentsError < current.medianF0CentsError;
  }
  return candidate.offsetAbsSec < current.offsetAbsSec;
}

export function alignProvidedPitchTrackToLocalGrid(
  localTrack: PitchTrack,
  providedTrack: PitchTrack,
  sampleRate: number,
  voicedThreshold: number,
): PitchTrack {
  if (localTrack.timestamps.length === 0 || providedTrack.timestamps.length === 0) {
    return providedTrack;
  }
  const localHopSec = inferTrackHopSeconds(localTrack, sampleRate);
  const providedHopSec = inferTrackHopSeconds(providedTrack, sampleRate);
  const gridBaseOffsetSec =
    ((localTrack.timestamps[0] ?? 0) - localHopSec * 0.5) -
    ((providedTrack.timestamps[0] ?? 0) - providedHopSec * 0.5);
  const offsets = Array.from(new Set(
    [
      0,
      gridBaseOffsetSec,
      gridBaseOffsetSec - localHopSec,
      gridBaseOffsetSec + localHopSec,
      -localHopSec,
      localHopSec,
      -providedHopSec,
      providedHopSec,
    ].filter(Number.isFinite).map((value) => value.toFixed(9)),
  )).map(Number);
  let bestTrack = regridPitchTrackOntoTimestamps(providedTrack, localTrack.timestamps, 0);
  let bestComparison = {
    ...comparePitchTracksOnGrid(localTrack, bestTrack, voicedThreshold),
    offsetAbsSec: 0,
  };
  for (const offsetSec of offsets) {
    const candidateTrack = regridPitchTrackOntoTimestamps(
      providedTrack,
      localTrack.timestamps,
      offsetSec,
    );
    const candidateComparison = {
      ...comparePitchTracksOnGrid(localTrack, candidateTrack, voicedThreshold),
      offsetAbsSec: Math.abs(offsetSec),
    };
    if (isBetterProvidedAlignment(candidateComparison, bestComparison)) {
      bestTrack = candidateTrack;
      bestComparison = candidateComparison;
    }
  }
  return bestTrack;
}

export function analyzePitchLocaVoiceDsp(
  samples: Float32Array,
  sampleRate: number,
  config?: Partial<LocaVoiceDspConfig>,
): PitchTrack {
  const resolvedConfig = resolveConfig(config);
  const frameSize = resolvedConfig.frameSize;
  const hopSize = resolvedConfig.hopSize;
  const maxFrameStart = Math.max(0, samples.length - frameSize);
  const frameCount = Math.max(1, Math.floor(maxFrameStart / hopSize) + 1);
  const pitchTrack = new Float32Array(frameCount);
  const voicedProbabilities = new Float32Array(frameCount);
  const timestamps = new Float32Array(frameCount);
  const minLag = Math.max(1, Math.floor(sampleRate / resolvedConfig.maxF0));
  const maxLag = Math.max(minLag + 1, Math.floor(sampleRate / resolvedConfig.minF0));
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize;
    const end = Math.min(start + frameSize, samples.length);
    const length = end - start;
    timestamps[frame] = (start + length * 0.5) / sampleRate;
    if (length <= maxLag + 2) continue;
    let rmsAcc = 0;
    for (let index = 0; index < length; index++) {
      const value = samples[start + index] ?? 0;
      rmsAcc += value * value;
    }
    if (Math.sqrt(rmsAcc / length) < resolvedConfig.minRms) continue;
    let bestLag = 0;
    let bestCorrelation = -1;
    for (let lag = minLag; lag <= Math.min(maxLag, length - 2); lag++) {
      let correlation = 0;
      let normA = 0;
      let normB = 0;
      const upper = length - lag;
      for (let index = 0; index < upper; index++) {
        const left = samples[start + index] ?? 0;
        const right = samples[start + index + lag] ?? 0;
        correlation += left * right;
        normA += left * left;
        normB += right * right;
      }
      const normalizedCorrelation = correlation / (Math.sqrt(normA * normB) + 1e-12);
      if (normalizedCorrelation > bestCorrelation) {
        bestCorrelation = normalizedCorrelation;
        bestLag = lag;
      }
    }
    const confidence = clamp((bestCorrelation - 0.2) / 0.8, 0, 1);
    voicedProbabilities[frame] = confidence;
    if (bestLag > 0 && confidence >= resolvedConfig.voicedThreshold) {
      const f0 = sampleRate / bestLag;
      if (f0 >= resolvedConfig.minF0 && f0 <= resolvedConfig.maxF0) {
        pitchTrack[frame] = f0;
      }
    }
  }
  return { pitchTrack, voicedProbabilities, timestamps };
}

function interpolateF0(position: number, framePositions: number[], f0s: number[]): number {
  if (framePositions.length === 0) return 0;
  if (framePositions.length === 1) return f0s[0] ?? 0;
  if (position <= (framePositions[0] ?? 0)) return f0s[0] ?? 0;
  if (position >= (framePositions[framePositions.length - 1] ?? 0)) {
    return f0s[f0s.length - 1] ?? 0;
  }
  let index = 1;
  while (index < framePositions.length && (framePositions[index] ?? 0) < position) index++;
  const leftIndex = Math.max(0, index - 1);
  const rightIndex = Math.min(framePositions.length - 1, index);
  const leftPosition = framePositions[leftIndex] ?? 0;
  const rightPosition = framePositions[rightIndex] ?? leftPosition + 1;
  const leftF0 = f0s[leftIndex] ?? 0;
  const rightF0 = f0s[rightIndex] ?? leftF0;
  if (Math.abs(rightPosition - leftPosition) < 1e-9) return leftF0;
  const ratio = (position - leftPosition) / (rightPosition - leftPosition);
  return leftF0 + (rightF0 - leftF0) * ratio;
}

function refinePeak(segment: Float32Array, center: number, period: number): number {
  const search = Math.max(2, Math.floor(period * 0.25));
  const start = Math.max(0, center - search);
  const end = Math.min(segment.length - 1, center + search);
  let best = center;
  let bestAmplitude = -1;
  for (let index = start; index <= end; index++) {
    const amplitude = Math.abs(segment[index] ?? 0);
    if (amplitude > bestAmplitude) {
      bestAmplitude = amplitude;
      best = index;
    }
  }
  return best;
}

function makePitchMarks(
  segment: Float32Array,
  framePositions: number[],
  f0s: number[],
  sampleRate: number,
): number[] {
  if (segment.length === 0 || framePositions.length === 0) return [];
  let position = Math.round(clamp(framePositions[0] ?? 0, 0, segment.length - 1));
  const firstF0 = interpolateF0(position, framePositions, f0s);
  if (firstF0 <= 0) return [];
  let period = sampleRate / firstF0;
  position = refinePeak(segment, position, period);
  if (position < 0 || position >= segment.length) return [];
  const marks = [position];
  while (true) {
    const f0 = interpolateF0(position, framePositions, f0s);
    if (f0 <= 0) break;
    period = Math.max(1, sampleRate / f0);
    let next = position + Math.round(period);
    if (next >= segment.length) break;
    next = refinePeak(segment, next, period);
    if (next <= position) next = position + Math.round(period);
    if (next >= segment.length) break;
    marks.push(next);
    position = next;
  }
  return marks;
}

function repairVoicedTrack(
  track: PitchTrack,
  sampleRate: number,
  sourceLength: number,
  voicingPolicy: {
    voicedThreshold: number;
    edgeContinuationThreshold: number;
    edgeEvidenceTrack?: PitchTrack;
    edgeEvidenceSamples: Float32Array;
    minimumEdgeRms: number;
    maximumGapSeconds: number;
    minimumVoicedRunSeconds: number;
  },
): { repairedTrack: PitchTrack; voicedRegions: VoicedRegion[] } {
  const {
    voicedThreshold,
    edgeContinuationThreshold,
    edgeEvidenceTrack,
    edgeEvidenceSamples,
    minimumEdgeRms,
    maximumGapSeconds,
    minimumVoicedRunSeconds,
  } = voicingPolicy;
  const hop = inferTrackHopSamples(track, sampleRate);
  const maxGapFrames = Math.max(1, Math.round(maximumGapSeconds * sampleRate / hop));
  const minRunFrames = Math.max(1, Math.round(minimumVoicedRunSeconds * sampleRate / hop));
  const repairedMask = new Uint8Array(track.pitchTrack.length);
  for (let index = 0; index < track.pitchTrack.length; index++) {
    if (
      (track.pitchTrack[index] ?? 0) > 0 &&
      (track.voicedProbabilities[index] ?? 0) >= voicedThreshold
    ) {
      repairedMask[index] = 1;
    }
  }
  const repairedPitch = Float32Array.from(track.pitchTrack);
  const repairedProbabilities = Float32Array.from(track.voicedProbabilities);
  const edgeEvidenceIsGridAligned = edgeEvidenceTrack !== undefined &&
    edgeEvidenceTrack.voicedProbabilities.length === repairedProbabilities.length &&
    edgeEvidenceTrack.timestamps.length === track.timestamps.length &&
    Array.from(track.timestamps).every(
      (timestamp, frame) =>
        Math.abs(timestamp - (edgeEvidenceTrack.timestamps[frame] ?? timestamp)) < 1e-6,
    );
  const edgeEvidenceProbabilities = edgeEvidenceIsGridAligned
    ? edgeEvidenceTrack.voicedProbabilities
    : repairedProbabilities;
  const hasCenteredEdgeEnergy = (startSample: number, endSample: number): boolean => {
    const start = clamp(Math.floor(startSample), 0, edgeEvidenceSamples.length);
    const end = clamp(Math.ceil(endSample), start, edgeEvidenceSamples.length);
    const length = end - start;
    if (length <= 1) return false;
    let sum = 0;
    for (let sample = start; sample < end; sample++) {
      sum += edgeEvidenceSamples[sample] ?? 0;
    }
    const mean = sum / length;
    let centeredEnergy = 0;
    for (let sample = start; sample < end; sample++) {
      const centered = (edgeEvidenceSamples[sample] ?? 0) - mean;
      centeredEnergy += centered * centered;
    }
    return Math.sqrt(centeredEnergy / length) >= minimumEdgeRms;
  };
  let previousVoicedEnd = -1;
  let index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) index++;
    if (index >= repairedMask.length) break;
    const voicedStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) index++;
    const voicedEnd = index - 1;
    if (previousVoicedEnd >= 0) {
      const gapStart = previousVoicedEnd + 1;
      const gapEnd = voicedStart - 1;
      const gapLength = gapEnd - gapStart + 1;
      if (gapLength > 0 && gapLength <= maxGapFrames) {
        const leftPitch = repairedPitch[previousVoicedEnd] ?? 0;
        const rightPitch = repairedPitch[voicedStart] ?? leftPitch;
        const leftProbability = repairedProbabilities[previousVoicedEnd] ?? voicedThreshold;
        const rightProbability = repairedProbabilities[voicedStart] ?? leftProbability;
        for (let offset = 0; offset < gapLength; offset++) {
          const frameIndex = gapStart + offset;
          const ratio = (offset + 1) / (gapLength + 1);
          repairedMask[frameIndex] = 1;
          repairedPitch[frameIndex] = leftPitch + (rightPitch - leftPitch) * ratio;
          repairedProbabilities[frameIndex] = clamp(
            Math.max(
              voicedThreshold,
              leftProbability + (rightProbability - leftProbability) * ratio,
            ),
            voicedThreshold,
            1,
          );
        }
      }
    }
    previousVoicedEnd = voicedEnd;
  }
  const firstVoicedFrame = repairedMask.indexOf(1);
  const lastVoicedFrame = repairedMask.lastIndexOf(1);
  const leadingFramesHaveContinuationEvidence = firstVoicedFrame > 0 &&
    Array.from(
      edgeEvidenceProbabilities.subarray(0, firstVoicedFrame),
    ).every((probability) => probability >= edgeContinuationThreshold);
  const leadingEdgeHasSignalEvidence = firstVoicedFrame >= 0 &&
    hasCenteredEdgeEnergy(
      0,
      (track.timestamps[firstVoicedFrame] ?? 0) * sampleRate,
    );
  if (
    firstVoicedFrame > 0 &&
    firstVoicedFrame <= maxGapFrames &&
    leadingFramesHaveContinuationEvidence &&
    leadingEdgeHasSignalEvidence
  ) {
    const edgePitch = repairedPitch[firstVoicedFrame] ?? 0;
    const edgeProbability = Math.max(
      voicedThreshold,
      repairedProbabilities[firstVoicedFrame] ?? voicedThreshold,
    );
    for (let frame = 0; frame < firstVoicedFrame; frame++) {
      repairedMask[frame] = 1;
      repairedPitch[frame] = edgePitch;
      repairedProbabilities[frame] = edgeProbability;
    }
  }
  const trailingGapFrames = repairedMask.length - 1 - lastVoicedFrame;
  const trailingFramesHaveContinuationEvidence = lastVoicedFrame >= 0 &&
    Array.from(
      edgeEvidenceProbabilities.subarray(lastVoicedFrame + 1),
    ).every((probability) => probability >= edgeContinuationThreshold);
  const trailingEdgeHasSignalEvidence = lastVoicedFrame >= 0 &&
    hasCenteredEdgeEnergy(
      (track.timestamps[lastVoicedFrame] ?? 0) * sampleRate,
      sourceLength,
    );
  if (
    lastVoicedFrame >= 0 &&
    trailingGapFrames > 0 &&
    trailingGapFrames <= maxGapFrames &&
    trailingFramesHaveContinuationEvidence &&
    trailingEdgeHasSignalEvidence
  ) {
    const edgePitch = repairedPitch[lastVoicedFrame] ?? 0;
    const edgeProbability = Math.max(
      voicedThreshold,
      repairedProbabilities[lastVoicedFrame] ?? voicedThreshold,
    );
    for (let frame = lastVoicedFrame + 1; frame < repairedMask.length; frame++) {
      repairedMask[frame] = 1;
      repairedPitch[frame] = edgePitch;
      repairedProbabilities[frame] = edgeProbability;
    }
  }
  index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) index++;
    if (index >= repairedMask.length) break;
    const runStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) index++;
    const runEnd = index - 1;
    if (runEnd - runStart + 1 < minRunFrames) {
      for (let frame = runStart; frame <= runEnd; frame++) {
        repairedMask[frame] = 0;
        repairedPitch[frame] = 0;
        repairedProbabilities[frame] = 0;
      }
    }
  }
  const voicedRegions: VoicedRegion[] = [];
  index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) index++;
    if (index >= repairedMask.length) break;
    const frameStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) index++;
    const frameEnd = index - 1;
    const startCenter = (track.timestamps[frameStart] ?? 0) * sampleRate;
    const endCenter = (track.timestamps[frameEnd] ?? 0) * sampleRate;
    const boundedStartSample = clamp(
      Math.round(startCenter - hop * 0.5),
      0,
      sourceLength,
    );
    const boundedEndSample = clamp(
      Math.round(endCenter + hop * 0.5),
      boundedStartSample + 1,
      sourceLength,
    );
    const maximumGapSamples = Math.round(maximumGapSeconds * sampleRate);
    const startSample = frameStart === 0 &&
        leadingEdgeHasSignalEvidence &&
        boundedStartSample <= maximumGapSamples
      ? 0
      : boundedStartSample;
    const endSample = frameEnd === repairedMask.length - 1 &&
        trailingEdgeHasSignalEvidence &&
        sourceLength - boundedEndSample <= maximumGapSamples
      ? sourceLength
      : boundedEndSample;
    voicedRegions.push({ startSample, endSample, frameStart, frameEnd });
  }
  return {
    repairedTrack: {
      pitchTrack: repairedPitch,
      voicedProbabilities: repairedProbabilities,
      timestamps: Float32Array.from(track.timestamps),
    },
    voicedRegions,
  };
}

function validateSourceMarks(
  marks: number[] | undefined,
  voicedRegions: VoicedRegion[],
  sourceLength: number,
): marks is number[] {
  if (!marks || marks.length < 2) return false;
  let previous = -1;
  for (const mark of marks) {
    if (!Number.isFinite(mark) || mark < 0 || mark >= sourceLength || mark <= previous) {
      return false;
    }
    previous = mark;
  }
  for (const region of voicedRegions) {
    if (region.endSample - region.startSample < 32) continue;
    const regionMarks = marks.filter(
      (mark) => mark >= region.startSample && mark < region.endSample,
    );
    if (regionMarks.length < 2) return false;
    let spacingSum = 0;
    let maxSpacing = 0;
    for (let index = 1; index < regionMarks.length; index++) {
      const spacing = regionMarks[index]! - regionMarks[index - 1]!;
      spacingSum += spacing;
      maxSpacing = Math.max(maxSpacing, spacing);
    }
    const averageSpacing = spacingSum / Math.max(1, regionMarks.length - 1);
    const coverageSlack = Math.max(
      128,
      Math.round(Math.max(maxSpacing, averageSpacing) * 2.5),
    );
    if (
      (regionMarks[0] ?? 0) > region.startSample + coverageSlack ||
      (regionMarks[regionMarks.length - 1] ?? 0) < region.endSample - coverageSlack
    ) {
      return false;
    }
  }
  return true;
}

function generateMarksForVoicedRegions(
  monoSource: Float32Array,
  track: PitchTrack,
  voicedRegions: VoicedRegion[],
  sampleRate: number,
): number[] | undefined {
  const marks: number[] = [];
  for (const region of voicedRegions) {
    const segment = monoSource.subarray(region.startSample, region.endSample);
    const framePositions: number[] = [];
    const f0s: number[] = [];
    for (let frame = region.frameStart; frame <= region.frameEnd; frame++) {
      const pitch = track.pitchTrack[frame] ?? 0;
      if (pitch <= 0) continue;
      framePositions.push(
        (track.timestamps[frame] ?? 0) * sampleRate - region.startSample,
      );
      f0s.push(pitch);
    }
    const regionMarks = makePitchMarks(segment, framePositions, f0s, sampleRate)
      .map((mark) => mark + region.startSample);
    for (const mark of regionMarks) {
      if (marks.length === 0 || mark > (marks[marks.length - 1] ?? -1)) {
        marks.push(mark);
      }
    }
  }
  return marks.length >= 2 ? marks : undefined;
}

export function prepareSourcePlan(args: {
  monoSource: Float32Array;
  track: PitchTrack;
  sampleRate: number;
  providedMarks: number[] | undefined;
  edgeEvidenceTrack?: PitchTrack;
  minimumEdgeRms?: number;
  voicedThreshold: number;
  maximumGapSeconds?: number;
  minimumVoicedRunSeconds?: number;
  edgeContinuationThreshold?: number;
}): PreparedSourcePlan {
  const {
    monoSource,
    track,
    sampleRate,
    providedMarks,
    edgeEvidenceTrack,
    minimumEdgeRms = 0.005,
    voicedThreshold,
    maximumGapSeconds = 0.06,
    minimumVoicedRunSeconds = 0.02,
    edgeContinuationThreshold = voicedThreshold * 0.75,
  } = args;
  const { repairedTrack, voicedRegions } = repairVoicedTrack(
    track,
    sampleRate,
    monoSource.length,
    {
      voicedThreshold,
      edgeContinuationThreshold,
      edgeEvidenceTrack,
      edgeEvidenceSamples: monoSource,
      minimumEdgeRms,
      maximumGapSeconds,
      minimumVoicedRunSeconds,
    },
  );
  const reusedProvidedMarks = validateSourceMarks(
    providedMarks,
    voicedRegions,
    monoSource.length,
  );
  const sourceMarks = reusedProvidedMarks
    ? providedMarks
    : generateMarksForVoicedRegions(monoSource, repairedTrack, voicedRegions, sampleRate);
  return { repairedTrack, sourceMarks, voicedRegions, reusedProvidedMarks, voicedThreshold };
}

function isIdentityWarpPlan(warpPlan: ClipWarpPlan): boolean {
  return warpPlan.kind === "linear" &&
    warpPlan.segments.length === 1 &&
    warpPlan.segments[0]?.outputStartSample === 0 &&
    warpPlan.segments[0]?.sourceStartSample === 0 &&
    warpPlan.segments[0]?.outputEndSample === warpPlan.segments[0]?.sourceEndSample;
}

export function inferRenderOperation(
  targetSamples: number,
  sourceLength: number,
  totalPitchSemitones: number,
  pitchSegments: PitchSegment[] | undefined,
  warpPlan: ClipWarpPlan,
): ClipTdPsolaOperation {
  const hasPitch = (pitchSegments?.length ?? 0) > 0 ||
    Math.abs(totalPitchSemitones) >= 0.01;
  const hasExactPitchOnlyTiming = isIdentityWarpPlan(warpPlan) &&
    targetSamples === sourceLength;
  const hasStretch = !isIdentityWarpPlan(warpPlan) || targetSamples !== sourceLength;
  if (hasPitch) return hasExactPitchOnlyTiming ? "pitch_only" : "combined";
  return hasStretch ? "stretch_only" : "bypass";
}
