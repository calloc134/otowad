import { clampZoomX } from "../../state/zoomLimits.ts";

/**
 * Two-finger zoom for the timeline.
 *
 * One-finger drag already pans (`resolveTimelineTouchPanPreview`), but the
 * timeline surface sets `touch-action: none`, so the browser's own pinch does
 * nothing here and there was no replacement — the mobile tool rail advertised
 * "Two-finger Pan/Zoom" while nothing implemented it.
 *
 * The gesture keeps the tick under the midpoint of the two fingers pinned to
 * the midpoint, so it pans and zooms in one motion.
 */

export interface TimelinePinchPoint {
  x: number;
  y: number;
}

export interface TimelinePinchAnchor {
  /** Finger separation when the second finger landed. */
  distance: number;
  /** `zoom.x` when the second finger landed. */
  zoomX: number;
  /** Tick that was under the midpoint of the two fingers at that moment. */
  tick: number;
}

/** Below this the separation is too small to derive a stable scale factor. */
const MIN_PINCH_DISTANCE_PX = 24;

export function getPinchDistance(a: TimelinePinchPoint, b: TimelinePinchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getPinchMidpointX(a: TimelinePinchPoint, b: TimelinePinchPoint): number {
  return (a.x + b.x) / 2;
}

/**
 * The anchor is captured once, when the gesture starts.
 *
 * `midpointOffsetX` is the midpoint relative to the viewport's left edge, so
 * the caller subtracts the bounding rect before calling.
 */
export function resolveTimelinePinchAnchor(args: {
  distance: number;
  zoomX: number;
  scrollLeft: number;
  midpointOffsetX: number;
}): TimelinePinchAnchor | null {
  if (args.distance < MIN_PINCH_DISTANCE_PX || args.zoomX <= 0) {
    return null;
  }

  return {
    distance: args.distance,
    zoomX: args.zoomX,
    tick: (args.scrollLeft + args.midpointOffsetX) / args.zoomX,
  };
}

/**
 * Returns the zoom and scroll that keep `anchor.tick` under the fingers.
 *
 * `null` while the fingers are too close together to read a scale from.
 */
export function resolveTimelinePinch(args: {
  anchor: TimelinePinchAnchor;
  distance: number;
  midpointOffsetX: number;
  maxScrollLeft: number;
}): { zoomX: number; scrollLeft: number } | null {
  if (args.distance < MIN_PINCH_DISTANCE_PX) {
    return null;
  }

  const zoomX = clampZoomX(args.anchor.zoomX * (args.distance / args.anchor.distance));
  const scrollLeft = args.anchor.tick * zoomX - args.midpointOffsetX;

  return {
    zoomX,
    scrollLeft: Math.min(Math.max(scrollLeft, 0), Math.max(0, args.maxScrollLeft)),
  };
}
