import assert from "node:assert/strict";
import test from "node:test";

import { resolveMidiEditorWheelIntent } from "./midiEditorWheel.ts";

test("plain wheel resolves to horizontal zoom", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: -12,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      verticalScrollEnabled: false,
      wheelMode: "mixed",
    }),
    { type: "zoom", factor: 1.18 },
  );
});

test("alt+wheel resolves to horizontal scroll", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: 24,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      verticalScrollEnabled: false,
      wheelMode: "mixed",
    }),
    { type: "scroll-horizontal", delta: 24 },
  );
});

test("ctrl+wheel keeps zoom priority over other modifiers", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: 18,
      altKey: true,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      verticalScrollEnabled: true,
      wheelMode: "scroll",
    }),
    { type: "zoom", factor: 0.85 },
  );
});

test("shift+wheel can be routed to vertical scrolling when enabled", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: 32,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      verticalScrollEnabled: true,
      wheelMode: "mixed",
    }),
    { type: "scroll-vertical", delta: 32 },
  );
});

test("shift+wheel stays ignored on surfaces that do not own vertical scrolling", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: 32,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      verticalScrollEnabled: false,
      wheelMode: "mixed",
    }),
    { type: "ignore" },
  );
});

test("scroll-mode MIDI editor routes plain wheel to vertical scrolling", () => {
  assert.deepEqual(
    resolveMidiEditorWheelIntent({
      deltaY: 28,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      verticalScrollEnabled: true,
      wheelMode: "scroll",
    }),
    { type: "scroll-vertical", delta: 28 },
  );
});
