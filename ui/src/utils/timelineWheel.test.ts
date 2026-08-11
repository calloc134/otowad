import assert from "node:assert/strict";
import test from "node:test";

import { resolveTimelineWheelIntent } from "./timelineWheel.ts";

test("plain wheel zooms in mixed timeline mode", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 0,
      deltaY: -12,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      wheelMode: "mixed",
    }),
    { type: "zoom", factor: 1.18 },
  );
});

test("alt+wheel scrolls timeline horizontally", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 0,
      deltaY: 32,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      wheelMode: "mixed",
    }),
    { type: "scroll-horizontal", delta: 32 },
  );
});

test("scroll-mode timeline leaves plain wheel to native scrolling", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 0,
      deltaY: 24,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      wheelMode: "scroll",
    }),
    { type: "native-scroll" },
  );
});

test("shift+wheel resolves to vertical timeline scrolling", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 0,
      deltaY: 24,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      wheelMode: "mixed",
    }),
    { type: "scroll-vertical", delta: 24 },
  );
});

test("ctrl+wheel keeps zoom priority regardless of wheel mode", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 0,
      deltaY: 18,
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      wheelMode: "scroll",
    }),
    { type: "zoom", factor: 0.85 },
  );
});

test("horizontal touchpad movement stays horizontal in mixed mode", () => {
  assert.deepEqual(
    resolveTimelineWheelIntent({
      deltaX: 48,
      deltaY: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      wheelMode: "mixed",
    }),
    { type: "scroll-horizontal", delta: 48 },
  );
});
