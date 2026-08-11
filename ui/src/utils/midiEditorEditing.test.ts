import assert from "node:assert/strict";
import test from "node:test";
import { describeGridDivision } from "../grid.ts";
import {
  buildAddNotesCommand,
  buildReplaceNotesCommand,
  clampNoteMoveDeltas,
  findMatchingNoteIndices,
  findNotesInSelectionRect,
  getDuplicateNoteDelta,
  normalizeSelectionRect,
  resolveDraftNoteTicks,
} from "./midiEditorEditing.ts";

test("describeGridDivision exposes time-signature-aware beat labels", () => {
  assert.equal(
    describeGridDivision("Half", 960, { num: 4, den: 8 }),
    "Half beat (1/16 note in 4/8)",
  );
  assert.equal(
    describeGridDivision("Beat", 960, { num: 7, den: 8 }),
    "Beat (1/8 note in 7/8)",
  );
});

test("findNotesInSelectionRect returns all intersecting notes", () => {
  const notes = [
    { id: "note-1", start: 0, length: 120, key: 60, vel: 100 },
    { id: "note-2", start: 240, length: 120, key: 64, vel: 100 },
    { id: "note-3", start: 480, length: 120, key: 67, vel: 100 },
  ];
  const rect = normalizeSelectionRect(100, (127 - 68) * 16, 500, (127 - 59) * 16);

  assert.deepEqual(
    findNotesInSelectionRect(notes, rect, 0.5, 16),
    [1, 2],
  );
});

test("clampNoteMoveDeltas keeps note moves inside valid tick and key bounds", () => {
  const notes = [
    { id: "note-1", start: 24, length: 120, key: 1, vel: 100 },
    { id: "note-2", start: 96, length: 120, key: 126, vel: 100 },
  ];

  assert.deepEqual(
    clampNoteMoveDeltas(notes, -120, 8),
    { tickDelta: -24, keyDelta: 1 },
  );
  assert.deepEqual(
    clampNoteMoveDeltas(notes, 12, -16),
    { tickDelta: 12, keyDelta: -1 },
  );
});

test("buildReplaceNotesCommand targets stable note IDs and preserves moved IDs", () => {
  const previousNotes = [
    { id: "note-1", start: 120, length: 120, key: 60, vel: 100 },
    { id: "note-2", start: 240, length: 120, key: 64, vel: 100 },
  ];
  assert.deepEqual(
    buildReplaceNotesCommand(
      "content-1",
      previousNotes,
      [{ id: "note-1", start: 480, length: 120, key: 72, vel: 100 }],
    ),
    {
      command: "batch",
      commands: [
        { command: "remove_midi_note", content_id: "content-1", note_id: "note-1" },
        { command: "remove_midi_note", content_id: "content-1", note_id: "note-2" },
        {
          command: "add_midi_note",
          content_id: "content-1",
          note: { id: "note-1", start: 480, length: 120, key: 72, vel: 100 },
        },
      ],
    },
  );
});

test("findMatchingNoteIndices follows IDs when note properties are identical", () => {
  const note = { id: "note-1", start: 120, length: 60, key: 64, vel: 100 };
  const notes = [
    note,
    { id: "note-2", start: 240, length: 60, key: 67, vel: 100 },
    { id: "note-3", start: 120, length: 60, key: 64, vel: 100 },
  ];

  assert.deepEqual(findMatchingNoteIndices(notes, [note]), [0]);
  assert.deepEqual(
    findMatchingNoteIndices(notes, [notes[2]!]),
    [2],
  );
});

test("getDuplicateNoteDelta places duplicates after the full selected span", () => {
  assert.equal(
    getDuplicateNoteDelta(
      [
        { id: "note-1", start: 120, length: 60, key: 64, vel: 100 },
        { id: "note-2", start: 300, length: 120, key: 67, vel: 100 },
      ],
      120,
    ),
    300,
  );
  assert.equal(getDuplicateNoteDelta([], 120), 120);
});

test("buildAddNotesCommand appends duplicated notes in one batch", () => {
  assert.deepEqual(
    buildAddNotesCommand("content-1", [
      { id: "note-1", start: 480, length: 120, key: 72, vel: 100 },
      { id: "note-2", start: 600, length: 120, key: 76, vel: 100 },
    ]),
    {
      command: "batch",
      commands: [
        {
          command: "add_midi_note",
          content_id: "content-1",
          note: { id: "note-1", start: 480, length: 120, key: 72, vel: 100 },
        },
        {
          command: "add_midi_note",
          content_id: "content-1",
          note: { id: "note-2", start: 600, length: 120, key: 76, vel: 100 },
        },
      ],
    },
  );
});

test("resolveDraftNoteTicks snaps the note start by meaning, not drag direction", () => {
  const snapStartTick = (tick: number) => (tick <= 100 ? 100 : Math.round(tick));
  const snapEndTick = (tick: number) => Math.round(tick);

  assert.deepEqual(
    resolveDraftNoteTicks({
      anchorTick: 108,
      currentTick: 92,
      minimumLength: 1,
      snapStartTick,
      snapEndTick,
    }),
    { start: 100, length: 8 },
  );
  assert.deepEqual(
    resolveDraftNoteTicks({
      anchorTick: 92,
      currentTick: 108,
      minimumLength: 1,
      snapStartTick,
      snapEndTick,
    }),
    { start: 100, length: 8 },
  );
});
