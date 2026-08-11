import { describe, expect, it } from "vitest";

import { buildTimelineDesktopContract } from "./timeline/useTimelineInteractionsDesktop";
import { buildTimelineMobileContract } from "./timeline/useTimelineInteractionsMobile";
import { buildClipDesktopContract } from "./clip-view/useClipInteractionsDesktop";
import { buildClipMobileContract } from "./clip-view/useClipInteractionsMobile";
import { buildMidiEditorDesktopContract } from "./midi-editor/useMidiEditorInteractionsDesktop";
import { buildMidiEditorMobileContract } from "./midi-editor/useMidiEditorInteractionsMobile";
import { buildTrackListDesktopContract } from "./track-list/useTrackListInteractionsDesktop";
import { buildTrackListMobileContract } from "./track-list/useTrackListInteractionsMobile";

function createTimelineBaseResult() {
  return {
    rootRef: { current: null },
    scrollRef: { current: null },
    rulerRef: { current: null },
    timelineRef: { current: null },
    marquee: null,
    fileDropPreview: null,
    getViewportContentPoint: () => null,
    getTickFromViewportClientX: () => 0,
    setViewportScrollLeft: () => {},
    handleRulerClick: () => {},
    handleTimelineClick: () => {},
    handleLanesScroll: () => {},
    handleRulerPointerDown: () => {},
    handleRulerPointerMove: () => {},
    finishRulerPointerGesture: () => {},
    handleTimelinePointerDown: () => {},
    handleTimelinePointerMove: () => {},
    finishTimelinePointerGesture: () => {},
    handleTimelineDragOver: () => {},
    handleTimelineDragLeave: () => {},
    handleTimelineDrop: () => {},
  };
}

function createClipBaseResult() {
  return {
    isSplitLongPressing: false,
    warpPlacementArmed: false,
    toggleWarpPlacementArmed: () => {},
    handlePointerDown: () => {},
    handlePointerMove: () => {},
    handlePointerUp: () => {},
    handlePointerCancel: () => {},
    handleClick: () => {},
    handleDoubleClick: () => {},
  };
}

function createMidiBaseResult() {
  return {
    gridScrollRef: { current: null },
    pianoScrollRef: { current: null },
    rulerScrollRef: { current: null },
    handleGridScroll: () => {},
    handleGridPointerDown: () => {},
    handleGridPointerMove: () => {},
    finishGridPointerGesture: () => {},
    handleContextMenu: () => {},
    handleRulerClick: () => {},
    handleEditorBodyPointerDown: () => {},
    handleEditorBodyPointerMove: () => {},
    finishEditorBodyPointerGesture: () => {},
    handleAuxClick: () => {},
    draftNote: null,
    marqueeRect: null,
    dragState: null,
    movingNoteIndexSet: null,
    copyGhostNotes: [],
  };
}

function createTrackListBaseResult() {
  return {
    listRef: { current: null },
    wheelSurfaceRef: { current: null },
    reorderState: null,
    activeReorderTrackId: null,
    pendingTrackDeleteId: null,
    pendingTrackDeleteTrack: null,
    pendingTrackDeleteClipCount: 0,
    actionSheetTrack: null,
    openTrackActionSheet: () => {},
    closeTrackActionSheet: () => {},
    handleListScroll: () => {},
    handleListDoubleClick: () => {},
    handleTrackReorderStart: () => {},
    moveTrackToIndex: () => {},
    requestTrackDelete: () => {},
    confirmTrackDelete: () => {},
    closePendingTrackDelete: () => {},
    dropIndicatorTop: 0,
  };
}

describe("interaction adapter contracts", () => {
  it("keeps timeline semantics shared between the shells", () => {
    const base = createTimelineBaseResult();
    const desktop = buildTimelineDesktopContract(base);
    const mobile = buildTimelineMobileContract(base);

    // The same handlers drive both: gestures branch on pointer type inside
    // them rather than through a per-shell implementation.
    expect(desktop.handleTimelinePointerDown).toBe(mobile.handleTimelinePointerDown);
    expect(desktop.handleTimelineDrop).toBe(mobile.handleTimelineDrop);
    expect(desktop.mobileTransientActionBadge.visible).toBe(false);
  });

  it("keeps clip semantics shared while mobile exposes action-sheet and badge boundaries", () => {
    const base = createClipBaseResult();
    const desktop = buildClipDesktopContract(base, { isDragging: false, isResizing: false });
    const mobile = buildClipMobileContract(base, { isDragging: false, isResizing: false });

    expect(desktop.handlePointerDown).toBe(mobile.handlePointerDown);
    expect(desktop.toggleWarpPlacementArmed).toBe(mobile.toggleWarpPlacementArmed);
    expect(desktop.mobileActionSheet.open).toBe(false);
    expect(mobile.mobileActionSheet.open).toBe(false);
    expect(mobile.mobileTransientActionBadge.visible).toBe(false);
  });

  it("keeps midi semantics shared while mobile exposes touch note-create boundaries", () => {
    const base = createMidiBaseResult();
    const desktop = buildMidiEditorDesktopContract(base);
    const mobile = buildMidiEditorMobileContract(base);

    expect(desktop.handleGridPointerDown).toBe(mobile.handleGridPointerDown);
    expect(desktop.finishGridPointerGesture).toBe(mobile.finishGridPointerGesture);
    expect(desktop.supportsTouchNoteCreateFlow).toBe(false);
    expect(mobile.supportsTouchNoteCreateFlow).toBe(true);
    expect(mobile.mobileTouchNoteCreateFlow.phase).toBe("idle");
  });

  it("keeps track list semantics shared while mobile drives the overflow sheet", () => {
    const base = createTrackListBaseResult();
    const desktop = buildTrackListDesktopContract(base);
    const mobile = buildTrackListMobileContract(base);

    expect(desktop.handleTrackReorderStart).toBe(mobile.handleTrackReorderStart);
    expect(desktop.requestTrackDelete).toBe(mobile.requestTrackDelete);
    // No track has its overflow open, so the sheet reports closed.
    expect(mobile.mobileActionSheet.open).toBe(false);
  });
});
