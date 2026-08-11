import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectDocument } from "../types/index.ts";
import {
  buildCreateEmptyMidiClipIntent,
  buildDeleteClipIntent,
} from "./timeline.ts";

function createTimelineIntentProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "timeline-intent",
      created_at: "",
      app_version: "test",
      project_sample_rate: 44_100,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
      },
      grid: {
        snap_enabled: true,
        division: "Beat" as const,
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [
        {
          id: "track-audio",
          name: "Audio",
          kind: { track_type: "audio" as const },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" as const }, sends: [] },
        },
        {
          id: "track-midi",
          name: "MIDI",
          kind: {
            track_type: "midi" as const,
            audition_instrument: null,
            render_enabled: false,
          },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" as const }, sends: [] },
        },
      ],
      media: [],
      contents: [{
        type: "midi" as const,
        id: "content-midi",
        notes: [{ id: "note-midi", start: 0, length: 240, key: 60, vel: 100 }],
        ccs: [],
      }],
      clips: [{
        id: "clip-midi",
        track_id: "track-midi",
        start: 960,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "midi" as const,
          content_id: "content-midi",
          midi: {
            content_in: 0,
            content_out: 960,
            transpose_semitones: 0,
          },
        },
      }],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

test("create-empty-midi-clip intent centralizes default clip/content shape", () => {
  const project = createTimelineIntentProject();
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  if (!midiTrack) {
    throw new Error("expected midi track");
  }

  let idCalls = 0;
  const intent = buildCreateEmptyMidiClipIntent({
    document: project,
    trackId: midiTrack.id,
    startTick: 2_400,
    clipLength: 3_840,
    snapTick: () => 1_920,
    createId: () => {
      idCalls += 1;
      return `new-${idCalls}`;
    },
  });

  assert.ok(intent);
  assert.equal(intent.clipId, "new-2");
  assert.deepEqual(intent.command, {
    command: "batch",
    commands: [
      {
        command: "add_content",
        content: {
          type: "midi",
          id: "new-1",
          notes: [],
          ccs: [],
        },
      },
      {
        command: "add_clip",
        clip: {
          id: "new-2",
          track_id: midiTrack.id,
          start: 1_920,
          length: 3_840,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "midi",
            content_id: "new-1",
            midi: {
              content_in: 0,
              content_out: 3_840,
              transpose_semitones: 0,
            },
          },
        },
      },
    ],
  });
});

test("create-empty-midi-clip intent rejects overlap and non-midi tracks", () => {
  const project = createTimelineIntentProject();
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
  if (!midiTrack || !audioTrack) {
    throw new Error("expected both track kinds");
  }

  const overlap = buildCreateEmptyMidiClipIntent({
    document: project,
    trackId: midiTrack.id,
    startTick: 960,
    clipLength: 960,
    snapTick: (tick) => tick,
    createId: () => "noop",
  });
  assert.equal(overlap, null);

  const wrongTrack = buildCreateEmptyMidiClipIntent({
    document: project,
    trackId: audioTrack.id,
    startTick: 2_000,
    clipLength: 960,
    snapTick: (tick) => tick,
    createId: () => "noop",
  });
  assert.equal(wrongTrack, null);
});

test("delete clip intent uses selected group only when clicked clip is already selected", () => {
  assert.deepEqual(
    buildDeleteClipIntent("clip-a", ["clip-a", "clip-b"], true),
    {
      command: "batch",
      commands: [
        { command: "remove_clip", clip_id: "clip-a" },
        { command: "remove_clip", clip_id: "clip-b" },
      ],
    },
  );

  assert.deepEqual(
    buildDeleteClipIntent("clip-c", ["clip-a", "clip-b"], false),
    { command: "remove_clip", clip_id: "clip-c" },
  );
});
