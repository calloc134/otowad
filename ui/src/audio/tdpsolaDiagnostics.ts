import type { ClipTdPsolaOperation } from "./directClipRender.ts";

type AnalysisSource = "local" | "provided";

interface TdPsolaSelectionPolicyLike {
  tieBreakPreference: "provided" | "local";
  hardRejectProvidedCoverageInflationRatio?: number;
}

interface TdPsolaCoverageDiagnosticsLike {
  totalSamples: number;
  coveredSamples: number;
  fallbackSamples: number;
  voicedInteriorSamples: number;
  voicedInteriorFallbackSamples: number;
  voicedInteriorFallbackRuns: number;
  maxVoicedInteriorFallbackRun: number;
}

interface TdPsolaCandidateDiagnosticsLike {
  analysisSource: AnalysisSource;
  voicedRegionCount: number;
  sourceMarkCount: number;
  reusedProvidedMarks: boolean;
  epochCounts: {
    voiced: number;
    unvoiced: number;
    transient: number;
  };
  initialCoverage: TdPsolaCoverageDiagnosticsLike;
  finalCoverage: TdPsolaCoverageDiagnosticsLike;
  insertedVoicedEpochs: number;
}

interface TdPsolaCandidateComparisonDiagnosticsLike {
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

interface TdPsolaSelectionDecisionLike {
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
  winner: AnalysisSource;
  loser?: AnalysisSource;
  winnerValue?: number | string;
  loserValue?: number | string;
  threshold?: number;
}

interface TdPsolaRenderDiagnosticsLike {
  analysisSource: AnalysisSource;
  selectionPolicy: TdPsolaSelectionPolicyLike;
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
  initialCoverage: TdPsolaCoverageDiagnosticsLike;
  finalCoverage: TdPsolaCoverageDiagnosticsLike;
  insertedVoicedEpochs: number;
  candidates: TdPsolaCandidateDiagnosticsLike[];
  candidateComparison?: TdPsolaCandidateComparisonDiagnosticsLike;
  selectionDecision: TdPsolaSelectionDecisionLike;
}

interface PitchTrackLike {
  pitchTrack: Float32Array;
  voicedProbabilities: Float32Array;
  timestamps: Float32Array;
}

interface VoicedRegionLike {
  startSample: number;
  endSample: number;
}

interface PreparedSourcePlanLike {
  repairedTrack: PitchTrackLike;
  sourceMarks: number[] | undefined;
  voicedRegions: VoicedRegionLike[];
  reusedProvidedMarks: boolean;
  voicedThreshold: number;
}

interface SynthesisEpochLike {
  kind: "voiced" | "unvoiced" | "transient";
  outputCenter: number;
  sourceLeft: number;
  centerOffset: number;
  window: Float32Array;
}

interface SynthesisScheduleLike {
  epochs: SynthesisEpochLike[];
  voicedInteriorMask: Uint8Array;
  initialCoverage: TdPsolaCoverageDiagnosticsLike;
  finalCoverage: TdPsolaCoverageDiagnosticsLike;
  insertedVoicedEpochs: number;
}

interface SynthesisCandidateLike {
  analysisSource: AnalysisSource;
  preparedSource: PreparedSourcePlanLike;
  schedule: SynthesisScheduleLike;
}

const DEFAULT_SELECTION_POLICY: TdPsolaSelectionPolicyLike = {
  tieBreakPreference: "local",
  hardRejectProvidedCoverageInflationRatio: 1.1,
};

const PROVIDED_DIVERGENCE_GUARDS = {
  minVoicedFrameJaccard: 0.9,
  maxMedianF0CentsError: 35,
  maxP95F0CentsError: 400,
  minF0Correlation: 0.75,
  maxVoicedEpochCountDelta: 6,
  maxSourceMarkSpacingMeanAbsDiff: 192,
  minSignalsToReject: 2,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function computeSpacingStats(values: number[]): { mean: number; p95: number } {
  if (values.length === 0) {
    return { mean: 0, p95: 0 };
  }
  return {
    mean: meanOf(values),
    p95: percentile(values, 0.95),
  };
}

function getSpacing(values: number[]): number[] {
  const spacing: number[] = [];
  for (let index = 1; index < values.length; index++) {
    spacing.push((values[index] ?? 0) - (values[index - 1] ?? 0));
  }
  return spacing;
}

export function resolveSelectionPolicy(
  policy?: Partial<TdPsolaSelectionPolicyLike>,
): TdPsolaSelectionPolicyLike {
  return {
    tieBreakPreference: policy?.tieBreakPreference ?? DEFAULT_SELECTION_POLICY.tieBreakPreference,
    hardRejectProvidedCoverageInflationRatio: (() => {
      const value = policy?.hardRejectProvidedCoverageInflationRatio
        ?? DEFAULT_SELECTION_POLICY.hardRejectProvidedCoverageInflationRatio;
      return value !== undefined && Number.isFinite(value)
        ? Math.max(1, value)
        : undefined;
    })(),
  };
}

export function candidateToDiagnostics(
  candidate: SynthesisCandidateLike,
): TdPsolaCandidateDiagnosticsLike {
  return {
    analysisSource: candidate.analysisSource,
    voicedRegionCount: candidate.preparedSource.voicedRegions.length,
    sourceMarkCount: candidate.preparedSource.sourceMarks?.length ?? 0,
    reusedProvidedMarks: candidate.preparedSource.reusedProvidedMarks,
    epochCounts: {
      voiced: candidate.schedule.epochs.filter((epoch) => epoch.kind === "voiced").length,
      unvoiced: candidate.schedule.epochs.filter((epoch) => epoch.kind === "unvoiced").length,
      transient: candidate.schedule.epochs.filter((epoch) => epoch.kind === "transient").length,
    },
    initialCoverage: candidate.schedule.initialCoverage,
    finalCoverage: candidate.schedule.finalCoverage,
    insertedVoicedEpochs: candidate.schedule.insertedVoicedEpochs,
  };
}

export function compareVoicedTrackDiagnostics(
  local: PreparedSourcePlanLike,
  provided: PreparedSourcePlanLike,
): TdPsolaCandidateComparisonDiagnosticsLike {
  const localTrack = local.repairedTrack;
  const providedTrack = provided.repairedTrack;
  const frameCount = Math.min(
    localTrack.pitchTrack.length,
    providedTrack.pitchTrack.length,
    localTrack.voicedProbabilities.length,
    providedTrack.voicedProbabilities.length,
    localTrack.timestamps.length,
    providedTrack.timestamps.length,
  );
  let unionVoicedFrames = 0;
  let sharedVoicedFrames = 0;
  let voicedFrameDisagreement = 0;
  const centsErrors: number[] = [];
  const correlationPairs: Array<{ x: number; y: number }> = [];
  const timestampDeltas: number[] = [];
  for (let index = 0; index < frameCount; index++) {
    const localPitch = localTrack.pitchTrack[index] ?? 0;
    const providedPitch = providedTrack.pitchTrack[index] ?? 0;
    const localVoiced =
      localPitch > 0 && (localTrack.voicedProbabilities[index] ?? 0) >= local.voicedThreshold;
    const providedVoiced =
      providedPitch > 0 &&
      (providedTrack.voicedProbabilities[index] ?? 0) >= provided.voicedThreshold;
    const localTimestamp = localTrack.timestamps[index] ?? 0;
    const providedTimestamp = providedTrack.timestamps[index] ?? 0;
    timestampDeltas.push(Math.abs(localTimestamp - providedTimestamp));
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

  const localVoicedEpochs = local.sourceMarks?.length ?? 0;
  const providedVoicedEpochs = provided.sourceMarks?.length ?? 0;
  const localEpochSpacing = getSpacing(local.sourceMarks ?? []);
  const providedEpochSpacing = getSpacing(provided.sourceMarks ?? []);
  const epochSpacingDiffs: number[] = [];
  for (let index = 0; index < Math.min(localEpochSpacing.length, providedEpochSpacing.length); index++) {
    epochSpacingDiffs.push(Math.abs((localEpochSpacing[index] ?? 0) - (providedEpochSpacing[index] ?? 0)));
  }
  const sourceMarkSpacingStats = computeSpacingStats(epochSpacingDiffs);

  return {
    sharedVoicedFrames,
    voicedFrameJaccard: unionVoicedFrames > 0 ? sharedVoicedFrames / unionVoicedFrames : 1,
    voicedFrameDisagreement,
    medianF0CentsError: percentile(centsErrors, 0.5),
    p95F0CentsError: percentile(centsErrors, 0.95),
    f0Correlation: correlationOf(correlationPairs),
    localEpochCount: localVoicedEpochs,
    providedEpochCount: providedVoicedEpochs,
    voicedEpochCountDelta: Math.abs(localVoicedEpochs - providedVoicedEpochs),
    voicedEpochSpacingMeanAbsDiff: sourceMarkSpacingStats.mean,
    voicedEpochSpacingP95AbsDiff: sourceMarkSpacingStats.p95,
    sourceMarkSpacingMeanAbsDiff: sourceMarkSpacingStats.mean,
    sourceMarkSpacingP95AbsDiff: sourceMarkSpacingStats.p95,
    timestampMeanAbsDeltaSec: meanOf(timestampDeltas),
    timestampMaxAbsDeltaSec: timestampDeltas.length > 0 ? Math.max(...timestampDeltas) : 0,
  };
}

function countProvidedDivergenceSignals(
  comparison: TdPsolaCandidateComparisonDiagnosticsLike,
): number {
  let signals = 0;
  if (comparison.voicedFrameJaccard < PROVIDED_DIVERGENCE_GUARDS.minVoicedFrameJaccard) {
    signals++;
  }
  if (comparison.medianF0CentsError > PROVIDED_DIVERGENCE_GUARDS.maxMedianF0CentsError) {
    signals++;
  }
  if (comparison.p95F0CentsError > PROVIDED_DIVERGENCE_GUARDS.maxP95F0CentsError) {
    signals++;
  }
  if (comparison.f0Correlation < PROVIDED_DIVERGENCE_GUARDS.minF0Correlation) {
    signals++;
  }
  if (comparison.voicedEpochCountDelta > PROVIDED_DIVERGENCE_GUARDS.maxVoicedEpochCountDelta) {
    signals++;
  }
  if (
    comparison.sourceMarkSpacingMeanAbsDiff >
    PROVIDED_DIVERGENCE_GUARDS.maxSourceMarkSpacingMeanAbsDiff
  ) {
    signals++;
  }
  return signals;
}

export function compareSynthesisCandidates(
  left: SynthesisCandidateLike,
  right: SynthesisCandidateLike,
  selectionPolicy: TdPsolaSelectionPolicyLike,
): { preferred: SynthesisCandidateLike; decision: TdPsolaSelectionDecisionLike } {
  const localCandidate = left.analysisSource === "local" ? left : right.analysisSource === "local" ? right : null;
  const providedCandidate = left.analysisSource === "provided"
    ? left
    : right.analysisSource === "provided"
    ? right
    : null;
  const candidateComparison = localCandidate && providedCandidate
    ? compareVoicedTrackDiagnostics(localCandidate.preparedSource, providedCandidate.preparedSource)
    : undefined;
  if (localCandidate && providedCandidate) {
    const localVoiced = localCandidate.schedule.initialCoverage.voicedInteriorSamples;
    const providedVoiced = providedCandidate.schedule.initialCoverage.voicedInteriorSamples;
    const ratio = providedVoiced / Math.max(1, localVoiced);
    if (
      selectionPolicy.hardRejectProvidedCoverageInflationRatio !== undefined &&
      ratio > selectionPolicy.hardRejectProvidedCoverageInflationRatio
    ) {
      return {
        preferred: localCandidate,
        decision: {
          criterion: "provided_coverage_hard_reject",
          winner: "local",
          loser: "provided",
          winnerValue: localVoiced,
          loserValue: providedVoiced,
          threshold: selectionPolicy.hardRejectProvidedCoverageInflationRatio,
        },
      };
    }
  }

  const divergenceSignals = candidateComparison
    ? countProvidedDivergenceSignals(candidateComparison)
    : 0;
  if (
    localCandidate &&
    providedCandidate &&
    candidateComparison &&
    divergenceSignals >= PROVIDED_DIVERGENCE_GUARDS.minSignalsToReject
  ) {
    return {
      preferred: localCandidate,
      decision: {
        criterion: "provided_divergence_reject",
        winner: "local",
        loser: "provided",
        winnerValue: divergenceSignals,
        threshold: PROVIDED_DIVERGENCE_GUARDS.minSignalsToReject,
      },
    };
  }

  const leftFallback = left.schedule.initialCoverage.voicedInteriorFallbackSamples;
  const rightFallback = right.schedule.initialCoverage.voicedInteriorFallbackSamples;
  if (leftFallback !== rightFallback) {
    return leftFallback < rightFallback
      ? {
          preferred: left,
          decision: {
            criterion: "voiced_interior_fallback",
            winner: left.analysisSource,
            loser: right.analysisSource,
            winnerValue: leftFallback,
            loserValue: rightFallback,
          },
        }
      : {
          preferred: right,
          decision: {
            criterion: "voiced_interior_fallback",
            winner: right.analysisSource,
            loser: left.analysisSource,
            winnerValue: rightFallback,
            loserValue: leftFallback,
          },
        };
  }

  const leftVoiced = left.schedule.initialCoverage.voicedInteriorSamples;
  const rightVoiced = right.schedule.initialCoverage.voicedInteriorSamples;
  const voicedGap = Math.abs(leftVoiced - rightVoiced);
  const voicedThreshold = Math.max(256, Math.round(Math.min(leftVoiced, rightVoiced) * 0.1));
  if (voicedGap > voicedThreshold) {
    return leftVoiced < rightVoiced
      ? {
          preferred: left,
          decision: {
            criterion: "voiced_coverage_conservative",
            winner: left.analysisSource,
            loser: right.analysisSource,
            winnerValue: leftVoiced,
            loserValue: rightVoiced,
            threshold: voicedThreshold,
          },
        }
      : {
          preferred: right,
          decision: {
            criterion: "voiced_coverage_conservative",
            winner: right.analysisSource,
            loser: left.analysisSource,
            winnerValue: rightVoiced,
            loserValue: leftVoiced,
            threshold: voicedThreshold,
          },
        };
  }

  if (left.analysisSource !== right.analysisSource) {
    const preferProvided = selectionPolicy.tieBreakPreference === "provided";
    return (left.analysisSource === "provided") === preferProvided
      ? {
          preferred: left,
          decision: {
            criterion: "analysis_source_tiebreak",
            winner: left.analysisSource,
            loser: right.analysisSource,
          },
        }
      : {
          preferred: right,
          decision: {
            criterion: "analysis_source_tiebreak",
            winner: right.analysisSource,
            loser: left.analysisSource,
          },
        };
  }

  const leftEpochCount = left.schedule.epochs.length;
  const rightEpochCount = right.schedule.epochs.length;
  if (leftEpochCount !== rightEpochCount) {
    return leftEpochCount < rightEpochCount
      ? {
          preferred: left,
          decision: {
            criterion: "epoch_count",
            winner: left.analysisSource,
            loser: right.analysisSource,
            winnerValue: leftEpochCount,
            loserValue: rightEpochCount,
          },
        }
      : {
          preferred: right,
          decision: {
            criterion: "epoch_count",
            winner: right.analysisSource,
            loser: left.analysisSource,
            winnerValue: rightEpochCount,
            loserValue: leftEpochCount,
          },
        };
  }

  const leftMarkCount = left.preparedSource.sourceMarks?.length ?? 0;
  const rightMarkCount = right.preparedSource.sourceMarks?.length ?? 0;
  if (leftMarkCount !== rightMarkCount) {
    return leftMarkCount < rightMarkCount
      ? {
          preferred: left,
          decision: {
            criterion: "source_mark_count",
            winner: left.analysisSource,
            loser: right.analysisSource,
            winnerValue: leftMarkCount,
            loserValue: rightMarkCount,
          },
        }
      : {
          preferred: right,
          decision: {
            criterion: "source_mark_count",
            winner: right.analysisSource,
            loser: left.analysisSource,
            winnerValue: rightMarkCount,
            loserValue: leftMarkCount,
          },
        };
  }

  return {
    preferred: left,
    decision: {
      criterion: "stable_order",
      winner: left.analysisSource,
      loser: right.analysisSource,
    },
  };
}

export function computeCoverageWeights(
  targetLength: number,
  epochs: SynthesisEpochLike[],
): Float32Array {
  const weights = new Float32Array(targetLength);
  for (const epoch of epochs) {
    const outputStart = epoch.outputCenter - epoch.centerOffset;
    for (let index = 0; index < epoch.window.length; index++) {
      const outIndex = outputStart + index;
      if (outIndex < 0 || outIndex >= targetLength) continue;
      weights[outIndex] = (weights[outIndex] ?? 0) + (epoch.window[index] ?? 0);
    }
  }
  return weights;
}

export function measureScheduleCoverage(
  targetLength: number,
  epochs: SynthesisEpochLike[],
  voicedInteriorMask: Uint8Array,
): TdPsolaCoverageDiagnosticsLike {
  const weights = computeCoverageWeights(targetLength, epochs);
  let coveredSamples = 0;
  let voicedInteriorSamples = 0;
  let voicedInteriorFallbackSamples = 0;
  let voicedInteriorFallbackRuns = 0;
  let maxVoicedInteriorFallbackRun = 0;
  let currentVoicedInteriorFallbackRun = 0;

  for (let index = 0; index < targetLength; index++) {
    const covered = (weights[index] ?? 0) > 1e-6;
    if (covered) {
      coveredSamples++;
    }

    if (voicedInteriorMask[index] === 1) {
      voicedInteriorSamples++;
      if (!covered) {
        voicedInteriorFallbackSamples++;
        currentVoicedInteriorFallbackRun++;
        continue;
      }
    }

    if (currentVoicedInteriorFallbackRun > 0) {
      voicedInteriorFallbackRuns++;
      maxVoicedInteriorFallbackRun = Math.max(
        maxVoicedInteriorFallbackRun,
        currentVoicedInteriorFallbackRun,
      );
      currentVoicedInteriorFallbackRun = 0;
    }
  }

  if (currentVoicedInteriorFallbackRun > 0) {
    voicedInteriorFallbackRuns++;
    maxVoicedInteriorFallbackRun = Math.max(
      maxVoicedInteriorFallbackRun,
      currentVoicedInteriorFallbackRun,
    );
  }

  return {
    totalSamples: targetLength,
    coveredSamples,
    fallbackSamples: targetLength - coveredSamples,
    voicedInteriorSamples,
    voicedInteriorFallbackSamples,
    voicedInteriorFallbackRuns,
    maxVoicedInteriorFallbackRun,
  };
}

export function makeEmptyCoverageDiagnostics(
  targetLength: number,
): TdPsolaCoverageDiagnosticsLike {
  return {
    totalSamples: targetLength,
    coveredSamples: 0,
    fallbackSamples: targetLength,
    voicedInteriorSamples: 0,
    voicedInteriorFallbackSamples: 0,
    voicedInteriorFallbackRuns: 0,
    maxVoicedInteriorFallbackRun: 0,
  };
}

export function makeEmptySynthesisSchedule(
  targetLength: number,
): SynthesisScheduleLike {
  const emptyCoverage = makeEmptyCoverageDiagnostics(targetLength);
  return {
    epochs: [],
    voicedInteriorMask: new Uint8Array(targetLength),
    initialCoverage: emptyCoverage,
    finalCoverage: emptyCoverage,
    insertedVoicedEpochs: 0,
  };
}

export function selectPreferredSynthesisCandidate(
  candidates: SynthesisCandidateLike[],
  selectionPolicy: TdPsolaSelectionPolicyLike,
): { candidate: SynthesisCandidateLike; decision: TdPsolaSelectionDecisionLike } {
  if (candidates.length === 0) {
    throw new Error("Expected at least one synthesis candidate.");
  }
  if (candidates.length === 1) {
    return {
      candidate: candidates[0]!,
      decision: {
        criterion: "only_candidate",
        winner: candidates[0]!.analysisSource,
      },
    };
  }

  let best = candidates[0]!;
  let decision: TdPsolaSelectionDecisionLike = {
    criterion: "stable_order",
    winner: best.analysisSource,
  };
  for (let index = 1; index < candidates.length; index++) {
    const compared = compareSynthesisCandidates(best, candidates[index]!, selectionPolicy);
    best = compared.preferred;
    decision = compared.decision;
  }

  return { candidate: best, decision };
}

export type {
  TdPsolaSelectionPolicyLike,
  TdPsolaCoverageDiagnosticsLike,
  TdPsolaCandidateDiagnosticsLike,
  TdPsolaCandidateComparisonDiagnosticsLike,
  TdPsolaSelectionDecisionLike,
  TdPsolaRenderDiagnosticsLike,
};
