import { mapSourceSampleToOutputSample } from "../tdpsolaWarp.ts";
import { applyFinalSafetyLimiter } from "./outputSafety.ts";
import { renderSourceNativePlan } from "./sourceNativeRenderer.ts";
import { buildSourceNativeSynthesisPlan } from "./synthesisPlan.ts";
import { renderUnvoicedTimeStretchBase } from "./unvoicedTimeStretch.ts";
import type {
  RenderSourceNativeRegionsArgs,
  SourceNativeRendererDiagnostics,
  SourceNativeRegionDiagnostics,
  SourceNativeRegionRenderResult,
} from "./types.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateRegions(args: RenderSourceNativeRegionsArgs): void {
  if (!Number.isInteger(args.outputLength) || args.outputLength <= 0) {
    throw new RangeError("outputLength must be a positive integer");
  }
  if (args.sourceChannels.length === 0) {
    throw new RangeError("sourceChannels must contain at least one channel");
  }
  const sourceLength = args.sourceChannels[0]!.length;
  if (args.sourceChannels.some((channel) => channel.length !== sourceLength)) {
    throw new RangeError("all source channels must have the same length");
  }
  const sourceOffsetSamples = args.sourceOffsetSamples ?? 0;
  const clipSourceLength = Math.max(
    0,
    ...args.warpPlan.segments.map((segment) => segment.sourceEndSample),
  );
  if (
    !Number.isInteger(sourceOffsetSamples) ||
    sourceOffsetSamples < 0 ||
    sourceOffsetSamples + clipSourceLength > sourceLength
  ) {
    throw new RangeError("sourceOffsetSamples must retain the complete clip source range");
  }

  let previousRegionEnd = Number.NEGATIVE_INFINITY;
  for (const region of args.voicedRegions) {
    if (
      !Number.isFinite(region.startSample) ||
      !Number.isFinite(region.endSample) ||
      region.endSample <= region.startSample
    ) {
      throw new RangeError("voiced regions must have finite, positive ranges");
    }
    if (region.startSample < previousRegionEnd) {
      throw new RangeError("voiced regions must be sorted and non-overlapping");
    }
    previousRegionEnd = region.endSample;
  }
}

function mapSourceSampleWithBoundaryExtrapolation(
  sourceSample: number,
  args: RenderSourceNativeRegionsArgs,
): number {
  const segments = args.warpPlan.segments;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return 0;

  if (sourceSample < first.sourceStartSample) {
    const sourceSpan = first.sourceEndSample - first.sourceStartSample;
    const outputSpan = first.outputEndSample - first.outputStartSample;
    return sourceSpan > 0
      ? first.outputStartSample +
        (sourceSample - first.sourceStartSample) * outputSpan / sourceSpan
      : first.outputStartSample;
  }
  if (sourceSample > last.sourceEndSample) {
    const sourceSpan = last.sourceEndSample - last.sourceStartSample;
    const outputSpan = last.outputEndSample - last.outputStartSample;
    return sourceSpan > 0
      ? last.outputEndSample +
        (sourceSample - last.sourceEndSample) * outputSpan / sourceSpan
      : last.outputEndSample;
  }
  return mapSourceSampleToOutputSample(sourceSample, args.warpPlan);
}

function collectRegionMarksWithGuards(
  sourceMarks: readonly number[],
  regionStartSample: number,
  regionEndSample: number,
): {
  marks: number[];
  coreMarkCount: number;
  leftGuardMarkCount: number;
  rightGuardMarkCount: number;
} {
  const firstCoreIndex = sourceMarks.findIndex(
    (mark) => mark >= regionStartSample && mark < regionEndSample,
  );
  if (firstCoreIndex < 0) {
    return {
      marks: [],
      coreMarkCount: 0,
      leftGuardMarkCount: 0,
      rightGuardMarkCount: 0,
    };
  }
  let lastCoreIndex = firstCoreIndex;
  while (
    lastCoreIndex + 1 < sourceMarks.length &&
    sourceMarks[lastCoreIndex + 1]! < regionEndSample
  ) {
    lastCoreIndex++;
  }
  const singleCoreNeighborPeriods = firstCoreIndex === lastCoreIndex
    ? [
        firstCoreIndex > 0
          ? sourceMarks[firstCoreIndex]! - sourceMarks[firstCoreIndex - 1]!
          : Number.POSITIVE_INFINITY,
        firstCoreIndex + 1 < sourceMarks.length
          ? sourceMarks[firstCoreIndex + 1]! - sourceMarks[firstCoreIndex]!
          : Number.POSITIVE_INFINITY,
      ]
    : [];
  const singleCorePeriod = Math.min(...singleCoreNeighborPeriods);
  const leadingCorePeriod = firstCoreIndex < lastCoreIndex
    ? sourceMarks[firstCoreIndex + 1]! - sourceMarks[firstCoreIndex]!
    : singleCorePeriod;
  const trailingCorePeriod = firstCoreIndex < lastCoreIndex
    ? sourceMarks[lastCoreIndex]! - sourceMarks[lastCoreIndex - 1]!
    : singleCorePeriod;
  let guardStartIndex = firstCoreIndex;
  while (guardStartIndex > 0 && firstCoreIndex - guardStartIndex < 2) {
    const gap = sourceMarks[guardStartIndex]! - sourceMarks[guardStartIndex - 1]!;
    if (gap > leadingCorePeriod * 2.5) break;
    guardStartIndex--;
  }
  let guardEndIndex = lastCoreIndex + 1;
  while (guardEndIndex < sourceMarks.length && guardEndIndex - lastCoreIndex <= 2) {
    const gap = sourceMarks[guardEndIndex]! - sourceMarks[guardEndIndex - 1]!;
    if (gap > trailingCorePeriod * 2.5) break;
    guardEndIndex++;
  }
  return {
    marks: sourceMarks.slice(guardStartIndex, guardEndIndex),
    coreMarkCount: lastCoreIndex - firstCoreIndex + 1,
    leftGuardMarkCount: firstCoreIndex - guardStartIndex,
    rightGuardMarkCount: guardEndIndex - lastCoreIndex - 1,
  };
}

function boundaryWeight(
  localOutputSample: number,
  regionLength: number,
  fadeInSamples: number,
  fadeOutSamples: number,
): number {
  let weight = 1;
  if (fadeInSamples > 0 && localOutputSample < fadeInSamples) {
    const phase = localOutputSample / fadeInSamples;
    weight *= Math.sin((Math.PI / 2) * phase) ** 2;
  }
  const samplesFromEnd = regionLength - 1 - localOutputSample;
  if (fadeOutSamples > 0 && samplesFromEnd < fadeOutSamples) {
    const phase = samplesFromEnd / fadeOutSamples;
    weight *= Math.sin((Math.PI / 2) * phase) ** 2;
  }
  return clamp(weight, 0, 1);
}

/**
 * Render voiced regions through the v2 source-native core over a unit-step
 * OLA base for unvoiced/transient time stretch. Internal region boundaries
 * use at least 24 ms or one local target period of equal-power fade.
 *
 * Those two numbers are a deliberate, replaceable policy rather than tuned
 * constants: 24 ms is long enough to hide a boundary at speech rates, and one
 * target period keeps the fade from spanning less than a full cycle at low F0.
 * Change them together with the parity fixtures, not on their own.
 */
export function renderSourceNativeRegions(
  args: RenderSourceNativeRegionsArgs,
): SourceNativeRegionRenderResult {
  validateRegions(args);
  const {
    sourceChannels,
    sourceOffsetSamples = 0,
    sourceMarks,
    voicedRegions,
    warpPlan,
    outputLength,
    pitchSegments,
    defaultShiftCents = 0,
    sampleRate,
    blockSize,
  } = args;

  const channels = renderUnvoicedTimeStretchBase({
    sourceChannels,
    sourceOffsetSamples,
    warpPlan,
    outputLength,
  });
  const replacedMask = new Uint8Array(outputLength);
  const channelDiagnostics: SourceNativeRendererDiagnostics[] = sourceChannels.map(() => ({
    grainCount: 0,
    sourceReadStep: 1,
    maxPendingTailSamples: 0,
    zeroPaddedSourceReadCount: 0,
    periodicExtendedSourceReadCount: 0,
    committedOutputSamples: 0,
  }));
  const regions: SourceNativeRegionDiagnostics[] = [];
  let renderedRegionCount = 0;
  let skippedRegionCount = 0;

  for (const region of voicedRegions) {
    const regionMarkSelection = collectRegionMarksWithGuards(
      sourceMarks,
      region.startSample,
      region.endSample,
    );
    const regionMarks = regionMarkSelection.marks;
    const outputStartSample = clamp(
      Math.floor(mapSourceSampleToOutputSample(region.startSample, warpPlan)),
      0,
      outputLength,
    );
    const outputEndSample = clamp(
      Math.ceil(mapSourceSampleToOutputSample(region.endSample, warpPlan)),
      outputStartSample,
      outputLength,
    );
    const hasValidLeftGuard = regionMarkSelection.leftGuardMarkCount > 0 &&
      sourceOffsetSamples + regionMarks[0]! >= 0;
    const hasValidRightGuard = regionMarkSelection.rightGuardMarkCount > 0 &&
      sourceOffsetSamples + regionMarks[regionMarks.length - 1]! <
        sourceChannels[0]!.length;
    const usesLeftCycleExtension = outputStartSample === 0 && !hasValidLeftGuard;
    const usesRightCycleExtension = outputEndSample === outputLength &&
      !hasValidRightGuard;
    const diagnostics: SourceNativeRegionDiagnostics = {
      sourceStartSample: region.startSample,
      sourceEndSample: region.endSample,
      outputStartSample,
      outputEndSample,
      sourceMarkCount: regionMarkSelection.coreMarkCount,
      leftGuardMarkCount: regionMarkSelection.leftGuardMarkCount,
      rightGuardMarkCount: regionMarkSelection.rightGuardMarkCount,
      leftEdgeCompletion: outputStartSample !== 0
        ? "crossfade"
        : hasValidLeftGuard ? "guard_context" : "nearest_cycle",
      rightEdgeCompletion: outputEndSample !== outputLength
        ? "crossfade"
        : hasValidRightGuard ? "guard_context" : "nearest_cycle",
      rendered: false,
    };

    if (
      regionMarkSelection.coreMarkCount < 1 ||
      regionMarks.length < 2 ||
      outputEndSample <= outputStartSample
    ) {
      skippedRegionCount++;
      regions.push(diagnostics);
      continue;
    }

    const firstGuardOutputCenter = mapSourceSampleWithBoundaryExtrapolation(
      regionMarks[0]!,
      args,
    );
    const lastGuardOutputCenter = mapSourceSampleWithBoundaryExtrapolation(
      regionMarks[regionMarks.length - 1]!,
      args,
    );
    const trailingGuardPeriod = regionMarks.length >= 2
      ? Math.abs(
          lastGuardOutputCenter -
            mapSourceSampleWithBoundaryExtrapolation(
              regionMarks[regionMarks.length - 2]!,
              args,
            ),
        )
      : 0;
    let initialOutputCenterSample = firstGuardOutputCenter;
    let renderStartSample = Math.floor(
      Math.min(outputStartSample, initialOutputCenterSample),
    );
    let renderEndSample = Math.ceil(
      Math.max(outputEndSample, lastGuardOutputCenter + trailingGuardPeriod),
    );
    const buildPlan = () => buildSourceNativeSynthesisPlan({
      sourceMarks: regionMarks,
      warpPlan,
      outputStartSample: renderStartSample,
      outputEndSample: renderEndSample,
      initialOutputCenterSample,
      pitchSegments,
      defaultShiftCents,
      sampleRate,
    });
    if (usesLeftCycleExtension) {
      // Keep the first accepted pitch mark as the phase anchor. Project that
      // synthesis phase backwards by complete target periods and repeat the
      // nearest accepted source cycle. Centering the first grain at sample 0
      // changes the phase whenever the first mark is not already at the edge.
      const phaseProbe = buildPlan();
      const leadingTargetPeriod = phaseProbe.marks[0]?.targetOutputPeriodSamples ?? 0;
      if (leadingTargetPeriod > 0) {
        while (
          initialOutputCenterSample - leadingTargetPeriod >= outputStartSample
        ) {
          initialOutputCenterSample -= leadingTargetPeriod;
        }
        initialOutputCenterSample -= leadingTargetPeriod;
        renderStartSample = Math.floor(initialOutputCenterSample);
      }
    }
    let plan = buildPlan();
    if (usesRightCycleExtension) {
      const trailingTargetPeriod = plan.marks[plan.marks.length - 1]
        ?.targetOutputPeriodSamples ?? 0;
      const cycleExtendedEnd = Math.ceil(outputEndSample + trailingTargetPeriod);
      if (cycleExtendedEnd > renderEndSample) {
        renderEndSample = cycleExtendedEnd;
        plan = buildPlan();
      }
    }
    const rendered = renderSourceNativePlan({
      sourceChannels,
      sourceOffsetSamples,
      sourceMarks: regionMarks,
      plan,
      blockSize,
      sourceBoundaryExtension: {
        ...(usesLeftCycleExtension
          ? {
              leftCycle: {
                startSample: regionMarks[0]!,
                endSample: regionMarks[1]!,
              },
            }
          : {}),
        ...(usesRightCycleExtension
          ? {
              rightCycle: {
                startSample: regionMarks[regionMarks.length - 2]!,
                endSample: regionMarks[regionMarks.length - 1]!,
              },
            }
          : {}),
      },
    });
    applyFinalSafetyLimiter(rendered.channels);
    const regionLength = outputEndSample - outputStartSample;
    const firstPeriod = plan.marks[0]?.targetOutputPeriodSamples ?? 0;
    const lastPeriod = plan.marks[plan.marks.length - 1]?.targetOutputPeriodSamples ?? 0;
    const minimumInternalBoundaryFade = Math.ceil(sampleRate * 0.024);
    const fadeInSamples = outputStartSample === 0 &&
        (hasValidLeftGuard || usesLeftCycleExtension)
      ? 0
      : Math.min(
          Math.max(Math.ceil(firstPeriod), minimumInternalBoundaryFade),
          Math.floor(regionLength / 2),
        );
    const fadeOutSamples = outputEndSample === outputLength &&
        (hasValidRightGuard || usesRightCycleExtension)
      ? 0
      : Math.min(
          Math.max(Math.ceil(lastPeriod), minimumInternalBoundaryFade),
          Math.floor(regionLength / 2),
        );
    const cropOffset = outputStartSample - renderStartSample;

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const destination = channels[channelIndex]!;
      const voiced = rendered.channels[channelIndex]!;
      for (let localSample = 0; localSample < regionLength; localSample++) {
        const outputSample = outputStartSample + localSample;
        const weight = boundaryWeight(
          localSample,
          regionLength,
          fadeInSamples,
          fadeOutSamples,
        );
        destination[outputSample] = (destination[outputSample] ?? 0) * (1 - weight) +
          (voiced[cropOffset + localSample] ?? 0) * weight;
        if (weight > 0) replacedMask[outputSample] = 1;
      }
    }

    diagnostics.rendered = true;
    diagnostics.synthesisPlan = plan.diagnostics;
    diagnostics.channelRenderer = rendered.channelDiagnostics;
    for (let channelIndex = 0; channelIndex < rendered.channelDiagnostics.length; channelIndex++) {
      const aggregate = channelDiagnostics[channelIndex]!;
      const regionChannel = rendered.channelDiagnostics[channelIndex]!;
      aggregate.grainCount += regionChannel.grainCount;
      aggregate.maxPendingTailSamples = Math.max(
        aggregate.maxPendingTailSamples,
        regionChannel.maxPendingTailSamples,
      );
      aggregate.zeroPaddedSourceReadCount += regionChannel.zeroPaddedSourceReadCount;
      aggregate.periodicExtendedSourceReadCount +=
        regionChannel.periodicExtendedSourceReadCount;
      aggregate.committedOutputSamples += regionChannel.committedOutputSamples;
    }
    renderedRegionCount++;
    regions.push(diagnostics);
  }

  let fallbackSampleCount = 0;
  for (const replaced of replacedMask) {
    if (replaced === 0) fallbackSampleCount++;
  }

  return {
    channels,
    channelDiagnostics,
    diagnostics: {
      renderedRegionCount,
      skippedRegionCount,
      fallbackSampleCount,
      regions,
    },
  };
}
