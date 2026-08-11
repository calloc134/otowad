import assert from "node:assert/strict";
import test from "node:test";

import type { PreparedPlaybackSchedule } from "./playbackPreparation.ts";
import { PlaybackRuntimeCaches } from "./playbackRuntimeCaches.ts";

test("worker recovery clears prepared schedules and main-thread rendered keys together", () => {
  const renderedKeys = new Set(["rendered-key"]);
  let renderedCacheClearCount = 0;
  const caches = new PlaybackRuntimeCaches({
    getKnownRenderKeys: () => new Set(renderedKeys),
    getProcessedClipCacheStats: () => ({ count: renderedKeys.size, bytes: 16 }),
    clearProcessedClipCache: () => {
      renderedCacheClearCount += 1;
      renderedKeys.clear();
    },
  });
  const preparedSchedule = {
    startTick: 0,
    startOffsetSec: 0,
    projectRevision: 1,
    clips: [{
      renderKey: "prepared-key",
      buffer: {
        numberOfChannels: 1,
        sampleRate: 4,
        length: 4,
        channels: [new Float32Array(4)],
      },
    }],
  } as PreparedPlaybackSchedule;
  caches.setPreparedSchedule(preparedSchedule);

  assert.deepEqual(caches.getMemorySnapshot(), {
    renderedAudioBuffers: { count: 1, bytes: 16 },
    preparedRenderedPcm: { count: 0, bytes: 0 },
  });

  assert.deepEqual(
    Array.from(caches.collectKnownRenderKeys()).sort(),
    ["rendered-key"],
  );
  assert.equal(caches.canReusePreparedSchedule(1, 0), false);
  renderedKeys.add("prepared-key");
  assert.equal(caches.canReusePreparedSchedule(1, 0), true);

  caches.clear();

  assert.equal(caches.getPreparedSchedule(), null);
  assert.equal(caches.collectKnownRenderKeys().size, 0);
  assert.equal(renderedCacheClearCount, 1);
});
