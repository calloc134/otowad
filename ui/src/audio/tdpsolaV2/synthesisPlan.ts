import { mapOutputSampleToSourceSample, mapSourceSampleToOutputSample } from "../tdpsolaWarp.ts";
import type { PitchSegment } from "../pitchPlan.ts";
import type {
  BuildSourceNativeSynthesisPlanArgs,
  SourceNativeSynthesisMark,
  SourceNativeSynthesisPlan,
  SourceNativeSynthesisPlanDiagnostics,
} from "./types.ts";

const DEFAULT_MAX_SYNTHESIS_MARK_COUNT = 1_000_000;
const MINIMUM_PROGRESS_SAMPLES = 1e-6;

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function validateSourceMarks(sourceMarks: readonly number[]): void {
  if (sourceMarks.length < 2) {
    throw new RangeError("sourceMarks must contain at least two accepted marks");
  }

  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < sourceMarks.length; index++) {
    const mark = sourceMarks[index]!;
    assertFinite(mark, `sourceMarks[${index}]`);
    if (mark <= previous) {
      throw new RangeError("sourceMarks must be strictly increasing");
    }
    previous = mark;
  }
}

function validatePitchSegments(pitchSegments: readonly PitchSegment[] | undefined): void {
  if (!pitchSegments) return;

  let previousEnd = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pitchSegments.length; index++) {
    const segment = pitchSegments[index]!;
    assertFinite(segment.startSample, `pitchSegments[${index}].startSample`);
    assertFinite(segment.endSample, `pitchSegments[${index}].endSample`);
    assertFinite(segment.shiftCents, `pitchSegments[${index}].shiftCents`);
    if (segment.endSample <= segment.startSample) {
      throw new RangeError("pitchSegments must have positive, half-open ranges");
    }
    if (segment.startSample < previousEnd) {
      throw new RangeError("pitchSegments must be sorted and non-overlapping");
    }
    previousEnd = segment.endSample;
  }
}

function resolveShiftCents(
  outputCenterSample: number,
  pitchSegments: readonly PitchSegment[] | undefined,
  defaultShiftCents: number,
): number {
  if (!pitchSegments || pitchSegments.length === 0) {
    return defaultShiftCents;
  }

  for (const segment of pitchSegments) {
    if (
      outputCenterSample >= segment.startSample &&
      outputCenterSample < segment.endSample
    ) {
      return segment.shiftCents;
    }
    if (segment.startSample > outputCenterSample) break;
  }
  return defaultShiftCents;
}

function findNearestSourceMarkIndex(
  sourceMarks: readonly number[],
  desiredSourceSample: number,
  minimumIndex: number,
): number {
  const lastIndex = sourceMarks.length - 1;
  if (desiredSourceSample <= sourceMarks[minimumIndex]!) return minimumIndex;
  if (desiredSourceSample >= sourceMarks[lastIndex]!) return lastIndex;

  let low = minimumIndex;
  let high = lastIndex;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (sourceMarks[middle]! < desiredSourceSample) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const rightIndex = low;
  const leftIndex = Math.max(minimumIndex, rightIndex - 1);
  const leftDistance = Math.abs(desiredSourceSample - sourceMarks[leftIndex]!);
  const rightDistance = Math.abs(sourceMarks[rightIndex]! - desiredSourceSample);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

function estimateLocalSourcePeriod(
  sourceMarks: readonly number[],
  sourceMarkIndex: number,
): number {
  if (sourceMarkIndex === 0) {
    return sourceMarks[1]! - sourceMarks[0]!;
  }
  if (sourceMarkIndex === sourceMarks.length - 1) {
    return sourceMarks[sourceMarkIndex]! - sourceMarks[sourceMarkIndex - 1]!;
  }
  return (sourceMarks[sourceMarkIndex + 1]! - sourceMarks[sourceMarkIndex - 1]!) / 2;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function safeFrequency(sampleRate: number, periodSamples: number): number {
  return periodSamples > 0 ? sampleRate / periodSamples : 0;
}

function buildDiagnostics(
  marks: readonly SourceNativeSynthesisMark[],
  sourceMarks: readonly number[],
  sampleRate: number,
): SourceNativeSynthesisPlanDiagnostics {
  if (marks.length === 0) {
    return {
      synthesisMarkCount: 0,
      uniqueSourceMarkCount: 0,
      repeatedSourceMarkCount: 0,
      advancedSourceMarkCount: 0,
      skippedSourceMarkCount: 0,
      firstSourceMarkIndex: -1,
      lastSourceMarkIndex: -1,
      sourceSpanCoverageRatio: 0,
      medianSourcePeriodSamples: 0,
      medianTargetOutputPeriodSamples: 0,
      medianPlannedOutputPeriodSamples: 0,
      medianSourceF0Hz: 0,
      medianTargetF0Hz: 0,
      medianPlannedF0Hz: 0,
    };
  }

  const uniqueIndices = new Set(marks.map((mark) => mark.sourceMarkIndex));
  const localPeriods = marks.map((mark) => mark.localSourcePeriodSamples);
  const targetPeriods = marks.map((mark) => mark.targetOutputPeriodSamples);
  const plannedPeriods = marks.slice(0, -1).map(
    (mark, index) => marks[index + 1]!.outputCenterSample - mark.outputCenterSample,
  );
  const firstSourceMarkIndex = marks[0]!.sourceMarkIndex;
  const lastSourceMarkIndex = marks[marks.length - 1]!.sourceMarkIndex;
  const fullSourceSpan = sourceMarks[sourceMarks.length - 1]! - sourceMarks[0]!;
  const coveredSourceSpan = sourceMarks[lastSourceMarkIndex]! - sourceMarks[firstSourceMarkIndex]!;
  const medianSourcePeriodSamples = median(localPeriods);
  const medianTargetOutputPeriodSamples = median(targetPeriods);
  const medianPlannedOutputPeriodSamples = median(plannedPeriods);

  return {
    synthesisMarkCount: marks.length,
    uniqueSourceMarkCount: uniqueIndices.size,
    repeatedSourceMarkCount: marks.filter((mark) => mark.selection === "repeat").length,
    advancedSourceMarkCount: marks.filter((mark) => mark.selection === "advance").length,
    skippedSourceMarkCount: marks.reduce(
      (total, mark) => total + mark.skippedSourceMarkCount,
      0,
    ),
    firstSourceMarkIndex,
    lastSourceMarkIndex,
    sourceSpanCoverageRatio: fullSourceSpan > 0 ? coveredSourceSpan / fullSourceSpan : 0,
    medianSourcePeriodSamples,
    medianTargetOutputPeriodSamples,
    medianPlannedOutputPeriodSamples,
    medianSourceF0Hz: safeFrequency(sampleRate, medianSourcePeriodSamples),
    medianTargetF0Hz: safeFrequency(sampleRate, medianTargetOutputPeriodSamples),
    medianPlannedF0Hz: safeFrequency(sampleRate, medianPlannedOutputPeriodSamples),
  };
}

/**
 * Build a deterministic synthesis-mark sequence without reading audio.
 *
 * Warp selects the desired source time. Pitch changes only the distance between
 * output marks. Source grains remain centered on accepted source marks, and a
 * monotonic nearest-mark cursor realizes stretch/pitch as repeat and skip.
 */
export function buildSourceNativeSynthesisPlan({
  sourceMarks,
  warpPlan,
  outputStartSample,
  outputEndSample,
  initialOutputCenterSample,
  pitchSegments,
  defaultShiftCents = 0,
  sampleRate,
  maxSynthesisMarkCount = DEFAULT_MAX_SYNTHESIS_MARK_COUNT,
}: BuildSourceNativeSynthesisPlanArgs): SourceNativeSynthesisPlan {
  validateSourceMarks(sourceMarks);
  validatePitchSegments(pitchSegments);
  assertFinite(outputStartSample, "outputStartSample");
  assertFinite(outputEndSample, "outputEndSample");
  assertFinite(defaultShiftCents, "defaultShiftCents");
  assertFinite(sampleRate, "sampleRate");
  if (outputEndSample <= outputStartSample) {
    throw new RangeError("output range must be positive");
  }
  if (sampleRate <= 0) {
    throw new RangeError("sampleRate must be positive");
  }
  if (!Number.isInteger(maxSynthesisMarkCount) || maxSynthesisMarkCount <= 0) {
    throw new RangeError("maxSynthesisMarkCount must be a positive integer");
  }

  const firstOutputCenter = initialOutputCenterSample ??
    mapSourceSampleToOutputSample(sourceMarks[0]!, warpPlan);
  assertFinite(firstOutputCenter, "initialOutputCenterSample");
  if (firstOutputCenter < outputStartSample || firstOutputCenter >= outputEndSample) {
    throw new RangeError("initial output center must be inside the output range");
  }

  const marks: SourceNativeSynthesisMark[] = [];
  let outputCenterSample = firstOutputCenter;
  let previousSourceMarkIndex = 0;

  while (outputCenterSample < outputEndSample) {
    if (marks.length >= maxSynthesisMarkCount) {
      throw new RangeError("synthesis mark count exceeded maxSynthesisMarkCount");
    }

    const desiredSourceSample = mapOutputSampleToSourceSample(outputCenterSample, warpPlan);
    const sourceMarkIndex = findNearestSourceMarkIndex(
      sourceMarks,
      desiredSourceSample,
      previousSourceMarkIndex,
    );
    const sourceCenterSample = sourceMarks[sourceMarkIndex]!;
    const localSourcePeriodSamples = estimateLocalSourcePeriod(sourceMarks, sourceMarkIndex);
    const shiftCents = resolveShiftCents(
      outputCenterSample,
      pitchSegments,
      defaultShiftCents,
    );
    const pitchRatio = 2 ** (shiftCents / 1200);
    const targetOutputPeriodSamples = localSourcePeriodSamples / pitchRatio;
    if (
      !Number.isFinite(targetOutputPeriodSamples) ||
      targetOutputPeriodSamples < MINIMUM_PROGRESS_SAMPLES
    ) {
      throw new RangeError("pitch shift produced an invalid output period");
    }

    const first = marks.length === 0;
    const skippedSourceMarkCount = first
      ? 0
      : Math.max(0, sourceMarkIndex - previousSourceMarkIndex - 1);
    marks.push({
      outputCenterSample,
      desiredSourceSample,
      sourceMarkIndex,
      sourceCenterSample,
      localSourcePeriodSamples,
      shiftCents,
      pitchRatio,
      targetOutputPeriodSamples,
      selection: first
        ? "first"
        : sourceMarkIndex === previousSourceMarkIndex
        ? "repeat"
        : "advance",
      skippedSourceMarkCount,
    });

    previousSourceMarkIndex = sourceMarkIndex;
    outputCenterSample += targetOutputPeriodSamples;
  }

  return {
    outputStartSample,
    outputEndSample,
    marks,
    diagnostics: buildDiagnostics(marks, sourceMarks, sampleRate),
  };
}
