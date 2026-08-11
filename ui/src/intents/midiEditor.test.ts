import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMidiDraftNote,
  buildMidiMarqueeSelection,
  resolveMidiMovePreview,
} from "./midiEditor.ts";

test("buildMidiDraftNote keeps note creation policy outside the component", () => {
  const note = buildMidiDraftNote({
    id: "note-draft",
    anchorTick: 120,
    currentTick: 270,
    key: 64,
    minimumLength: 120,
    snapStartTick: (tick) => Math.round(tick / 120) * 120,
    snapEndTick: (tick) => Math.round(tick / 120) * 120,
  });

  assert.deepEqual(note, {
    id: "note-draft",
    start: 120,
    length: 120,
    key: 64,
    vel: 100,
  });
});

test("buildMidiMarqueeSelection returns rect and selected indices together", () => {
  const result = buildMidiMarqueeSelection({
    notes: [
      { id: "note-1", start: 0, length: 240, key: 60, vel: 100 },
      { id: "note-2", start: 480, length: 240, key: 64, vel: 100 },
    ],
    anchorX: 0,
    anchorY: (127 - 65) * 16,
    currentX: 800,
    currentY: (127 - 59) * 16,
    pxPerTick: 1,
    rowHeight: 16,
  });

  assert.deepEqual(result.selectedIndices, [0, 1]);
  assert.equal(result.rect.left, 0);
});

test("resolveMidiMovePreview centralizes clamp behavior", () => {
  const result = resolveMidiMovePreview({
    notes: [{ id: "note-1", start: 10, length: 120, key: 1, vel: 100 }],
    rawTickDelta: -40,
    rawKeyDelta: -8,
  });

  assert.deepEqual(result, { tickDelta: -10, keyDelta: -1 });
});
