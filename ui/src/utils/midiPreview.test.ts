import assert from "node:assert/strict";
import test from "node:test";

import { buildMidiPreviewSegments } from "./midiPreview.ts";

test("buildMidiPreviewSegments clips notes to the visible MIDI content window", () => {
  const segments = buildMidiPreviewSegments(
    {
      content_in: 50,
      content_out: 180,
      transpose_semitones: 2,
    },
    [
      { id: "note-1", start: 0, length: 100, key: 60, vel: 100 },
      { id: "note-2", start: 100, length: 120, key: 64, vel: 96 },
      { id: "note-3", start: 220, length: 40, key: 67, vel: 80 },
    ],
  );

  assert.deepEqual(segments, [
    { startInClip: 0, lengthInClip: 50, key: 62, vel: 100 },
    { startInClip: 50, lengthInClip: 80, key: 66, vel: 96 },
  ]);
});
