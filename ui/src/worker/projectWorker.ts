/// <reference lib="webworker" />

import initWasm from "../wasm/otomad_core.js";
import { analyze_f0_buffer_with_backend } from "../wasm/otomad_core.js";
import { AnalysisStore } from "../audio/analysisStore.ts";
import {
  computeMediaContentHash,
  resolveMediaIdByContentHash,
} from "../audio/mediaContentHash.ts";
import {
  collectAudioBufferTransferables,
  type AudioBufferData,
} from "../audio/audioBufferData.ts";
import {
  measureAnalysisArtifacts,
  measureAudioBufferSources,
} from "../audio/runtimeMemoryDiagnostics.ts";
import {
  createPlaybackPreparationDiagnostics,
  createPlaybackPreparationPhaseCounts,
  measurePreparedPlaybackBufferBytes,
  measurePreparedPlaybackScheduleMetadataBytes,
  measureJsonBytes,
  nowPerfEpochMs,
  preparePlaybackSchedule,
} from "../audio/playbackPreparation.ts";
import {
  buildProjectArchiveAnalysisFiles,
  buildProjectArchive,
  buildProjectArchiveMediaFiles,
  collectReferencedAudioMedia,
  hydrateProjectArchiveMediaDataSafely,
  parseProjectArchive,
  prepareCanonicalProjectArchivePayload,
} from "../persist/projectArchive.ts";
import { parseProjectDocumentJson } from "../adapters/projectDocument.ts";
import { renderProjectToAudioBufferData } from "../render/projectMixdown.ts";
import { encodeWav } from "../render/wavEncoder.ts";
import type {
  ProjectWorkerErrorCode,
  ProjectWorkerRequest,
  ProjectWorkerResponse,
  WorkerAnalysisArtifactEntry,
  WorkerArchiveMediaEntry,
} from "./projectWorkerProtocol.ts";
import { PROJECT_WORKER_VERSION, isRevisionGatedRequestType } from "./projectWorkerProtocol.ts";
import {
  MissingWorkerMediaError,
  WorkerMediaCache,
  type WorkerRequestMediaContext,
} from "./workerMediaCache.ts";

const workerMediaCache = new WorkerMediaCache();
const workerAnalysisStore = new AnalysisStore();

const canceledRequests = new Set<string>();
const inflightRequestIds = new Set<string>();
let latestProjectRevision = 0;
let activeWorkerGeneration: number | null = null;
let wasmReadyPromise: Promise<void> | null = null;

class ProjectWorkerError extends Error {
  code: ProjectWorkerErrorCode;

  constructor(code: ProjectWorkerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function materializeRequestMedia(
  project: Extract<
    ProjectWorkerRequest,
    { type: "prepare_playback" | "build_project_archive" | "render_wav_export" }
  >["payload"]["project"],
  mediaEntries: Extract<
    ProjectWorkerRequest,
    { type: "prepare_playback" | "build_project_archive" | "render_wav_export" }
  >["payload"]["mediaEntries"],
): WorkerRequestMediaContext {
  try {
    return workerMediaCache.materializeRequest(
      collectReferencedAudioMedia(project).map((asset) => asset.id),
      mediaEntries,
    );
  } catch (error) {
    if (error instanceof MissingWorkerMediaError) {
      throw new ProjectWorkerError("MISSING_MEDIA", error.message);
    }
    throw error;
  }
}

function admitRequestMediaToCache(context: WorkerRequestMediaContext): void {
  workerMediaCache.admitRequest(context);
}

function ensureWasmReady(): Promise<void> {
  if (!wasmReadyPromise) {
    wasmReadyPromise = initWasm().then(() => undefined);
  }
  return wasmReadyPromise;
}

function shouldTrackRevision(type: ProjectWorkerRequest["type"]): boolean {
  return isRevisionGatedRequestType(type);
}

function validateEnvelope(request: ProjectWorkerRequest): void {
  if (request.version !== PROJECT_WORKER_VERSION) {
    throw new ProjectWorkerError(
      "UNKNOWN_VERSION",
      `Worker version ${request.version} is not supported.`,
    );
  }
  if (
    !Number.isSafeInteger(request.workerGeneration) ||
    request.workerGeneration < 0 ||
    (activeWorkerGeneration !== null && request.workerGeneration !== activeWorkerGeneration)
  ) {
    throw new ProjectWorkerError(
      "STALE_WORKER_GENERATION",
      `Worker generation ${request.workerGeneration} does not match ${activeWorkerGeneration ?? "an uninitialized worker"}.`,
    );
  }
  activeWorkerGeneration ??= request.workerGeneration;
  if (shouldTrackRevision(request.type) && request.projectRevision < latestProjectRevision) {
    throw new ProjectWorkerError(
      "STALE_REVISION",
      `Request revision ${request.projectRevision} is stale; latest is ${latestProjectRevision}.`,
    );
  }
  if (shouldTrackRevision(request.type) && request.projectRevision > latestProjectRevision) {
    latestProjectRevision = request.projectRevision;
  }
}

function assertRequestActive(request: ProjectWorkerRequest): void {
  if (request.workerGeneration !== activeWorkerGeneration) {
    throw new ProjectWorkerError(
      "STALE_WORKER_GENERATION",
      `Request generation ${request.workerGeneration} is stale; active generation is ${activeWorkerGeneration}.`,
    );
  }
  if (canceledRequests.has(request.requestId)) {
    throw new ProjectWorkerError("REQUEST_CANCELED", "Request was canceled.");
  }
  if (shouldTrackRevision(request.type) && request.projectRevision < latestProjectRevision) {
    throw new ProjectWorkerError(
      "STALE_REVISION",
      `Request revision ${request.projectRevision} is stale; latest is ${latestProjectRevision}.`,
    );
  }
}

function postResponse<TType extends ProjectWorkerResponse["type"]>(
  message: Extract<ProjectWorkerResponse, { type: TType }>,
  transferables?: Transferable[],
): void {
  self.postMessage(message, transferables ?? []);
}

function postError(
  request: ProjectWorkerRequest,
  code: ProjectWorkerErrorCode,
  message: string,
): void {
  postResponse({
    type: "request_error",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { code, message },
  });
}

function postProgress(
  request: ProjectWorkerRequest,
  payload: Extract<ProjectWorkerResponse, { type: "progress" }> ["payload"],
): void {
  assertRequestActive(request);
  postResponse({
    type: "progress",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload,
  });
}

function handleReplaceMedia(
  request: Extract<ProjectWorkerRequest, { type: "replace_media" }>,
): void {
  if (request.payload.mode === "replace_all") {
    workerMediaCache.replaceAll(request.payload.entries);
    workerAnalysisStore.clear();
  } else {
    workerMediaCache.upsert(request.payload.entries);
  }
  const cacheSnapshot = workerMediaCache.snapshot();

  postResponse({
    type: "replace_media_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { mediaCount: workerMediaCache.size, ...cacheSnapshot },
  });
}

function handleReplaceAnalysisArtifacts(
  request: Extract<ProjectWorkerRequest, { type: "replace_analysis_artifacts" }>,
): void {
  if (request.payload.mode === "replace_all") {
    workerAnalysisStore.clear();
  }
  for (const entry of request.payload.entries) {
    switch (entry.artifact.kind) {
      case "f0_track":
        workerAnalysisStore.setF0(entry.artifact.media_id, entry.artifact, entry.analysisId);
        break;
      case "pitch_marks":
        workerAnalysisStore.setPitchMarks(entry.artifact.media_id, entry.artifact, entry.analysisId);
        break;
      case "waveform_peaks":
        break;
    }
  }

  postResponse({
    type: "replace_analysis_artifacts_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { analysisCount: workerAnalysisStore.getStore().size },
  });
}

function collectAnalysisEntriesByIds(analysisIds: readonly string[]): WorkerAnalysisArtifactEntry[] {
  return analysisIds
    .map((analysisId) => {
      const artifact = workerAnalysisStore.getStore().get(analysisId);
      return artifact ? { analysisId, artifact } : null;
    })
    .filter((entry): entry is WorkerAnalysisArtifactEntry => entry !== null);
}

function handleClearProjectCache(
  request: Extract<ProjectWorkerRequest, { type: "clear_project_cache" }>,
): void {
  workerMediaCache.clear();
  workerAnalysisStore.clear();
  postResponse({
    type: "clear_project_cache_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { ok: true },
  });
}

function handleMeasureRuntimeMemory(
  request: Extract<ProjectWorkerRequest, { type: "measure_runtime_memory" }>,
): void {
  assertRequestActive(request);
  postResponse({
    type: "measure_runtime_memory_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: {
      sourcePcm: measureAudioBufferSources(workerMediaCache.values()),
      renderedPcm: { count: 0, bytes: 0 },
      analysis: measureAnalysisArtifacts(workerAnalysisStore.getStore()),
    },
  });
}

function handleParseProjectArchive(
  request: Extract<ProjectWorkerRequest, { type: "parse_project_archive" }>,
): void {
  assertRequestActive(request);
  const archive = parseProjectArchive(request.payload.bytes);
  const document = parseProjectDocumentJson(archive.projectJson);
  const mediaHydration = hydrateProjectArchiveMediaDataSafely(document, archive.mediaFiles);
  const analysisEntries: WorkerArchiveMediaEntry[] = Array.from(archive.analysisFiles.entries()).map(
    ([path, bytes]) => ({ path, bytes }),
  );
  const transferables: Transferable[] = [
    ...mediaHydration.entries.flatMap((entry) => collectAudioBufferTransferables(entry.buffer)),
    ...analysisEntries.map((entry) => entry.bytes.buffer as ArrayBuffer),
  ];
  assertRequestActive(request);
  postResponse({
    type: "parse_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: {
      projectJson: archive.projectJson,
      hydratedMediaEntries: mediaHydration.entries,
      mediaIssues: mediaHydration.issues,
      analysisEntries,
    },
  }, transferables);
}

async function handleImportAudioBuffer(
  request: Extract<ProjectWorkerRequest, { type: "import_audio_buffer" }>,
): Promise<void> {
  await ensureWasmReady();
  assertRequestActive(request);

  const contentHash = await computeMediaContentHash(request.payload.buffer);
  assertRequestActive(request);
  const resolvedMediaId = resolveMediaIdByContentHash(
    request.payload.mediaId,
    contentHash,
    request.payload.existingMediaByHash,
  );
  let analysisRefs: string[] = [];
  let analysisError: string | null = null;
  try {
    ({ analysisRefs } = await workerAnalysisStore.ensureForBuffer(
      resolvedMediaId,
      request.payload.buffer,
    ));
  } catch (error) {
    analysisError = error instanceof Error ? error.message : String(error);
  }
  assertRequestActive(request);
  workerMediaCache.upsert([{
    mediaId: resolvedMediaId,
    buffer: request.payload.buffer,
  }]);
  const cacheSnapshot = workerMediaCache.snapshot();

  postResponse({
    type: "import_audio_buffer_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: {
      analysisEntries: collectAnalysisEntriesByIds(analysisRefs),
      analysisError,
      contentHash,
      resolvedMediaId,
      mediaCount: workerMediaCache.size,
      ...cacheSnapshot,
    },
  });
}

async function handleHashAudioBuffer(
  request: Extract<ProjectWorkerRequest, { type: "hash_audio_buffer" }>,
): Promise<void> {
  const contentHash = await computeMediaContentHash(request.payload.buffer);
  assertRequestActive(request);
  postResponse({
    type: "hash_audio_buffer_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { contentHash },
  });
}

async function handlePreparePlayback(
  request: Extract<ProjectWorkerRequest, { type: "prepare_playback" }>,
): Promise<void> {
  await ensureWasmReady();
  assertRequestActive(request);
  const diagnostics = createPlaybackPreparationDiagnostics();
  const progressCounts = createPlaybackPreparationPhaseCounts();
  const workerReceivedAtMs = nowPerfEpochMs();
  const requestPayloadJsonBytes = measureJsonBytes({
    ...request.payload,
    mediaEntries: request.payload.mediaEntries.map((entry) => entry.mediaId),
  });
  const requestProjectJsonBytes = measureJsonBytes(request.payload.project);
  let firstProgressSentAtMs: number | null = null;
  let progressMessageCount = 0;
  let progressPostMessageDurationMs = 0;
  const requestMedia = materializeRequestMedia(
    request.payload.project,
    request.payload.mediaEntries,
  );

  let schedule;
  try {
    schedule = await preparePlaybackSchedule(
      request.payload.project,
      requestMedia.lookup,
      workerAnalysisStore,
      {
        startTick: request.payload.startTick,
        projectRevision: request.projectRevision,
        knownRenderKeys: new Set(request.payload.knownRenderKeys),
        tdPsolaCore: request.payload.tdPsolaCore,
        outputSampleRate: request.payload.outputSampleRate,
        diagnostics,
        onProgress: (progress) => {
          const sentAtMs = nowPerfEpochMs();
          if (firstProgressSentAtMs === null) {
            firstProgressSentAtMs = sentAtMs;
          }
          progressMessageCount += 1;
          progressCounts[progress.phase] += 1;
          const postStartedAt = performance.now();
          postProgress(request, {
            operation: "prepare_playback",
            phase: progress.phase,
            progress: progress.progress,
            sentAtMs,
          });
          progressPostMessageDurationMs += performance.now() - postStartedAt;
        },
      },
    );
  } finally {
    admitRequestMediaToCache(requestMedia);
  }
  assertRequestActive(request);

  const resultScheduleMetadataBytes = measurePreparedPlaybackScheduleMetadataBytes(schedule);
  const { bufferCount: resultBufferCount, bufferBytes: resultBufferBytes } =
    measurePreparedPlaybackBufferBytes(schedule);
  diagnostics.resultScheduleMetadataBytes = resultScheduleMetadataBytes;
  diagnostics.resultBufferCount = resultBufferCount;
  diagnostics.resultBufferBytes = resultBufferBytes;

  const transferables: Transferable[] = [];
  for (const clip of schedule.clips) {
    if (clip.buffer) {
      transferables.push(...collectAudioBufferTransferables(clip.buffer));
    }
  }
  const resultPostedAtMs = nowPerfEpochMs();
  const cacheSnapshot = workerMediaCache.snapshot();
  postResponse({
    type: "prepare_playback_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: {
      schedule,
      ...cacheSnapshot,
      metrics: {
        workerReceivedAtMs,
        firstProgressSentAtMs,
        resultPostedAtMs,
        requestPayloadJsonBytes,
        requestProjectJsonBytes,
        requestKnownRenderKeyCount: request.payload.knownRenderKeys.length,
        resultScheduleMetadataBytes,
        resultBufferCount,
        resultBufferBytes,
        progressMessageCount,
        progressMessageCounts: progressCounts,
        progressPostMessageDurationMs,
        diagnostics,
      },
    },
  }, transferables);
}

async function handleBuildProjectArchive(
  request: Extract<ProjectWorkerRequest, { type: "build_project_archive" }>,
): Promise<void> {
  await ensureWasmReady();
  assertRequestActive(request);
  const requestMedia = materializeRequestMedia(
    request.payload.project,
    request.payload.mediaEntries,
  );

  let archiveBytes: Uint8Array;
  try {
    const archivePayload = prepareCanonicalProjectArchivePayload(
      request.payload.project,
      workerAnalysisStore.getStore(),
    );
    const mediaFiles = buildProjectArchiveMediaFiles(
      archivePayload.document,
      requestMedia.lookup,
    );
    const analysisFiles = buildProjectArchiveAnalysisFiles(
      archivePayload.document,
      workerAnalysisStore.getStore(),
    );
    archiveBytes = buildProjectArchive(
      archivePayload.projectJson,
      mediaFiles,
      analysisFiles,
    );
  } finally {
    admitRequestMediaToCache(requestMedia);
  }
  assertRequestActive(request);
  const cacheSnapshot = workerMediaCache.snapshot();

  postResponse({
    type: "build_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { bytes: archiveBytes, ...cacheSnapshot },
  }, [archiveBytes.buffer as ArrayBuffer]);
}

async function handleRenderWavExport(
  request: Extract<ProjectWorkerRequest, { type: "render_wav_export" }>,
): Promise<void> {
  await ensureWasmReady();
  assertRequestActive(request);
  const requestMedia = materializeRequestMedia(
    request.payload.project,
    request.payload.mediaEntries,
  );

  let rendered: AudioBufferData;
  try {
    rendered = await renderProjectToAudioBufferData(
      request.payload.project,
      requestMedia.lookup,
      workerAnalysisStore,
      request.payload.options,
      (progress) => {
        postProgress(request, {
          operation: "render_wav_export",
          phase: progress.phase,
          progress: progress.progress,
        });
      },
    );
  } finally {
    admitRequestMediaToCache(requestMedia);
  }
  assertRequestActive(request);

  const wavBytes = encodeWav(rendered);
  const cacheSnapshot = workerMediaCache.snapshot();
  postResponse({
    type: "render_wav_export_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { bytes: wavBytes, ...cacheSnapshot },
  }, [wavBytes]);
}

async function handleCompareF0Backends(
  request: Extract<ProjectWorkerRequest, { type: "compare_f0_backends" }>,
): Promise<void> {
  await ensureWasmReady();
  assertRequestActive(request);

  const mono = request.payload.buffer.channels[0] ?? new Float32Array(request.payload.buffer.length);
  const analyses = request.payload.backends.map((backend) => {
    const artifactJson = analyze_f0_buffer_with_backend(
      mono,
      request.payload.buffer.sampleRate,
      request.payload.mediaId,
      backend,
    );
    const artifact = JSON.parse(artifactJson) as { f0_hz_x100?: number[] };
    const frames = artifact.f0_hz_x100 ?? [];
    const voicedFrameCount = frames.filter((value) => value > 0).length;
    const frameCount = frames.length;
    return {
      backend,
      artifactJson,
      voicedFrameCount,
      frameCount,
      voicedRatio: voicedFrameCount / Math.max(1, frameCount),
    };
  });

  postResponse({
    type: "compare_f0_backends_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: request.projectRevision,
    requestId: request.requestId,
    payload: { analyses },
  });
}

self.onmessage = (event: MessageEvent<ProjectWorkerRequest>) => {
  const request = event.data;
  if (!request || typeof request !== "object" || !("type" in request)) {
    return;
  }

  if (request.type === "cancel_request") {
    try {
      validateEnvelope(request);
    } catch (error) {
      if (error instanceof ProjectWorkerError) {
        postError(request, error.code, error.message);
      }
      return;
    }
    const target = request.payload.canceledRequestId;
    if (inflightRequestIds.has(target)) {
      canceledRequests.add(target);
    }
    return;
  }

  inflightRequestIds.add(request.requestId);
  const run = async () => {
    validateEnvelope(request);

    switch (request.type) {
      case "parse_project_archive":
        handleParseProjectArchive(request);
        return;
      case "replace_media":
        handleReplaceMedia(request);
        return;
      case "replace_analysis_artifacts":
        handleReplaceAnalysisArtifacts(request);
        return;
      case "import_audio_buffer":
        await handleImportAudioBuffer(request);
        return;
      case "hash_audio_buffer":
        await handleHashAudioBuffer(request);
        return;
      case "clear_project_cache":
        handleClearProjectCache(request);
        return;
      case "measure_runtime_memory":
        handleMeasureRuntimeMemory(request);
        return;
      case "prepare_playback":
        await handlePreparePlayback(request);
        return;
      case "build_project_archive":
        await handleBuildProjectArchive(request);
        return;
      case "render_wav_export":
        await handleRenderWavExport(request);
        return;
      case "compare_f0_backends":
        await handleCompareF0Backends(request);
        return;
      default:
        throw new ProjectWorkerError("UNKNOWN_TYPE", "Unknown request type.");
    }
  };

  run().catch((error) => {
    if (error instanceof ProjectWorkerError) {
      postError(request, error.code, error.message);
      return;
    }
    postError(
      request,
      "WORKER_FAILURE",
      error instanceof Error ? error.message : String(error),
    );
  }).finally(() => {
    inflightRequestIds.delete(request.requestId);
    canceledRequests.delete(request.requestId);
  });
};

export {};
