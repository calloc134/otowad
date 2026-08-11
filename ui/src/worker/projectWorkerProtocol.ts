import type { AudioBufferData } from "../audio/audioBufferData.ts";
import type { TdPsolaSynthesisCore } from "../audio/clipRenderPlan.ts";
import type { WorkerRuntimeMemorySnapshot } from "../audio/runtimeMemoryDiagnostics.ts";
import type {
  PreparedPlaybackSchedule,
  PreparePlaybackWorkerMetrics,
} from "../audio/playbackPreparation.ts";
import type { RenderMixdownOptions, RenderMixdownProgress } from "../render/index.ts";
import type { AnalysisArtifact, AnalysisId, ProjectDocument } from "../types";

export const PROJECT_WORKER_VERSION = 8;

export type ProjectWorkerErrorCode =
  | "UNKNOWN_VERSION"
  | "UNKNOWN_TYPE"
  | "STALE_REVISION"
  | "STALE_WORKER_GENERATION"
  | "REQUEST_CANCELED"
  | "MISSING_MEDIA"
  | "WORKER_FAILURE"
  | "WORKER_TERMINATED";

export interface WorkerMediaEntry {
  mediaId: string;
  buffer: AudioBufferData;
}

export interface WorkerMediaCacheSnapshot {
  cachedMediaIds: string[];
  sourcePcmBytes: number;
}

export interface WorkerKnownMediaHash {
  mediaId: string;
  contentHash: string;
}

export interface WorkerArchiveMediaEntry {
  path: string;
  bytes: Uint8Array;
}

export interface WorkerHydratedMediaEntry {
  mediaId: string;
  buffer: AudioBufferData;
}

export interface WorkerMediaAvailabilityIssue {
  mediaId: string;
  status: "missing" | "invalid";
  message: string;
}

export interface WorkerAnalysisArtifactEntry {
  analysisId: AnalysisId;
  artifact: AnalysisArtifact;
}

export interface WorkerF0BackendAnalysis {
  backend: "legacy_loqa" | "internal_autocorr";
  artifactJson: string;
  voicedFrameCount: number;
  frameCount: number;
  voicedRatio: number;
}

export interface WorkerRequestEnvelope<TType extends string, TPayload> {
  type: TType;
  version: number;
  workerGeneration: number;
  projectRevision: number;
  requestId: string;
  payload: TPayload;
}

export interface WorkerResponseEnvelope<TType extends string, TPayload> {
  type: TType;
  version: number;
  workerGeneration: number;
  projectRevision: number;
  requestId: string;
  payload: TPayload;
}

export type ProjectWorkerRequest =
  | WorkerRequestEnvelope<
      "parse_project_archive",
      { bytes: ArrayBuffer; fileName: string }
    >
  | WorkerRequestEnvelope<
      "replace_media",
      { mode: "replace_all" | "upsert"; entries: WorkerMediaEntry[] }
    >
  | WorkerRequestEnvelope<
      "replace_analysis_artifacts",
      { mode: "replace_all" | "upsert"; entries: WorkerAnalysisArtifactEntry[] }
    >
  | WorkerRequestEnvelope<
      "import_audio_buffer",
      {
        mediaId: string;
        buffer: AudioBufferData;
        existingMediaByHash: WorkerKnownMediaHash[];
      }
    >
  | WorkerRequestEnvelope<"hash_audio_buffer", { buffer: AudioBufferData }>
  | WorkerRequestEnvelope<"clear_project_cache", { reason?: string }>
  | WorkerRequestEnvelope<"measure_runtime_memory", Record<string, never>>
  | WorkerRequestEnvelope<
      "prepare_playback",
      {
        project: ProjectDocument;
        startTick: number;
        knownRenderKeys: string[];
        tdPsolaCore: TdPsolaSynthesisCore;
        outputSampleRate: number;
        mediaEntries: WorkerMediaEntry[];
      }
    >
  | WorkerRequestEnvelope<
      "build_project_archive",
      { project: ProjectDocument; mediaEntries: WorkerMediaEntry[] }
    >
  | WorkerRequestEnvelope<
      "render_wav_export",
      {
        project: ProjectDocument;
        options?: Partial<RenderMixdownOptions>;
        mediaEntries: WorkerMediaEntry[];
      }
    >
  | WorkerRequestEnvelope<
      "compare_f0_backends",
      {
        mediaId: string;
        buffer: AudioBufferData;
        backends: Array<"legacy_loqa" | "internal_autocorr">;
      }
    >
  | WorkerRequestEnvelope<"cancel_request", { canceledRequestId: string }>;

// Cache-ingest requests (media/analysis uploads) are idempotent upserts whose
// caches survive across edit revisions, so rejecting them as STALE_REVISION
// would silently drop media that later playback requests depend on. Only
// requests that read the project document participate in the monotonic
// revision gate.
export const REVISION_EXEMPT_REQUEST_TYPES: ReadonlySet<ProjectWorkerRequest["type"]> = new Set<
  ProjectWorkerRequest["type"]
>([
  "parse_project_archive",
  "cancel_request",
  "replace_media",
  "replace_analysis_artifacts",
  "import_audio_buffer",
  "hash_audio_buffer",
  "measure_runtime_memory",
]);

export function isRevisionGatedRequestType(type: ProjectWorkerRequest["type"]): boolean {
  return !REVISION_EXEMPT_REQUEST_TYPES.has(type);
}

export type ProjectWorkerProgressPayload =
  | {
      operation: "prepare_playback";
      phase:
        | "analyzing"
        | "compiling"
        | "enumerating_candidates"
        | "building_render_keys"
        | "rendering_missing_buffers"
        | "finalizing"
        | "done";
      progress: number;
      sentAtMs?: number;
    }
  | {
      operation: "render_wav_export";
      phase: RenderMixdownProgress["phase"];
      progress: number;
    };

export type ProjectWorkerResponse =
  | WorkerResponseEnvelope<
      "parse_project_archive_result",
      {
        projectJson: string;
        hydratedMediaEntries: WorkerHydratedMediaEntry[];
        mediaIssues: WorkerMediaAvailabilityIssue[];
        analysisEntries: WorkerArchiveMediaEntry[];
      }
    >
  | WorkerResponseEnvelope<
      "replace_media_result",
      { mediaCount: number } & WorkerMediaCacheSnapshot
    >
  | WorkerResponseEnvelope<
      "replace_analysis_artifacts_result",
      { analysisCount: number }
    >
  | WorkerResponseEnvelope<
      "import_audio_buffer_result",
      {
        analysisEntries: WorkerAnalysisArtifactEntry[];
        analysisError: string | null;
        contentHash: string;
        resolvedMediaId: string;
        mediaCount: number;
      } & WorkerMediaCacheSnapshot
    >
  | WorkerResponseEnvelope<"hash_audio_buffer_result", { contentHash: string }>
  | WorkerResponseEnvelope<"clear_project_cache_result", { ok: true }>
  | WorkerResponseEnvelope<
      "measure_runtime_memory_result",
      WorkerRuntimeMemorySnapshot
    >
  | WorkerResponseEnvelope<
      "prepare_playback_result",
      {
        schedule: PreparedPlaybackSchedule;
        metrics: PreparePlaybackWorkerMetrics;
      } & WorkerMediaCacheSnapshot
    >
  | WorkerResponseEnvelope<
      "build_project_archive_result",
      { bytes: Uint8Array } & WorkerMediaCacheSnapshot
    >
  | WorkerResponseEnvelope<
      "render_wav_export_result",
      { bytes: ArrayBuffer } & WorkerMediaCacheSnapshot
    >
  | WorkerResponseEnvelope<
      "compare_f0_backends_result",
      { analyses: WorkerF0BackendAnalysis[] }
    >
  | WorkerResponseEnvelope<"progress", ProjectWorkerProgressPayload>
  | WorkerResponseEnvelope<
      "request_error",
      { code: ProjectWorkerErrorCode; message: string }
    >;
