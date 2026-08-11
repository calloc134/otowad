import type { AudioBufferData, AudioBufferSource } from "../audioBufferData.ts";
import {
  createAudioBufferData,
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "../audioBufferData.ts";
import type { F0TrackArtifact, PitchMarksArtifact } from "../../types/index.ts";
import type { ClipTdPsolaOperation } from "../directClipRender.ts";
import type { ClipWarpPlan, PitchSegment } from "../pitchPlan.ts";
import {
  localPitchMarksFromArtifact,
  normalizeWarpPlan,
} from "../tdpsolaWarp.ts";
import {
  resolveTdPsolaV2AnalysisPolicy,
  resolveTdPsolaV2AnalysisSource,
  type TdPsolaV2AnalysisPolicyContract,
  type TdPsolaV2AnalysisPolicyId,
  type TdPsolaV2AnalysisSource,
} from "./analysisPolicy.ts";
import {
  applyMonophonicPitchRangePolicy,
  type MonophonicPitchRangePolicyDiagnostics,
} from "./monophonicAnalysisPolicy.ts";
import { renderSourceNativeRegions } from "./regionCompositor.ts";
import {
  alignProvidedPitchTrackToLocalGrid,
  analyzePitchLocaVoiceDsp,
  clamp,
  extractMonoSegment,
  fitConfigToTargetLength,
  inferRenderOperation,
  pitchTrackFromF0Artifact,
  prepareSourcePlan,
  resolveConfig,
  summarizePreparedSourcePitch,
  summarizeSourceMarkIntervals,
  type LocaVoiceDspConfig,
  type PreparedSourcePlan,
} from "./sourceAnalysis.ts";
import type { SourceNativeRegionRenderDiagnostics } from "./types.ts";

export interface RenderTdPsolaV2DataOptions {
  inputBuffer: AudioBufferSource;
  sourceInFrame: number;
  sourceOutFrame: number;
  targetDurationSec: number;
  totalPitchSemitones: number;
  pitchSegments?: PitchSegment[];
  warpPlan?: ClipWarpPlan;
  sourceF0Track?: F0TrackArtifact | null;
  sourcePitchMarks?: PitchMarksArtifact | null;
  renderOperation?: ClipTdPsolaOperation;
  preserveFormant?: boolean;
  config?: Partial<LocaVoiceDspConfig>;
  analysisPolicy?: TdPsolaV2AnalysisPolicyId;
  blockSize?: number;
  diagnosticsCollector?: (diagnostics: TdPsolaV2RenderDiagnostics) => void;
}

interface TdPsolaV2RenderDiagnostics {
  analysisPolicy: TdPsolaV2AnalysisPolicyContract;
  requestedAnalysisSource: TdPsolaV2AnalysisSource;
  analysisSource: TdPsolaV2AnalysisSource;
  analysisFallbackReason: "provided_artifact_missing" | null;
  operation: ClipTdPsolaOperation;
  sourceLength: number;
  targetLength: number;
  voicedRegionCount: number;
  sourceMarkCount: number;
  reusedProvidedMarks: boolean;
  sourceContext: {
    leftSamples: number;
    rightSamples: number;
  };
  sourceMarkIntervals: {
    minimumSamples: number;
    medianSamples: number;
    p95Samples: number;
    maximumSamples: number;
    maximumToMedianRatio: number;
    maximumIntervalStartSample: number;
    maximumIntervalEndSample: number;
  };
  sourcePitchHz: {
    minimum: number;
    median: number;
    p95: number;
    maximum: number;
  };
  providedPitchRangePolicy: MonophonicPitchRangePolicyDiagnostics | null;
  regionRender: SourceNativeRegionRenderDiagnostics;
}

function movePreparedSourceToClipCoordinates(
  preparedSource: PreparedSourcePlan,
  sourceOffsetSamples: number,
  sourceLength: number,
  sampleRate: number,
): PreparedSourcePlan {
  return {
    ...preparedSource,
    repairedTrack: {
      ...preparedSource.repairedTrack,
      timestamps: Float32Array.from(
        preparedSource.repairedTrack.timestamps,
        (timestamp) => timestamp - sourceOffsetSamples / sampleRate,
      ),
    },
    sourceMarks: preparedSource.sourceMarks?.map(
      (mark) => mark - sourceOffsetSamples,
    ),
    voicedRegions: preparedSource.voicedRegions
      .map((region) => ({
        ...region,
        startSample: clamp(region.startSample - sourceOffsetSamples, 0, sourceLength),
        endSample: clamp(region.endSample - sourceOffsetSamples, 0, sourceLength),
      }))
      .filter((region) => region.endSample > region.startSample),
  };
}

/**
 * Adapter from clip-level render inputs to the source-native TD-PSOLA core.
 *
 * Source analysis and output safety live with the v2 backend so deleting the
 * legacy renderer cannot silently remove v2 preparation behavior.
 */
export function renderAudioClipTdPsolaV2Data(
  options: RenderTdPsolaV2DataOptions,
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
    config,
    analysisPolicy: analysisPolicyId = "voice_monophonic_v2",
    blockSize = 128,
    diagnosticsCollector,
  } = options;

  const inputLength = getAudioBufferLength(inputBuffer);
  const start = clamp(Math.round(sourceInFrame), 0, inputLength - 1);
  const end = clamp(Math.round(sourceOutFrame), start + 1, inputLength);
  const sourceLength = end - start;
  if (sourceLength <= 1 || targetDurationSec <= 0) return null;

  const sampleRate = getAudioBufferSampleRate(inputBuffer);
  const targetSamples = Math.max(1, Math.round(targetDurationSec * sampleRate));
  const analysisPolicy = resolveTdPsolaV2AnalysisPolicy(analysisPolicyId);
  const resolvedConfig = resolveConfig({
    minF0: analysisPolicy.analysis.minimumF0Hz,
    maxF0: analysisPolicy.analysis.maximumF0Hz,
    voicedThreshold: analysisPolicy.voicing.voicedThreshold,
    ...config,
  });
  const contextSamples = Math.ceil(Math.max(
    resolvedConfig.frameSize / 2,
    3 * sampleRate / resolvedConfig.minF0,
  ));
  const contextStart = Math.max(0, start - contextSamples);
  const contextEnd = Math.min(inputLength, end + contextSamples);
  const sourceOffsetSamples = start - contextStart;
  const effectiveWarpPlan = normalizeWarpPlan(warpPlan, sourceLength, targetSamples);
  const operation = renderOperation ?? inferRenderOperation(
    targetSamples,
    sourceLength,
    totalPitchSemitones,
    pitchSegments,
    effectiveWarpPlan,
  );
  const monoSource = extractMonoSegment(inputBuffer, contextStart, contextEnd);
  const analysisConfig = fitConfigToTargetLength(resolvedConfig, monoSource.length);
  const localSourceTrack = analyzePitchLocaVoiceDsp(monoSource, sampleRate, analysisConfig);
  const rawProvidedSourceTrack = analysisPolicy.analysis.preferredSource === "provided" &&
      sourceF0Track
    ? pitchTrackFromF0Artifact(sourceF0Track, contextStart, contextEnd)
    : null;
  const alignedProvidedSourceTrack = rawProvidedSourceTrack
    ? alignProvidedPitchTrackToLocalGrid(
        localSourceTrack,
        rawProvidedSourceTrack,
        sampleRate,
        analysisConfig.voicedThreshold,
      )
    : null;
  const providedPitchRangePolicy = alignedProvidedSourceTrack
    ? applyMonophonicPitchRangePolicy({
        track: alignedProvidedSourceTrack,
        minimumF0Hz: analysisConfig.minF0,
        maximumF0Hz: analysisConfig.maxF0,
      })
    : null;
  const providedSourceTrack = providedPitchRangePolicy?.track ?? null;
  const providedSourceMarks = sourcePitchMarks
    ? localPitchMarksFromArtifact(
        sourcePitchMarks.marks_src_frames,
        contextStart,
        contextEnd,
      )
    : undefined;
  const analysisResolution = resolveTdPsolaV2AnalysisSource({
    policy: analysisPolicy,
    hasProvidedTrack: providedSourceTrack !== null,
  });
  const actualAnalysisSource = analysisResolution.actualSource;
  const contextPreparedSource = prepareSourcePlan({
    monoSource,
    track: actualAnalysisSource === "provided" ? providedSourceTrack! : localSourceTrack,
    sampleRate,
    providedMarks: actualAnalysisSource === "provided" ? providedSourceMarks : undefined,
    edgeEvidenceTrack: actualAnalysisSource === "provided" ? localSourceTrack : undefined,
    minimumEdgeRms: analysisConfig.minRms,
    voicedThreshold: analysisConfig.voicedThreshold,
    maximumGapSeconds: analysisPolicy.candidateHistory.maximumGapSeconds,
    minimumVoicedRunSeconds: analysisPolicy.voicing.minimumVoicedRunSeconds,
    edgeContinuationThreshold: analysisPolicy.voicing.edgeContinuationThreshold,
  });
  const preparedSource = movePreparedSourceToClipCoordinates(
    contextPreparedSource,
    sourceOffsetSamples,
    sourceLength,
    sampleRate,
  );
  const sourceChannels = Array.from(
    { length: getAudioBufferChannelCount(inputBuffer) },
    (_, channelIndex) =>
      getAudioBufferChannelData(inputBuffer, channelIndex).subarray(contextStart, contextEnd),
  );
  const regionRender = renderSourceNativeRegions({
    sourceChannels,
    sourceOffsetSamples,
    sourceMarks: preparedSource.sourceMarks ?? [],
    voicedRegions: preparedSource.voicedRegions.map((region) => ({
      startSample: region.startSample,
      endSample: region.endSample,
    })),
    warpPlan: effectiveWarpPlan,
    outputLength: targetSamples,
    pitchSegments: operation === "stretch_only" || operation === "bypass"
      ? undefined
      : pitchSegments,
    defaultShiftCents: operation === "stretch_only" || operation === "bypass"
      ? 0
      : totalPitchSemitones * 100,
    sampleRate,
    blockSize,
  });
  const clipSourceMarks = preparedSource.sourceMarks?.filter(
    (mark) => mark >= 0 && mark < sourceLength,
  );

  diagnosticsCollector?.({
    analysisPolicy,
    requestedAnalysisSource: analysisResolution.requestedSource,
    analysisSource: actualAnalysisSource,
    analysisFallbackReason: analysisResolution.fallbackReason,
    operation,
    sourceLength,
    targetLength: targetSamples,
    voicedRegionCount: preparedSource.voicedRegions.length,
    sourceMarkCount: clipSourceMarks?.length ?? 0,
    reusedProvidedMarks: preparedSource.reusedProvidedMarks,
    sourceContext: {
      leftSamples: sourceOffsetSamples,
      rightSamples: contextEnd - end,
    },
    sourceMarkIntervals: summarizeSourceMarkIntervals(
      clipSourceMarks,
      preparedSource.voicedRegions,
    ),
    sourcePitchHz: summarizePreparedSourcePitch(preparedSource),
    providedPitchRangePolicy: providedPitchRangePolicy?.diagnostics ?? null,
    regionRender: regionRender.diagnostics,
  });

  const rendered = createAudioBufferData(
    getAudioBufferChannelCount(inputBuffer),
    targetSamples,
    sampleRate,
  );
  for (let channelIndex = 0; channelIndex < regionRender.channels.length; channelIndex++) {
    rendered.channels[channelIndex]?.set(regionRender.channels[channelIndex]!);
  }
  return rendered;
}
