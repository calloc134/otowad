import type {
  AudioBufferData,
  AudioBufferSource,
} from "./audioBufferData.ts";
import {
  audioBufferDataToAudioBuffer,
  createAudioBufferData,
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "./audioBufferData.ts";
import type {
  F0TrackArtifact,
  PitchMarksArtifact,
  TimePitchModeKind,
} from "../types/index.ts";
import type { ClipWarpPlan, PitchSegment } from "./pitchPlan.ts";
import type { ClipTdPsolaOperation } from "./directClipRender.ts";
import {
  candidateToDiagnostics,
  compareVoicedTrackDiagnostics,
  makeEmptySynthesisSchedule,
  measureScheduleCoverage,
  resolveSelectionPolicy,
  selectPreferredSynthesisCandidate,
} from "./tdpsolaDiagnostics.ts";
import {
  intersectWarpPlanWithSourceRange,
  localPitchMarksFromArtifact,
  mapOutputSampleToSourceSample,
  mapSourceSampleToOutputSample,
  normalizeWarpPlan,
  renderWarpedLinear,
  slicePitchMarks,
} from "./tdpsolaWarp.ts";
import { applyFinalSafetyLimiter } from "./tdpsolaV2/outputSafety.ts";

export type { PitchSegment };

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

export interface RenderTdPsolaOptions {
  context: BaseAudioContext;
  inputBuffer: AudioBufferSource;
  sourceInFrame: number;
  sourceOutFrame: number;
  targetDurationSec: number;
  /** Combined pitch shift in semitones (manual + follow). Used when pitchSegments is not provided. */
  totalPitchSemitones: number;
  /** Segment-based pitch shifts. When provided, overrides totalPitchSemitones for the follow component. */
  pitchSegments?: PitchSegment[];
  warpPlan?: ClipWarpPlan;
  sourceF0Track?: F0TrackArtifact | null;
  sourcePitchMarks?: PitchMarksArtifact | null;
  renderOperation?: ClipTdPsolaOperation;
  preserveFormant?: boolean;
  config?: Partial<LocaVoiceDspConfig>;
  selectionPolicy?: Partial<TdPsolaSelectionPolicy>;
  diagnosticsCollector?: (diagnostics: TdPsolaRenderDiagnostics) => void;
}

export type RenderTdPsolaDataOptions = Omit<RenderTdPsolaOptions, "context">;

export interface TdPsolaSelectionPolicy {
  /** Benchmark-only override. Runtime defaults must remain local-first. */
  tieBreakPreference: "provided" | "local";
  hardRejectProvidedCoverageInflationRatio?: number;
}

export interface TdPsolaCoverageDiagnostics {
  totalSamples: number;
  coveredSamples: number;
  fallbackSamples: number;
  voicedInteriorSamples: number;
  voicedInteriorFallbackSamples: number;
  voicedInteriorFallbackRuns: number;
  maxVoicedInteriorFallbackRun: number;
}

export interface TdPsolaCandidateDiagnostics {
  analysisSource: "local" | "provided";
  voicedRegionCount: number;
  sourceMarkCount: number;
  reusedProvidedMarks: boolean;
  epochCounts: {
    voiced: number;
    unvoiced: number;
    transient: number;
  };
  initialCoverage: TdPsolaCoverageDiagnostics;
  finalCoverage: TdPsolaCoverageDiagnostics;
  insertedVoicedEpochs: number;
}

export interface TdPsolaCandidateComparisonDiagnostics {
  sharedVoicedFrames: number;
  voicedFrameJaccard: number;
  voicedFrameDisagreement: number;
  medianF0CentsError: number;
  p95F0CentsError: number;
  f0Correlation: number;
  localEpochCount: number;
  providedEpochCount: number;
  voicedEpochCountDelta: number;
  voicedEpochSpacingMeanAbsDiff: number;
  voicedEpochSpacingP95AbsDiff: number;
  sourceMarkSpacingMeanAbsDiff: number;
  sourceMarkSpacingP95AbsDiff: number;
  timestampMeanAbsDeltaSec: number;
  timestampMaxAbsDeltaSec: number;
}

export interface TdPsolaSelectionDecision {
  criterion:
    | "bypass"
    | "only_candidate"
    | "provided_coverage_hard_reject"
    | "provided_divergence_reject"
    | "voiced_interior_fallback"
    | "voiced_coverage_conservative"
    | "analysis_source_tiebreak"
    | "epoch_count"
    | "source_mark_count"
    | "stable_order";
  winner: "local" | "provided";
  loser?: "local" | "provided";
  winnerValue?: number | string;
  loserValue?: number | string;
  threshold?: number;
}

export interface TdPsolaRenderDiagnostics {
  analysisSource: "local" | "provided";
  selectionPolicy: TdPsolaSelectionPolicy;
  operation: ClipTdPsolaOperation;
  sourceLength: number;
  targetLength: number;
  voicedRegionCount: number;
  sourceMarkCount: number;
  reusedProvidedMarks: boolean;
  epochCounts: {
    voiced: number;
    unvoiced: number;
    transient: number;
  };
  initialCoverage: TdPsolaCoverageDiagnostics;
  finalCoverage: TdPsolaCoverageDiagnostics;
  insertedVoicedEpochs: number;
  candidates: TdPsolaCandidateDiagnostics[];
  candidateComparison?: TdPsolaCandidateComparisonDiagnostics;
  selectionDecision: TdPsolaSelectionDecision;
}

const DEFAULT_CONFIG: LocaVoiceDspConfig = {
  minF0: 60,
  maxF0: 500,
  frameSize: 2048,
  hopSize: 512,
  voicedThreshold: 0.6,
  minRms: 0.005,
};

interface AnalysisWindow {
  left: number;
  centerOffset: number;
  window: Float32Array;
}

interface VoicedRegion {
  startSample: number;
  endSample: number;
  frameStart: number;
  frameEnd: number;
}

interface PreparedSourcePlan {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveConfig(config?: Partial<LocaVoiceDspConfig>): LocaVoiceDspConfig {
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
  while (power * 2 <= value) {
    power *= 2;
  }
  return power;
}

function fitConfigToTargetLength(
  config: LocaVoiceDspConfig,
  targetSamples: number,
): LocaVoiceDspConfig {
  if (targetSamples >= config.frameSize) {
    return config;
  }

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

function resampleLinear(input: Float32Array, targetLength: number): Float32Array {
  const outLength = Math.max(1, Math.round(targetLength));
  const out = new Float32Array(outLength);
  if (input.length === 0) {
    return out;
  }
  if (input.length === 1) {
    out.fill(input[0] ?? 0);
    return out;
  }
  if (outLength === 1) {
    out[0] = input[0] ?? 0;
    return out;
  }

  const scale = (input.length - 1) / (outLength - 1);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * scale;
    const left = Math.floor(srcPos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcPos - left;
    const l = input[left] ?? 0;
    const r = input[right] ?? l;
    out[i] = l + (r - l) * frac;
  }
  return out;
}

function extractMonoSegment(
  inputBuffer: AudioBufferSource,
  startFrame: number,
  endFrame: number,
): Float32Array {
  const length = Math.max(0, endFrame - startFrame);
  const mono = new Float32Array(length);
  if (length === 0) return mono;

  const channels = getAudioBufferChannelCount(inputBuffer);
  for (let ch = 0; ch < channels; ch++) {
    const data = getAudioBufferChannelData(inputBuffer, ch);
    for (let i = 0; i < length; i++) {
      mono[i] = (mono[i] ?? 0) + (data[startFrame + i] ?? 0);
    }
  }

  const inv = 1 / Math.max(1, channels);
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (mono[i] ?? 0) * inv;
  }
  return mono;
}

function pitchTrackFromF0Artifact(
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
        : raw > 0
          ? 1
          : 0,
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
  if (track.timestamps.length < 2) {
    return 1;
  }

  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 1; i < track.timestamps.length; i++) {
    const delta = (track.timestamps[i] ?? 0) - (track.timestamps[i - 1] ?? 0);
    if (delta > 0 && delta < minDelta) {
      minDelta = delta;
    }
  }

  if (!Number.isFinite(minDelta)) {
    return 1;
  }
  return Math.max(1, Math.round(minDelta * sampleRate));
}

function slicePitchTrack(
  track: PitchTrack,
  startSample: number,
  endSample: number,
  sampleRate: number,
): PitchTrack {
  const padding = inferTrackHopSamples(track, sampleRate);
  const startSec = (startSample - padding) / sampleRate;
  const endSec = (endSample + padding) / sampleRate;

  const pitch: number[] = [];
  const voiced: number[] = [];
  const timestamps: number[] = [];

  for (let i = 0; i < track.timestamps.length; i++) {
    const timestamp = track.timestamps[i] ?? 0;
    if (timestamp < startSec || timestamp > endSec) continue;
    pitch.push(track.pitchTrack[i] ?? 0);
    voiced.push(track.voicedProbabilities[i] ?? 0);
    timestamps.push(timestamp - startSample / sampleRate);
  }

  return {
    pitchTrack: Float32Array.from(pitch),
    voicedProbabilities: Float32Array.from(voiced),
    timestamps: Float32Array.from(timestamps),
  };
}

function inferTrackHopSeconds(track: PitchTrack, sampleRate: number): number {
  return inferTrackHopSamples(track, sampleRate) / sampleRate;
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
  if (positionSec < start || positionSec > end) {
    return 0;
  }
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
    const localVoiced =
      localPitch > 0 && (localTrack.voicedProbabilities[index] ?? 0) >= voicedThreshold;
    const providedVoiced =
      providedPitch > 0 && (providedTrack.voicedProbabilities[index] ?? 0) >= voicedThreshold;

    if (localVoiced || providedVoiced) {
      unionVoicedFrames++;
    }
    if (localVoiced !== providedVoiced) {
      voicedFrameDisagreement++;
    }
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

function pickBetterProvidedAlignment(
  left: PitchTrackGridComparison & { offsetAbsSec: number },
  right: PitchTrackGridComparison & { offsetAbsSec: number },
): boolean {
  if (left.voicedFrameDisagreement !== right.voicedFrameDisagreement) {
    return left.voicedFrameDisagreement < right.voicedFrameDisagreement;
  }
  if (left.sharedVoicedFrames !== right.sharedVoicedFrames) {
    return left.sharedVoicedFrames > right.sharedVoicedFrames;
  }
  if (Math.abs(left.f0Correlation - right.f0Correlation) > 1e-6) {
    return left.f0Correlation > right.f0Correlation;
  }
  if (Math.abs(left.p95F0CentsError - right.p95F0CentsError) > 1e-6) {
    return left.p95F0CentsError < right.p95F0CentsError;
  }
  if (Math.abs(left.medianF0CentsError - right.medianF0CentsError) > 1e-6) {
    return left.medianF0CentsError < right.medianF0CentsError;
  }
  return left.offsetAbsSec < right.offsetAbsSec;
}

function alignProvidedPitchTrackToLocalGrid(
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
  const localGridOffsetSec = (localTrack.timestamps[0] ?? 0) - localHopSec * 0.5;
  const providedGridOffsetSec = (providedTrack.timestamps[0] ?? 0) - providedHopSec * 0.5;
  const gridBaseOffsetSec = localGridOffsetSec - providedGridOffsetSec;
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
    ]
      .filter((value) => Number.isFinite(value))
      .map((value) => value.toFixed(9)),
  )).map((value) => Number(value));

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
    if (pickBetterProvidedAlignment(candidateComparison, bestComparison)) {
      bestTrack = candidateTrack;
      bestComparison = candidateComparison;
    }
  }

  return bestTrack;
}

export function mapPitchTrackToOutput(
  track: PitchTrack,
  sampleRate: number,
  warpPlan: ClipWarpPlan,
): PitchTrack {
  const timestamps = new Float32Array(track.timestamps.length);
  for (let i = 0; i < track.timestamps.length; i++) {
    const sourceSample = (track.timestamps[i] ?? 0) * sampleRate;
    timestamps[i] = mapSourceSampleToOutputSample(sourceSample, warpPlan) / sampleRate;
  }

  return {
    pitchTrack: Float32Array.from(track.pitchTrack),
    voicedProbabilities: Float32Array.from(track.voicedProbabilities),
    timestamps,
  };
}

export function mapPitchMarksToOutput(
  marks: number[] | undefined,
  warpPlan: ClipWarpPlan,
): number[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const mapped = marks
    .map((mark) => Math.round(mapSourceSampleToOutputSample(mark, warpPlan)))
    .sort((left, right) => left - right)
    .filter((mark, index, all) => index === 0 || mark !== all[index - 1]);
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Lightweight, local pitch tracker for TD-PSOLA.
 * The API shape intentionally mirrors loqa_voice_dsp-style outputs.
 */
export function analyzePitchLocaVoiceDsp(
  samples: Float32Array,
  sampleRate: number,
  config?: Partial<LocaVoiceDspConfig>,
): PitchTrack {
  const cfg = resolveConfig(config);
  const frameSize = cfg.frameSize;
  const hopSize = cfg.hopSize;
  const maxFrameStart = Math.max(0, samples.length - frameSize);
  const frameCount = Math.max(1, Math.floor(maxFrameStart / hopSize) + 1);

  const pitchTrack = new Float32Array(frameCount);
  const voicedProbabilities = new Float32Array(frameCount);
  const timestamps = new Float32Array(frameCount);

  const minLag = Math.max(1, Math.floor(sampleRate / cfg.maxF0));
  const maxLag = Math.max(minLag + 1, Math.floor(sampleRate / cfg.minF0));

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize;
    const end = Math.min(start + frameSize, samples.length);
    const len = end - start;

    timestamps[frame] = (start + len * 0.5) / sampleRate;
    if (len <= maxLag + 2) continue;

    let rmsAcc = 0;
    for (let i = 0; i < len; i++) {
      const v = samples[start + i] ?? 0;
      rmsAcc += v * v;
    }
    const rms = Math.sqrt(rmsAcc / len);
    if (rms < cfg.minRms) continue;

    let bestLag = 0;
    let bestCorr = -1;

    for (let lag = minLag; lag <= Math.min(maxLag, len - 2); lag++) {
      let corr = 0;
      let normA = 0;
      let normB = 0;

      const upper = len - lag;
      for (let i = 0; i < upper; i++) {
        const a = samples[start + i] ?? 0;
        const b = samples[start + i + lag] ?? 0;
        corr += a * b;
        normA += a * a;
        normB += b * b;
      }

      const denom = Math.sqrt(normA * normB) + 1e-12;
      const ncc = corr / denom;
      if (ncc > bestCorr) {
        bestCorr = ncc;
        bestLag = lag;
      }
    }

    const confidence = clamp((bestCorr - 0.2) / 0.8, 0, 1);
    voicedProbabilities[frame] = confidence;

    if (bestLag > 0 && confidence >= cfg.voicedThreshold) {
      const f0 = sampleRate / bestLag;
      if (f0 >= cfg.minF0 && f0 <= cfg.maxF0) {
        pitchTrack[frame] = f0;
      }
    }
  }

  return { pitchTrack, voicedProbabilities, timestamps };
}

function interpF0(pos: number, framePos: number[], f0s: number[]): number {
  if (framePos.length === 0) return 0;
  if (framePos.length === 1) return f0s[0] ?? 0;
  if (pos <= (framePos[0] ?? 0)) return f0s[0] ?? 0;
  if (pos >= (framePos[framePos.length - 1] ?? 0)) return f0s[f0s.length - 1] ?? 0;

  let idx = 1;
  while (idx < framePos.length && (framePos[idx] ?? 0) < pos) {
    idx++;
  }
  const i0 = Math.max(0, idx - 1);
  const i1 = Math.min(framePos.length - 1, idx);
  const x0 = framePos[i0] ?? 0;
  const x1 = framePos[i1] ?? x0 + 1;
  const y0 = f0s[i0] ?? 0;
  const y1 = f0s[i1] ?? y0;
  if (Math.abs(x1 - x0) < 1e-9) return y0;
  const t = (pos - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

function refinePeak(segment: Float32Array, center: number, period: number): number {
  const len = segment.length;
  const search = Math.max(2, Math.floor(period * 0.25));
  const start = Math.max(0, center - search);
  const end = Math.min(len - 1, center + search);

  let best = center;
  let bestAmp = -1;
  for (let i = start; i <= end; i++) {
    const amp = Math.abs(segment[i] ?? 0);
    if (amp > bestAmp) {
      bestAmp = amp;
      best = i;
    }
  }
  return best;
}

function makePitchMarks(
  segment: Float32Array,
  framePos: number[],
  f0s: number[],
  sampleRate: number,
): number[] {
  const len = segment.length;
  if (len === 0 || framePos.length === 0) return [];

  let pos = Math.round(clamp(framePos[0] ?? 0, 0, len - 1));
  const firstF0 = interpF0(pos, framePos, f0s);
  if (firstF0 <= 0) return [];

  let period = sampleRate / firstF0;
  pos = refinePeak(segment, pos, period);
  if (pos < 0 || pos >= len) return [];

  const marks: number[] = [pos];

  while (true) {
    const f0 = interpF0(pos, framePos, f0s);
    if (f0 <= 0) break;
    period = Math.max(1, sampleRate / f0);
    let next = pos + Math.round(period);
    if (next >= len) break;
    next = refinePeak(segment, next, period);
    if (next <= pos) {
      next = pos + Math.round(period);
    }
    if (next >= len) break;
    marks.push(next);
    pos = next;
  }

  return marks;
}

function buildWindows(marks: number[], len: number): AnalysisWindow[] {
  const windows: AnalysisWindow[] = [];
  if (marks.length < 2) return windows;

  for (let k = 0; k < marks.length; k++) {
    const mark = marks[k] ?? 0;
    const prev = marks[Math.max(0, k - 1)] ?? mark;
    const next = marks[Math.min(marks.length - 1, k + 1)] ?? mark;

    const leftPeriod = Math.max(1, k === 0 ? next - mark : mark - prev);
    const rightPeriod = Math.max(1, k + 1 === marks.length ? mark - prev : next - mark);
    const leftF = mark - leftPeriod;
    const rightF = mark + rightPeriod;

    const left = Math.max(0, Math.floor(leftF));
    const right = Math.min(len, Math.ceil(rightF));
    const width = Math.max(1, right - left);
    const window = new Float32Array(width);

    if (width === 1) {
      window[0] = 1;
    } else {
      for (let n = 0; n < width; n++) {
        const w =
          0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (width - 1));
        window[n] = w;
      }
    }

    windows.push({
      left,
      centerOffset: Math.max(0, mark - left),
      window,
    });
  }

  return windows;
}

function buildVoicedFrameMask(track: PitchTrack, voicedThreshold: number): Uint8Array {
  const mask = new Uint8Array(track.pitchTrack.length);
  for (let i = 0; i < track.pitchTrack.length; i++) {
    const pitch = track.pitchTrack[i] ?? 0;
    const voicedProbability = track.voicedProbabilities[i] ?? 0;
    if (pitch > 0 && voicedProbability >= voicedThreshold) {
      mask[i] = 1;
    }
  }
  return mask;
}

function repairVoicedTrack(
  track: PitchTrack,
  sampleRate: number,
  sourceLength: number,
  voicingPolicy: {
    voicedThreshold: number;
    maximumGapSeconds: number;
    minimumVoicedRunSeconds: number;
  },
): { repairedTrack: PitchTrack; voicedRegions: VoicedRegion[] } {
  const {
    voicedThreshold,
    maximumGapSeconds,
    minimumVoicedRunSeconds,
  } = voicingPolicy;
  const hop = inferTrackHopSamples(track, sampleRate);
  const maxGapFrames = Math.max(1, Math.round((maximumGapSeconds * sampleRate) / hop));
  const minRunFrames = Math.max(
    1,
    Math.round((minimumVoicedRunSeconds * sampleRate) / hop),
  );
  const mask = buildVoicedFrameMask(track, voicedThreshold);
  const repairedMask = Uint8Array.from(mask);
  const repairedPitch = Float32Array.from(track.pitchTrack);
  const repairedVoicedProbabilities = Float32Array.from(track.voicedProbabilities);

  let previousVoicedEnd = -1;
  let index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) {
      index++;
    }
    if (index >= repairedMask.length) break;
    const voicedStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) {
      index++;
    }
    const voicedEnd = index - 1;

    if (previousVoicedEnd >= 0) {
      const gapStart = previousVoicedEnd + 1;
      const gapEnd = voicedStart - 1;
      const gapLength = gapEnd - gapStart + 1;
      if (gapLength > 0 && gapLength <= maxGapFrames) {
        const leftPitch = repairedPitch[previousVoicedEnd] ?? 0;
        const rightPitch = repairedPitch[voicedStart] ?? leftPitch;
        const leftProb = repairedVoicedProbabilities[previousVoicedEnd] ?? voicedThreshold;
        const rightProb = repairedVoicedProbabilities[voicedStart] ?? leftProb;
        for (let offset = 0; offset < gapLength; offset++) {
          const frameIndex = gapStart + offset;
          const t = (offset + 1) / (gapLength + 1);
          repairedMask[frameIndex] = 1;
          repairedPitch[frameIndex] = leftPitch + (rightPitch - leftPitch) * t;
          repairedVoicedProbabilities[frameIndex] = clamp(
            Math.max(voicedThreshold, leftProb + (rightProb - leftProb) * t),
            voicedThreshold,
            1,
          );
        }
      }
    }

    previousVoicedEnd = voicedEnd;
  }

  index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) {
      index++;
    }
    if (index >= repairedMask.length) break;
    const runStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) {
      index++;
    }
    const runEnd = index - 1;
    if (runEnd - runStart + 1 < minRunFrames) {
      for (let frame = runStart; frame <= runEnd; frame++) {
        repairedMask[frame] = 0;
        repairedPitch[frame] = 0;
        repairedVoicedProbabilities[frame] = 0;
      }
    }
  }

  const voicedRegions: VoicedRegion[] = [];
  index = 0;
  while (index < repairedMask.length) {
    while (index < repairedMask.length && repairedMask[index] === 0) {
      index++;
    }
    if (index >= repairedMask.length) break;
    const frameStart = index;
    while (index < repairedMask.length && repairedMask[index] === 1) {
      index++;
    }
    const frameEnd = index - 1;
    const startCenter = (track.timestamps[frameStart] ?? 0) * sampleRate;
    const endCenter = (track.timestamps[frameEnd] ?? 0) * sampleRate;
    const startSample = clamp(Math.round(startCenter - hop * 0.5), 0, sourceLength);
    const endSample = clamp(Math.round(endCenter + hop * 0.5), startSample + 1, sourceLength);
    voicedRegions.push({ startSample, endSample, frameStart, frameEnd });
  }

  return {
    repairedTrack: {
      pitchTrack: repairedPitch,
      voicedProbabilities: repairedVoicedProbabilities,
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
    const regionMarks = marks.filter((mark) => mark >= region.startSample && mark < region.endSample);
    if (regionMarks.length < 2) {
      return false;
    }
    let spacingSum = 0;
    let maxSpacing = 0;
    for (let index = 1; index < regionMarks.length; index++) {
      const spacing = regionMarks[index]! - regionMarks[index - 1]!;
      spacingSum += spacing;
      maxSpacing = Math.max(maxSpacing, spacing);
    }
    const averageSpacing = spacingSum / Math.max(1, regionMarks.length - 1);
    const coverageSlack = Math.max(128, Math.round(Math.max(maxSpacing, averageSpacing) * 2.5));
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
    const framePos: number[] = [];
    const f0s: number[] = [];
    for (let frame = region.frameStart; frame <= region.frameEnd; frame++) {
      const pitch = track.pitchTrack[frame] ?? 0;
      if (pitch <= 0) continue;
      framePos.push((track.timestamps[frame] ?? 0) * sampleRate - region.startSample);
      f0s.push(pitch);
    }
    const regionMarks = makePitchMarks(segment, framePos, f0s, sampleRate)
      .map((mark) => mark + region.startSample);
    for (const mark of regionMarks) {
      if (marks.length === 0 || mark > (marks[marks.length - 1] ?? -1)) {
        marks.push(mark);
      }
    }
  }
  return marks.length >= 2 ? marks : undefined;
}

function prepareSourcePlan(args: {
  monoSource: Float32Array;
  track: PitchTrack;
  sampleRate: number;
  providedMarks: number[] | undefined;
  voicedThreshold: number;
  maximumGapSeconds?: number;
  minimumVoicedRunSeconds?: number;
}): PreparedSourcePlan {
  const {
    monoSource,
    track,
    sampleRate,
    providedMarks,
    voicedThreshold,
    maximumGapSeconds = 0.06,
    minimumVoicedRunSeconds = 0.02,
  } = args;
  const { repairedTrack, voicedRegions } = repairVoicedTrack(
    track,
    sampleRate,
    monoSource.length,
    { voicedThreshold, maximumGapSeconds, minimumVoicedRunSeconds },
  );
  const reusedProvidedMarks = validateSourceMarks(providedMarks, voicedRegions, monoSource.length);
  const sourceMarks = reusedProvidedMarks
    ? providedMarks
    : generateMarksForVoicedRegions(monoSource, repairedTrack, voicedRegions, sampleRate);
  return { repairedTrack, sourceMarks, voicedRegions, reusedProvidedMarks, voicedThreshold };
}

function normalizeBuffer(buf: Float32Array): void {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i] ?? 0);
    if (a > max) max = a;
  }
  if (max > 1) {
    const scale = 0.95 / max;
    for (let i = 0; i < buf.length; i++) {
      buf[i] = (buf[i] ?? 0) * scale;
    }
  }
}

function estimateMarkPeriod(marks: number[], index: number): number {
  if (marks.length < 2) return 1;
  const prev = marks[Math.max(0, index - 1)] ?? marks[index] ?? 0;
  const current = marks[index] ?? prev;
  const next = marks[Math.min(marks.length - 1, index + 1)] ?? current;
  const fromPrev = Math.max(1, current - prev);
  const toNext = Math.max(1, next - current);
  return Math.max(1, Math.round((fromPrev + toNext) * 0.5));
}

function blendSegment(
  destination: Float32Array,
  segment: Float32Array,
  start: number,
): void {
  const fadeLength = Math.min(64, Math.max(1, Math.floor(segment.length / 8)));

  for (let i = 0; i < segment.length; i++) {
    const dst = start + i;
    if (dst < 0 || dst >= destination.length) continue;

    let weight = 1;
    if (fadeLength > 1 && i < fadeLength) {
      weight = i / fadeLength;
    } else if (fadeLength > 1 && i >= segment.length - fadeLength) {
      weight = (segment.length - i - 1) / fadeLength;
    }
    weight = clamp(weight, 0, 1);

    const src = segment[i] ?? 0;
    const base = destination[dst] ?? 0;
    destination[dst] = base * (1 - weight) + src * weight;
  }
}

function tdpsolaTimeStretchSegment(
  segment: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  startFrame: number,
  endFrame: number,
  segmentStart: number,
  targetLength: number,
  precomputedMarks?: number[],
): Float32Array {
  const len = segment.length;
  const outLength = Math.max(1, Math.round(targetLength));
  if (len < 2 || outLength < 2) {
    return resampleLinear(segment, outLength);
  }

  const framePos: number[] = [];
  const f0s: number[] = [];
  for (let i = startFrame; i <= endFrame; i++) {
    const ts = track.timestamps[i];
    const f0 = track.pitchTrack[i];
    if (ts === undefined || f0 === undefined || f0 <= 0) continue;
    framePos.push(ts * sampleRate - segmentStart);
    f0s.push(f0);
  }

  const analysisMarks =
    precomputedMarks && precomputedMarks.length >= 2
      ? precomputedMarks
      : makePitchMarks(segment, framePos, f0s, sampleRate);
  if (analysisMarks.length < 2) {
    return resampleLinear(segment, outLength);
  }

  const windows = buildWindows(analysisMarks, len);
  if (windows.length === 0) {
    return resampleLinear(segment, outLength);
  }

  const base = resampleLinear(segment, outLength);
  const accum = new Float32Array(outLength);
  const windowSums = new Float32Array(outLength);
  const timeScale = outLength / len;
  let analysisIdx = 0;
  let synthPos = Math.round((analysisMarks[0] ?? 0) * timeScale);

  while (synthPos < outLength) {
    const sourcePos = clamp(synthPos / timeScale, 0, len - 1);

    while (
      analysisIdx + 1 < analysisMarks.length &&
      (analysisMarks[analysisIdx + 1] ?? sourcePos) <= sourcePos
    ) {
      analysisIdx++;
    }

    let k = analysisIdx;
    if (analysisIdx + 1 < analysisMarks.length) {
      const d0 = Math.abs((analysisMarks[analysisIdx] ?? sourcePos) - sourcePos);
      const d1 = Math.abs((analysisMarks[analysisIdx + 1] ?? sourcePos) - sourcePos);
      k = d1 < d0 ? analysisIdx + 1 : analysisIdx;
    }

    const win = windows[k];
    if (!win) break;

    const outStart = synthPos - win.centerOffset;
    for (let n = 0; n < win.window.length; n++) {
      const outIdx = outStart + n;
      const srcIdx = win.left + n;
      if (outIdx >= 0 && outIdx < outLength && srcIdx >= 0 && srcIdx < len) {
        const weight = win.window[n] ?? 0;
        accum[outIdx] =
          (accum[outIdx] ?? 0) + (segment[srcIdx] ?? 0) * weight;
        windowSums[outIdx] = (windowSums[outIdx] ?? 0) + weight;
      }
    }

    const f0 = interpF0(sourcePos, framePos, f0s);
    const period = f0 > 0
      ? Math.max(1, sampleRate / f0)
      : estimateMarkPeriod(analysisMarks, k);
    synthPos += Math.max(1, Math.round(period));
  }

  const out = base.slice();
  let covered = 0;
  for (let i = 0; i < out.length; i++) {
    const weight = windowSums[i] ?? 0;
    if (weight > 1e-6) {
      out[i] = (accum[i] ?? 0) / weight;
      covered++;
    }
  }

  if (covered === 0) {
    return base;
  }
  normalizeBuffer(out);
  return out;
}

export function tdpsolaTimeStretch(
  input: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  config: Partial<LocaVoiceDspConfig> | undefined,
  targetLength: number,
  analysisMarks?: number[],
  warpPlan?: ClipWarpPlan,
): Float32Array {
  const outLength = Math.max(1, Math.round(targetLength));
  if (input.length === 0) {
    return new Float32Array(outLength);
  }
  if (input.length === 1) {
    const out = new Float32Array(outLength);
    out.fill(input[0] ?? 0);
    return out;
  }
  if (track.pitchTrack.length === 0) {
    return renderWarpedLinear(
      input,
      outLength,
      normalizeWarpPlan(warpPlan, input.length, outLength),
    );
  }

  const cfg = resolveConfig(config);
  const effectiveWarpPlan = normalizeWarpPlan(warpPlan, input.length, outLength);
  const output = renderWarpedLinear(input, outLength, effectiveWarpPlan);
  const frameSize = cfg.frameSize;
  const hopSize = cfg.hopSize;

  const isVoiced = (i: number): boolean =>
    (track.pitchTrack[i] ?? 0) > 0 &&
    (track.voicedProbabilities[i] ?? 0) >= cfg.voicedThreshold;

  let i = 0;
  while (i < track.pitchTrack.length) {
    if (!isVoiced(i)) {
      i++;
      continue;
    }

    const startFrame = i;
    while (i < track.pitchTrack.length && isVoiced(i)) {
      i++;
    }
    const endFrame = i - 1;

    const segmentStart = startFrame * hopSize;
    const segmentEnd = Math.min(endFrame * hopSize + frameSize, input.length);
    if (segmentEnd <= segmentStart) continue;

    // Split the voiced overlay at warp boundaries so PSOLA follows the same
    // piecewise time mapping as the base warped render.
    const voicedPieces = intersectWarpPlanWithSourceRange(
      segmentStart,
      segmentEnd,
      effectiveWarpPlan,
    );
    for (const piece of voicedPieces) {
      const outStart = clamp(
        Math.round(piece.outputStartSample),
        0,
        outLength - 1,
      );
      const outEnd = clamp(
        Math.round(piece.outputEndSample),
        outStart + 1,
        outLength,
      );
      const voicedSegment = input.subarray(
        piece.sourceStartSample,
        piece.sourceEndSample,
      );
      const pieceTrack = slicePitchTrack(
        track,
        piece.sourceStartSample,
        piece.sourceEndSample,
        sampleRate,
      );
      const pieceTrackEnd = Math.max(0, pieceTrack.pitchTrack.length - 1);
      const stretchedVoiced = tdpsolaTimeStretchSegment(
        voicedSegment,
        sampleRate,
        pieceTrack,
        0,
        pieceTrackEnd,
        0,
        outEnd - outStart,
        slicePitchMarks(
          analysisMarks,
          piece.sourceStartSample,
          piece.sourceEndSample,
        ),
      );
      blendSegment(output, stretchedVoiced, outStart);
    }
  }

  normalizeBuffer(output);
  return output;
}

export function tdpsolaPitchShift(
  input: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  config: Partial<LocaVoiceDspConfig> | undefined,
  semitone: number,
  analysisMarks?: number[],
): Float32Array {
  if (Math.abs(semitone) < 1e-4 || track.pitchTrack.length === 0) {
    return input.slice();
  }

  const cfg = resolveConfig(config);
  const effectiveWarpPlan = normalizeWarpPlan(undefined, input.length, input.length);
  const preparedSource = prepareSourcePlan({
    monoSource: input,
    track,
    sampleRate,
    providedMarks: analysisMarks,
    voicedThreshold: cfg.voicedThreshold,
  });
  const schedule = buildOnePassSynthesisSchedule({
    operation: "pitch_only",
    monoSource: input,
    targetLength: input.length,
    sampleRate,
    preparedSource,
    warpPlan: effectiveWarpPlan,
    pitchSegments: undefined,
    totalPitchSemitones: semitone,
    config: cfg,
  });
  const { output } = renderScheduleChannel(input, input.length, effectiveWarpPlan, schedule);
  normalizeBuffer(output);
  return output;
}

// ---------------------------------------------------------------------------
// Segment-based pitch shifting
// ---------------------------------------------------------------------------

/** Short crossfade length at segment boundaries to avoid artifacts. */
const SEGMENT_CROSSFADE = 64;

/**
 * Apply segment-based pitch shifts to a time-stretched buffer.
 *
 * Each PitchSegment defines a sample range and the shift in cents.
 * Adjacent segments are crossfaded at boundaries.
 */
export function applyPitchSegmentsToBuffer(
  stretched: Float32Array,
  sampleRate: number,
  pitchCfg: Partial<LocaVoiceDspConfig> | undefined,
  segments: PitchSegment[],
  track?: PitchTrack,
  marks?: number[],
): Float32Array {
  if (segments.length === 0) return stretched.slice();

  const totalLen = stretched.length;
  const output = new Float32Array(totalLen);
  // Copy original as base (for gaps not covered by any segment)
  output.set(stretched);

  const stretchedTrack = track ?? analyzePitchLocaVoiceDsp(stretched, sampleRate, pitchCfg);

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    const semitones = seg.shiftCents / 100;

    // Clamp to buffer bounds
    const segStart = clamp(seg.startSample, 0, totalLen);
    const segEnd = clamp(seg.endSample, segStart, totalLen);
    if (segEnd <= segStart) continue;

    if (Math.abs(semitones) < 0.01) {
      // No shift needed -- keep the stretched data
      continue;
    }

    // Extract segment slice
    const segLen = segEnd - segStart;
    const segSlice = stretched.subarray(segStart, segEnd);
    const segTrack = slicePitchTrack(stretchedTrack, segStart, segEnd, sampleRate);
    const segMarks = slicePitchMarks(marks, segStart, segEnd);

    // Pitch shift this segment
    const shifted = tdpsolaPitchShift(
      segSlice,
      sampleRate,
      segTrack,
      pitchCfg,
      semitones,
      segMarks,
    );

    // Crossfade into the output
    const fadeLen = Math.min(SEGMENT_CROSSFADE, Math.floor(segLen / 4));

    for (let i = 0; i < segLen; i++) {
      const outIdx = segStart + i;
      if (outIdx >= totalLen) break;

      let weight = 1.0;
      if (fadeLen > 1 && i < fadeLen) {
        weight = i / fadeLen;
      } else if (fadeLen > 1 && i >= segLen - fadeLen) {
        weight = (segLen - i - 1) / fadeLen;
      }
      weight = clamp(weight, 0, 1);

      output[outIdx] = (shifted[i] ?? 0) * weight + (output[outIdx] ?? 0) * (1 - weight);
    }
  }

  normalizeBuffer(output);
  return output;
}

interface SynthesisEpoch {
  kind: "voiced" | "unvoiced" | "transient";
  outputCenter: number;
  sourceLeft: number;
  centerOffset: number;
  window: Float32Array;
}

interface SynthesisSchedule {
  epochs: SynthesisEpoch[];
  voicedInteriorMask: Uint8Array;
  initialCoverage: TdPsolaCoverageDiagnostics;
  finalCoverage: TdPsolaCoverageDiagnostics;
  insertedVoicedEpochs: number;
}

interface SynthesisCandidate {
  analysisSource: "local" | "provided";
  preparedSource: PreparedSourcePlan;
  schedule: SynthesisSchedule;
}

function isIdentityWarpPlan(warpPlan: ClipWarpPlan): boolean {
  return warpPlan.kind === "linear" &&
    warpPlan.segments.length === 1 &&
    warpPlan.segments[0]?.outputStartSample === 0 &&
    warpPlan.segments[0]?.sourceStartSample === 0 &&
    warpPlan.segments[0]?.outputEndSample === warpPlan.segments[0]?.sourceEndSample;
}

function inferRenderOperation(
  targetSamples: number,
  sourceLength: number,
  totalPitchSemitones: number,
  pitchSegments: PitchSegment[] | undefined,
  warpPlan: ClipWarpPlan,
): ClipTdPsolaOperation {
  const hasPitch = (pitchSegments?.length ?? 0) > 0 || Math.abs(totalPitchSemitones) >= 0.01;
  const hasExactPitchOnlyTiming = isIdentityWarpPlan(warpPlan) && targetSamples === sourceLength;
  const hasStretch = !isIdentityWarpPlan(warpPlan) || targetSamples !== sourceLength;
  if (hasPitch) {
    return hasExactPitchOnlyTiming ? "pitch_only" : "combined";
  }
  return hasStretch ? "stretch_only" : "bypass";
}

function resolvePitchShiftCentsAtSample(
  sample: number,
  pitchSegments: PitchSegment[] | undefined,
  totalPitchSemitones: number,
): number {
  if (!pitchSegments || pitchSegments.length === 0) {
    return totalPitchSemitones * 100;
  }
  for (const segment of pitchSegments) {
    if (sample >= segment.startSample && sample < segment.endSample) {
      return segment.shiftCents;
    }
  }
  return 0;
}

function computeMaxPitchShiftSemitones(
  pitchSegments: PitchSegment[] | undefined,
  totalPitchSemitones: number,
): number {
  let maxShift = Math.abs(totalPitchSemitones);
  for (const segment of pitchSegments ?? []) {
    maxShift = Math.max(maxShift, Math.abs(segment.shiftCents / 100));
  }
  return maxShift;
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
  while (index < length && (timestamps[index] ?? 0) < positionSec) {
    index++;
  }
  const leftIndex = Math.max(0, index - 1);
  const rightIndex = Math.min(length - 1, index);
  const leftTime = timestamps[leftIndex] ?? 0;
  const rightTime = timestamps[rightIndex] ?? leftTime;
  const leftValue = values[leftIndex] ?? 0;
  const rightValue = values[rightIndex] ?? leftValue;
  if (Math.abs(rightTime - leftTime) < 1e-9) {
    return leftValue;
  }
  const t = clamp((positionSec - leftTime) / (rightTime - leftTime), 0, 1);
  return leftValue + (rightValue - leftValue) * t;
}

function sampleTrackState(
  track: PitchTrack,
  sampleRate: number,
  sourceSample: number,
  voicedThreshold: number,
): { pitchHz: number; voicedProbability: number; voiced: boolean } {
  const positionSec = clamp(sourceSample / sampleRate, 0, Number.POSITIVE_INFINITY);
  const pitchHz = interpolateTrackArray(track.pitchTrack, track.timestamps, positionSec);
  const voicedProbability = interpolateTrackArray(
    track.voicedProbabilities,
    track.timestamps,
    positionSec,
  );
  return {
    pitchHz,
    voicedProbability,
    voiced: pitchHz > 0 && voicedProbability >= voicedThreshold,
  };
}

function buildTransientMask(samples: Float32Array, hopSize: number): Uint8Array {
  const hop = Math.max(16, Math.round(hopSize));
  const frame = hop * 2;
  const count = Math.max(1, Math.ceil(samples.length / hop));
  const flux = new Float32Array(count);

  for (let index = 0; index < count; index++) {
    const start = index * hop;
    const end = Math.min(samples.length, start + frame);
    let value = 0;
    for (let i = start; i < end; i++) {
      const current = Math.abs(samples[i] ?? 0);
      const previous = Math.abs(samples[i - hop] ?? 0);
      value += Math.max(0, current - previous);
    }
    flux[index] = value;
  }

  let meanFlux = 0;
  for (const value of flux) meanFlux += value;
  meanFlux /= Math.max(1, flux.length);
  const threshold = Math.max(0.01, meanFlux * 2.5);
  const mask = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    if ((flux[index] ?? 0) < threshold) continue;
    mask[index] = 1;
    if (index > 0) mask[index - 1] = 1;
    if (index + 1 < count) mask[index + 1] = 1;
  }
  return mask;
}

function isTransientAtSample(mask: Uint8Array, hopSize: number, sourceSample: number): boolean {
  const hop = Math.max(1, Math.round(hopSize));
  const index = clamp(Math.floor(sourceSample / hop), 0, Math.max(0, mask.length - 1));
  return mask[index] === 1;
}

function findNearestMarkIndex(marks: number[], sourceSample: number): number {
  if (marks.length <= 1) return 0;
  let low = 0;
  let high = marks.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((marks[mid] ?? 0) < sourceSample) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const right = low;
  const left = Math.max(0, right - 1);
  const rightDistance = Math.abs((marks[right] ?? sourceSample) - sourceSample);
  const leftDistance = Math.abs((marks[left] ?? sourceSample) - sourceSample);
  return leftDistance <= rightDistance ? left : right;
}

function buildFixedWindow(length: number, transient: boolean): Float32Array {
  const size = Math.max(32, Math.round(length));
  const window = new Float32Array(size);
  if (size === 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < size; i++) {
    const phase = i / (size - 1);
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    window[i] = transient ? Math.sqrt(Math.max(0, hann)) : hann;
  }
  return window;
}

function buildOutputVoicedInteriorMask(
  voicedRegions: VoicedRegion[],
  warpPlan: ClipWarpPlan,
  targetLength: number,
): Uint8Array {
  const mask = new Uint8Array(targetLength);
  for (const region of voicedRegions) {
    const outputStart = clamp(
      Math.floor(mapSourceSampleToOutputSample(region.startSample, warpPlan)),
      0,
      targetLength,
    );
    const outputEnd = clamp(
      Math.ceil(mapSourceSampleToOutputSample(region.endSample, warpPlan)),
      outputStart,
      targetLength,
    );
    for (let i = outputStart; i < outputEnd; i++) {
      mask[i] = 1;
    }
  }
  return mask;
}

function buildOnePassSynthesisSchedule(args: {
  operation: ClipTdPsolaOperation;
  monoSource: Float32Array;
  targetLength: number;
  sampleRate: number;
  preparedSource: PreparedSourcePlan;
  warpPlan: ClipWarpPlan;
  pitchSegments: PitchSegment[] | undefined;
  totalPitchSemitones: number;
  config: LocaVoiceDspConfig;
}): SynthesisSchedule {
  const {
    operation,
    monoSource,
    targetLength,
    sampleRate,
    preparedSource,
    warpPlan,
    pitchSegments,
    totalPitchSemitones,
    config,
  } = args;
  const effectiveSourceMarks = preparedSource.sourceMarks;
  const voicedWindows = effectiveSourceMarks ? buildWindows(effectiveSourceMarks, monoSource.length) : [];
  const transientHop = Math.max(32, Math.floor(config.hopSize / 2));
  const transientMask = buildTransientMask(monoSource, transientHop);
  const epochs: SynthesisEpoch[] = [];
  const maxEpochs = Math.max(512, targetLength * 4);
  const voicedInteriorMask = buildOutputVoicedInteriorMask(
    preparedSource.voicedRegions,
    warpPlan,
    targetLength,
  );

  let outputCenter = 0;
  let guard = 0;
  while (outputCenter < targetLength && guard < maxEpochs) {
    guard++;
    const sourcePosition = mapOutputSampleToSourceSample(outputCenter, warpPlan);
    const trackState = sampleTrackState(
      preparedSource.repairedTrack,
      sampleRate,
      sourcePosition,
      config.voicedThreshold,
    );
    const transient = operation !== "pitch_only" && isTransientAtSample(transientMask, transientHop, sourcePosition);
    const pitchSemitones = operation === "stretch_only"
      ? 0
      : resolvePitchShiftCentsAtSample(outputCenter, pitchSegments, totalPitchSemitones) / 100;
    const pitchFactor = Math.max(0.25, Math.pow(2, pitchSemitones / 12));

    if (!transient && effectiveSourceMarks && voicedWindows.length > 0 && trackState.voiced) {
      const markIndex = findNearestMarkIndex(effectiveSourceMarks, sourcePosition);
      const sourceWindow = voicedWindows[markIndex]!;
      const period = trackState.pitchHz > 0
        ? sampleRate / trackState.pitchHz
        : estimateMarkPeriod(effectiveSourceMarks, markIndex);
      epochs.push({
        kind: "voiced",
        outputCenter: Math.round(outputCenter),
        sourceLeft: sourceWindow.left,
        centerOffset: sourceWindow.centerOffset,
        window: sourceWindow.window,
      });
      outputCenter += clamp(Math.round(period / pitchFactor), 16, config.frameSize);
      continue;
    }

    const transientWindow = transient;
    const baseStep = transientWindow
      ? Math.max(24, Math.round(config.hopSize * 0.75))
      : Math.max(32, config.hopSize);
    const window = buildFixedWindow(baseStep * (transientWindow ? 4 : 3), transientWindow);
    const centerOffset = Math.floor(window.length / 2);
    epochs.push({
      kind: transientWindow ? "transient" : "unvoiced",
      outputCenter: Math.round(outputCenter),
      sourceLeft: Math.round(sourcePosition) - centerOffset,
      centerOffset,
      window,
    });
    outputCenter += baseStep;
  }

  const initialCoverage = measureScheduleCoverage(targetLength, epochs, voicedInteriorMask);
  return {
    epochs,
    voicedInteriorMask,
    initialCoverage,
    finalCoverage: initialCoverage,
    insertedVoicedEpochs: 0,
  };
}

function renderScheduleChannel(
  source: Float32Array,
  targetLength: number,
  warpPlan: ClipWarpPlan,
  schedule: SynthesisSchedule,
): { output: Float32Array; voicedMask: Float32Array } {
  const accum = new Float32Array(targetLength);
  const weights = new Float32Array(targetLength);
  const voicedWeights = new Float32Array(targetLength);
  const fallback = renderWarpedLinear(source, targetLength, warpPlan);

  for (const epoch of schedule.epochs) {
    const outputStart = epoch.outputCenter - epoch.centerOffset;
    for (let index = 0; index < epoch.window.length; index++) {
      const outIndex = outputStart + index;
      const srcIndex = epoch.sourceLeft + index;
      if (outIndex < 0 || outIndex >= targetLength || srcIndex < 0 || srcIndex >= source.length) {
        continue;
      }
      const weight = epoch.window[index] ?? 0;
      accum[outIndex] = (accum[outIndex] ?? 0) + (source[srcIndex] ?? 0) * weight;
      weights[outIndex] = (weights[outIndex] ?? 0) + weight;
      if (epoch.kind === "voiced") {
        voicedWeights[outIndex] = (voicedWeights[outIndex] ?? 0) + weight;
      }
    }
  }

  const output = new Float32Array(targetLength);
  const voicedMask = new Float32Array(targetLength);
  const voicedInteriorMask = schedule.voicedInteriorMask;
  for (let i = 0; i < targetLength; i++) {
    const weight = weights[i] ?? 0;
    if (weight > 1e-6) {
      output[i] = (accum[i] ?? 0) / weight;
      voicedMask[i] = clamp((voicedWeights[i] ?? 0) / weight, 0, 1);
    } else if (voicedInteriorMask[i] !== 1) {
      output[i] = fallback[i] ?? 0;
      voicedMask[i] = 0;
    } else {
      let left = i - 1;
      while (left >= 0 && (weights[left] ?? 0) <= 1e-6) {
        left--;
      }
      let right = i + 1;
      while (right < targetLength && (weights[right] ?? 0) <= 1e-6) {
        right++;
      }
      if (left >= 0 && right < targetLength) {
        const leftValue = (accum[left] ?? 0) / Math.max(1e-6, weights[left] ?? 0);
        const rightValue = (accum[right] ?? 0) / Math.max(1e-6, weights[right] ?? 0);
        const t = (i - left) / Math.max(1, right - left);
        output[i] = leftValue + (rightValue - leftValue) * t;
        voicedMask[i] = clamp(
          ((voicedWeights[left] ?? 0) / Math.max(1e-6, weights[left] ?? 0)) * (1 - t) +
            ((voicedWeights[right] ?? 0) / Math.max(1e-6, weights[right] ?? 0)) * t,
          0,
          1,
        );
      } else if (left >= 0) {
        output[i] = (accum[left] ?? 0) / Math.max(1e-6, weights[left] ?? 0);
        voicedMask[i] = clamp((voicedWeights[left] ?? 0) / Math.max(1e-6, weights[left] ?? 0), 0, 1);
      } else if (right < targetLength) {
        output[i] = (accum[right] ?? 0) / Math.max(1e-6, weights[right] ?? 0);
        voicedMask[i] = clamp(
          (voicedWeights[right] ?? 0) / Math.max(1e-6, weights[right] ?? 0),
          0,
          1,
        );
      } else {
        output[i] = fallback[i] ?? 0;
        voicedMask[i] = 0;
      }
    }
  }
  return { output, voicedMask };
}

function computeLpcCoefficients(samples: Float32Array, order: number): Float32Array | null {
  const effectiveOrder = Math.max(2, Math.min(order, 24, samples.length - 1));
  if (effectiveOrder < 2) return null;

  const autocorrelation = new Float32Array(effectiveOrder + 1);
  for (let lag = 0; lag <= effectiveOrder; lag++) {
    let sum = 0;
    for (let i = lag; i < samples.length; i++) {
      sum += (samples[i] ?? 0) * (samples[i - lag] ?? 0);
    }
    autocorrelation[lag] = sum;
  }
  if ((autocorrelation[0] ?? 0) <= 1e-8) {
    return null;
  }

  const coeffs = new Float32Array(effectiveOrder + 1);
  coeffs[0] = 1;
  let error = autocorrelation[0] ?? 0;

  for (let i = 1; i <= effectiveOrder; i++) {
    let acc = autocorrelation[i] ?? 0;
    for (let j = 1; j < i; j++) {
      acc -= (coeffs[j] ?? 0) * (autocorrelation[i - j] ?? 0);
    }
    const reflection = clamp(acc / Math.max(error, 1e-8), -0.99, 0.99);
    const next = Float32Array.from(coeffs);
    next[i] = reflection;
    for (let j = 1; j < i; j++) {
      next[j] = (coeffs[j] ?? 0) - reflection * (coeffs[i - j] ?? 0);
    }
    coeffs.set(next);
    error *= 1 - reflection * reflection;
    if (error <= 1e-8) break;
  }

  return coeffs.subarray(1);
}

function applyLpcInverseFilter(signal: Float32Array, coeffs: Float32Array): Float32Array {
  const output = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let sample = signal[i] ?? 0;
    for (let j = 0; j < coeffs.length; j++) {
      const history = i - j - 1;
      if (history < 0) break;
      sample -= (coeffs[j] ?? 0) * (signal[history] ?? 0);
    }
    output[i] = sample;
  }
  return output;
}

function applyLpcSynthesisFilter(signal: Float32Array, coeffs: Float32Array): Float32Array {
  const output = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let sample = signal[i] ?? 0;
    for (let j = 0; j < coeffs.length; j++) {
      const history = i - j - 1;
      if (history < 0) break;
      sample += (coeffs[j] ?? 0) * (output[history] ?? 0);
    }
    output[i] = sample;
  }
  return output;
}

function maybeApplyFormantPreservation(args: {
  enabled: boolean;
  operation: ClipTdPsolaOperation;
  maxPitchSemitones: number;
  rendered: Float32Array;
  sourceReference: Float32Array;
  voicedMask: Float32Array;
  sampleRate: number;
}): Float32Array {
  const {
    enabled,
    operation,
    maxPitchSemitones,
    rendered,
    sourceReference,
    voicedMask,
    sampleRate,
  } = args;
  if (!enabled || operation === "stretch_only" || maxPitchSemitones < 2.5) {
    return rendered;
  }

  const maskedSource = new Float32Array(sourceReference.length);
  const maskedRendered = new Float32Array(rendered.length);
  for (let i = 0; i < rendered.length; i++) {
    const weight = Math.sqrt(clamp(voicedMask[i] ?? 0, 0, 1));
    maskedSource[i] = (sourceReference[i] ?? 0) * weight;
    maskedRendered[i] = (rendered[i] ?? 0) * weight;
  }

  const order = clamp(Math.round(sampleRate / 4_000), 8, 16);
  const sourceCoeffs = computeLpcCoefficients(maskedSource, order);
  const renderedCoeffs = computeLpcCoefficients(maskedRendered, order);
  if (!sourceCoeffs || !renderedCoeffs) {
    return rendered;
  }

  const residual = applyLpcInverseFilter(rendered, renderedCoeffs);
  const compensated = applyLpcSynthesisFilter(residual, sourceCoeffs);
  const blend = clamp((maxPitchSemitones - 2.5) / 8, 0.2, 0.75);
  const mixed = rendered.slice();
  for (let i = 0; i < rendered.length; i++) {
    const weight = blend * clamp(voicedMask[i] ?? 0, 0, 1);
    mixed[i] = (rendered[i] ?? 0) * (1 - weight) + (compensated[i] ?? 0) * weight;
  }
  return mixed;
}

/**
 * Render one clip with explicit bypass/stretch-only/pitch-only/combined paths.
 *
 * Non-bypass rendering builds one linked synthesis schedule from source-domain
 * analysis and final output intent, then overlap-adds each channel with the
 * shared schedule instead of running stretch and pitch as separate stages.
 */
export function renderAudioClipTdPsolaData(
  options: RenderTdPsolaDataOptions,
): AudioBufferData | null {
  const {
    inputBuffer,
    sourceInFrame,
    sourceOutFrame,
    targetDurationSec,
    totalPitchSemitones,
    pitchSegments,
    warpPlan,
    sourceF0Track,
    sourcePitchMarks,
    renderOperation,
    preserveFormant,
    config,
    selectionPolicy,
    diagnosticsCollector,
  } = options;

  const inputLength = getAudioBufferLength(inputBuffer);
  const start = clamp(Math.round(sourceInFrame), 0, inputLength - 1);
  const end = clamp(Math.round(sourceOutFrame), start + 1, inputLength);
  const sourceLength = end - start;
  if (sourceLength <= 1 || targetDurationSec <= 0) return null;

  const sampleRate = getAudioBufferSampleRate(inputBuffer);
  const targetSamples = Math.max(1, Math.round(targetDurationSec * sampleRate));
  const resolvedConfig = resolveConfig(config);
  const resolvedSelectionPolicy = resolveSelectionPolicy(selectionPolicy);
  const effectiveWarpPlan = normalizeWarpPlan(warpPlan, sourceLength, targetSamples);
  const operation = renderOperation ?? inferRenderOperation(
    targetSamples,
    sourceLength,
    totalPitchSemitones,
    pitchSegments,
    effectiveWarpPlan,
  );

  const monoSource = extractMonoSegment(inputBuffer, start, end);
  const analysisConfig = fitConfigToTargetLength(resolvedConfig, sourceLength);
  const localSourceTrack = analyzePitchLocaVoiceDsp(monoSource, sampleRate, analysisConfig);
  const rawProvidedSourceTrack = sourceF0Track
    ? pitchTrackFromF0Artifact(sourceF0Track, start, end)
    : null;
  const providedSourceTrack = rawProvidedSourceTrack
    ? alignProvidedPitchTrackToLocalGrid(
        localSourceTrack,
        rawProvidedSourceTrack,
        sampleRate,
        analysisConfig.voicedThreshold,
      )
    : null;
  const providedSourceMarks = sourcePitchMarks
    ? localPitchMarksFromArtifact(sourcePitchMarks.marks_src_frames, start, end)
    : undefined;
  const maxPitchSemitones = computeMaxPitchShiftSemitones(pitchSegments, totalPitchSemitones);
  const renderedChannels: Float32Array[] = [];
  const renderConfig = fitConfigToTargetLength(resolvedConfig, targetSamples);
  const localPreparedSource = prepareSourcePlan({
    monoSource,
    track: localSourceTrack,
    sampleRate,
    providedMarks: providedSourceMarks,
    voicedThreshold: analysisConfig.voicedThreshold,
  });
  const candidates: SynthesisCandidate[] = operation === "bypass"
    ? []
    : [{
        analysisSource: "local",
        preparedSource: localPreparedSource,
        schedule: buildOnePassSynthesisSchedule({
          operation,
          monoSource,
          targetLength: targetSamples,
          sampleRate,
          preparedSource: localPreparedSource,
          warpPlan: effectiveWarpPlan,
          pitchSegments,
          totalPitchSemitones,
          config: renderConfig,
        }),
      }];
  if (operation !== "bypass" && providedSourceTrack) {
    const providedPreparedSource = prepareSourcePlan({
      monoSource,
      track: providedSourceTrack,
      sampleRate,
      providedMarks: providedSourceMarks,
      voicedThreshold: analysisConfig.voicedThreshold,
    });
    candidates.push({
      analysisSource: "provided",
      preparedSource: providedPreparedSource,
      schedule: buildOnePassSynthesisSchedule({
        operation,
        monoSource,
        targetLength: targetSamples,
        sampleRate,
        preparedSource: providedPreparedSource,
        warpPlan: effectiveWarpPlan,
        pitchSegments,
        totalPitchSemitones,
        config: renderConfig,
      }),
    });
  }
  const selected = operation === "bypass"
    ? null
    : selectPreferredSynthesisCandidate(candidates, resolvedSelectionPolicy);
  const selectedCandidate = selected?.candidate ?? null;
  const preparedSource = selectedCandidate?.preparedSource ?? localPreparedSource;
  const schedule = selectedCandidate?.schedule ?? makeEmptySynthesisSchedule(targetSamples);
  const analysisSource = selectedCandidate?.analysisSource ?? "local";
  const candidateDiagnostics = candidates.map(candidateToDiagnostics);
  const localPreparedCandidate = candidates.find((candidate) => candidate.analysisSource === "local")?.preparedSource;
  const providedPreparedCandidate = candidates.find((candidate) => candidate.analysisSource === "provided")?.preparedSource;
  const candidateComparison = localPreparedCandidate && providedPreparedCandidate
    ? compareVoicedTrackDiagnostics(localPreparedCandidate, providedPreparedCandidate)
    : undefined;
  const selectionDecision: TdPsolaSelectionDecision = selected?.decision ?? {
    criterion: "bypass",
    winner: "local",
  };

  diagnosticsCollector?.({
    analysisSource,
    selectionPolicy: resolvedSelectionPolicy,
    operation,
    sourceLength,
    targetLength: targetSamples,
    voicedRegionCount: preparedSource.voicedRegions.length,
    sourceMarkCount: preparedSource.sourceMarks?.length ?? 0,
    reusedProvidedMarks: preparedSource.reusedProvidedMarks,
    epochCounts: {
      voiced: schedule.epochs.filter((epoch) => epoch.kind === "voiced").length,
      unvoiced: schedule.epochs.filter((epoch) => epoch.kind === "unvoiced").length,
      transient: schedule.epochs.filter((epoch) => epoch.kind === "transient").length,
    },
    initialCoverage: schedule.initialCoverage,
    finalCoverage: schedule.finalCoverage,
    insertedVoicedEpochs: schedule.insertedVoicedEpochs,
    candidates: candidateDiagnostics,
    candidateComparison,
    selectionDecision,
  });

  for (let channelIndex = 0; channelIndex < getAudioBufferChannelCount(inputBuffer); channelIndex++) {
    const sourceChannel = getAudioBufferChannelData(inputBuffer, channelIndex).subarray(start, end);
    const { output, voicedMask } = renderScheduleChannel(
      sourceChannel,
      targetSamples,
      effectiveWarpPlan,
      schedule,
    );
    const sourceReference = renderWarpedLinear(sourceChannel, targetSamples, effectiveWarpPlan);
    renderedChannels.push(maybeApplyFormantPreservation({
      enabled: preserveFormant ?? false,
      operation,
      maxPitchSemitones,
      rendered: output,
      sourceReference,
      voicedMask,
      sampleRate,
    }));
  }

  applyFinalSafetyLimiter(renderedChannels);

  const rendered = createAudioBufferData(
    getAudioBufferChannelCount(inputBuffer),
    targetSamples,
    sampleRate,
  );
  for (let channelIndex = 0; channelIndex < renderedChannels.length; channelIndex++) {
    rendered.channels[channelIndex]?.set(renderedChannels[channelIndex] ?? new Float32Array(targetSamples));
  }
  return rendered;
}

export function renderAudioClipTdPsola(options: RenderTdPsolaOptions): AudioBuffer | null {
  const { context, ...rest } = options;
  const rendered = renderAudioClipTdPsolaData(rest);
  return rendered ? audioBufferDataToAudioBuffer(context, rendered) : null;
}

interface ClipRenderKeyParts {
  mediaIdentity: string;
  sourceIn: number;
  sourceOut: number;
  lengthTick: number;
  /** Combined pitch shift in semitones (manual + follow). */
  totalPitchSemitones: number;
  /** Serialized pitch segments for cache invalidation. */
  pitchSegmentsKey?: string;
  /** Serialized warp segments for cache invalidation. */
  warpPlanKey?: string;
  /** Serialized source-analysis signature for cache invalidation. */
  analysisKey?: string;
  timePitchMode: TimePitchModeKind;
  backend?:
    | "direct"
    | "voice_tdpsola"
    | "source_native_tdpsola"
    | "music_phase_vocoder";
  backendVersion?: string;
  analysisPolicy?: string;
  renderOperation?: ClipTdPsolaOperation;
  preserveFormant?: boolean;
  bpm: number;
  ppq: number;
  mediaSampleRate: number;
}

export function makeTdPsolaClipKey(parts: ClipRenderKeyParts): string {
  return [
    "tdpsola-v11",
    parts.mediaIdentity,
    parts.sourceIn,
    parts.sourceOut,
    parts.lengthTick,
    parts.totalPitchSemitones.toFixed(6),
    parts.pitchSegmentsKey ?? "",
    parts.warpPlanKey ?? "",
    parts.analysisKey ?? "",
    parts.timePitchMode,
    parts.backend ?? "voice_tdpsola",
    parts.backendVersion ?? "voice-tdpsola-v1",
    parts.analysisPolicy ?? "",
    parts.renderOperation ?? "",
    parts.preserveFormant ? "formant-on" : "formant-off",
    parts.bpm.toFixed(6),
    parts.ppq,
    parts.mediaSampleRate,
  ].join("|");
}
