import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopTimelinePolicy,
  touchTimelinePolicy,
} from "../app/deviceInteraction.ts";

import {
  resolveRulerSelectionPreview,
  resolveTimelinePolicyGesture,
  resolveTimelineTouchPanPreview,
} from "./timelineGesture.ts";

test("resolveTimelinePolicyGesture uses policy threshold", () => {
  assert.equal(
    resolveTimelinePolicyGesture(desktopTimelinePolicy, {
      startX: 0,
      startY: 0,
      currentX: 3,
      currentY: 0,
    }),
    "click",
  );

  assert.equal(
    resolveTimelinePolicyGesture(touchTimelinePolicy, {
      startX: 0,
      startY: 0,
      currentX: 9,
      currentY: 0,
    }),
    "drag",
  );
});

test("resolveRulerSelectionPreview only emits when drag threshold is crossed", () => {
  const idle = resolveRulerSelectionPreview({
    policy: desktopTimelinePolicy,
    startX: 20,
    startY: 0,
    currentX: 22,
    currentY: 0,
    anchorTick: 120,
    resolveTickFromClientX: (clientX) => clientX,
  });
  assert.equal(idle, null);

  const active = resolveRulerSelectionPreview({
    policy: desktopTimelinePolicy,
    startX: 20,
    startY: 0,
    currentX: 40,
    currentY: 0,
    anchorTick: 120,
    resolveTickFromClientX: (clientX) => clientX * 2,
  });
  assert.deepEqual(active, { startTick: 120, endTick: 80 });
});

test("resolveTimelineTouchPanPreview computes next scroll values after threshold", () => {
  const inactive = resolveTimelineTouchPanPreview({
    policy: touchTimelinePolicy,
    startX: 100,
    startY: 120,
    currentX: 103,
    currentY: 123,
    startScrollLeft: 40,
    startScrollTop: 70,
    maxScrollTop: 200,
  });
  assert.equal(inactive, null);

  const active = resolveTimelineTouchPanPreview({
    policy: touchTimelinePolicy,
    startX: 100,
    startY: 120,
    currentX: 124,
    currentY: 150,
    startScrollLeft: 40,
    startScrollTop: 70,
    maxScrollTop: 80,
  });
  assert.deepEqual(active, { scrollLeft: 16, scrollTop: 40 });
});
