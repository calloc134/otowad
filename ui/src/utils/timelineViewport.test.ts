import assert from "node:assert/strict";
import test from "node:test";
import {
  getBiasedZoomScrollLeft,
  getMaxScrollLeft,
  getPlayheadFollowScrollLeft,
} from "./timelineViewport.ts";

test("zoom anchor biases halfway from viewport center toward the playhead", () => {
  const scrollLeft = getBiasedZoomScrollLeft({
    currentScrollLeft: 400,
    viewportWidth: 200,
    oldPixelsPerTick: 2,
    newPixelsPerTick: 4,
    playheadTick: 400,
    contentWidth: 2000,
    bias: 0.5,
  });

  assert.equal(scrollLeft, 1200);
});

test("zoom anchor clamps to the left edge when the focus point would go negative", () => {
  const scrollLeft = getBiasedZoomScrollLeft({
    currentScrollLeft: 20,
    viewportWidth: 200,
    oldPixelsPerTick: 2,
    newPixelsPerTick: 4,
    playheadTick: 0,
    contentWidth: 2000,
    bias: 1,
  });

  assert.equal(scrollLeft, 0);
});

test("playhead follow does not move the viewport while the playhead is visible", () => {
  const scrollLeft = getPlayheadFollowScrollLeft({
    currentScrollLeft: 200,
    viewportWidth: 300,
    playheadX: 420,
    maxScrollLeft: 900,
  });

  assert.equal(scrollLeft, null);
});

test("playhead follow snaps an offscreen playhead to the left edge and clamps at the end", () => {
  assert.equal(
    getPlayheadFollowScrollLeft({
      currentScrollLeft: 200,
      viewportWidth: 300,
      playheadX: 650,
      maxScrollLeft: 900,
    }),
    650,
  );

  assert.equal(getMaxScrollLeft(1200, 300), 900);
  assert.equal(
    getPlayheadFollowScrollLeft({
      currentScrollLeft: 700,
      viewportWidth: 300,
      playheadX: 1200,
      maxScrollLeft: 900,
    }),
    900,
  );
});
