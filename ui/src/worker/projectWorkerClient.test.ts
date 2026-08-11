import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectWorkerClient,
  type ProjectWorkerLike,
} from "./projectWorkerClient.ts";
import type { ProjectWorkerRequest, ProjectWorkerResponse } from "./projectWorkerProtocol.ts";
import { PROJECT_WORKER_VERSION } from "./projectWorkerProtocol.ts";
import { createBaseTimelineProject } from "../test/projectTestUtils.ts";
import { DEFAULT_TDPSOLA_CORE } from "../audio/clipRenderPlan.ts";

class FakeWorker implements ProjectWorkerLike {
  onmessage: ((event: MessageEvent<ProjectWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: Array<{ message: ProjectWorkerRequest; transferables: Transferable[] }> = [];

  postMessage(message: ProjectWorkerRequest, transferables: Transferable[] = []): void {
    this.posted.push({ message, transferables });
  }

  emit(message: ProjectWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<ProjectWorkerResponse>);
  }

  terminate(): void {}
}

test("worker playback preparation defaults to source-native TD-PSOLA", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const requestHandle = client.preparePlayback(
    { schema_version: 4, meta: {} as never, edit: {} as never },
    0,
    0,
    [],
    { scheduleCacheMissReason: "empty", outputSampleRate: 48_000 },
  );
  const request = worker.posted[0]?.message;
  if (!request || request.type !== "prepare_playback") {
    throw new Error("expected prepare playback request");
  }

  assert.equal(DEFAULT_TDPSOLA_CORE, "source_native_v2");
  assert.equal(request.payload.tdPsolaCore, "source_native_v2");
  assert.equal(request.payload.outputSampleRate, 48_000);
  client.cancelRequest(requestHandle.requestId, 0);
  await assert.rejects(requestHandle.promise, /canceled/i);
});

test("worker client forwards progress events before resolving the request", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const seen: string[] = [];

  const { promise } = client.preparePlayback(
    { schema_version: 4, meta: {} as never, edit: {} as never },
    3,
    240,
    [],
    {
      scheduleCacheMissReason: "empty",
      tdPsolaCore: "source_native_v2",
      outputSampleRate: 96_000,
    },
    (progress) => {
    seen.push(`${progress.operation}:${progress.phase}`);
    },
  );
  const requestId = worker.posted[0]?.message.requestId;
  if (!requestId) {
    throw new Error("expected prepare playback request");
  }
  const request = worker.posted[0]?.message;
  assert.equal(request?.type, "prepare_playback");
  if (request?.type === "prepare_playback") {
    assert.equal(request.payload.tdPsolaCore, "source_native_v2");
    assert.equal(request.payload.outputSampleRate, 96_000);
  }

  worker.emit({
    type: "progress",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 3,
    requestId,
    payload: {
      operation: "prepare_playback",
      phase: "compiling",
      progress: 0.4,
      sentAtMs: 123,
    },
  });
  worker.emit({
    type: "prepare_playback_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 3,
    requestId,
    payload: {
      cachedMediaIds: [],
      sourcePcmBytes: 0,
      schedule: {
        startTick: 240,
        startOffsetSec: 0,
        projectRevision: 3,
        clips: [],
      },
      metrics: {
        workerReceivedAtMs: 100,
        firstProgressSentAtMs: 123,
        resultPostedAtMs: 140,
        requestPayloadJsonBytes: 10,
        requestProjectJsonBytes: 5,
        requestKnownRenderKeyCount: 0,
        resultScheduleMetadataBytes: 12,
        resultBufferCount: 0,
        resultBufferBytes: 0,
        progressMessageCount: 1,
        progressMessageCounts: {
          analyzing: 0,
          compiling: 1,
          enumerating_candidates: 0,
          building_render_keys: 0,
          rendering_missing_buffers: 0,
          finalizing: 0,
          done: 0,
        },
        progressPostMessageDurationMs: 0.2,
        diagnostics: {
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
          resultScheduleMetadataBytes: 12,
          resultBufferCount: 0,
          resultBufferBytes: 0,
          totalPrepareDurationMs: 0,
        },
      },
    },
  });

  const result = await promise;
  assert.deepEqual(seen, ["prepare_playback:compiling"]);
  assert.equal(result.startTick, 240);
});

test("worker archive parsing keeps analysis entries separate from media entries", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const bytes = new ArrayBuffer(8);
  const promise = client.parseProjectArchive(bytes, "session.zip");
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected parse project archive request");
  }
  assert.deepEqual(client.getTransferMemorySnapshot(), {
    pcmCloneInFlightBytes: 0,
    pcmClonePeakBytes: 0,
    pcmCloneCumulativeBytes: 0,
    otherInFlightBytes: 0,
    otherPeakBytes: 8,
    otherCumulativeBytes: 8,
  });

  worker.emit({
    type: "parse_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 0,
    requestId: request.requestId,
    payload: {
      projectJson: "{}",
      hydratedMediaEntries: [{
        mediaId: "media-1",
        buffer: {
          numberOfChannels: 1,
          sampleRate: 44_100,
          length: 3,
          channels: [new Float32Array([0, 0.5, 1])],
        },
      }],
      mediaIssues: [],
      analysisEntries: [{ path: "analysis/test.json", bytes: new Uint8Array([4, 5]) }],
    },
  });

  const result = await promise;
  assert.deepEqual(result.hydratedMediaEntries.map((entry) => entry.mediaId), ["media-1"]);
  assert.deepEqual(result.analysisEntries.map((entry) => entry.path), ["analysis/test.json"]);
});

test("worker client imports audio and carries known hashes for duplicate resolution", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const promise = client.importAudioBuffer("media-proposed", {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 2,
    channels: [new Float32Array([0, 1])],
  }, 9, [{ mediaId: "media-existing", contentHash: "sha256-pcm24-v1:test" }]);
  const request = worker.posted[0]?.message;
  if (!request) {
    throw new Error("expected import audio buffer request");
  }
  assert.equal(request.type, "import_audio_buffer");
  if (request.type === "import_audio_buffer") {
    assert.deepEqual(request.payload.existingMediaByHash, [{
      mediaId: "media-existing",
      contentHash: "sha256-pcm24-v1:test",
    }]);
  }
  assert.deepEqual(client.getTransferMemorySnapshot(), {
    pcmCloneInFlightBytes: 0,
    pcmClonePeakBytes: 8,
    pcmCloneCumulativeBytes: 8,
    otherInFlightBytes: 0,
    otherPeakBytes: 0,
    otherCumulativeBytes: 0,
  });

  worker.emit({
    type: "import_audio_buffer_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 9,
    requestId: request.requestId,
    payload: {
      analysisEntries: [],
      analysisError: null,
      contentHash: "sha256-pcm24-v1:test",
      resolvedMediaId: "media-existing",
      mediaCount: 1,
      cachedMediaIds: ["media-existing"],
      sourcePcmBytes: 8,
    },
  });

  const result = await promise;
  assert.deepEqual(result, {
    analysisEntries: [],
    analysisError: null,
    contentHash: "sha256-pcm24-v1:test",
    mediaId: "media-existing",
  });
});

test("worker client hashes candidate audio without admitting it to the media cache", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const promise = client.hashAudioBuffer({
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 1,
    channels: [new Float32Array([0.5])],
  }, 10);
  const request = worker.posted[0]?.message;
  if (!request || request.type !== "hash_audio_buffer") {
    throw new Error("expected hash audio buffer request");
  }
  worker.emit({
    type: "hash_audio_buffer_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 10,
    requestId: request.requestId,
    payload: { contentHash: "sha256-pcm24-v1:candidate" },
  });

  assert.equal(await promise, "sha256-pcm24-v1:candidate");
});

test("worker client requests a classified runtime memory snapshot", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const promise = client.measureRuntimeMemory();
  const request = worker.posted[0]?.message;
  if (!request || request.type !== "measure_runtime_memory") {
    throw new Error("expected measure runtime memory request");
  }

  worker.emit({
    type: "measure_runtime_memory_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: request.workerGeneration,
    projectRevision: 0,
    requestId: request.requestId,
    payload: {
      sourcePcm: { count: 1, bytes: 8 },
      renderedPcm: { count: 2, bytes: 16 },
      analysis: { count: 3, bytes: 24 },
    },
  });

  assert.deepEqual(await promise, {
    sourcePcm: { count: 1, bytes: 8 },
    renderedPcm: { count: 2, bytes: 16 },
    analysis: { count: 3, bytes: 24 },
  });
});

test("worker client posts compare_f0_backends with media buffer transferables", async () => {
  const worker = new FakeWorker();
  const client = new ProjectWorkerClient(() => worker);
  const promise = client.compareF0Backends("media-1", {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 2,
    channels: [new Float32Array([0, 1])],
  }, 15);
  const posted = worker.posted[0];
  if (!posted) {
    throw new Error("expected compare f0 backends request");
  }

  assert.equal(posted.message.type, "compare_f0_backends");
  assert.equal(posted.message.payload.backends[0], "legacy_loqa");
  assert.equal(posted.message.payload.backends[1], "internal_autocorr");

  worker.emit({
    type: "compare_f0_backends_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: posted.message.workerGeneration,
    projectRevision: 15,
    requestId: posted.message.requestId,
    payload: {
      analyses: [],
    },
  });

  const result = await promise;
  assert.deepEqual(result, []);
});

test("consumer requests resend only source PCM evicted from the worker LRU", async () => {
  const worker = new FakeWorker();
  const project = createBaseTimelineProject();
  const mediaId = project.edit.media[0]!.id;
  const source = {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 2,
    channels: [new Float32Array([0, 1])],
  };
  const client = new ProjectWorkerClient(
    () => worker,
    (requestedMediaId) => requestedMediaId === mediaId ? source : undefined,
  );

  const firstPromise = client.buildProjectArchive(project, 1);
  const first = worker.posted[0]?.message;
  if (!first || first.type !== "build_project_archive") {
    throw new Error("expected first archive request");
  }
  assert.deepEqual(first.payload.mediaEntries.map((entry) => entry.mediaId), [mediaId]);
  worker.emit({
    type: "build_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: first.workerGeneration,
    projectRevision: 1,
    requestId: first.requestId,
    payload: {
      bytes: new Uint8Array(),
      cachedMediaIds: [mediaId],
      sourcePcmBytes: 8,
    },
  });
  await firstPromise;

  const secondPromise = client.buildProjectArchive(project, 1);
  const second = worker.posted[1]?.message;
  if (!second || second.type !== "build_project_archive") {
    throw new Error("expected second archive request");
  }
  assert.deepEqual(second.payload.mediaEntries, []);
  worker.emit({
    type: "build_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: second.workerGeneration,
    projectRevision: 1,
    requestId: second.requestId,
    payload: { bytes: new Uint8Array(), cachedMediaIds: [], sourcePcmBytes: 0 },
  });
  await secondPromise;

  const thirdPromise = client.buildProjectArchive(project, 1);
  const third = worker.posted[2]?.message;
  if (!third || third.type !== "build_project_archive") {
    throw new Error("expected third archive request");
  }
  assert.deepEqual(third.payload.mediaEntries.map((entry) => entry.mediaId), [mediaId]);
  worker.emit({
    type: "build_project_archive_result",
    version: PROJECT_WORKER_VERSION,
    workerGeneration: third.workerGeneration,
    projectRevision: 1,
    requestId: third.requestId,
    payload: { bytes: new Uint8Array(), cachedMediaIds: [], sourcePcmBytes: 0 },
  });
  await thirdPromise;
});
