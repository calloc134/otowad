import { describe, expect, it } from "vitest";
import { buildClipGeometry, resolveClipHeaderPaddingRight } from "./clipGeometry";

describe("buildClipGeometry", () => {
  it("expands header padding when the primary desktop action strip is visible", () => {
    const geometry = buildClipGeometry({
      displayStart: 120,
      displayLength: 480,
      pixelsPerTick: 0.5,
      trackHeight: 80,
      isInteracting: false,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      usesTouchSizedActions: false,
      visibleActionCount: 6,
    });

    expect(geometry.left).toBe(60);
    expect(geometry.width).toBe(240);
    expect(geometry.clipHeight).toBe(76);
    expect(geometry.shouldShowActionStrip).toBe(true);
    expect(geometry.headerPaddingRight).toBeGreaterThan(100);
  });

  it("keeps compact header padding while interacting", () => {
    const geometry = buildClipGeometry({
      displayStart: 0,
      displayLength: 1,
      pixelsPerTick: 1,
      trackHeight: 24,
      isInteracting: true,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      usesTouchSizedActions: true,
      visibleActionCount: 4,
    });

    expect(geometry.width).toBe(4);
    expect(geometry.clipHeight).toBe(20);
    expect(geometry.shouldShowActionStrip).toBe(false);
    expect(geometry.headerPaddingRight).toBe(4);
  });

  it("reserves header room for the actions a pointer clip draws inside itself", () => {
    expect(resolveClipHeaderPaddingRight({
      isPrimarySelection: true,
      isInteracting: false,
      usesTouchSizedActions: false,
      visibleActionCount: 4,
    })).toBe(84);
  });

  it("reserves no header room on touch, where the actions are a bottom bar", () => {
    expect(resolveClipHeaderPaddingRight({
      isPrimarySelection: true,
      isInteracting: false,
      usesTouchSizedActions: true,
      visibleActionCount: 4,
    })).toBe(4);
  });
});
