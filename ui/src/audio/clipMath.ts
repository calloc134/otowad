import type { ProjectDocument } from "@/types";
import { tickToSeconds } from "./playbackMath.ts";

export interface AudioClipMediaInfo {
  sampleRate: number;
  lengthFrames: number | null;
}

/**
 * Resolve media metadata for an audio clip content reference.
 * Falls back to project sample rate when metadata is unavailable.
 */
export function getAudioClipMediaInfo(
  doc: ProjectDocument,
  contentId: string,
): AudioClipMediaInfo {
  const content = doc.edit.contents.find((c) => c.id === contentId);
  if (content && content.type === "audio") {
    const media = doc.edit.media.find((m) => m.id === content.media_id);
    return {
      sampleRate: media?.src_sample_rate ?? doc.meta.project_sample_rate,
      lengthFrames: media?.length_src_frames ?? null,
    };
  }
  return { sampleRate: doc.meta.project_sample_rate, lengthFrames: null };
}

/**
 * Convert ticks to source/media frames with clip media sample rate.
 * Uses micro_bpm (integer BPM * 1_000_000) for fixed-point precision.
 */
export function ticksToMediaFrames(
  ticks: number,
  microBpm: number,
  ppq: number,
  mediaSampleRate: number,
): number {
  // micro_bpm = BPM * 1_000_000, so BPM = micro_bpm / 1_000_000
  // frames = ticks * mediaSampleRate * 60 / (bpm * ppq)
  //        = ticks * mediaSampleRate * 60 * 1_000_000 / (micro_bpm * ppq)
  return Math.round(
    (ticks * mediaSampleRate * 60 * 1_000_000) / (microBpm * ppq),
  );
}

/**
 * Clamp a source frame range into [0, maxLength] while keeping src_in < src_out.
 */
export function clampSourceRange(
  srcIn: number,
  srcOut: number,
  maxLengthFrames: number | null,
): { srcIn: number; srcOut: number } {
  const max = maxLengthFrames ?? Number.POSITIVE_INFINITY;
  const clampedIn = Math.max(0, Math.min(srcIn, max - 1));
  const clampedOut = Math.max(clampedIn + 1, Math.min(srcOut, max));
  return {
    srcIn: Math.round(clampedIn),
    srcOut: Math.round(clampedOut),
  };
}

export interface BoundedClipRenderWindowInput {
  clipStartTick: number;
  clipLengthTicks: number;
  selectionStartTick: number;
  selectionEndTick: number;
  microBpm: number;
  ppq: number;
}

export interface BoundedClipRenderWindow {
  overlapStartTick: number;
  overlapEndTick: number;
  renderStartSec: number;
  bufferOffsetSec: number;
  durationSec: number;
}

export function getBoundedClipRenderWindow(
  input: BoundedClipRenderWindowInput,
): BoundedClipRenderWindow | null {
  const clipStartTick = Math.max(0, Math.round(input.clipStartTick));
  const clipLengthTicks = Math.max(0, Math.round(input.clipLengthTicks));
  const selectionStartTick = Math.max(0, Math.round(input.selectionStartTick));
  const selectionEndTick = Math.max(0, Math.round(input.selectionEndTick));
  if (clipLengthTicks <= 0 || selectionEndTick <= selectionStartTick) {
    return null;
  }

  const clipEndTick = clipStartTick + clipLengthTicks;
  const overlapStartTick = Math.max(clipStartTick, selectionStartTick);
  const overlapEndTick = Math.min(clipEndTick, selectionEndTick);
  if (overlapEndTick <= overlapStartTick) {
    return null;
  }

  return {
    overlapStartTick,
    overlapEndTick,
    renderStartSec: tickToSeconds(
      overlapStartTick - selectionStartTick,
      input.microBpm,
      input.ppq,
    ),
    bufferOffsetSec: tickToSeconds(
      overlapStartTick - clipStartTick,
      input.microBpm,
      input.ppq,
    ),
    durationSec: tickToSeconds(
      overlapEndTick - overlapStartTick,
      input.microBpm,
      input.ppq,
    ),
  };
}
