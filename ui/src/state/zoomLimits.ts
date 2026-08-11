/**
 * Horizontal zoom is expressed as pixels per tick.
 *
 * Its bounds used to be declared independently in two places (`ZoomControls`
 * and `useTimelineViewportInteraction`), while `viewportStore` picked an
 * initial value that knew about neither. That initial `1` sat above the `0.5`
 * ceiling, so the first zoom-in clamped *down* to the ceiling and the default
 * view could never be reached again.
 *
 * Everything that derives or mutates `zoom.x` goes through this module.
 */

const MIN_ZOOM_X = 0.005;
const MAX_ZOOM_X = 0.5;

/**
 * Roughly 8 bars of 4/4 at 960 PPQ across a ~1200px timeline:
 * `3840 ticks/bar * 0.04 px/tick = 153.6 px/bar`.
 */
export const DEFAULT_ZOOM_X = 0.04;

const ZOOM_X_STEP = 1.25;

export function clampZoomX(value: number): number {
  // `Fit` divides by a content length, so a non-finite value is reachable.
  if (!Number.isFinite(value)) {
    return DEFAULT_ZOOM_X;
  }
  return Math.min(MAX_ZOOM_X, Math.max(MIN_ZOOM_X, value));
}

export function zoomInX(current: number): number {
  return clampZoomX(current * ZOOM_X_STEP);
}

export function zoomOutX(current: number): number {
  return clampZoomX(current / ZOOM_X_STEP);
}

/**
 * `0..1` position for the toolbar zoom bar. Steps are multiplicative, so a
 * linear scale collapses most of the usable range into the left edge.
 */
export function zoomXToSliderRatio(value: number): number {
  return Math.log(clampZoomX(value) / MIN_ZOOM_X) / Math.log(MAX_ZOOM_X / MIN_ZOOM_X);
}

/** Percentage shown in the status bar, where `100%` is the default view. */
export function zoomXToDisplayPercent(value: number): number {
  return (clampZoomX(value) / DEFAULT_ZOOM_X) * 100;
}
