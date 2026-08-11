// =============================================================================
// MediaCache — stores decoded AudioBuffers keyed by MediaId
// =============================================================================

import { audioBufferDataToAudioBuffer, type AudioBufferData } from "./audioBufferData.ts";

/**
 * In-memory cache of decoded AudioBuffers.
 * Media files are decoded once and reused across playback sessions.
 */
export class MediaCache {
  private buffers: Map<string, AudioBuffer> = new Map();

  /**
   * Load and decode an audio file from raw bytes.
   */
  async loadFromArrayBuffer(
    mediaId: string,
    arrayBuffer: ArrayBuffer,
    ctx: BaseAudioContext,
  ): Promise<AudioBuffer> {
    const existing = this.buffers.get(mediaId);
    if (existing) return existing;

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.buffers.set(mediaId, audioBuffer);
    return audioBuffer;
  }

  /**
   * Load and decode an audio file from a File object (e.g. from file picker).
   */
  async loadFromFile(
    mediaId: string,
    file: File,
    ctx: AudioContext,
  ): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return this.loadFromArrayBuffer(mediaId, arrayBuffer, ctx);
  }

  /**
   * Load and decode an audio file from a URL.
   */
  async loadFromUrl(
    mediaId: string,
    url: string,
    ctx: AudioContext,
  ): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return this.loadFromArrayBuffer(mediaId, arrayBuffer, ctx);
  }

  loadFromAudioBufferData(
    mediaId: string,
    bufferData: AudioBufferData,
    ctx: BaseAudioContext,
  ): AudioBuffer {
    const existing = this.buffers.get(mediaId);
    if (existing) return existing;

    const audioBuffer = audioBufferDataToAudioBuffer(ctx, bufferData);
    this.buffers.set(mediaId, audioBuffer);
    return audioBuffer;
  }

  /**
   * Get a previously decoded AudioBuffer by MediaId.
   */
  get(mediaId: string): AudioBuffer | undefined {
    return this.buffers.get(mediaId);
  }

  /** Replace one decoded buffer, including during manual media relink. */
  set(mediaId: string, audioBuffer: AudioBuffer): void {
    this.buffers.set(mediaId, audioBuffer);
  }

  /**
   * Check if a MediaId has been loaded.
   */
  has(mediaId: string): boolean {
    return this.buffers.has(mediaId);
  }

  /**
   * Remove all cached buffers.
   */
  clear(): void {
    this.buffers.clear();
  }

  /**
   * Iterate over cached media entries.
   */
  entries(): IterableIterator<[string, AudioBuffer]> {
    return this.buffers.entries();
  }

  /**
   * Replace the entire cache with a new set of decoded buffers.
   */
  replaceAll(entries: Iterable<[string, AudioBuffer]>): void {
    this.buffers = new Map(entries);
  }
}

/** Singleton media cache instance. */
export const mediaCache = new MediaCache();
