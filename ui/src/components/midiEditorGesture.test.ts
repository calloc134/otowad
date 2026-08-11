import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopMidiEditorPolicy,
  touchMidiEditorPolicy,
} from "../app/deviceInteraction.ts";

import {
  resolveMidiCreationDraft,
  resolveMidiMarqueePreview,
  resolveMidiMoveDragPreview,
  shouldStartMidiNoteCreation,
  shouldStartMidiNoteMove,
} from "./midiEditorGesture.ts";

test("shouldStartMidiNoteCreation uses policy threshold", () => {
  assert.equal(
    shouldStartMidiNoteCreation({
      policy: touchMidiEditorPolicy,
      anchorClientX: 100,
      currentClientX: 108,
    }),
    false,
  );
  assert.equal(
    shouldStartMidiNoteCreation({
      policy: touchMidiEditorPolicy,
      anchorClientX: 100,
      currentClientX: 120,
    }),
    true,
  );
});

test("shouldStartMidiNoteMove uses policy threshold on either axis", () => {
  assert.equal(
    shouldStartMidiNoteMove({
      policy: desktopMidiEditorPolicy,
      startClientX: 0,
      startClientY: 0,
      currentClientX: 3,
      currentClientY: 3,
    }),
    false,
  );
  assert.equal(
    shouldStartMidiNoteMove({
      policy: desktopMidiEditorPolicy,
      startClientX: 0,
      startClientY: 0,
      currentClientX: 5,
      currentClientY: 0,
    }),
    true,
  );
});

test("resolveMidiCreationDraft reuses intent builder", () => {
  const note = resolveMidiCreationDraft({
    id: "note-draft",
    anchorTick: 120,
    currentTick: 250,
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

test("resolveMidiMarqueePreview returns rect and selection", () => {
  const result = resolveMidiMarqueePreview({
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

test("resolveMidiMoveDragPreview centralizes clamp behavior", () => {
  const result = resolveMidiMoveDragPreview({
    notes: [{ id: "note-1", start: 10, length: 120, key: 1, vel: 100 }],
    rawTickDelta: -40,
    rawKeyDelta: -8,
  });

  assert.deepEqual(result, { tickDelta: -10, keyDelta: -1 });
});
