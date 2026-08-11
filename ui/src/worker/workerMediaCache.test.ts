import assert from "node:assert/strict";
import test from "node:test";

import type { AudioBufferData } from "../audio/audioBufferData.ts";
import { MissingWorkerMediaError, WorkerMediaCache } from "./workerMediaCache.ts";

function buffer(samples: number): AudioBufferData {
  return {
    numberOfChannels: 1,
    sampleRate: 48_000,
    length: samples,
    channels: [new Float32Array(samples)],
  };
}

test("request-local sources remain readable while steady worker PCM stays within budget", () => {
  const cache = new WorkerMediaCache(16);
  cache.upsert([{ mediaId: "cached", buffer: buffer(4) }]);

  const context = cache.materializeRequest(
    ["cached", "incoming"],
    [{ mediaId: "incoming", buffer: buffer(4) }],
  );
  assert.ok(context.lookup.get("cached"));
  assert.ok(context.lookup.get("incoming"));

  cache.admitRequest(context);
  assert.deepEqual(cache.snapshot(), {
    cachedMediaIds: ["incoming"],
    sourcePcmBytes: 16,
  });
});

test("an oversized source is request-local and is not retained after admission", () => {
  const cache = new WorkerMediaCache(16);
  const context = cache.materializeRequest(
    ["oversized"],
    [{ mediaId: "oversized", buffer: buffer(8) }],
  );

  assert.equal(context.lookup.get("oversized")?.length, 8);
  cache.admitRequest(context);
  assert.deepEqual(cache.snapshot(), {
    cachedMediaIds: [],
    sourcePcmBytes: 0,
  });
});

test("materialization reports every source missing from cache and request payload", () => {
  const cache = new WorkerMediaCache(16);
  assert.throws(
    () => cache.materializeRequest(["a", "b"], []),
    (error) => error instanceof MissingWorkerMediaError &&
      error.mediaIds.join(",") === "a,b",
  );
});
