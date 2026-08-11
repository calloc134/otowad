import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ZOOM_X } from "../../state/zoomLimits.ts";
import {
  getPinchDistance,
  getPinchMidpointX,
  resolveTimelinePinch,
  resolveTimelinePinchAnchor,
} from "./timelinePinch.ts";

function createAnchor(overrides: { zoomX?: number; scrollLeft?: number; midpointOffsetX?: number } = {}) {
  const anchor = resolveTimelinePinchAnchor({
    distance: 200,
    zoomX: overrides.zoomX ?? DEFAULT_ZOOM_X,
    scrollLeft: overrides.scrollLeft ?? 0,
    midpointOffsetX: overrides.midpointOffsetX ?? 400,
  });
  assert.ok(anchor);
  return anchor;
}

test("finger separation and midpoint come from the two contact points", () => {
  assert.equal(getPinchDistance({ x: 0, y: 0 }, { x: 30, y: 40 }), 50);
  assert.equal(getPinchMidpointX({ x: 100, y: 0 }, { x: 300, y: 0 }), 200);
});

test("the anchor records the tick that sits under the fingers", () => {
  const anchor = createAnchor({ zoomX: 0.04, scrollLeft: 800, midpointOffsetX: 400 });
  // (800 + 400) / 0.04
  assert.equal(anchor.tick, 30_000);
});

test("fingers too close together do not start a gesture", () => {
  const anchor = resolveTimelinePinchAnchor({
    distance: 10,
    zoomX: DEFAULT_ZOOM_X,
    scrollLeft: 0,
    midpointOffsetX: 400,
  });
  assert.equal(anchor, null);
});

test("spreading the fingers zooms in and pinching them zooms out", () => {
  const anchor = createAnchor();

  const spread = resolveTimelinePinch({
    anchor,
    distance: 400,
    midpointOffsetX: 400,
    maxScrollLeft: 100_000,
  });
  const pinch = resolveTimelinePinch({
    anchor,
    distance: 100,
    midpointOffsetX: 400,
    maxScrollLeft: 100_000,
  });

  assert.ok(spread);
  assert.ok(pinch);
  assert.ok(spread.zoomX > anchor.zoomX);
  assert.ok(pinch.zoomX < anchor.zoomX);
});

test("the tick under the fingers stays under the fingers", () => {
  const anchor = createAnchor({ zoomX: 0.04, scrollLeft: 1_200, midpointOffsetX: 400 });

  for (const distance of [120, 260, 400, 800]) {
    const result = resolveTimelinePinch({
      anchor,
      distance,
      midpointOffsetX: 400,
      maxScrollLeft: 10_000_000,
    });
    assert.ok(result);
    const tickUnderMidpoint = (result.scrollLeft + 400) / result.zoomX;
    assert.ok(
      Math.abs(tickUnderMidpoint - anchor.tick) < 1e-6,
      `distance ${distance} moved the anchor tick to ${tickUnderMidpoint}`,
    );
  }
});

test("moving both fingers without changing their separation pans", () => {
  const anchor = createAnchor({ zoomX: 0.04, scrollLeft: 1_200, midpointOffsetX: 400 });

  const held = resolveTimelinePinch({
    anchor,
    distance: 200,
    midpointOffsetX: 400,
    maxScrollLeft: 10_000_000,
  });
  const draggedRight = resolveTimelinePinch({
    anchor,
    distance: 200,
    midpointOffsetX: 600,
    maxScrollLeft: 10_000_000,
  });

  assert.ok(held);
  assert.ok(draggedRight);
  assert.equal(held.zoomX, anchor.zoomX);
  assert.equal(draggedRight.zoomX, anchor.zoomX);
  // Fingers moved 200px to the right, so the content follows them.
  assert.equal(held.scrollLeft - draggedRight.scrollLeft, 200);
});

test("the gesture cannot leave the scrollable range", () => {
  const anchor = createAnchor({ zoomX: 0.04, scrollLeft: 0, midpointOffsetX: 400 });

  const result = resolveTimelinePinch({
    anchor,
    distance: 20_000,
    midpointOffsetX: 400,
    maxScrollLeft: 500,
  });

  assert.ok(result);
  assert.ok(result.scrollLeft >= 0);
  assert.ok(result.scrollLeft <= 500);
});

test("the zoom it produces is one the zoom controls could also produce", () => {
  const anchor = createAnchor();

  const wayIn = resolveTimelinePinch({ anchor, distance: 100_000, midpointOffsetX: 400, maxScrollLeft: 0 });
  const wayOut = resolveTimelinePinch({ anchor, distance: 25, midpointOffsetX: 400, maxScrollLeft: 0 });

  assert.ok(wayIn);
  assert.ok(wayOut);
  assert.equal(wayIn.zoomX, clampedTo(wayIn.zoomX));
  assert.equal(wayOut.zoomX, clampedTo(wayOut.zoomX));
});

function clampedTo(zoomX: number) {
  // Re-clamping a clamped value is a no-op, so this asserts the range holds.
  return Math.min(0.5, Math.max(0.005, zoomX));
}
