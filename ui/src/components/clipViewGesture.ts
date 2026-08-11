import type { MouseEvent as ReactMouseEvent } from "react";

// Relative rather than aliased: `node --test` does not resolve `@/`, and this
// is a value import, so it survives type erasure.
import { CLIP_HANDLE_WIDTH } from "../utils/timelineInteractions.ts";
import type { ResizeEdge } from "@/hooks/useClipResize.ts";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";

export type ClipBodyIntent =
  | { type: "resize"; edge: ResizeEdge }
  | { type: "body"; relativeX: number; relativeY: number };

export function resolveClipBodyIntent(args: {
  event: ReactMouseEvent;
  clipWidth: number;
  clipHeight: number;
  disableGroupEdit: boolean;
  isAudio: boolean;
}): ClipBodyIntent | null {
  const { event, clipWidth, clipHeight, disableGroupEdit, isAudio } = args;
  if (event.button === 2 || event.button !== 0) {
    return null;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const relativeY = event.clientY - rect.top;

  if (!disableGroupEdit && relativeX <= CLIP_HANDLE_WIDTH) {
    return {
      type: "resize",
      edge: relativeY < clipHeight / 2 && isAudio ? "start-blue" : "start-red",
    };
  }

  if (!disableGroupEdit && relativeX >= clipWidth - CLIP_HANDLE_WIDTH) {
    return {
      type: "resize",
      edge: relativeY < clipHeight / 2 && isAudio ? "end-blue" : "end-red",
    };
  }

  return { type: "body", relativeX, relativeY };
}

export function resolveClipSplitLongPressSettings(
  policy: TimelineInteractionPolicy,
): {
  longPressMs: number;
  moveThresholdPx: number;
} {
  return {
    longPressMs: policy.splitLongPressMs,
    moveThresholdPx: policy.splitMoveThresholdPx,
  };
}
