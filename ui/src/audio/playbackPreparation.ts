import type {
  AudioContentEdit,
  F0TrackArtifact,
  PitchMarksArtifact,
  ProjectDocument,
} from "@/types";
import {
  cloneAudioBufferData,
  resampleAudioBufferData,
  type AudioBufferData,
  type AudioBufferSource,
} from "./audioBufferData.ts";
import {
  buildClipRenderPlan,
  DEFAULT_TDPSOLA_CORE,
  type ClipRenderPlan,
  type TdPsolaSynthesisCore,
} from "./clipRenderPlan.ts";
import { renderClipFromPlan } from "./clipRenderDispatch.ts";
import type { ResolvedAudioContentAnalysis } from "./analysisResolution.ts";
import type { EnsureSourceAnalysisOptions } from "./analysisStore.ts";
import {
  buildPitchPlanCompileInput,
  compilePitchPlanFromInput,
  compilePitchPlan,
  type ClipWarpPlan,
  type PitchSegment,
} from "./pitchPlan.ts";
import { tickToSeconds } from "./playbackMath.ts";
import { makeTdPsolaClipKey } from "./tdpsola.ts";
import { gainMilliDbToLinear, panPermilleToUnit } from "./trackMix.ts";

export interface MediaSourceLookup {
  get(mediaId: string): AudioBufferSource | undefined;
}

export interface AnalysisArtifactLookup {
  ensureForProject(
    project: ProjectDocument,
    mediaLookup: MediaSourceLookup,
    options?: EnsureSourceAnalysisOptions,
  ): Promise<void>;
  buildCompileInput(project: ProjectDocument): {
    project: ProjectDocument;
    analysisJson: string;
  };
  resolveForAudioContent(
    content: Pick<AudioContentEdit, "media_id" | "analysis_refs">,
  ): {
    sourceF0Track: F0TrackArtifact | null;
    sourcePitchMarks: PitchMarksArtifact | null;
    analysisSignature?: string;
  };
  getF0(mediaId: string): F0TrackArtifact | undefined;
  getPitchMarks(mediaId: string): PitchMarksArtifact | undefined;
  getAnalysisSignature?(mediaId: string): string | undefined;
}

export interface PreparedPlaybackClip {
  clipId: string;
  trackId: string;
  mediaId: string;
  renderKey: string;
  whenRelativeSec: number;
  clipDurationSec: number;
  clipGain: number;
  trackGain: number;
  trackPan: number;
  buffer?: AudioBufferData;
}

export interface PreparedPlaybackSchedule {
  startTick: number;
  startOffsetSec: number;
  projectRevision: number;
  clips: PreparedPlaybackClip[];
}

export type PlaybackPreparationPhase =
  | "analyzing"
  | "compiling"
  | "enumerating_candidates"
  | "building_render_keys"
  | "rendering_missing_buffers"
  | "finalizing"
  | "done";

export interface PlaybackPreparationProgress {
  phase: PlaybackPreparationPhase;
  progress: number;
  sentAtMs?: number;
}

export interface PlaybackPreparationPhaseCounts {
  analyzing: number;
  compiling: number;
  enumerating_candidates: number;
  building_render_keys: number;
  rendering_missing_buffers: number;
  finalizing: number;
  done: number;
}

export interface PlaybackPreparationDiagnostics {
  inputTrackCount: number;
  inputAudioTrackCount: number;
  inputClipCount: number;
  inputAudioClipCount: number;
  inputContentCount: number;
  inputMediaCount: number;
  candidateCount: number;
  buildClipPitchRenderPlanCount: number;
  classifyOperationCount: number;
  renderKeyBuildCount: number;
  analysisSignatureBuildCount: number;
  renderCacheHitCount: number;
  renderCacheMissCount: number;
  bufferPayloadIncludedCount: number;
  metadataOnlyClipCount: number;
  actualRenderClipCount: number;
  actualDirectRenderCount: number;
  actualTdPsolaRenderCount: number;
  analysisEnsureDurationMs: number;
  compileDurationMs: number;
  candidateEnumerationDurationMs: number;
  renderLoopDurationMs: number;
  renderKeyBuildDurationMs: number;
  cacheLookupDurationMs: number;
  actualRenderDurationMs: number;
  resultScheduleMetadataBytes: number;
  resultBufferCount: number;
  resultBufferBytes: number;
  totalPrepareDurationMs: number;
}

export interface PreparePlaybackWorkerMetrics {
  workerReceivedAtMs: number;
  firstProgressSentAtMs: number | null;
  resultPostedAtMs: number;
  requestPayloadJsonBytes: number;
  requestProjectJsonBytes: number;
  requestKnownRenderKeyCount: number;
  resultScheduleMetadataBytes: number;
  resultBufferCount: number;
  resultBufferBytes: number;
  progressMessageCount: number;
  progressMessageCounts: PlaybackPreparationPhaseCounts;
  progressPostMessageDurationMs: number;
  diagnostics: PlaybackPreparationDiagnostics;
}

export interface PreparePlaybackClientMetrics {
  prepareCalledAtMs: number;
  requestPostedAtMs: number;
  firstProgressReceivedAtMs: number | null;
  resultReceivedAtMs: number | null;
  requestPayloadJsonBytes: number;
  requestProjectJsonBytes: number;
  requestKnownRenderKeyCount: number;
  progressMessageCount: number;
  progressMessageCounts: PlaybackPreparationPhaseCounts;
  progressCallbackDurationMs: number;
  progressCallbackDurationByPhaseMs: PlaybackPreparationPhaseCounts;
  progressTransportLatencyMs: number;
  progressTransportMaxLatencyMs: number;
}

export interface PreparePlaybackRequestMeasurement {
  requestId: string;
  projectRevision: number;
  startTick: number;
  scheduleCacheMissReason: "empty" | "project_revision" | "start_tick";
  client: PreparePlaybackClientMetrics;
  worker: PreparePlaybackWorkerMetrics;
  ui: {
    initialBusyTaskDispatchDurationMs: number;
    playPreparedStartAtMs: number;
    playPreparedEndAtMs: number;
    playPreparedDurationMs: number;
    busyTaskClearedAtMs: number;
  };
}

export function createPlaybackPreparationDiagnostics(): PlaybackPreparationDiagnostics {
  return {
    inputTrackCount: 0,
    inputAudioTrackCount: 0,
    inputClipCount: 0,
    inputAudioClipCount: 0,
    inputContentCount: 0,
    inputMediaCount: 0,
    candidateCount: 0,
    buildClipPitchRenderPlanCount: 0,
    classifyOperationCount: 0,
    renderKeyBuildCount: 0,
    analysisSignatureBuildCount: 0,
    renderCacheHitCount: 0,
    renderCacheMissCount: 0,
    bufferPayloadIncludedCount: 0,
    metadataOnlyClipCount: 0,
    actualRenderClipCount: 0,
    actualDirectRenderCount: 0,
    actualTdPsolaRenderCount: 0,
    analysisEnsureDurationMs: 0,
    compileDurationMs: 0,
    candidateEnumerationDurationMs: 0,
    renderLoopDurationMs: 0,
    renderKeyBuildDurationMs: 0,
    cacheLookupDurationMs: 0,
    actualRenderDurationMs: 0,
    resultScheduleMetadataBytes: 0,
    resultBufferCount: 0,
    resultBufferBytes: 0,
    totalPrepareDurationMs: 0,
  };
}

export function createPlaybackPreparationPhaseCounts(): PlaybackPreparationPhaseCounts {
  return {
    analyzing: 0,
    compiling: 0,
    enumerating_candidates: 0,
    building_render_keys: 0,
    rendering_missing_buffers: 0,
    finalizing: 0,
    done: 0,
  };
}

const RENDER_PROGRESS_MIN_INTERVAL_MS = 100;

function createThrottledProgressReporter(
  onProgress: ((progress: PlaybackPreparationProgress) => void) | undefined,
  phase: PlaybackPreparationPhase,
  total: number,
  minIntervalMs = RENDER_PROGRESS_MIN_INTERVAL_MS,
): ((completed: number, force?: boolean) => void) | null {
  if (!onProgress || total <= 0) {
    return null;
  }

  let lastSentAt = -Infinity;
  let lastSentProgress = -1;

  return (completed: number, force = false) => {
    const progress = Math.max(0, Math.min(1, completed / total));
    const now = performance.now();
    if (!force && progress <= lastSentProgress) {
      return;
    }
    if (!force && now - lastSentAt < minIntervalMs) {
      return;
    }
    onProgress({ phase, progress });
    lastSentAt = now;
    lastSentProgress = progress;
  };
}

export function nowPerfEpochMs(): number {
  return performance.timeOrigin + performance.now();
}

export function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function measureAudioBufferDataBytes(buffer: AudioBufferData): number {
  return buffer.channels.reduce((total: number, channel: Float32Array) => total + channel.byteLength, 0);
}

export function measurePreparedPlaybackScheduleMetadataBytes(schedule: PreparedPlaybackSchedule): number {
  return measureJsonBytes({
    startTick: schedule.startTick,
    startOffsetSec: schedule.startOffsetSec,
    projectRevision: schedule.projectRevision,
      clips: schedule.clips.map((clip) => ({
        clipId: clip.clipId,
        trackId: clip.trackId,
        mediaId: clip.mediaId,
        renderKey: clip.renderKey,
        whenRelativeSec: clip.whenRelativeSec,
        clipDurationSec: clip.clipDurationSec,
        clipGain: clip.clipGain,
        trackGain: clip.trackGain,
        trackPan: clip.trackPan,
        hasBuffer: clip.buffer !== undefined,
      })),
  });
}

export function measurePreparedPlaybackBufferBytes(schedule: PreparedPlaybackSchedule): {
  bufferCount: number;
  bufferBytes: number;
} {
  let bufferCount = 0;
  let bufferBytes = 0;
  for (const clip of schedule.clips) {
    if (!clip.buffer) {
      continue;
    }
    bufferCount += 1;
    bufferBytes += measureAudioBufferDataBytes(clip.buffer);
  }
  return { bufferCount, bufferBytes };
}

export interface PreparePlaybackScheduleOptions {
  startTick?: number;
  projectRevision?: number;
  onProgress?: (progress: PlaybackPreparationProgress) => void;
  getCachedBuffer?: (renderKey: string) => AudioBufferData | undefined;
  setCachedBuffer?: (renderKey: string, buffer: AudioBufferData) => void;
  knownRenderKeys?: ReadonlySet<string>;
  diagnostics?: PlaybackPreparationDiagnostics;
  /** Runtime-only A/B selector. The persisted project model remains unchanged. */
  tdPsolaCore?: TdPsolaSynthesisCore;
  /** Materialize prepared PCM at the playback AudioContext sample rate. */
  outputSampleRate?: number;
}

interface ClipRenderCandidate extends ClipRenderPlan {
  clipId: string;
  trackId: string;
  contentId: string;
  mediaId: string;
  mediaIdentity: string;
  lengthTick: number;
  inputBuffer: AudioBufferSource;
  sourceInFrame: number;
  sourceOutFrame: number;
  clipDurationSec: number;
  whenRelativeSec: number;
  clipGain: number;
  trackGain: number;
  trackPan: number;
  analysis: ResolvedAudioContentAnalysis;
}

interface PreparedClipBuildCandidate {
  candidate: ClipRenderCandidate;
  renderKey: string;
  includeBuffer: boolean;
  sourceF0Track: F0TrackArtifact | null;
  sourcePitchMarks: PitchMarksArtifact | null;
  rendered?: AudioBufferData;
}

function serializePitchSegmentsKey(segments: PitchSegment[]): string {
  return segments
    .map((segment) =>
      `${segment.startSample}:${segment.endSample}:${segment.shiftCents.toFixed(2)}`
    )
    .join(",");
}

export function buildPreparedClipRenderKey(args: {
  mediaIdentity: string;
  sourceInFrame: number;
  sourceOutFrame: number;
  lengthTick: number;
  totalPitchSemitones: number;
  pitchSegments?: PitchSegment[];
  warpPlan?: ClipWarpPlan;
  analysisSignature?: string;
  timePitchMode: ClipRenderPlan["timePitchMode"];
  backend: ClipRenderPlan["backend"];
  backendVersion: ClipRenderPlan["backendVersion"];
  tdPsolaAnalysisPolicy?: ClipRenderPlan["tdPsolaAnalysisPolicy"];
  renderOperation: ClipRenderPlan["renderOperation"];
  preserveFormant: boolean;
  bpm: number;
  ppq: number;
  mediaSampleRate: number;
  outputSampleRate?: number;
}): string {
  const renderKey = makeTdPsolaClipKey({
    mediaIdentity: args.mediaIdentity,
    sourceIn: args.sourceInFrame,
    sourceOut: args.sourceOutFrame,
    lengthTick: args.lengthTick,
    totalPitchSemitones: args.totalPitchSemitones,
    pitchSegmentsKey: args.pitchSegments && args.pitchSegments.length > 0
      ? serializePitchSegmentsKey(args.pitchSegments)
      : undefined,
    warpPlanKey: args.warpPlan ? JSON.stringify(args.warpPlan.segments) : undefined,
    analysisKey: args.analysisSignature,
    timePitchMode: args.timePitchMode,
    backend: args.backend,
    backendVersion: args.backendVersion,
    analysisPolicy: args.tdPsolaAnalysisPolicy ?? "",
    renderOperation: args.renderOperation,
    preserveFormant:
      args.backend === "source_native_tdpsola" ? false : args.preserveFormant,
    bpm: args.bpm,
    ppq: args.ppq,
    mediaSampleRate: args.mediaSampleRate,
  });
  const requestedOutputSampleRate = args.outputSampleRate ?? args.mediaSampleRate;
  const outputSampleRate = Number.isFinite(requestedOutputSampleRate) &&
      requestedOutputSampleRate > 0
    ? Math.round(requestedOutputSampleRate)
    : Math.max(1, Math.round(args.mediaSampleRate));
  return `${renderKey}|output-rate:${outputSampleRate}`;
}

export function shouldIncludePreparedClipBuffer(
  renderKey: string,
  knownRenderKeys?: ReadonlySet<string>,
): boolean {
  return !(knownRenderKeys?.has(renderKey) ?? false);
}

export function collectPreparedPlaybackRenderKeys(
  schedule: PreparedPlaybackSchedule | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  if (!schedule) {
    return keys;
  }
  for (const clip of schedule.clips) {
    keys.add(clip.renderKey);
  }
  return keys;
}

export function mergeKnownRenderKeys(
  ...sources: Array<Iterable<string> | null | undefined>
): Set<string> {
  const keys = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const key of source) {
      keys.add(key);
    }
  }
  return keys;
}

export async function preparePlaybackSchedule(
  project: ProjectDocument,
  mediaLookup: MediaSourceLookup,
  analysisLookup: AnalysisArtifactLookup,
  options: PreparePlaybackScheduleOptions = {},
): Promise<PreparedPlaybackSchedule> {
  const onProgress = options.onProgress;
  const diagnostics = options.diagnostics;
  const tdPsolaCore = options.tdPsolaCore ?? DEFAULT_TDPSOLA_CORE;
  const prepareStartedAt = performance.now();

  onProgress?.({ phase: "analyzing", progress: 0 });
  const analysisStartedAt = performance.now();
  const needsMonophonicV2Analysis = tdPsolaCore === "source_native_v2" &&
    project.edit.clips.some((clip) =>
      clip.kind.clip_type === "audio" &&
      clip.kind.audio.time_pitch.mode === "Voice" &&
      clip.kind.audio.time_pitch.analysis === "Source"
    );
  await analysisLookup.ensureForProject(
    project,
    mediaLookup,
    needsMonophonicV2Analysis
      ? {
          profile: "tdpsola_monophonic_v2",
          refreshIfProfileMismatch: true,
        }
      : undefined,
  );
  if (diagnostics) {
    diagnostics.analysisEnsureDurationMs += performance.now() - analysisStartedAt;
  }
  onProgress?.({ phase: "analyzing", progress: 1 });

  onProgress?.({ phase: "compiling", progress: 0 });
  const compileStartedAt = performance.now();
  const compileInput = buildPitchPlanCompileInput(project, analysisLookup);
  const compiledPitchPlan = compilePitchPlanFromInput(compileInput);
  if (diagnostics) {
    diagnostics.compileDurationMs += performance.now() - compileStartedAt;
  }
  onProgress?.({ phase: "compiling", progress: 1 });

  const schedule = buildPreparedPlaybackScheduleFromCompiledPlan(
    compileInput.project,
    mediaLookup,
    analysisLookup,
    compiledPitchPlan,
    { ...options, tdPsolaCore },
  );
  if (diagnostics) {
    diagnostics.totalPrepareDurationMs += performance.now() - prepareStartedAt;
  }
  return schedule;
}

export function buildPreparedPlaybackScheduleFromCompiledPlan(
  project: ProjectDocument,
  mediaLookup: MediaSourceLookup,
  analysisLookup: AnalysisArtifactLookup,
  compiledPitchPlan: ReturnType<typeof compilePitchPlan>,
  options: PreparePlaybackScheduleOptions = {},
): PreparedPlaybackSchedule {
  const startTick = options.startTick ?? 0;
  const projectRevision = options.projectRevision ?? 0;
  const onProgress = options.onProgress;
  const knownRenderKeys = options.knownRenderKeys ?? new Set<string>();
  const tdPsolaCore = options.tdPsolaCore ?? DEFAULT_TDPSOLA_CORE;
  const requestedOutputSampleRate = options.outputSampleRate ?? project.meta.project_sample_rate;
  const outputSampleRate = Number.isFinite(requestedOutputSampleRate) &&
      requestedOutputSampleRate > 0
    ? Math.round(requestedOutputSampleRate)
    : project.meta.project_sample_rate;
  const diagnostics = options.diagnostics;
  const enumerationStartedAt = performance.now();

  onProgress?.({ phase: "enumerating_candidates", progress: 0 });

  const edit = project.edit;
  const mediaById = new Map(edit.media.map((asset) => [asset.id, asset] as const));
  const microBpm = edit.tempo.points[0]?.micro_bpm ?? 120_000_000;
  const ppq = edit.tempo.ppq;
  const startOffsetSec = tickToSeconds(startTick, microBpm, ppq);
  const anySolo = edit.tracks.some((track) => track.solo);
  const candidates: ClipRenderCandidate[] = [];

  if (diagnostics) {
    diagnostics.inputTrackCount = edit.tracks.length;
    diagnostics.inputAudioTrackCount = edit.tracks.filter((track) => track.kind.track_type === "audio").length;
    diagnostics.inputClipCount = edit.clips.length;
    diagnostics.inputAudioClipCount = edit.clips.filter((clip) => clip.kind.clip_type === "audio").length;
    diagnostics.inputContentCount = edit.contents.length;
    diagnostics.inputMediaCount = edit.media.length;
  }

  for (const track of edit.tracks) {
    if (track.mute) continue;
    if (anySolo && !track.solo) continue;
    if (track.kind.track_type !== "audio") continue;

    const trackClips = edit.clips.filter((clip) => clip.track_id === track.id);
    for (const clip of trackClips) {
      if (clip.muted || clip.kind.clip_type !== "audio") continue;

      const content = edit.contents.find((item) => item.id === clip.kind.content_id);
      if (!content || content.type !== "audio") continue;

      const buffer = mediaLookup.get(content.media_id);
      if (!buffer) continue;

      const clipStartSec = tickToSeconds(clip.start, microBpm, ppq);
      const clipDurationSec = tickToSeconds(clip.length, microBpm, ppq);
      const sourceDurationSec =
        (clip.kind.audio.src_out - clip.kind.audio.src_in) / buffer.sampleRate;
      if (sourceDurationSec <= 0 || clipDurationSec <= 0) continue;

      const whenRelativeSec = clipStartSec - startOffsetSec;
      if (whenRelativeSec + clipDurationSec <= 0) continue;

      const renderPlan = buildClipRenderPlan({
        compiledPlan: compiledPitchPlan,
        clipId: clip.id,
        trackId: track.id,
        audio: clip.kind.audio,
        clipDurationSec,
        mediaSampleRate: buffer.sampleRate,
        microBpm,
        ppq,
        tdPsolaCore,
      });
      if (diagnostics) diagnostics.buildClipPitchRenderPlanCount += 1;
      if (diagnostics) diagnostics.classifyOperationCount += 1;

      candidates.push({
        clipId: clip.id,
        trackId: track.id,
        contentId: content.id,
        mediaId: content.media_id,
        mediaIdentity: mediaById.get(content.media_id)?.hash ?? content.media_id,
        lengthTick: clip.length,
        inputBuffer: buffer,
        sourceInFrame: clip.kind.audio.src_in,
        sourceOutFrame: clip.kind.audio.src_out,
        clipDurationSec,
        whenRelativeSec,
        clipGain: gainMilliDbToLinear(clip.gain_milli_db),
        trackGain: gainMilliDbToLinear(track.gain_milli_db),
        trackPan: panPermilleToUnit(track.pan_permille),
        analysis: analysisLookup.resolveForAudioContent(content),
        ...renderPlan,
      });
    }
  }

  if (diagnostics) {
    diagnostics.candidateCount = candidates.length;
    diagnostics.candidateEnumerationDurationMs += performance.now() - enumerationStartedAt;
  }
  onProgress?.({ phase: "enumerating_candidates", progress: 1 });

  onProgress?.({ phase: "building_render_keys", progress: 0 });
  const preparedCandidates: PreparedClipBuildCandidate[] = [];
  const missingRenderCandidates: PreparedClipBuildCandidate[] = [];
  const renderLoopStartedAt = performance.now();
  for (const candidate of candidates) {
    const sourceF0Track = candidate.analysis.sourceF0Track;
    const sourcePitchMarks = candidate.analysis.sourcePitchMarks;
    const renderKeyBuildStartedAt = performance.now();
    const analysisSignature = candidate.analysis.analysisSignature;
    if (diagnostics) {
      diagnostics.renderKeyBuildCount += 1;
      if (analysisSignature !== undefined) {
        diagnostics.analysisSignatureBuildCount += 1;
      }
    }
    const renderKey = buildPreparedClipRenderKey({
      mediaIdentity: candidate.mediaIdentity,
      sourceInFrame: candidate.sourceInFrame,
      sourceOutFrame: candidate.sourceOutFrame,
      lengthTick: candidate.lengthTick,
      totalPitchSemitones: candidate.totalPitchSemitones,
      pitchSegments: candidate.pitchSegments,
      warpPlan: candidate.warpPlan,
      analysisSignature,
      timePitchMode: candidate.timePitchMode,
      backend: candidate.backend,
      backendVersion: candidate.backendVersion,
      tdPsolaAnalysisPolicy: candidate.tdPsolaAnalysisPolicy,
      renderOperation: candidate.renderOperation,
      preserveFormant: candidate.preserveFormant,
      bpm: microBpm,
      ppq,
      mediaSampleRate: candidate.inputBuffer.sampleRate,
      outputSampleRate,
    });
    if (diagnostics) diagnostics.renderKeyBuildDurationMs += performance.now() - renderKeyBuildStartedAt;

    const cacheLookupStartedAt = performance.now();
    let rendered: AudioBufferData | undefined = options.getCachedBuffer?.(renderKey);
    if (diagnostics) diagnostics.cacheLookupDurationMs += performance.now() - cacheLookupStartedAt;
    const includeBuffer = shouldIncludePreparedClipBuffer(renderKey, knownRenderKeys);
    if (diagnostics) {
      if (includeBuffer) {
        diagnostics.bufferPayloadIncludedCount += 1;
      } else {
        diagnostics.metadataOnlyClipCount += 1;
      }
    }

    const preparedCandidate: PreparedClipBuildCandidate = {
      candidate,
      renderKey,
      includeBuffer,
      sourceF0Track,
      sourcePitchMarks,
      rendered,
    };

    if (!rendered && includeBuffer) {
      if (diagnostics) diagnostics.renderCacheMissCount += 1;
      missingRenderCandidates.push(preparedCandidate);
    } else {
      if (diagnostics) diagnostics.renderCacheHitCount += 1;
    }

    preparedCandidates.push(preparedCandidate);
  }
  onProgress?.({ phase: "building_render_keys", progress: 1 });

  const reportRenderProgress = createThrottledProgressReporter(
    onProgress,
    "rendering_missing_buffers",
    missingRenderCandidates.length,
  );
  if (missingRenderCandidates.length > 0) {
    onProgress?.({ phase: "rendering_missing_buffers", progress: 0 });
  }
  for (let index = 0; index < missingRenderCandidates.length; index++) {
    const preparedCandidate = missingRenderCandidates[index];
    if (!preparedCandidate) {
      continue;
    }
    const { candidate } = preparedCandidate;
    const renderStartedAt = performance.now();
    const newlyRendered = renderClipFromPlan({
      mediaId: candidate.mediaId,
      inputBuffer: candidate.inputBuffer,
      sourceInFrame: candidate.sourceInFrame,
      sourceOutFrame: candidate.sourceOutFrame,
      targetDurationSec: candidate.clipDurationSec,
      renderPlan: candidate,
      sourceF0Track: preparedCandidate.sourceF0Track,
      sourcePitchMarks: preparedCandidate.sourcePitchMarks,
    });
    if (!newlyRendered) {
      reportRenderProgress?.(index + 1);
      continue;
    }
    if (diagnostics) {
      diagnostics.actualRenderClipCount += 1;
      diagnostics.actualRenderDurationMs += performance.now() - renderStartedAt;
      if (candidate.backend === "direct") {
        diagnostics.actualDirectRenderCount += 1;
      } else {
        diagnostics.actualTdPsolaRenderCount += 1;
      }
    }
    const renderedAtOutputRate = newlyRendered.sampleRate === outputSampleRate
      ? newlyRendered
      : resampleAudioBufferData(newlyRendered, outputSampleRate);
    preparedCandidate.rendered = renderedAtOutputRate;
    options.setCachedBuffer?.(preparedCandidate.renderKey, renderedAtOutputRate);
    reportRenderProgress?.(index + 1);
  }
  if (missingRenderCandidates.length > 0) {
    reportRenderProgress?.(missingRenderCandidates.length, true);
  }

  const preparedClips: PreparedPlaybackClip[] = [];
  onProgress?.({ phase: "finalizing", progress: 0 });
  for (const preparedCandidate of preparedCandidates) {
    const rendered = preparedCandidate.rendered;
    if (!rendered && preparedCandidate.includeBuffer) {
      continue;
    }
    const { candidate, renderKey, includeBuffer } = preparedCandidate;

    preparedClips.push({
      clipId: candidate.clipId,
      trackId: candidate.trackId,
      mediaId: candidate.mediaId,
      renderKey,
      whenRelativeSec: candidate.whenRelativeSec,
      clipDurationSec: candidate.clipDurationSec,
      clipGain: candidate.clipGain,
      trackGain: candidate.trackGain,
      trackPan: candidate.trackPan,
      buffer: includeBuffer && rendered && options.setCachedBuffer
        ? cloneAudioBufferData(rendered)
        : includeBuffer && rendered
        ? rendered
        : undefined,
    });
  }
  onProgress?.({ phase: "finalizing", progress: 1 });

  if (diagnostics) {
    diagnostics.renderLoopDurationMs += performance.now() - renderLoopStartedAt;
  }

  onProgress?.({ phase: "done", progress: 1 });
  const schedule = {
    startTick,
    startOffsetSec,
    projectRevision,
    clips: preparedClips,
  };
  if (diagnostics) {
    diagnostics.resultScheduleMetadataBytes = measurePreparedPlaybackScheduleMetadataBytes(schedule);
    const { bufferCount, bufferBytes } = measurePreparedPlaybackBufferBytes(schedule);
    diagnostics.resultBufferCount = bufferCount;
    diagnostics.resultBufferBytes = bufferBytes;
  }
  return schedule;
}

export function canReusePreparedPlaybackSchedule(
  schedule: PreparedPlaybackSchedule | null,
  projectRevision: number,
  startTick: number,
): boolean {
  return schedule !== null &&
    schedule.projectRevision === projectRevision &&
    schedule.startTick === startTick;
}
