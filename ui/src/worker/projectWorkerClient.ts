import {
  cloneAudioBufferSource,
  collectAudioBufferTransferables,
  type AudioBufferSource,
} from "../audio/audioBufferData.ts";
import {
  createPlaybackPreparationPhaseCounts,
  measureJsonBytes,
  nowPerfEpochMs,
} from "../audio/playbackPreparation.ts";
import type {
  PreparedPlaybackSchedule,
  PreparePlaybackClientMetrics,
  PreparePlaybackRequestMeasurement,
} from "../audio/playbackPreparation.ts";
import {
  DEFAULT_TDPSOLA_CORE,
  type TdPsolaSynthesisCore,
} from "../audio/clipRenderPlan.ts";
import { mediaCache } from "../audio/mediaCache.ts";
import {
  TransferMemoryTracker,
  type TransferMemoryCategory,
  type TransferMemorySnapshot,
} from "../audio/runtimeMemoryDiagnostics.ts";
import type { RenderMixdownOptions } from "../render/index.ts";
import { collectReferencedAudioMedia } from "../persist/projectArchive.ts";
import type { ProjectDocument } from "../types";
import type {
  ProjectWorkerErrorCode,
  ProjectWorkerProgressPayload,
  ProjectWorkerRequest,
  ProjectWorkerResponse,
  WorkerF0BackendAnalysis,
  WorkerAnalysisArtifactEntry,
  WorkerArchiveMediaEntry,
  WorkerHydratedMediaEntry,
  WorkerMediaAvailabilityIssue,
  WorkerMediaEntry,
  WorkerKnownMediaHash,
} from "./projectWorkerProtocol.ts";
import { PROJECT_WORKER_VERSION } from "./projectWorkerProtocol.ts";

type ManagedProjectWorkerRequest = Exclude<ProjectWorkerRequest, { type: "cancel_request" }>;
type ManagedProjectWorkerResponse = Exclude<ProjectWorkerResponse, { type: "progress" | "request_error" }>;

export type ProjectWorkerClientErrorCode =
  | ProjectWorkerErrorCode
  | "UNEXPECTED_RESPONSE_TYPE"
  | "UNEXPECTED_PROGRESS";

const RESPONSE_TYPE_BY_REQUEST_TYPE = {
  parse_project_archive: "parse_project_archive_result",
  replace_media: "replace_media_result",
  replace_analysis_artifacts: "replace_analysis_artifacts_result",
  import_audio_buffer: "import_audio_buffer_result",
  hash_audio_buffer: "hash_audio_buffer_result",
  clear_project_cache: "clear_project_cache_result",
  measure_runtime_memory: "measure_runtime_memory_result",
  prepare_playback: "prepare_playback_result",
  build_project_archive: "build_project_archive_result",
  render_wav_export: "render_wav_export_result",
  compare_f0_backends: "compare_f0_backends_result",
} satisfies Record<ManagedProjectWorkerRequest["type"], ManagedProjectWorkerResponse["type"]>;

export interface ParsedWorkerProjectArchive {
  projectJson: string;
  hydratedMediaEntries: WorkerHydratedMediaEntry[];
  mediaIssues: WorkerMediaAvailabilityIssue[];
  analysisEntries: WorkerArchiveMediaEntry[];
}

export interface ImportedAudioBufferResult {
  analysisEntries: WorkerAnalysisArtifactEntry[];
  analysisError: string | null;
  contentHash: string;
  mediaId: string;
}

const PROGRESS_OPERATION_BY_REQUEST_TYPE = {
  prepare_playback: "prepare_playback",
  render_wav_export: "render_wav_export",
} as const satisfies Partial<
  Record<ManagedProjectWorkerRequest["type"], ProjectWorkerProgressPayload["operation"]>
>;

function getExpectedProgressOperation(
  request: ManagedProjectWorkerRequest,
): ProjectWorkerProgressPayload["operation"] | null {
  switch (request.type) {
    case "prepare_playback":
    case "render_wav_export":
      return PROGRESS_OPERATION_BY_REQUEST_TYPE[request.type];
    default:
      return null;
  }
}

export interface ProjectWorkerLike {
  onmessage: ((event: MessageEvent<ProjectWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: ProjectWorkerRequest, transferables?: Transferable[]): void;
  terminate(): void;
}

class ProjectWorkerClientError extends Error {
  code: ProjectWorkerClientErrorCode;

  constructor(code: ProjectWorkerClientErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface PendingRequest {
  request: ManagedProjectWorkerRequest;
  workerGeneration: number;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (payload: ProjectWorkerProgressPayload) => void;
}

type WorkerMediaSourceProvider = (mediaId: string) => AudioBufferSource | undefined;

function isMediaConsumerRequest(
  request: ManagedProjectWorkerRequest,
): request is Extract<
  ManagedProjectWorkerRequest,
  { type: "prepare_playback" | "build_project_archive" | "render_wav_export" }
> {
  return request.type === "prepare_playback" ||
    request.type === "build_project_archive" ||
    request.type === "render_wav_export";
}

function assertWorkerResponseEnvelope(
  request: ManagedProjectWorkerRequest,
  response: ProjectWorkerResponse,
): void {
  if (response.version !== PROJECT_WORKER_VERSION) {
    throw new ProjectWorkerClientError(
      "UNKNOWN_VERSION",
      `Unsupported worker version ${response.version}.`,
    );
  }
  if (response.workerGeneration !== request.workerGeneration) {
    throw new ProjectWorkerClientError(
      "STALE_WORKER_GENERATION",
      `Stale worker generation ${response.workerGeneration}; expected ${request.workerGeneration}.`,
    );
  }
  if (response.projectRevision !== request.projectRevision) {
    throw new ProjectWorkerClientError(
      "STALE_REVISION",
      `Stale worker revision ${response.projectRevision}; expected ${request.projectRevision}.`,
    );
  }
  if (response.type === "request_error") {
    return;
  }
  if (response.type === "progress") {
    const expectedOperation = getExpectedProgressOperation(request);
    if (!expectedOperation) {
      throw new ProjectWorkerClientError(
        "UNEXPECTED_RESPONSE_TYPE",
        `Unexpected worker progress for ${request.type}.`,
      );
    }
    if (response.payload.operation !== expectedOperation) {
      throw new ProjectWorkerClientError(
        "UNEXPECTED_PROGRESS",
        `Unexpected worker progress ${response.payload.operation}; expected ${expectedOperation}.`,
      );
    }
    return;
  }

  const expectedType = RESPONSE_TYPE_BY_REQUEST_TYPE[request.type];
  if (response.type !== expectedType) {
    throw new ProjectWorkerClientError(
      "UNEXPECTED_RESPONSE_TYPE",
      `Unexpected worker response ${response.type}; expected ${expectedType}.`,
    );
  }
}

export class ProjectWorkerClient {
  private worker: ProjectWorkerLike | null = null;
  private workerGeneration = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly workerResetListeners = new Set<
    (event: { workerGeneration: number; error: ProjectWorkerClientError }) => void
  >();
  private latestPreparePlaybackMeasurement: PreparePlaybackRequestMeasurement | null = null;
  private readonly transferMemory = new TransferMemoryTracker();
  private readonly workerFactory: () => ProjectWorkerLike;
  private readonly mediaSourceProvider: WorkerMediaSourceProvider | null;
  private workerCachedMediaIds = new Set<string>();

  constructor(
    workerFactory: () => ProjectWorkerLike = () =>
      new Worker(new URL("./projectWorker.ts", import.meta.url), {
        type: "module",
      }),
    mediaSourceProvider: WorkerMediaSourceProvider | null = null,
  ) {
    this.workerFactory = workerFactory;
    this.mediaSourceProvider = mediaSourceProvider;
  }

  subscribeWorkerReset(
    listener: (event: {
      workerGeneration: number;
      error: ProjectWorkerClientError;
    }) => void,
  ): () => void {
    this.workerResetListeners.add(listener);
    return () => {
      this.workerResetListeners.delete(listener);
    };
  }

  private resetWorker(
    worker: ProjectWorkerLike,
    failedGeneration: number,
    message: string,
  ): void {
    if (this.worker !== worker || this.workerGeneration !== failedGeneration) {
      return;
    }

    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = null;
    this.workerGeneration += 1;
    this.workerCachedMediaIds.clear();
    this.latestPreparePlaybackMeasurement = null;

    const error = new ProjectWorkerClientError("WORKER_TERMINATED", message);
    for (const [requestId, pending] of this.pending) {
      if (pending.workerGeneration !== failedGeneration) {
        continue;
      }
      this.pending.delete(requestId);
      pending.reject(error);
    }

    const resetEvent = { workerGeneration: this.workerGeneration, error };
    for (const listener of this.workerResetListeners) {
      listener(resetEvent);
    }
  }

  private ensureWorker(): ProjectWorkerLike {
    if (!this.worker) {
      const worker = this.workerFactory();
      const workerGeneration = this.workerGeneration;
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<ProjectWorkerResponse>) => {
        if (this.worker !== worker || this.workerGeneration !== workerGeneration) {
          return;
        }
        const message = event.data;
        const pending = this.pending.get(message.requestId);
        if (!pending || pending.workerGeneration !== workerGeneration) return;

        try {
          assertWorkerResponseEnvelope(pending.request, message);
          if (message.type === "progress") {
            pending.onProgress?.(message.payload);
            return;
          }

          this.pending.delete(message.requestId);
          if (message.type === "request_error") {
            if (isMediaConsumerRequest(pending.request)) {
              // An error can happen after request-local media was admitted to
              // the LRU. Forget the client mirror so the next attempt safely
              // resends every referenced source.
              this.workerCachedMediaIds.clear();
            }
            pending.reject(
              new ProjectWorkerClientError(message.payload.code, message.payload.message),
            );
            return;
          }

          pending.resolve(message.payload as never);
        } catch (error) {
          this.pending.delete(message.requestId);
          pending.reject(error);
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        this.resetWorker(
          worker,
          workerGeneration,
          event.message
            ? `Project worker terminated: ${event.message}`
            : "Project worker terminated unexpectedly.",
        );
      };
      worker.onmessageerror = (event: MessageEvent<unknown>) => {
        event.preventDefault();
        this.resetWorker(
          worker,
          workerGeneration,
          "Project worker terminated after failing to deserialize a message.",
        );
      };
    }
    return this.worker;
  }

  private sendRequest<TResult>(
    request: ManagedProjectWorkerRequest,
    transferables: Transferable[] = [],
    onProgress?: (payload: ProjectWorkerProgressPayload) => void,
    transferCategory: TransferMemoryCategory = "other",
  ): Promise<TResult> {
    const worker = this.ensureWorker();
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(request.requestId, {
        request,
        workerGeneration: this.workerGeneration,
        resolve: (value) => resolve(value as TResult),
        reject,
        onProgress,
      });
      const transferBytes = measureTransferableBytes(transferables);
      this.transferMemory.begin(transferCategory, transferBytes);
      try {
        worker.postMessage(request, transferables);
      } catch (error) {
        this.pending.delete(request.requestId);
        reject(error);
      } finally {
        this.transferMemory.end(transferCategory, transferBytes);
      }
    });
  }

  getWorkerGeneration(): number {
    return this.workerGeneration;
  }

  getTransferMemorySnapshot(): TransferMemorySnapshot {
    return this.transferMemory.getSnapshot();
  }

  resetTransferMemorySnapshot(): void {
    this.transferMemory.reset();
  }

  private updateWorkerMediaCache(cachedMediaIds: readonly string[]): void {
    this.workerCachedMediaIds = new Set(cachedMediaIds);
  }

  private buildRequestMediaEntries(project: ProjectDocument): WorkerMediaEntry[] {
    if (!this.mediaSourceProvider) {
      return [];
    }
    return collectReferencedAudioMedia(project)
      .filter((asset) => !this.workerCachedMediaIds.has(asset.id))
      .map((asset) => {
        const source = this.mediaSourceProvider!(asset.id);
        if (!source) {
          throw new ProjectWorkerClientError(
            "MISSING_MEDIA",
            `Main thread has no decoded source for referenced media ${asset.id}.`,
          );
        }
        return {
          mediaId: asset.id,
          buffer: cloneAudioBufferSource(source),
        };
      });
  }

  cancelRequest(requestId: string, projectRevision: number): void {
    // Settle the pending promise immediately. Cancellation must not depend on
    // the worker reaching its next cancellation checkpoint: if the worker
    // finishes first, the caller would otherwise receive a canceled request's
    // result as a normal success. Any late response for this requestId is
    // dropped by the onmessage handler because the entry is gone.
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);
    pending.reject(
      new ProjectWorkerClientError("REQUEST_CANCELED", "Request was canceled by the client."),
    );

    const worker = this.worker;
    if (!worker || pending.workerGeneration !== this.workerGeneration) {
      return;
    }
    const cancelRequest: ProjectWorkerRequest = {
      type: "cancel_request",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: pending.workerGeneration,
      projectRevision,
      requestId: crypto.randomUUID(),
      payload: { canceledRequestId: requestId },
    };
    try {
      worker.postMessage(cancelRequest);
    } catch (error) {
      this.resetWorker(
        worker,
        pending.workerGeneration,
        `Project worker terminated while canceling a request: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async parseProjectArchive(
    bytes: ArrayBuffer,
    fileName: string,
  ): Promise<ParsedWorkerProjectArchive> {
    const requestId = crypto.randomUUID();
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "parse_project_archive_result" }>["payload"]
    >({
      type: "parse_project_archive",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision: 0,
      requestId,
      payload: { bytes, fileName },
    }, [bytes]);
    return payload;
  }

  async replaceMedia(
    entries: WorkerMediaEntry[],
    projectRevision: number,
    mode: "replace_all" | "upsert",
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    const transferables = entries.flatMap((entry) => collectAudioBufferTransferables(entry.buffer));
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "replace_media_result" }>["payload"]
    >({
      type: "replace_media",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { mode, entries },
    }, transferables, undefined, "pcm_clone");
    this.updateWorkerMediaCache(payload.cachedMediaIds);
  }

  async replaceAnalysisArtifacts(
    entries: WorkerAnalysisArtifactEntry[],
    projectRevision: number,
    mode: "replace_all" | "upsert",
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    await this.sendRequest({
      type: "replace_analysis_artifacts",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { mode, entries },
    });
  }

  async importAudioBuffer(
    mediaId: string,
    buffer: AudioBufferSource,
    projectRevision: number,
    existingMediaByHash: WorkerKnownMediaHash[] = [],
  ): Promise<ImportedAudioBufferResult> {
    const requestId = crypto.randomUUID();
    const cloned = cloneAudioBufferSource(buffer);
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "import_audio_buffer_result" }> ["payload"]
    >({
      type: "import_audio_buffer",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { mediaId, buffer: cloned, existingMediaByHash },
    }, collectAudioBufferTransferables(cloned), undefined, "pcm_clone");
    this.updateWorkerMediaCache(payload.cachedMediaIds);
    return {
      analysisEntries: payload.analysisEntries,
      analysisError: payload.analysisError,
      contentHash: payload.contentHash,
      mediaId: payload.resolvedMediaId,
    };
  }

  async hashAudioBuffer(
    buffer: AudioBufferSource,
    projectRevision: number,
  ): Promise<string> {
    const cloned = cloneAudioBufferSource(buffer);
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "hash_audio_buffer_result" }>["payload"]
    >({
      type: "hash_audio_buffer",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId: crypto.randomUUID(),
      payload: { buffer: cloned },
    }, collectAudioBufferTransferables(cloned), undefined, "pcm_clone");
    return payload.contentHash;
  }

  async upsertMediaBuffer(
    mediaId: string,
    buffer: AudioBufferSource,
    projectRevision: number,
  ): Promise<void> {
    await this.replaceMedia([
      {
        mediaId,
        buffer: cloneAudioBufferSource(buffer),
      },
    ], projectRevision, "upsert");
  }

  async clearProjectCache(projectRevision: number): Promise<void> {
    const requestId = crypto.randomUUID();
    await this.sendRequest({
      type: "clear_project_cache",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { reason: "client_reset" },
    });
    this.workerCachedMediaIds.clear();
  }

  async measureRuntimeMemory(): Promise<
    Extract<ProjectWorkerResponse, { type: "measure_runtime_memory_result" }>["payload"]
  > {
    return this.sendRequest({
      type: "measure_runtime_memory",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision: 0,
      requestId: crypto.randomUUID(),
      payload: {},
    });
  }

  getLatestPreparePlaybackMeasurement(): PreparePlaybackRequestMeasurement | null {
    return this.latestPreparePlaybackMeasurement;
  }

  preparePlayback(
    project: ProjectDocument,
    projectRevision: number,
    startTick: number,
    knownRenderKeys: Iterable<string>,
    measurementContext: {
      scheduleCacheMissReason: "empty" | "project_revision" | "start_tick";
      tdPsolaCore?: TdPsolaSynthesisCore;
      outputSampleRate: number;
    },
    onProgress?: (payload: Extract<ProjectWorkerProgressPayload, { operation: "prepare_playback" }>) => void,
  ): { requestId: string; promise: Promise<PreparedPlaybackSchedule> } {
    const requestId = crypto.randomUUID();
    const prepareCalledAtMs = nowPerfEpochMs();
    const knownRenderKeysArray = Array.from(knownRenderKeys);
    const mediaEntries = this.buildRequestMediaEntries(project);
    const requestPayload = {
      project,
      startTick,
      knownRenderKeys: knownRenderKeysArray,
      tdPsolaCore: measurementContext.tdPsolaCore ?? DEFAULT_TDPSOLA_CORE,
      outputSampleRate: measurementContext.outputSampleRate,
      mediaEntries,
    };
    const requestPayloadMeasurement = {
      ...requestPayload,
      mediaEntries: mediaEntries.map((entry) => entry.mediaId),
    };
    const clientMetrics: PreparePlaybackClientMetrics = {
      prepareCalledAtMs,
      requestPostedAtMs: prepareCalledAtMs,
      firstProgressReceivedAtMs: null,
      resultReceivedAtMs: null,
      requestPayloadJsonBytes: measureJsonBytes(requestPayloadMeasurement),
      requestProjectJsonBytes: measureJsonBytes(project),
      requestKnownRenderKeyCount: knownRenderKeysArray.length,
      progressMessageCount: 0,
      progressMessageCounts: createPlaybackPreparationPhaseCounts(),
      progressCallbackDurationMs: 0,
      progressCallbackDurationByPhaseMs: createPlaybackPreparationPhaseCounts(),
      progressTransportLatencyMs: 0,
      progressTransportMaxLatencyMs: 0,
    };

    const promise = this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "prepare_playback_result" }>["payload"]
    >({
      type: "prepare_playback",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: requestPayload,
    }, mediaEntries.flatMap((entry) => collectAudioBufferTransferables(entry.buffer)), (payload) => {
      if (payload.operation === "prepare_playback") {
        const progressReceivedAtMs = nowPerfEpochMs();
        if (clientMetrics.firstProgressReceivedAtMs === null) {
          clientMetrics.firstProgressReceivedAtMs = progressReceivedAtMs;
        }
        clientMetrics.progressMessageCount += 1;
        clientMetrics.progressMessageCounts[payload.phase] += 1;
        if (payload.sentAtMs !== undefined) {
          const transportLatencyMs = Math.max(0, progressReceivedAtMs - payload.sentAtMs);
          clientMetrics.progressTransportLatencyMs += transportLatencyMs;
          clientMetrics.progressTransportMaxLatencyMs = Math.max(
            clientMetrics.progressTransportMaxLatencyMs,
            transportLatencyMs,
          );
        }
        const progressCallbackStartedAt = performance.now();
        onProgress?.(payload);
        const progressCallbackDurationMs = performance.now() - progressCallbackStartedAt;
        clientMetrics.progressCallbackDurationMs += progressCallbackDurationMs;
        clientMetrics.progressCallbackDurationByPhaseMs[payload.phase] += progressCallbackDurationMs;
      }
    }, "pcm_clone").then((payload) => {
      this.updateWorkerMediaCache(payload.cachedMediaIds);
      clientMetrics.resultReceivedAtMs = nowPerfEpochMs();
      this.latestPreparePlaybackMeasurement = {
        requestId,
        projectRevision,
        startTick,
        scheduleCacheMissReason: measurementContext.scheduleCacheMissReason,
        client: clientMetrics,
        worker: payload.metrics,
        ui: {
          initialBusyTaskDispatchDurationMs: 0,
          playPreparedStartAtMs: 0,
          playPreparedEndAtMs: 0,
          playPreparedDurationMs: 0,
          busyTaskClearedAtMs: 0,
        },
      };
      return payload.schedule;
    });

    clientMetrics.requestPostedAtMs = nowPerfEpochMs();
    return { requestId, promise };
  }

  async buildProjectArchive(
    project: ProjectDocument,
    projectRevision: number,
  ): Promise<Uint8Array> {
    const requestId = crypto.randomUUID();
    const mediaEntries = this.buildRequestMediaEntries(project);
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "build_project_archive_result" }>["payload"]
    >({
      type: "build_project_archive",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { project, mediaEntries },
    }, mediaEntries.flatMap((entry) => collectAudioBufferTransferables(entry.buffer)), undefined, "pcm_clone");
    this.updateWorkerMediaCache(payload.cachedMediaIds);
    return payload.bytes;
  }

  renderWavExport(
    project: ProjectDocument,
    projectRevision: number,
    options?: Partial<RenderMixdownOptions>,
    onProgress?: (payload: Extract<ProjectWorkerProgressPayload, { operation: "render_wav_export" }>) => void,
  ): { requestId: string; promise: Promise<ArrayBuffer> } {
    const requestId = crypto.randomUUID();
    const mediaEntries = this.buildRequestMediaEntries(project);
    const promise = this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "render_wav_export_result" }>["payload"]
    >({
      type: "render_wav_export",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { project, options, mediaEntries },
    }, mediaEntries.flatMap((entry) => collectAudioBufferTransferables(entry.buffer)), (payload) => {
      if (payload.operation === "render_wav_export") {
        onProgress?.(payload);
      }
    }, "pcm_clone").then((payload) => {
      this.updateWorkerMediaCache(payload.cachedMediaIds);
      return payload.bytes;
    });

    return { requestId, promise };
  }

  async compareF0Backends(
    mediaId: string,
    buffer: AudioBufferSource,
    projectRevision: number,
    backends: Array<"legacy_loqa" | "internal_autocorr"> = ["legacy_loqa", "internal_autocorr"],
  ): Promise<WorkerF0BackendAnalysis[]> {
    const requestId = crypto.randomUUID();
    const cloned = cloneAudioBufferSource(buffer);
    const payload = await this.sendRequest<
      Extract<ProjectWorkerResponse, { type: "compare_f0_backends_result" }>["payload"]
    >({
      type: "compare_f0_backends",
      version: PROJECT_WORKER_VERSION,
      workerGeneration: this.workerGeneration,
      projectRevision,
      requestId,
      payload: { mediaId, buffer: cloned, backends },
    }, collectAudioBufferTransferables(cloned), undefined, "pcm_clone");
    return payload.analyses;
  }
}

function measureTransferableBytes(transferables: readonly Transferable[]): number {
  const buffers = new Set<ArrayBuffer>();
  for (const transferable of transferables) {
    if (transferable instanceof ArrayBuffer) {
      buffers.add(transferable);
    }
  }
  let bytes = 0;
  for (const buffer of buffers) {
    bytes += buffer.byteLength;
  }
  return bytes;
}

export { ProjectWorkerClientError };
export const projectWorkerClient = new ProjectWorkerClient(
  undefined,
  (mediaId) => mediaCache.get(mediaId),
);
