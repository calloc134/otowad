// =============================================================================
// PlaybackEngine — manages AudioContext and clip scheduling for playback
// =============================================================================

import type { ProjectDocument } from "../types/index.ts";
import {
  audioBufferDataToAudioBuffer,
  type AudioBufferData,
} from "./audioBufferData.ts";
import type { PreparedPlaybackSchedule } from "./playbackPreparation.ts";
import type { RuntimeMemoryBucket } from "./runtimeMemoryDiagnostics.ts";
import { ByteBoundedLru } from "./lruCache.ts";

// ---------------------------------------------------------------------------
// PlaybackEngine
// ---------------------------------------------------------------------------

interface ScheduledSource {
  source: AudioBufferSourceNode;
  clipGainNode: GainNode;
  trackGainNode: GainNode;
  trackPanNode: StereoPannerNode;
}

interface PendingScheduledSource extends ScheduledSource {
  whenRelativeSec: number;
  clipDurationSec: number;
  bufferDurationSec: number;
}

export interface ScheduledSourceTiming {
  whenSec: number;
  offsetSec: number;
  durationSec: number;
}

const PLAYBACK_SCHEDULE_LEAD_SEC = 0.02;

export function resolveScheduledSourceTiming(
  baseWhenSec: number,
  whenRelativeSec: number,
  bufferDurationSec: number,
  clipDurationSec: number,
): ScheduledSourceTiming | null {
  const playableDurationSec = Math.min(bufferDurationSec, clipDurationSec);
  if (playableDurationSec <= 0) {
    return null;
  }

  if (whenRelativeSec >= 0) {
    return {
      whenSec: baseWhenSec + whenRelativeSec,
      offsetSec: 0,
      durationSec: playableDurationSec,
    };
  }

  const offsetSec = -whenRelativeSec;
  const durationSec = playableDurationSec - offsetSec;
  if (durationSec <= 0) {
    return null;
  }

  return {
    whenSec: baseWhenSec,
    offsetSec,
    durationSec,
  };
}

/** 256 MiB budget for the main-thread rendered clip cache. Rendered PCM has no
 * worker-side steady owner, so this is the sole rendered-buffer budget. */
const MAIN_THREAD_PROCESSED_CLIP_CACHE_MAX_BYTES = 256 * 1024 * 1024;

function audioBufferByteSize(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * 4;
}

export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private _isPlaying = false;
  private startTime = 0; // AudioContext.currentTime when playback becomes audible
  private startOffset = 0; // offset in seconds from which playback started
  private scheduledSources: ScheduledSource[] = [];
  private processedClipCache: ByteBoundedLru<AudioBuffer> = new ByteBoundedLru<AudioBuffer>({
    maxBytes: MAIN_THREAD_PROCESSED_CLIP_CACHE_MAX_BYTES,
    sizeOf: audioBufferByteSize,
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Create or resume the AudioContext. */
  async init(): Promise<void> {
    const context = this.ensureAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  /**
   * Create the context without waiting for autoplay permission.
   *
   * Import decoding does not require a running AudioContext. Keeping this
   * separate from init() prevents browser autoplay policy from blocking the
   * import pipeline before decodeAudioData can start.
   */
  ensureAudioContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  /** Get the underlying AudioContext (may be null before init). */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** Whether playback is currently active. */
  get playing(): boolean {
    return this._isPlaying;
  }

  // -----------------------------------------------------------------------
  // Transport
  // -----------------------------------------------------------------------

  /** Stop playback and clean up all scheduled sources. */
  stop(): void {
    this.stopInternal();
  }

  playPrepared(schedule: PreparedPlaybackSchedule): void {
    if (!this.ctx) return;

    this.stopInternal();
    this.startOffset = schedule.startOffsetSec;
    const pendingSources: PendingScheduledSource[] = [];

    for (const clip of schedule.clips) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.getPreparedAudioBuffer(
        clip.renderKey,
        clip.buffer,
      );
      source.playbackRate.value = 1;

      const clipGainNode = this.ctx.createGain();
      clipGainNode.gain.value = clip.clipGain;
      const trackGainNode = this.ctx.createGain();
      trackGainNode.gain.value = clip.trackGain;
      const trackPanNode = this.ctx.createStereoPanner();
      trackPanNode.pan.value = clip.trackPan;

      source.connect(clipGainNode);
      clipGainNode.connect(trackGainNode);
      trackGainNode.connect(trackPanNode);
      trackPanNode.connect(this.ctx.destination);

      pendingSources.push({
        source,
        clipGainNode,
        trackGainNode,
        trackPanNode,
        whenRelativeSec: clip.whenRelativeSec,
        clipDurationSec: clip.clipDurationSec,
        bufferDurationSec: source.buffer.duration,
      });
    }

    this.schedulePendingSources(pendingSources);
  }

  getKnownRenderKeys(): Set<string> {
    return new Set(this.processedClipCache.keys());
  }

  getProcessedClipCacheStats(): RuntimeMemoryBucket {
    return {
      count: this.processedClipCache.size,
      bytes: this.processedClipCache.bytes,
    };
  }

  clearProcessedClipCache(): void {
    this.processedClipCache.clear();
  }

  private schedulePendingSources(pendingSources: PendingScheduledSource[]): void {
    if (!this.ctx) {
      return;
    }

    const baseWhenSec = this.ctx.currentTime + PLAYBACK_SCHEDULE_LEAD_SEC;
    this.startTime = baseWhenSec;

    for (const pendingSource of pendingSources) {
      const timing = resolveScheduledSourceTiming(
        baseWhenSec,
        pendingSource.whenRelativeSec,
        pendingSource.bufferDurationSec,
        pendingSource.clipDurationSec,
      );
      if (!timing) {
        pendingSource.source.disconnect();
        pendingSource.clipGainNode.disconnect();
        pendingSource.trackGainNode.disconnect();
        pendingSource.trackPanNode.disconnect();
        continue;
      }

      pendingSource.source.start(
        timing.whenSec,
        timing.offsetSec,
        timing.durationSec,
      );
      this.scheduledSources.push(pendingSource);
    }

    this._isPlaying = true;
  }

  private stopInternal(): void {
    for (const { source, clipGainNode, trackGainNode, trackPanNode } of this.scheduledSources) {
      try {
        source.stop();
        source.disconnect();
        clipGainNode.disconnect();
        trackGainNode.disconnect();
        trackPanNode.disconnect();
      } catch {
        // Ignore errors from already-stopped sources
      }
    }
    this.scheduledSources = [];
    this._isPlaying = false;
  }

  private getPreparedAudioBuffer(
    renderKey: string,
    buffer?: AudioBufferData,
  ): AudioBuffer {
    if (!this.ctx) {
      throw new Error("Audio context is not initialized.");
    }
    const cached = this.processedClipCache.get(renderKey);
    if (cached) {
      return cached;
    }
    if (!buffer) {
      throw new Error(`Prepared clip buffer is missing for render key ${renderKey}.`);
    }
    const audioBuffer = audioBufferDataToAudioBuffer(this.ctx, buffer);
    this.processedClipCache.set(renderKey, audioBuffer);
    return audioBuffer;
  }

  // -----------------------------------------------------------------------
  // Playhead
  // -----------------------------------------------------------------------

  /**
   * Get the current playhead position in ticks based on elapsed AudioContext time.
   */
  getCurrentTick(project: ProjectDocument): number {
    if (!this.ctx || !this._isPlaying) return 0;

    const microBpm = project.edit.tempo.points[0]?.micro_bpm ?? 120_000_000;
    const ppq = project.edit.tempo.ppq;

    const elapsed = Math.max(0, this.ctx.currentTime - this.startTime);
    const currentSeconds = this.startOffset + elapsed;

    // Inverse of tickToSeconds: tick = seconds * microBpm * ppq / (60 * 1_000_000)
    return (currentSeconds * microBpm * ppq) / (60 * 1_000_000);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Fully dispose the engine and close the AudioContext. */
  destroy(): void {
    this.stopInternal();
    this.processedClipCache.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
