/**
 * Geometry shared by the timeline and the track list.
 *
 * These two surfaces are drawn by separate component trees but must line up
 * pixel for pixel: track N's header sits beside track N's lane, and both
 * scroll together. They previously declared their own constants —
 * `TIMELINE_TRACK_HEIGHT` existed twice and `TRACK_HEIGHT` a third time — and
 * the chrome above the lanes did not match at all, which put every track
 * header 11px below its lane.
 */

/**
 * Height of the row above the lanes: the timeline ruler on one side, the
 * track list's create-track actions on the other. The lanes start below it on
 * both sides, so a single value is what keeps the two aligned.
 */
export const EDITOR_HEADER_HEIGHT = 30;

/** Vertical padding plus bottom border of a track row. */
const TRACK_ROW_CHROME_HEIGHT = 13;

/**
 * What a row needs for its name and its transport controls, measured in the
 * browser for each control size.
 *
 * Touch rows are taller because they carry affordances a pointer does not
 * need: the reorder chevrons and an explicit rename button turn a 28px name
 * row into a 58px one. Sizing every row from the pointer numbers is what left
 * the touch rows overflowing by 26px.
 */
const TRACK_ROW_ESSENTIAL_CONTENT_HEIGHT = {
  /** name row 28 + control row 28 */
  compact: 56,
  /** name row 58 + control row 28 */
  touch: 86,
} as const;

/** The gain and pan sliders, stacked under their labels. Same either way. */
const TRACK_ROW_MIX_CONTENT_HEIGHT = 31;

export const MAX_TRACK_HEIGHT = 200;

function essentialContentHeight(usesTouchControls: boolean): number {
  return usesTouchControls
    ? TRACK_ROW_ESSENTIAL_CONTENT_HEIGHT.touch
    : TRACK_ROW_ESSENTIAL_CONTENT_HEIGHT.compact;
}

/**
 * Below this a row cannot show its name and its transport controls at once,
 * so shrinking further would only clip them.
 */
export function minTrackHeight(usesTouchControls: boolean): number {
  return essentialContentHeight(usesTouchControls) + TRACK_ROW_CHROME_HEIGHT + 3;
}

/**
 * A row needs this much before the gain and pan sliders fit underneath the
 * name and the controls. Rendering them regardless is what made every row
 * overflow and bleed into the row below.
 */
function mixRowMinHeight(usesTouchControls: boolean): number {
  return essentialContentHeight(usesTouchControls)
    + TRACK_ROW_MIX_CONTENT_HEIGHT
    + TRACK_ROW_CHROME_HEIGHT;
}

/**
 * Dense desktop default. It keeps the name and transport controls visible but
 * deliberately leaves gain / pan to a zoomed-in row. Touch rows clamp this
 * shared zoom value to their taller essential-controls minimum.
 */
export const DEFAULT_TRACK_HEIGHT = 80;

export function clampTrackHeight(height: number, usesTouchControls = false): number {
  if (!Number.isFinite(height)) {
    return DEFAULT_TRACK_HEIGHT;
  }
  return Math.min(MAX_TRACK_HEIGHT, Math.max(minTrackHeight(usesTouchControls), height));
}

/** Whether a row of this height has room for the gain and pan sliders. */
export function trackRowShowsMixControls(
  trackHeight: number,
  usesTouchControls = false,
): boolean {
  return clampTrackHeight(trackHeight, usesTouchControls) >= mixRowMinHeight(usesTouchControls);
}
