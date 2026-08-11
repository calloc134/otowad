import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAudioBlueStretchCommand,
  buildAudioRedTrimCommand,
  buildMidiRedTrimCommand,
  buildMoveClipsCommand,
  buildSetTimePitchCommand,
} from "./clipCommands.ts";
import type { ProjectDocument } from "../types/index.ts";

test("move clips intent batches track changes and timeline offsets", () => {
  assert.deepEqual(
    buildMoveClipsCommand({
      clipIds: ["clip-a", "clip-b"],
      deltaTicks: 240,
      originalStarts: {
        "clip-a": 960,
        "clip-b": 1_920,
      },
      originalTrackIds: {
        "clip-a": "track-audio",
        "clip-b": "track-midi",
      },
      previewTrackIds: {
        "clip-b": "track-midi-2",
      },
    }),
    {
      command: "batch",
      commands: [
        { command: "move_clip", clip_id: "clip-a", new_start: 1_200 },
        {
          command: "move_clip_to_track",
          clip_id: "clip-b",
          new_track_id: "track-midi-2",
        },
        { command: "move_clip", clip_id: "clip-b", new_start: 2_160 },
      ],
    },
  );

  assert.equal(
    buildMoveClipsCommand({
      clipIds: ["clip-a"],
      deltaTicks: 0,
      originalStarts: { "clip-a": 0 },
      originalTrackIds: { "clip-a": "track-audio" },
      previewTrackIds: {},
    }),
    null,
  );
});

test("audio stretch and trim intents reject no-op updates", () => {
  assert.equal(
    buildAudioBlueStretchCommand({
      clipId: "clip-a",
      originalStart: 0,
      originalLength: 960,
      newStart: 0,
      newLength: 960,
    }),
    null,
  );
  assert.deepEqual(
    buildAudioBlueStretchCommand({
      clipId: "clip-a",
      originalStart: 0,
      originalLength: 960,
      newStart: 120,
      newLength: 840,
    }),
    {
      command: "audio_blue_stretch",
      clip_id: "clip-a",
      new_start: 120,
      new_length: 840,
    },
  );
  assert.deepEqual(
    buildAudioRedTrimCommand({
      clipId: "clip-a",
      originalStart: 0,
      originalLength: 960,
      originalSrcIn: 0,
      originalSrcOut: 44_100,
      newStart: 120,
      newLength: 840,
      newSrcIn: 5_000,
      newSrcOut: 40_000,
    }),
    {
      command: "audio_red_trim",
      clip_id: "clip-a",
      new_src_in: 5_000,
      new_src_out: 40_000,
      new_start: 120,
      new_length: 840,
    },
  );
});

test("midi trim intent centralizes clip-window command assembly", () => {
  assert.equal(
    buildMidiRedTrimCommand({
      clipId: "clip-midi",
      originalStart: 960,
      originalLength: 960,
      originalContentIn: 0,
      originalContentOut: 960,
      newStart: 960,
      newLength: 960,
      newContentIn: 0,
      newContentOut: 960,
    }),
    null,
  );
  assert.deepEqual(
    buildMidiRedTrimCommand({
      clipId: "clip-midi",
      originalStart: 960,
      originalLength: 960,
      originalContentIn: 0,
      originalContentOut: 960,
      newStart: 1_080,
      newLength: 840,
      newContentIn: 120,
      newContentOut: 960,
    }),
    {
      command: "midi_red_trim",
      clip_id: "clip-midi",
      new_start: 1_080,
      new_content_in: 120,
      new_content_out: 960,
    },
  );
});

test("time/pitch intent maps UI selections into the persisted mode", () => {
  const document = {
    edit: {
      clips: [{
        id: "clip-a",
        kind: {
          clip_type: "audio",
          audio: {
            time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: true },
          },
        },
      }],
    },
  } as unknown as ProjectDocument;

  assert.deepEqual(
    buildSetTimePitchCommand(document, "clip-a", "Voice"),
    {
      command: "set_time_pitch",
      clip_id: "clip-a",
      time_pitch: {
        mode: "Voice",
        analysis: "Source",
        preserve_formant: true,
      },
    },
  );
  assert.deepEqual(
    buildSetTimePitchCommand(document, "clip-a", "Music"),
    {
      command: "set_time_pitch",
      clip_id: "clip-a",
      time_pitch: { mode: "Music" },
    },
  );
});
