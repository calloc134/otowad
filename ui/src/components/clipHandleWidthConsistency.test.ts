import assert from "node:assert/strict";
import test from "node:test";

import { resolveClipBodyIntent } from "./clipViewGesture.ts";
import { CLIP_HANDLE_WIDTH, isClipBodyClick } from "../utils/timelineInteractions.ts";

/**
 * Three code paths decide where a clip's resize handle ends, and they used to
 * disagree: the overlay drew 6px, click resolution used 6px, and the
 * pointerdown hit test used its own 8px constant. In the 2px gap a press
 * started a resize on a pixel that looked and clicked like clip body.
 *
 * These assertions pin the hit test and the click resolution to the same
 * constant the overlay renders, so the paths cannot drift apart again.
 */

function intentAt(relativeX: number) {
  const clipWidth = 200;
  const clipHeight = 40;
  return resolveClipBodyIntent({
    event: {
      button: 0,
      clientX: relativeX,
      clientY: clipHeight / 2 + 1,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
    } as unknown as Parameters<typeof resolveClipBodyIntent>[0]["event"],
    clipWidth,
    clipHeight,
    disableGroupEdit: false,
    isAudio: false,
  });
}

test("pointerdown stops treating a pixel as a handle exactly where the overlay ends", () => {
  assert.equal(intentAt(CLIP_HANDLE_WIDTH)?.type, "resize");
  assert.equal(intentAt(CLIP_HANDLE_WIDTH + 1)?.type, "body");
});

test("pointerdown and click resolution agree on the first body pixel", () => {
  const firstBodyPixel = CLIP_HANDLE_WIDTH + 1;

  assert.equal(intentAt(firstBodyPixel)?.type, "body");
  assert.equal(
    isClipBodyClick({
      relativeX: firstBodyPixel,
      renderedWidth: 200,
      disableGroupEdit: false,
    }),
    true,
  );
});

test("pointerdown and click resolution agree on the last handle pixel", () => {
  assert.equal(intentAt(CLIP_HANDLE_WIDTH)?.type, "resize");
  assert.equal(
    isClipBodyClick({
      relativeX: CLIP_HANDLE_WIDTH,
      renderedWidth: 200,
      disableGroupEdit: false,
    }),
    false,
  );
});
