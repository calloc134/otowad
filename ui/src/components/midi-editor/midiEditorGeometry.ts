interface MidiNoteLike {
  start: number;
  length: number;
}

interface BuildMidiEditorGeometryInput {
  notes: MidiNoteLike[];
  ticksPerBar: number;
  ticksPerBeat: number;
  pxPerTick: number;
  rowHeight: number;
  totalKeys: number;
  gridTickSize: number;
  isSnapEnabled: boolean;
  playheadContentTick: number | null;
  contentEndTick?: number | null;
}

export interface MidiEditorBarLabelMetrics {
  barWidthPx: number;
  barLabelInterval: number;
  totalBars: number;
}

export interface MidiEditorGridLine {
  x: number;
  isBeat: boolean;
}

export interface MidiEditorGeometry {
  totalHeight: number;
  totalTicks: number;
  totalWidth: number;
  barWidthPx: number;
  barLabelInterval: number;
  totalBars: number;
  gridLines: MidiEditorGridLine[];
}

function getBarLabelInterval(barWidthPx: number): number {
  if (barWidthPx < 20) return 16;
  if (barWidthPx < 40) return 8;
  if (barWidthPx < 80) return 4;
  if (barWidthPx < 150) return 2;
  return 1;
}

export function buildMidiEditorBarLabelMetrics(
  totalTicks: number,
  ticksPerBar: number,
  pxPerTick: number,
): MidiEditorBarLabelMetrics {
  const barWidthPx = ticksPerBar * pxPerTick;
  return {
    barWidthPx,
    barLabelInterval: getBarLabelInterval(barWidthPx),
    totalBars: Math.ceil(totalTicks / ticksPerBar),
  };
}

export function buildMidiEditorGeometry({
  notes,
  ticksPerBar,
  ticksPerBeat,
  pxPerTick,
  rowHeight,
  totalKeys,
  gridTickSize,
  isSnapEnabled,
  playheadContentTick,
  contentEndTick,
}: BuildMidiEditorGeometryInput): MidiEditorGeometry {
  const totalHeight = totalKeys * rowHeight;
  const maxNoteEnd = notes.reduce((max, note) => Math.max(max, note.start + note.length), 0);
  const minTicks = ticksPerBar * 32;
  const totalTicks = Math.max(
    minTicks,
    Math.max(
      maxNoteEnd,
      Math.max(0, playheadContentTick ?? 0),
      Math.max(0, contentEndTick ?? 0),
    ) + ticksPerBar * 4,
  );
  const totalWidth = totalTicks * pxPerTick;
  const { barWidthPx, barLabelInterval, totalBars } = buildMidiEditorBarLabelMetrics(
    totalTicks,
    ticksPerBar,
    pxPerTick,
  );

  const gridLines: MidiEditorGridLine[] = [];
  if (isSnapEnabled && gridTickSize > 0) {
    const gridPx = gridTickSize * pxPerTick;
    if (gridPx >= 6) {
      const count = Math.ceil(totalTicks / gridTickSize);
      for (let i = 0; i < count; i++) {
        const tick = i * gridTickSize;
        if (tick % ticksPerBar === 0) {
          continue;
        }
        gridLines.push({
          x: tick * pxPerTick,
          isBeat: tick % ticksPerBeat === 0,
        });
      }
    }
  }

  return {
    totalHeight,
    totalTicks,
    totalWidth,
    barWidthPx,
    barLabelInterval,
    totalBars,
    gridLines,
  };
}
