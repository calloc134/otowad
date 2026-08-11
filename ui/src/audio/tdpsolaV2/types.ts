import type { ClipWarpPlan, PitchSegment } from "../pitchPlan.ts";

export type SourceMarkSelection = "first" | "repeat" | "advance";

/**
 * One source-native PSOLA grain placement.
 *
 * `outputCenterSample` remains fractional. `sourceCenterSample` is always an
 * accepted source-domain pitch mark; pitch and warp never alter the sample
 * step inside the grain.
 */
export interface SourceNativeSynthesisMark {
  outputCenterSample: number;
  desiredSourceSample: number;
  sourceMarkIndex: number;
  sourceCenterSample: number;
  localSourcePeriodSamples: number;
  shiftCents: number;
  pitchRatio: number;
  targetOutputPeriodSamples: number;
  selection: SourceMarkSelection;
  skippedSourceMarkCount: number;
}

export interface SourceNativeSynthesisPlanDiagnostics {
  synthesisMarkCount: number;
  uniqueSourceMarkCount: number;
  repeatedSourceMarkCount: number;
  advancedSourceMarkCount: number;
  skippedSourceMarkCount: number;
  firstSourceMarkIndex: number;
  lastSourceMarkIndex: number;
  sourceSpanCoverageRatio: number;
  medianSourcePeriodSamples: number;
  medianTargetOutputPeriodSamples: number;
  medianPlannedOutputPeriodSamples: number;
  medianSourceF0Hz: number;
  medianTargetF0Hz: number;
  medianPlannedF0Hz: number;
}

export interface SourceNativeSynthesisPlan {
  outputStartSample: number;
  outputEndSample: number;
  marks: SourceNativeSynthesisMark[];
  diagnostics: SourceNativeSynthesisPlanDiagnostics;
}

export interface BuildSourceNativeSynthesisPlanArgs {
  /** Accepted, strictly increasing SrcFrame-local marks from one voiced region. */
  sourceMarks: readonly number[];
  /** Output-to-source time map for the containing clip. */
  warpPlan: ClipWarpPlan;
  outputStartSample: number;
  outputEndSample: number;
  /**
   * Optional phase seed. By default the first source mark is mapped through
   * the warp plan. Callers that include leading context may provide an earlier
   * synthesis center explicitly.
   */
  initialOutputCenterSample?: number;
  /** Segment values are already the final natural-follow shift in cents. */
  pitchSegments?: readonly PitchSegment[];
  /** Used only when no pitch segment covers a synthesis center. */
  defaultShiftCents?: number;
  sampleRate: number;
  /** Safety guard only; it does not change mark placement. */
  maxSynthesisMarkCount?: number;
}

export interface SourceNativeRendererDiagnostics {
  grainCount: number;
  sourceReadStep: 1;
  maxPendingTailSamples: number;
  zeroPaddedSourceReadCount: number;
  periodicExtendedSourceReadCount: number;
  committedOutputSamples: number;
}

export interface SourceNativeRenderResult {
  channels: Float32Array[];
  channelDiagnostics: SourceNativeRendererDiagnostics[];
}

export interface RenderSourceNativePlanArgs {
  sourceChannels: readonly Float32Array[];
  /** Index in each source channel that corresponds to clip-local source sample 0. */
  sourceOffsetSamples?: number;
  sourceMarks: readonly number[];
  plan: SourceNativeSynthesisPlan;
  blockSize: number;
  /** Clip-local complete cycles used only when a physical media read escapes. */
  sourceBoundaryExtension?: {
    leftCycle?: { startSample: number; endSample: number };
    rightCycle?: { startSample: number; endSample: number };
  };
}

export interface SourceVoicedRegion {
  startSample: number;
  endSample: number;
}

export interface SourceNativeRegionDiagnostics {
  sourceStartSample: number;
  sourceEndSample: number;
  outputStartSample: number;
  outputEndSample: number;
  sourceMarkCount: number;
  leftGuardMarkCount: number;
  rightGuardMarkCount: number;
  leftEdgeCompletion: "guard_context" | "nearest_cycle" | "crossfade";
  rightEdgeCompletion: "guard_context" | "nearest_cycle" | "crossfade";
  rendered: boolean;
  synthesisPlan?: SourceNativeSynthesisPlanDiagnostics;
  channelRenderer?: SourceNativeRendererDiagnostics[];
}

export interface SourceNativeRegionRenderDiagnostics {
  renderedRegionCount: number;
  skippedRegionCount: number;
  fallbackSampleCount: number;
  regions: SourceNativeRegionDiagnostics[];
}

export interface RenderSourceNativeRegionsArgs {
  sourceChannels: readonly Float32Array[];
  /** Index in each source channel that corresponds to clip-local source sample 0. */
  sourceOffsetSamples?: number;
  sourceMarks: readonly number[];
  voicedRegions: readonly SourceVoicedRegion[];
  warpPlan: ClipWarpPlan;
  outputLength: number;
  pitchSegments?: readonly PitchSegment[];
  defaultShiftCents?: number;
  sampleRate: number;
  blockSize: number;
}

export interface SourceNativeRegionRenderResult extends SourceNativeRenderResult {
  diagnostics: SourceNativeRegionRenderDiagnostics;
}
