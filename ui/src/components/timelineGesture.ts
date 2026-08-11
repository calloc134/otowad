import type { TimelineInteractionPolicy } from "../app/deviceInteraction.ts";
import { resolveTimelineGesture } from "../utils/timelineInteractions.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface PointerThresholdInput {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function resolveTimelinePolicyGesture(
  policy: TimelineInteractionPolicy,
  input: PointerThresholdInput,
) {
  return resolveTimelineGesture({
    ...input,
    threshold: policy.dragThresholdPx,
  });
}

export function resolveRulerSelectionPreview(args: {
  policy: TimelineInteractionPolicy;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  anchorTick: number;
  resolveTickFromClientX: (clientX: number) => number;
}): { startTick: number; endTick: number } | null {
  const gesture = resolveTimelinePolicyGesture(args.policy, {
    startX: args.startX,
    startY: args.startY,
    currentX: args.currentX,
    currentY: args.currentY,
  });
  if (gesture !== "drag") {
    return null;
  }

  return {
    startTick: args.anchorTick,
    endTick: args.resolveTickFromClientX(args.currentX),
  };
}

export function resolveTimelineTouchPanPreview(args: {
  policy: TimelineInteractionPolicy;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startScrollLeft: number;
  startScrollTop: number;
  maxScrollTop: number;
}): { scrollLeft: number; scrollTop: number } | null {
  const gesture = resolveTimelinePolicyGesture(args.policy, {
    startX: args.startX,
    startY: args.startY,
    currentX: args.currentX,
    currentY: args.currentY,
  });
  if (gesture !== "drag") {
    return null;
  }

  return {
    scrollLeft: args.startScrollLeft - (args.currentX - args.startX),
    scrollTop: clamp(
      args.startScrollTop - (args.currentY - args.startY),
      0,
      args.maxScrollTop,
    ),
  };
}
