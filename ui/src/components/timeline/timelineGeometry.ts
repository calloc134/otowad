interface TimelineClipLike {
  start: number;
  length: number;
}

interface TimelineTimeSelectionLike {
  startTick: number;
  endTick: number;
}

interface BuildTimelineGeometryInput {
  clips: TimelineClipLike[];
  ticksPerBar: number;
  ticksPerBeat: number;
  pixelsPerTick: number;
  trackCount: number;
  trackHeight: number;
  appendNewTrack: boolean;
  timeSelection: TimelineTimeSelectionLike | null;
  isSnapEnabled: boolean;
  gridTickSize: number;
}

export interface TimelineBarLabelMetrics {
  barWidthPx: number;
  barLabelInterval: number;
  totalBars: number;
}

export interface TimelineGridLine {
  x: number;
  isBeat: boolean;
}

export interface TimelineGeometry {
  totalTicks: number;
  totalWidth: number;
  barWidthPx: number;
  barLabelInterval: number;
  totalBars: number;
  timelineHeight: number;
  canvasHeight: number;
  timeSelectionLeft: number;
  timeSelectionWidth: number;
  gridLines: TimelineGridLine[];
  showSubGrid: boolean;
}

function getBarLabelInterval(barWidthPx: number): number {
  if (barWidthPx < 20) return 16;
  if (barWidthPx < 40) return 8;
  if (barWidthPx < 80) return 4;
  if (barWidthPx < 150) return 2;
  return 1;
}

export function buildTimelineBarLabelMetrics(
  totalTicks: number,
  ticksPerBar: number,
  pixelsPerTick: number,
): TimelineBarLabelMetrics {
  const barWidthPx = ticksPerBar * pixelsPerTick;
  return {
    barWidthPx,
    barLabelInterval: getBarLabelInterval(barWidthPx),
    totalBars: Math.ceil(totalTicks / ticksPerBar),
  };
}

export function buildTimelineGeometry({
  clips,
  ticksPerBar,
  ticksPerBeat,
  pixelsPerTick,
  trackCount,
  trackHeight,
  appendNewTrack,
  timeSelection,
  isSnapEnabled,
  gridTickSize,
}: BuildTimelineGeometryInput): TimelineGeometry {
  const maxClipEnd = clips.reduce((max, clip) => Math.max(max, clip.start + clip.length), 0);
  const minTicks = ticksPerBar * 64;
  const totalTicks = Math.max(minTicks, maxClipEnd + ticksPerBar * 4);
  const totalWidth = totalTicks * pixelsPerTick;
  const { barWidthPx, barLabelInterval, totalBars } = buildTimelineBarLabelMetrics(
    totalTicks,
    ticksPerBar,
    pixelsPerTick,
  );
  const timelineHeight = trackCount * trackHeight || trackHeight;
  const canvasHeight = timelineHeight + (appendNewTrack ? trackHeight : 0);
  const timeSelectionLeft = timeSelection ? timeSelection.startTick * pixelsPerTick : 0;
  const timeSelectionWidth = timeSelection
    ? Math.max(1, (timeSelection.endTick - timeSelection.startTick) * pixelsPerTick)
    : 0;
  const showSubGrid = isSnapEnabled;

  const gridLines: TimelineGridLine[] = [];
  if (isSnapEnabled && gridTickSize > 0) {
    const gridPx = gridTickSize * pixelsPerTick;
    if (gridPx >= 6) {
      const count = Math.ceil(totalTicks / gridTickSize);
      for (let i = 0; i < count; i++) {
        const tick = i * gridTickSize;
        if (tick % ticksPerBar === 0) {
          continue;
        }
        const isBeat = tick % ticksPerBeat === 0;
        if (isBeat && barWidthPx >= 40) {
          continue;
        }
        gridLines.push({ x: tick * pixelsPerTick, isBeat });
      }
    }
  }

  return {
    totalTicks,
    totalWidth,
    barWidthPx,
    barLabelInterval,
    totalBars,
    timelineHeight,
    canvasHeight,
    timeSelectionLeft,
    timeSelectionWidth,
    gridLines,
    showSubGrid,
  };
}
