import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMidiDraftToWindow,
  clampMidiNoteMoveDeltaToWindow,
  getMidiNoteIndicesInsideWindow,
  isContentTickInMidiWindow,
} from "./midiClipWindow.ts";

const window = { contentIn: 400, contentOut: 900 };

test("MIDI clip windows use half-open tick bounds", () => {
  assert.equal(isContentTickInMidiWindow(399, window), false);
  assert.equal(isContentTickInMidiWindow(400, window), true);
  assert.equal(isContentTickInMidiWindow(899, window), true);
  assert.equal(isContentTickInMidiWindow(900, window), false);
});

test("only notes fully contained in a MIDI clip window are editable", () => {
  const notes = [
    { id: "before", start: 0, length: 100, key: 60, vel: 100 },
    { id: "cross-in", start: 350, length: 100, key: 61, vel: 100 },
    { id: "inside", start: 480, length: 240, key: 62, vel: 100 },
    { id: "cross-out", start: 850, length: 100, key: 63, vel: 100 },
    { id: "after", start: 900, length: 100, key: 64, vel: 100 },
  ];
  assert.deepEqual(getMidiNoteIndicesInsideWindow(notes, window), [2]);
});

test("moves and drafts are clamped to the clip content window", () => {
  assert.equal(
    clampMidiNoteMoveDeltaToWindow(
      [{ start: 480, length: 240 }],
      -200,
      window,
    ),
    -80,
  );
  assert.equal(
    clampMidiNoteMoveDeltaToWindow(
      [{ start: 480, length: 240 }],
      500,
      window,
    ),
    180,
  );
  assert.deepEqual(
    clampMidiDraftToWindow(
      { id: "draft", start: 850, length: 200, key: 60, vel: 100 },
      120,
      window,
    ),
    { id: "draft", start: 850, length: 50, key: 60, vel: 100 },
  );
});
