import assert from "node:assert/strict";
import test from "node:test";

import { initialViewportStoreState } from "../state/viewportStore.ts";
import {
  DEFAULT_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  clampTrackHeight,
  minTrackHeight,
  trackRowShowsMixControls,
} from "./editorGeometry.ts";

const MIN_TRACK_HEIGHT = minTrackHeight(false);

test("the initial track height is one the zoom controls can produce", () => {
  assert.equal(DEFAULT_TRACK_HEIGHT, 80);
  assert.equal(clampTrackHeight(initialViewportStoreState.zoom.y), initialViewportStoreState.zoom.y);
});

test("the smallest allowed row still has room for its name and controls", () => {
  // 28px name row + 28px control row + padding and border.
  assert.ok(MIN_TRACK_HEIGHT >= 56 + 13);
});

test("clamping keeps a row inside the range the row can actually render", () => {
  assert.equal(clampTrackHeight(10), MIN_TRACK_HEIGHT);
  assert.equal(clampTrackHeight(10_000), MAX_TRACK_HEIGHT);
  assert.equal(clampTrackHeight(Number.NaN), DEFAULT_TRACK_HEIGHT);
  assert.equal(clampTrackHeight(120), 120);
});

test("the compact default keeps essential controls and hides the mix row", () => {
  assert.equal(trackRowShowsMixControls(DEFAULT_TRACK_HEIGHT), false);
  assert.ok(DEFAULT_TRACK_HEIGHT >= 56 + 13);
  assert.ok(DEFAULT_TRACK_HEIGHT < 56 + 31 + 13);
});

test("shrinking a row drops the mix controls instead of overflowing", () => {
  assert.equal(trackRowShowsMixControls(MIN_TRACK_HEIGHT), false);
  assert.equal(trackRowShowsMixControls(MAX_TRACK_HEIGHT), true);
});

test("a touch row is measured against its own taller contents", () => {
  // Touch rows carry reorder chevrons and a rename button, so their name row
  // is 58px rather than 28px. Sizing them from the pointer numbers left them
  // overflowing their box by 26px and bleeding into the next track.
  assert.ok(minTrackHeight(true) > minTrackHeight(false));
  assert.ok(minTrackHeight(true) >= 86 + 13);
});

test("the default row does not overflow under either control size", () => {
  for (const usesTouchControls of [false, true]) {
    const renderedHeight = clampTrackHeight(DEFAULT_TRACK_HEIGHT, usesTouchControls);
    const available = renderedHeight - 13;
    const needed = (usesTouchControls ? 86 : 56)
      + (trackRowShowsMixControls(renderedHeight, usesTouchControls) ? 31 : 0);
    assert.ok(
      needed <= available,
      `${usesTouchControls ? "touch" : "compact"} row needs ${needed} of ${available}`,
    );
  }
});

test("a touch row trades its sliders for the space instead of overflowing", () => {
  // Touch clamps the shared zoom value to its taller essential-controls minimum.
  const touchDefaultHeight = clampTrackHeight(DEFAULT_TRACK_HEIGHT, true);
  assert.equal(touchDefaultHeight, minTrackHeight(true));
  assert.equal(trackRowShowsMixControls(touchDefaultHeight, true), false);
  assert.equal(trackRowShowsMixControls(DEFAULT_TRACK_HEIGHT, false), false);
  // Zooming in far enough brings them back.
  assert.equal(trackRowShowsMixControls(MAX_TRACK_HEIGHT, true), true);
});

test("zooming out reaches a compact row and zooming back in restores the mix controls", () => {
  let height = DEFAULT_TRACK_HEIGHT;
  while (height > MIN_TRACK_HEIGHT && trackRowShowsMixControls(height)) {
    height = clampTrackHeight(height - 20);
  }
  assert.equal(trackRowShowsMixControls(height), false);

  while (height < MAX_TRACK_HEIGHT && !trackRowShowsMixControls(height)) {
    height = clampTrackHeight(height + 20);
  }
  assert.equal(trackRowShowsMixControls(height), true);
});
