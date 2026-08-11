function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getMaxScrollLeft(
  contentWidth: number,
  viewportWidth: number,
): number {
  if (!Number.isFinite(contentWidth) || !Number.isFinite(viewportWidth)) {
    return 0;
  }
  return Math.max(0, contentWidth - viewportWidth);
}

interface BiasedZoomScrollLeftArgs {
  currentScrollLeft: number;
  viewportWidth: number;
  oldPixelsPerTick: number;
  newPixelsPerTick: number;
  playheadTick: number;
  contentWidth: number;
  bias: number;
}

export function getBiasedZoomScrollLeft({
  currentScrollLeft,
  viewportWidth,
  oldPixelsPerTick,
  newPixelsPerTick,
  playheadTick,
  contentWidth,
  bias,
}: BiasedZoomScrollLeftArgs): number {
  const maxScrollLeft = getMaxScrollLeft(contentWidth, viewportWidth);
  const safeCurrentScrollLeft = Number.isFinite(currentScrollLeft)
    ? currentScrollLeft
    : 0;

  if (
    viewportWidth <= 0 ||
    oldPixelsPerTick <= 0 ||
    newPixelsPerTick <= 0 ||
    !Number.isFinite(playheadTick)
  ) {
    return clamp(safeCurrentScrollLeft, 0, maxScrollLeft);
  }

  const centerTick =
    (safeCurrentScrollLeft + viewportWidth / 2) / oldPixelsPerTick;
  const focusTick = centerTick + (playheadTick - centerTick) * bias;
  const nextScrollLeft = focusTick * newPixelsPerTick - viewportWidth / 2;

  return clamp(nextScrollLeft, 0, maxScrollLeft);
}

interface PlayheadFollowScrollLeftArgs {
  currentScrollLeft: number;
  viewportWidth: number;
  playheadX: number;
  maxScrollLeft: number;
}

export function getPlayheadFollowScrollLeft({
  currentScrollLeft,
  viewportWidth,
  playheadX,
  maxScrollLeft,
}: PlayheadFollowScrollLeftArgs): number | null {
  if (
    viewportWidth <= 0 ||
    !Number.isFinite(currentScrollLeft) ||
    !Number.isFinite(playheadX)
  ) {
    return null;
  }

  const safeMaxScrollLeft = Math.max(0, maxScrollLeft);
  const visibleLeft = clamp(currentScrollLeft, 0, safeMaxScrollLeft);
  const visibleRight = visibleLeft + viewportWidth;

  if (playheadX < visibleLeft || playheadX > visibleRight) {
    return clamp(playheadX, 0, safeMaxScrollLeft);
  }

  return null;
}
