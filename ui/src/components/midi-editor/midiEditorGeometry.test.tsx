import { describe, expect, it } from "vitest";
import { buildMidiEditorBarLabelMetrics, buildMidiEditorGeometry } from "./midiEditorGeometry";

describe("buildMidiEditorGeometry", () => {
  it("extends the grid past the playhead so it stays inside the scrollable width", () => {
    const geometry = buildMidiEditorGeometry({
      notes: [{ start: 0, length: 120 }],
      ticksPerBar: 960,
      ticksPerBeat: 240,
      pxPerTick: 0.5,
      rowHeight: 16,
      totalKeys: 128,
      gridTickSize: 120,
      isSnapEnabled: true,
      playheadContentTick: 6_000,
    });

    expect(geometry.totalHeight).toBe(2048);
    expect(geometry.totalTicks).toBeGreaterThan(6_000);
    expect(geometry.totalWidth).toBeGreaterThan(6_000 * 0.5);
    expect(geometry.gridLines.length).toBeGreaterThan(0);
  });

  it("does not extend the grid for a playhead behind the clip, and skips dense grid lines", () => {
    const geometry = buildMidiEditorGeometry({
      notes: [],
      ticksPerBar: 960,
      ticksPerBeat: 240,
      pxPerTick: 0.01,
      rowHeight: 12,
      totalKeys: 128,
      gridTickSize: 120,
      isSnapEnabled: true,
      playheadContentTick: -1,
    });

    // 32 bars is the floor, so a negative playhead must not shrink or grow it.
    expect(geometry.totalTicks).toBe(960 * 32);
    expect(geometry.barLabelInterval).toBe(16);
    expect(geometry.gridLines).toHaveLength(0);
  });

  it("keeps a late clip content_out inside the scrollable grid", () => {
    const geometry = buildMidiEditorGeometry({
      notes: [],
      ticksPerBar: 960,
      ticksPerBeat: 240,
      pxPerTick: 0.5,
      rowHeight: 16,
      totalKeys: 128,
      gridTickSize: 120,
      isSnapEnabled: true,
      playheadContentTick: null,
      contentEndTick: 40_000,
    });

    expect(geometry.totalTicks).toBeGreaterThan(40_000);
    expect(geometry.totalWidth).toBeGreaterThan(20_000);
  });

  it("derives midi bar label metrics as a pure helper", () => {
    expect(buildMidiEditorBarLabelMetrics(960 * 32, 960, 0.5)).toEqual({
      barWidthPx: 480,
      barLabelInterval: 1,
      totalBars: 32,
    });
  });
});
