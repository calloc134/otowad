import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIP_HANDLE_WIDTH,
  getPageStepTicks,
  getPlayheadStepTicks,
  isClipBodyClick,
  normalizeTimeSelectionRange,
  resolvePlayheadKeyTick,
  resolveTimelineGesture,
  resolveClipResizeClickOutcome,
  resolveClipSelection,
  resolveClipSelectionOnClick,
  resolveViewportContentPoint,
  tickFromViewportClientX,
  tickFromClipBodyClick,
} from "./timelineInteractions.ts";

test("plain click removes only the clicked clip from a multi-selection", () => {
  const result = resolveClipSelectionOnClick({
    clipId: "clip-b",
    selectedClipIds: ["clip-a", "clip-b", "clip-c"],
    primaryClipId: "clip-b",
    isToggle: false,
  });

  assert.deepEqual(result, {
    clipIds: ["clip-a", "clip-c"],
    primaryClipId: null,
  });
});

test("plain click keeps a single selected clip focused", () => {
  const result = resolveClipSelectionOnClick({
    clipId: "clip-a",
    selectedClipIds: ["clip-a"],
    primaryClipId: "clip-a",
    isToggle: false,
  });

  assert.deepEqual(result, {
    clipIds: ["clip-a"],
    primaryClipId: "clip-a",
  });
});

test("toggle click adds and removes clips without collapsing the whole selection", () => {
  const added = resolveClipSelectionOnClick({
    clipId: "clip-c",
    selectedClipIds: ["clip-a", "clip-b"],
    primaryClipId: "clip-a",
    isToggle: true,
    clickedClipKind: "audio",
    currentSelectionKind: "audio",
  });
  assert.deepEqual(added, {
    clipIds: ["clip-a", "clip-b", "clip-c"],
    primaryClipId: "clip-c",
  });

  const removed = resolveClipSelectionOnClick({
    clipId: "clip-a",
    selectedClipIds: added.clipIds,
    primaryClipId: added.primaryClipId,
    isToggle: true,
    clickedClipKind: "audio",
    currentSelectionKind: "audio",
  });
  assert.deepEqual(removed, {
    clipIds: ["clip-b", "clip-c"],
    primaryClipId: "clip-c",
  });
});

test("toggle click across clip kinds collapses to the clicked clip", () => {
  const result = resolveClipSelectionOnClick({
    clipId: "clip-midi",
    selectedClipIds: ["clip-audio-a", "clip-audio-b"],
    primaryClipId: "clip-audio-a",
    isToggle: true,
    clickedClipKind: "midi",
    currentSelectionKind: "audio",
  });

  assert.deepEqual(result, {
    clipIds: ["clip-midi"],
    primaryClipId: "clip-midi",
  });
});

test("preserve-click mode keeps the clicked clip selected instead of toggling it away", () => {
  const result = resolveClipSelection({
    clipId: "clip-b",
    selectedClipIds: ["clip-a", "clip-b"],
    primaryClipId: "clip-a",
    isToggle: false,
    mode: "preserve_clicked",
  });

  assert.deepEqual(result, {
    clipIds: ["clip-a", "clip-b"],
    primaryClipId: "clip-b",
  });
});

test("wide clips treat edge zones as non-body clicks", () => {
  assert.equal(
    isClipBodyClick({
      relativeX: CLIP_HANDLE_WIDTH,
      renderedWidth: 40,
      disableGroupEdit: false,
    }),
    false,
  );
  assert.equal(
    isClipBodyClick({
      relativeX: 20,
      renderedWidth: 40,
      disableGroupEdit: false,
    }),
    true,
  );
});

test("narrow clips still resolve clicks as body clicks", () => {
  assert.equal(
    isClipBodyClick({
      relativeX: 1,
      renderedWidth: 4,
      disableGroupEdit: false,
    }),
    true,
  );
});

test("clip click tick stays within clip bounds even when rendered width is inflated", () => {
  assert.equal(
    tickFromClipBodyClick({
      relativeX: 4,
      renderedWidth: 4,
      clipStart: 120,
      clipLength: 1,
    }),
    121,
  );
  assert.equal(
    tickFromClipBodyClick({
      relativeX: -8,
      renderedWidth: 4,
      clipStart: 120,
      clipLength: 1,
    }),
    120,
  );
});

test("page step uses the current step multiplied by the time signature numerator", () => {
  assert.equal(getPageStepTicks(120, 4), 480);
  assert.equal(getPageStepTicks(0, 0), 1);
});

test("playhead step uses the grid when snapping is enabled and beat steps when disabled", () => {
  assert.equal(
    getPlayheadStepTicks({
      snapEnabled: true,
      division: "Sixteenth",
      ppq: 960,
      timeSig: { num: 4, den: 4 },
    }),
    60,
  );
  assert.equal(
    getPlayheadStepTicks({
      snapEnabled: false,
      division: "Sixteenth",
      ppq: 960,
      timeSig: { num: 7, den: 8 },
    }),
    480,
  );
});

test("viewport coordinate conversion applies scroll offsets exactly once", () => {
  assert.deepEqual(
    resolveViewportContentPoint({
      clientX: 110,
      clientY: 190,
      viewportLeft: 10,
      viewportTop: 30,
      scrollLeft: 20,
      scrollTop: 40,
    }),
    { x: 120, y: 200 },
  );
  assert.deepEqual(
    resolveViewportContentPoint({
      clientX: 110,
      clientY: 190,
      viewportLeft: 10,
      viewportTop: 30,
      scrollLeft: 0,
      scrollTop: 0,
    }),
    { x: 100, y: 160 },
  );
});

test("tickFromViewportClientX resolves ticks from scrolled viewport positions", () => {
  assert.equal(
    tickFromViewportClientX({
      clientX: 110,
      viewportLeft: 10,
      scrollLeft: 20,
      pixelsPerTick: 2,
    }),
    60,
  );
  assert.equal(
    tickFromViewportClientX({
      clientX: 5,
      viewportLeft: 10,
      scrollLeft: 0,
      pixelsPerTick: 2,
    }),
    0,
  );
});

test("playhead key resolution matches timeline navigation shortcuts", () => {
  assert.equal(
    resolvePlayheadKeyTick({
      key: "ArrowLeft",
      currentTick: 240,
      playheadStepTicks: 120,
      pageStepTicks: 480,
    }),
    120,
  );
  assert.equal(
    resolvePlayheadKeyTick({
      key: "PageDown",
      currentTick: 240,
      playheadStepTicks: 120,
      pageStepTicks: 480,
    }),
    720,
  );
  assert.equal(
    resolvePlayheadKeyTick({
      key: "Home",
      currentTick: 240,
      playheadStepTicks: 120,
      pageStepTicks: 480,
    }),
    0,
  );
  assert.equal(
    resolvePlayheadKeyTick({
      key: "KeyA",
      currentTick: 240,
      playheadStepTicks: 120,
      pageStepTicks: 480,
    }),
    null,
  );
});

test("time selection ranges are normalized into half-open bounds", () => {
  assert.deepEqual(normalizeTimeSelectionRange(480, 120), {
    startTick: 120,
    endTick: 480,
  });
  assert.deepEqual(normalizeTimeSelectionRange(-8, 12), {
    startTick: 0,
    endTick: 12,
  });
});

test("collapsed or missing time selections resolve to null", () => {
  assert.equal(normalizeTimeSelectionRange(240, 240), null);
  assert.equal(normalizeTimeSelectionRange(null, 240), null);
});

test("timeline gesture threshold distinguishes clicks from drags", () => {
  assert.equal(
    resolveTimelineGesture({
      startX: 10,
      startY: 20,
      currentX: 13,
      currentY: 22,
      threshold: 4,
    }),
    "click",
  );
  assert.equal(
    resolveTimelineGesture({
      startX: 10,
      startY: 20,
      currentX: 15,
      currentY: 20,
      threshold: 4,
    }),
    "drag",
  );
});

test("resize click outcome seeks to the handle edge only when the clip shape did not change", () => {
  assert.deepEqual(
    resolveClipResizeClickOutcome({
      edge: "start-red",
      originalStart: 120,
      originalLength: 80,
      originalSourceIn: 1000,
      originalSourceOut: 1800,
      nextStart: 120,
      nextLength: 80,
      nextSourceIn: 1000,
      nextSourceOut: 1800,
    }),
    { type: "seek_edge", edge: "start" },
  );

  assert.deepEqual(
    resolveClipResizeClickOutcome({
      edge: "end-blue",
      originalStart: 120,
      originalLength: 80,
      nextStart: 120,
      nextLength: 96,
    }),
    { type: "select_only" },
  );
});
