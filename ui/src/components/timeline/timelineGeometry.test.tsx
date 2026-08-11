import { describe, expect, it } from "vitest";
import { buildTimelineBarLabelMetrics, buildTimelineGeometry } from "./timelineGeometry";

describe("buildTimelineGeometry", () => {
  it("keeps a 64-bar minimum canvas and adds new-track preview height", () => {
    const geometry = buildTimelineGeometry({
      clips: [{ start: 0, length: 960 }],
      ticksPerBar: 960,
      ticksPerBeat: 240,
      pixelsPerTick: 0.5,
      trackCount: 2,
      trackHeight: 80,
      appendNewTrack: true,
      timeSelection: { startTick: 120, endTick: 240 },
      isSnapEnabled: true,
      gridTickSize: 120,
    });

    expect(geometry.totalTicks).toBe(960 * 64);
    expect(geometry.totalWidth).toBe(960 * 64 * 0.5);
    expect(geometry.canvasHeight).toBe(240);
    expect(geometry.timeSelectionLeft).toBe(60);
    expect(geometry.timeSelectionWidth).toBe(60);
  });

  it("omits subdivision lines when the grid would render too densely", () => {
    const geometry = buildTimelineGeometry({
      clips: [{ start: 0, length: 1920 }],
      ticksPerBar: 960,
      ticksPerBeat: 240,
      pixelsPerTick: 0.01,
      trackCount: 1,
      trackHeight: 80,
      appendNewTrack: false,
      timeSelection: null,
      isSnapEnabled: true,
      gridTickSize: 120,
    });

    expect(geometry.barLabelInterval).toBe(16);
    expect(geometry.gridLines).toHaveLength(0);
  });

  it("derives bar label metrics as a pure helper", () => {
    expect(buildTimelineBarLabelMetrics(960 * 64, 960, 0.01)).toEqual({
      barWidthPx: 9.6,
      barLabelInterval: 16,
      totalBars: 64,
    });
  });
});
