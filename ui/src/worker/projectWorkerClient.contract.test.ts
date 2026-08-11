import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectWorkerClient,
  type ProjectWorkerLike,
} from "./projectWorkerClient.ts";
import type { ProjectWorkerRequest, ProjectWorkerResponse } from "./projectWorkerProtocol.ts";
import { PROJECT_WORKER_VERSION, isRevisionGatedRequestType } from "./projectWorkerProtocol.ts";

class FakeWorker implements ProjectWorkerLike {
  onmessage: ((event: MessageEvent<ProjectWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: Array<{ message: ProjectWorkerRequest; transferables: Transferable[] }> = [];
  terminated = false;

  postMessage(message: ProjectWorkerRequest, transferables: Transferable[] = []): void {
    this.posted.push({ message, transferables });
  }

  emit(message: ProjectWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<ProjectWorkerResponse>);
  }

  emitError(message = "worker crashed"): void {
    this.onerror?.({
      message,
      preventDefault() {},
    } as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({
      data: null,
      preventDefault() {},
    } as unknown as MessageEvent<unknown>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function createClient(worker: FakeWorker): ProjectWorkerClient {
  return new ProjectWorkerClient(() => worker);
}

test("cache-ingest request types are exempt from the revision gate", () => {
  // Idempotent cache uploads must never be rejected as STALE_REVISION; the
  // media/analysis they carry is valid across edit revisions.
  assert.equal(isRevisionGatedRequestType("replace_media"), false);
  assert.equal(isRevisionGatedRequestType("replace_analysis_artifacts"), false);
  assert.equal(isRevisionGatedRequestType("import_audio_buffer"), false);
  assert.equal(isRevisionGatedRequestType("hash_audio_buffer"), false);
  assert.equal(isRevisionGatedRequestType("parse_project_archive"), false);
  assert.equal(isRevisionGatedRequestType("cancel_request"), false);
  assert.equal(isRevisionGatedRequestType("measure_runtime_memory"), false);

  // Requests that read the project document stay gated.
  assert.equal(isRevisionGatedRequestType("prepare_playback"), true);
  assert.equal(isRevisionGatedRequestType("build_project_archive"), true);
  assert.equal(isRevisionGatedRequestType("render_wav_export"), true);
  assert.equal(isRevisionGatedRequestType("clear_project_cache"), true);
});

test("worker client rejects mismatched envelope version before resolving payload", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(4);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  worker.emit({
    type: "clear_project_cache_result",
    version: PROJECT_WORKER_VERSION + 1,
    workerGeneration: request.workerGeneration,
    projectRevision: 4,
    requestId: request.requestId,
    payload: { ok: true },
  });

  await assert.rejects(
    promise,
    new RegExp(`Unsupported worker version ${PROJECT_WORKER_VERSION + 1}`),
  );
});

test("worker client rejects stale project revisions before resolving payload", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(7);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  worker.emit({
    type: "request_error",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 6,
    requestId: request.requestId,
    payload: { code: "STALE_REVISION", message: "Request revision 6 is stale." },
  });

  await assert.rejects(promise, /Stale worker revision 6; expected 7/);
});

test("worker client rejects responses from a different worker generation", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(7);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  worker.emit({
    type: "clear_project_cache_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration + 1,
    projectRevision: 7,
    requestId: request.requestId,
    payload: { ok: true },
  });

  await assert.rejects(promise, /Stale worker generation 1; expected 0/);
});

test("worker client rejects unexpected success response types for a request", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(3);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  worker.emit({
    type: "replace_media_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 3,
    requestId: request.requestId,
    payload: { mediaCount: 0, cachedMediaIds: [], sourcePcmBytes: 0 },
  });

  await assert.rejects(promise, /Unexpected worker response replace_media_result/);
});

test("worker client accepts the new analysis artifact replacement response family", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.replaceAnalysisArtifacts([], 11, "replace_all");
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected replace analysis artifacts request");
  }

  worker.emit({
    type: "replace_analysis_artifacts_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 11,
    requestId: request.requestId,
    payload: { analysisCount: 0 },
  });

  await promise;
});

test("worker client accepts the imported-audio analysis response family", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.importAudioBuffer("media-1", {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 1,
    channels: [new Float32Array([0])],
  }, 12);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected import audio buffer request");
  }

  worker.emit({
    type: "import_audio_buffer_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 12,
    requestId: request.requestId,
    payload: {
      analysisEntries: [],
      analysisError: null,
      contentHash: "sha256-pcm24-v1:test",
      resolvedMediaId: "media-1",
      mediaCount: 1,
      cachedMediaIds: ["media-1"],
      sourcePcmBytes: 4,
    },
  });

  await promise;
});

test("worker client rejects unexpected progress families for a request", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(5);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  worker.emit({
    type: "progress",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 5,
    requestId: request.requestId,
    payload: {
      operation: "prepare_playback",
      phase: "compiling",
      progress: 0.2,
      sentAtMs: 123,
    },
  });

  await assert.rejects(promise, /Unexpected worker progress for clear_project_cache/);
});

test("cancelRequest rejects the pending promise immediately", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(5);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  // Cancellation must settle the promise without waiting for the worker to
  // reach a cancellation checkpoint.
  client.cancelRequest(request.requestId, 5);
  await assert.rejects(promise, /canceled/i);
});

test("a worker result arriving after cancellation is dropped, not resolved", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(5);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected clear project cache request");
  }

  client.cancelRequest(request.requestId, 5);
  await assert.rejects(promise, /canceled/i);

  // The worker finished before it saw the cancel message; its late result
  // must not surface anywhere (the promise already rejected).
  worker.emit({
    type: "clear_project_cache_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 5,
    requestId: request.requestId,
    payload: { ok: true },
  });
});

test("cancel requests preserve the required worker envelope fields", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const pending = client.clearProjectCache(9);
  const activeRequest = worker.posted[0]?.message;
  if (!activeRequest) {
    throw new Error("expected active request");
  }

  client.cancelRequest(activeRequest.requestId, 9);

  const request = worker.posted[1]?.message;
  if (!request) {
    throw new Error("expected cancel request");
  }

  assert.equal(request.type, "cancel_request");
  assert.equal(request.version, PROJECT_WORKER_VERSION);
  assert.equal(request.workerGeneration, activeRequest.workerGeneration);
  assert.equal(request.projectRevision, 9);
  assert.equal(typeof request.requestId, "string");
  assert.equal(request.payload.canceledRequestId, activeRequest.requestId);
  await assert.rejects(pending, /canceled/i);
});

test("cancelRequest does not create a worker for an unknown request", () => {
  let workerFactoryCalls = 0;
  const client = new ProjectWorkerClient(() => {
    workerFactoryCalls += 1;
    return new FakeWorker();
  });

  client.cancelRequest("unknown-request", 9);

  assert.equal(workerFactoryCalls, 0);
});

test("worker failure rejects all pending requests and recovers with a new generation", async () => {
  const firstWorker = new FakeWorker();
  const recoveredWorker = new FakeWorker();
  let workerFactoryCalls = 0;
  const client = new ProjectWorkerClient(() => {
    const worker = workerFactoryCalls === 0
      ? firstWorker
      : workerFactoryCalls === 1
      ? recoveredWorker
      : null;
    workerFactoryCalls += 1;
    if (!worker) {
      throw new Error("unexpected worker creation");
    }
    return worker;
  });
  const recoveredGenerations: number[] = [];
  client.subscribeWorkerReset(({ workerGeneration }) => {
    recoveredGenerations.push(workerGeneration);
  });

  const first = client.clearProjectCache(4);
  const second = client.replaceAnalysisArtifacts([], 4, "replace_all");
  firstWorker.emitError();

  await Promise.all([
    assert.rejects(first, (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      error.code === "WORKER_TERMINATED"
    )),
    assert.rejects(second, (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      error.code === "WORKER_TERMINATED"
    )),
  ]);
  assert.equal(firstWorker.terminated, true);
  assert.deepEqual(recoveredGenerations, [1]);

  const recovered = client.clearProjectCache(5);
  const recoveredRequest = recoveredWorker.posted[0]?.message;
  if (!recoveredRequest) {
    throw new Error("expected recovered worker request");
  }
  assert.equal(recoveredRequest.workerGeneration, 1);
  recoveredWorker.emit({
    type: "clear_project_cache_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: recoveredRequest.workerGeneration,
    projectRevision: 5,
    requestId: recoveredRequest.requestId,
    payload: { ok: true },
  });

  await recovered;
  assert.equal(workerFactoryCalls, 2);
});

test("message deserialization failure rejects pending work and resets the worker", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.clearProjectCache(6);

  worker.emitMessageError();

  await assert.rejects(promise, /deserialize/i);
  assert.equal(worker.terminated, true);
});

test("worker client accepts compare_f0_backends response family", async () => {
  const worker = new FakeWorker();
  const client = createClient(worker);
  const promise = client.compareF0Backends("media-1", {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 2,
    channels: [new Float32Array([0, 1])],
  }, 14);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected compare f0 backends request");
  }

  worker.emit({
    type: "compare_f0_backends_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 14,
    requestId: request.requestId,
    payload: {
      analyses: [{
        backend: "legacy_loqa",
        artifactJson: "{}",
        voicedFrameCount: 1,
        frameCount: 2,
        voicedRatio: 0.5,
      }],
    },
  });

  const result = await promise;
  assert.equal(result[0]?.backend, "legacy_loqa");
});
