import type { PreparedPlaybackSchedule } from "./playbackPreparation.ts";
import {
  canReusePreparedPlaybackSchedule,
  measurePreparedPlaybackBufferBytes,
} from "./playbackPreparation.ts";
import type { RuntimeMemoryBucket } from "./runtimeMemoryDiagnostics.ts";

interface MainThreadRenderedPlaybackCache {
  getKnownRenderKeys(): Set<string>;
  getProcessedClipCacheStats(): RuntimeMemoryBucket;
  clearProcessedClipCache(): void;
}

export class PlaybackRuntimeCaches {
  private preparedSchedule: PreparedPlaybackSchedule | null = null;
  private readonly renderedCache: MainThreadRenderedPlaybackCache;

  constructor(renderedCache: MainThreadRenderedPlaybackCache) {
    this.renderedCache = renderedCache;
  }

  getPreparedSchedule(): PreparedPlaybackSchedule | null {
    return this.preparedSchedule;
  }

  setPreparedSchedule(schedule: PreparedPlaybackSchedule): void {
    // Main-thread ownership lives in PlaybackEngine's byte-bounded AudioBuffer
    // cache. Keep only schedule metadata for loop restart/reuse.
    this.preparedSchedule = {
      ...schedule,
      clips: schedule.clips.map((clip) => ({ ...clip, buffer: undefined })),
    };
  }

  clearPreparedSchedule(): void {
    this.preparedSchedule = null;
  }

  collectKnownRenderKeys(): Set<string> {
    // A metadata-only schedule does not own buffers. Never advertise its keys
    // after the main AudioBuffer LRU has evicted them.
    return this.renderedCache.getKnownRenderKeys();
  }

  canReusePreparedSchedule(projectRevision: number, startTick: number): boolean {
    if (!canReusePreparedPlaybackSchedule(this.preparedSchedule, projectRevision, startTick)) {
      return false;
    }
    const knownRenderKeys = this.renderedCache.getKnownRenderKeys();
    return this.preparedSchedule!.clips.every((clip) => knownRenderKeys.has(clip.renderKey));
  }

  getMemorySnapshot(): {
    renderedAudioBuffers: RuntimeMemoryBucket;
    preparedRenderedPcm: RuntimeMemoryBucket;
  } {
    const prepared = this.preparedSchedule
      ? measurePreparedPlaybackBufferBytes(this.preparedSchedule)
      : { bufferCount: 0, bufferBytes: 0 };
    return {
      renderedAudioBuffers: this.renderedCache.getProcessedClipCacheStats(),
      preparedRenderedPcm: {
        count: prepared.bufferCount,
        bytes: prepared.bufferBytes,
      },
    };
  }

  clear(): void {
    this.clearPreparedSchedule();
    this.renderedCache.clearProcessedClipCache();
  }
}
