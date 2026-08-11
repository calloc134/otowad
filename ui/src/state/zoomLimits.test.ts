import assert from "node:assert/strict";
import test from "node:test";

import { initialViewportStoreState } from "./viewportStore.ts";
import {
  DEFAULT_ZOOM_X,
  clampZoomX,
  zoomInX,
  zoomOutX,
  zoomXToDisplayPercent,
  zoomXToSliderRatio,
} from "./zoomLimits.ts";

test("the initial viewport zoom is a value the zoom controls can produce", () => {
  // A default outside the clamp range is unreachable once the user zooms once.
  assert.equal(clampZoomX(initialViewportStoreState.zoom.x), initialViewportStoreState.zoom.x);
});

test("zooming in from the default magnifies rather than clamping down", () => {
  assert.ok(zoomInX(DEFAULT_ZOOM_X) > DEFAULT_ZOOM_X);
});

test("zoom in and zoom out are inverse within the range", () => {
  assert.equal(zoomOutX(zoomInX(DEFAULT_ZOOM_X)), DEFAULT_ZOOM_X);
});

test("repeated zooming settles at the bounds instead of running away", () => {
  let zoomedIn = DEFAULT_ZOOM_X;
  for (let i = 0; i < 40; i += 1) zoomedIn = zoomInX(zoomedIn);
  assert.equal(zoomInX(zoomedIn), zoomedIn);
  assert.ok(zoomedIn > DEFAULT_ZOOM_X);

  let zoomedOut = DEFAULT_ZOOM_X;
  for (let i = 0; i < 40; i += 1) zoomedOut = zoomOutX(zoomedOut);
  assert.equal(zoomOutX(zoomedOut), zoomedOut);
  assert.ok(zoomedOut < DEFAULT_ZOOM_X);
});

test("a non-finite zoom falls back to the default instead of poisoning the viewport", () => {
  // `Fit` divides the available width by the content length.
  assert.equal(clampZoomX(1 / 0), DEFAULT_ZOOM_X);
  assert.equal(clampZoomX(Number.NaN), DEFAULT_ZOOM_X);
});

test("the slider ratio spans the full bar across the zoom range", () => {
  const atMin = zoomXToSliderRatio(0);
  const atMax = zoomXToSliderRatio(Number.MAX_SAFE_INTEGER);

  assert.equal(atMin, 0);
  assert.equal(atMax, 1);

  // Linear scaling put the default near the left edge; log scaling centres it.
  const atDefault = zoomXToSliderRatio(DEFAULT_ZOOM_X);
  assert.ok(atDefault > 0.3 && atDefault < 0.7);
});

test("the displayed percentage treats the default view as 100%", () => {
  assert.equal(zoomXToDisplayPercent(DEFAULT_ZOOM_X), 100);
  assert.ok(zoomXToDisplayPercent(zoomInX(DEFAULT_ZOOM_X)) > 100);
  assert.ok(zoomXToDisplayPercent(zoomOutX(DEFAULT_ZOOM_X)) < 100);
});
