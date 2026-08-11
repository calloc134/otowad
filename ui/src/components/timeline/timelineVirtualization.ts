export interface TimelineVirtualClip {
  id: string;
  track_id: string;
  start: number;
  length: number;
}

export interface TimelineVisibleWindow {
  startTick: number;
  endTick: number;
  startTrackIndex: number;
  endTrackIndex: number;
}

interface ResolveTimelineVisibleWindowInput {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  pixelsPerTick: number;
  trackHeight: number;
  trackCount: number;
  horizontalOverscanPx?: number;
  verticalOverscanTracks?: number;
}

interface SelectVisibleTimelineClipsInput<TClip extends TimelineVirtualClip> {
  clips: readonly TClip[];
  trackIndexById: ReadonlyMap<string, number>;
  visibleWindow: TimelineVisibleWindow | null;
  alwaysIncludeClipIds?: ReadonlySet<string>;
}

const TIMELINE_HORIZONTAL_OVERSCAN_PX = 800;
const TIMELINE_VERTICAL_OVERSCAN_TRACKS = 1;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function resolveTimelineVisibleWindow({
  scrollX,
  scrollY,
  viewportWidth,
  viewportHeight,
  pixelsPerTick,
  trackHeight,
  trackCount,
  horizontalOverscanPx = TIMELINE_HORIZONTAL_OVERSCAN_PX,
  verticalOverscanTracks = TIMELINE_VERTICAL_OVERSCAN_TRACKS,
}: ResolveTimelineVisibleWindowInput): TimelineVisibleWindow | null {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    !Number.isFinite(pixelsPerTick) ||
    pixelsPerTick <= 0 ||
    !Number.isFinite(trackHeight) ||
    trackHeight <= 0
  ) {
    return null;
  }

  const safeScrollX = finiteNonNegative(scrollX);
  const safeScrollY = finiteNonNegative(scrollY);
  const safeHorizontalOverscan = finiteNonNegative(horizontalOverscanPx);
  const safeVerticalOverscan = Math.max(0, Math.floor(verticalOverscanTracks));
  const safeTrackCount = Math.max(0, Math.floor(trackCount));

  return {
    startTick: Math.max(0, (safeScrollX - safeHorizontalOverscan) / pixelsPerTick),
    endTick: (safeScrollX + viewportWidth + safeHorizontalOverscan) / pixelsPerTick,
    startTrackIndex: Math.max(
      0,
      Math.floor(safeScrollY / trackHeight) - safeVerticalOverscan,
    ),
    endTrackIndex: Math.min(
      safeTrackCount,
      Math.ceil((safeScrollY + viewportHeight) / trackHeight) + safeVerticalOverscan,
    ),
  };
}

export function selectVisibleTimelineClips<TClip extends TimelineVirtualClip>({
  clips,
  trackIndexById,
  visibleWindow,
  alwaysIncludeClipIds = new Set(),
}: SelectVisibleTimelineClipsInput<TClip>): TClip[] {
  return clips.filter((clip) => {
    const trackIndex = trackIndexById.get(clip.track_id);
    if (trackIndex === undefined) {
      return false;
    }
    if (!visibleWindow || alwaysIncludeClipIds.has(clip.id)) {
      return true;
    }
    if (
      trackIndex < visibleWindow.startTrackIndex ||
      trackIndex >= visibleWindow.endTrackIndex
    ) {
      return false;
    }
    return (
      clip.start < visibleWindow.endTick &&
      clip.start + clip.length > visibleWindow.startTick
    );
  });
}

export function selectVisibleTimelineTrackIndices(
  trackCount: number,
  visibleWindow: TimelineVisibleWindow | null,
): number[] {
  const safeTrackCount = Math.max(0, Math.floor(trackCount));
  const start = visibleWindow?.startTrackIndex ?? 0;
  const end = visibleWindow?.endTrackIndex ?? safeTrackCount;
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

export function selectVisibleTimelineStepIndices(
  totalCount: number,
  stepTicks: number,
  visibleWindow: TimelineVisibleWindow | null,
): number[] {
  const safeTotalCount = Math.max(0, Math.floor(totalCount));
  if (!visibleWindow || !Number.isFinite(stepTicks) || stepTicks <= 0) {
    return Array.from({ length: safeTotalCount }, (_, index) => index);
  }
  const start = Math.max(0, Math.floor(visibleWindow.startTick / stepTicks));
  const end = Math.min(
    safeTotalCount,
    Math.ceil(visibleWindow.endTick / stepTicks),
  );
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}
