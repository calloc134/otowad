import type { AudioBufferData } from "../audio/audioBufferData.ts";
import { ByteBoundedLru } from "../audio/lruCache.ts";
import type { MediaSourceLookup } from "../audio/playbackPreparation.ts";
import type {
  WorkerMediaCacheSnapshot,
  WorkerMediaEntry,
} from "./projectWorkerProtocol.ts";

const WORKER_SOURCE_PCM_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export interface WorkerRequestMediaContext {
  lookup: MediaSourceLookup;
  suppliedEntries: WorkerMediaEntry[];
}

export class MissingWorkerMediaError extends Error {
  readonly mediaIds: string[];

  constructor(mediaIds: string[]) {
    super(`Worker request is missing source PCM for media: ${mediaIds.join(", ")}.`);
    this.mediaIds = mediaIds;
  }
}

export class WorkerMediaCache {
  private readonly lru: ByteBoundedLru<AudioBufferData>;

  constructor(maxBytes = WORKER_SOURCE_PCM_CACHE_MAX_BYTES) {
    this.lru = new ByteBoundedLru<AudioBufferData>({
      maxBytes,
      sizeOf: (buffer) => buffer.channels.reduce(
        (bytes, channel) => bytes + channel.byteLength,
        0,
      ),
      // Oversized sources remain request-local. Retaining one would make the
      // configured budget descriptive rather than enforceable.
      retainOversizedEntry: false,
    });
  }

  get size(): number {
    return this.lru.size;
  }

  get bytes(): number {
    return this.lru.bytes;
  }

  get(mediaId: string): AudioBufferData | undefined {
    return this.lru.get(mediaId);
  }

  values(): IterableIterator<AudioBufferData> {
    return this.lru.values();
  }

  clear(): void {
    this.lru.clear();
  }

  replaceAll(entries: readonly WorkerMediaEntry[]): void {
    this.clear();
    this.upsert(entries);
  }

  upsert(entries: readonly WorkerMediaEntry[]): void {
    for (const entry of entries) {
      this.lru.set(entry.mediaId, entry.buffer);
    }
  }

  materializeRequest(
    requiredMediaIds: readonly string[],
    mediaEntries: readonly WorkerMediaEntry[],
  ): WorkerRequestMediaContext {
    const suppliedById = new Map(
      mediaEntries.map((entry) => [entry.mediaId, entry] as const),
    );
    const requestBuffers = new Map<string, AudioBufferData>();
    const suppliedEntries: WorkerMediaEntry[] = [];
    const missingMediaIds: string[] = [];

    for (const mediaId of new Set(requiredMediaIds)) {
      const supplied = suppliedById.get(mediaId);
      const buffer = supplied?.buffer ?? this.lru.get(mediaId);
      if (!buffer) {
        missingMediaIds.push(mediaId);
        continue;
      }
      requestBuffers.set(mediaId, buffer);
      if (supplied) {
        suppliedEntries.push(supplied);
      }
    }

    if (missingMediaIds.length > 0) {
      throw new MissingWorkerMediaError(missingMediaIds);
    }

    return {
      lookup: { get: (mediaId) => requestBuffers.get(mediaId) },
      suppliedEntries,
    };
  }

  admitRequest(context: WorkerRequestMediaContext): void {
    this.upsert(context.suppliedEntries);
  }

  snapshot(): WorkerMediaCacheSnapshot {
    return {
      cachedMediaIds: Array.from(this.lru.keys()),
      sourcePcmBytes: this.lru.bytes,
    };
  }
}
