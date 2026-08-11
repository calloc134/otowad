import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDocument } from "@/types";
import {
  buildMidiImportGroups,
  collectTrackMidiExportData,
  encodeSingleTrackSmf,
  MIDI_DRUM_CHANNEL,
  parseMidiSmf,
} from "./midiSmf.ts";

function encodeVlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
}

function buildTrackChunk(events: Array<{ delta: number; bytes: number[] }>): Uint8Array {
  const trackBody: number[] = [];
  for (const event of events) {
    trackBody.push(...encodeVlq(event.delta), ...event.bytes);
  }
  trackBody.push(0x00, 0xff, 0x2f, 0x00);

  const body = Uint8Array.from(trackBody);
  const chunk = new Uint8Array(8 + body.length);
  chunk.set([0x4d, 0x54, 0x72, 0x6b], 0);
  const view = new DataView(chunk.buffer);
  view.setUint32(4, body.length);
  chunk.set(body, 8);
  return chunk;
}

function buildRawTrackChunk(body: readonly number[], declaredLength = body.length): Uint8Array {
  const chunk = new Uint8Array(8 + body.length);
  chunk.set([0x4d, 0x54, 0x72, 0x6b], 0);
  new DataView(chunk.buffer).setUint32(4, declaredLength);
  chunk.set(body, 8);
  return chunk;
}

function buildTrackNameMeta(name: string): number[] {
  const bytes = new TextEncoder().encode(name);
  return [0xff, 0x03, ...encodeVlq(bytes.length), ...bytes];
}

function buildSmf(ppq: number, tracks: Uint8Array[]): ArrayBuffer {
  const header = new Uint8Array(14);
  header.set([0x4d, 0x54, 0x68, 0x64], 0);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(4, 6);
  headerView.setUint16(8, 1);
  headerView.setUint16(10, tracks.length);
  headerView.setUint16(12, ppq);

  const totalLength = header.length + tracks.reduce((sum, track) => sum + track.length, 0);
  const bytes = new Uint8Array(totalLength);
  bytes.set(header, 0);
  let offset = header.length;
  for (const track of tracks) {
    bytes.set(track, offset);
    offset += track.length;
  }
  return bytes.buffer;
}

test("buildMidiImportGroups keeps source track/channel order and filters drums and empty groups", () => {
  const source = buildSmf(480, [
    buildTrackChunk([
      { delta: 0, bytes: buildTrackNameMeta("Piano") },
      { delta: 0, bytes: [0x90, 60, 100] },
      { delta: 120, bytes: [0x80, 60, 0] },
      { delta: 0, bytes: [0xb0, 1, 64] },
      { delta: 0, bytes: [0x99, 36, 100] },
      { delta: 120, bytes: [0x89, 36, 0] },
    ]),
    buildTrackChunk([
      { delta: 0, bytes: [0x91, 64, 110] },
      { delta: 240, bytes: [0x81, 64, 0] },
      { delta: 0, bytes: [0xb2, 7, 100] },
    ]),
  ]);

  const parsed = parseMidiSmf(source);
  const groups = buildMidiImportGroups(parsed, 960);

  assert.equal(parsed.ppq, 480);
  assert.equal(parsed.tracks[0]?.name, "Piano");
  assert.deepEqual(
    groups.map((group) => ({
      sourceTrackIndex: group.sourceTrackIndex,
      midiChannel: group.midiChannel,
      noteCount: group.notes.length,
      ccCount: group.ccs.length,
    })),
    [
      {
        sourceTrackIndex: 0,
        midiChannel: 0,
        noteCount: 1,
        ccCount: 1,
      },
      {
        sourceTrackIndex: 1,
        midiChannel: 1,
        noteCount: 1,
        ccCount: 0,
      },
    ],
  );
  assert.equal(groups.some((group) => group.midiChannel === MIDI_DRUM_CHANNEL), false);
  assert.deepEqual(groups[0]?.notes[0], {
    start: 0,
    length: 240,
    key: 60,
    vel: 100,
  });
  assert.deepEqual(groups[0]?.ccs[0], {
    at: 240,
    cc: 1,
    value: 64,
  });
  assert.deepEqual(groups[1]?.notes[0], {
    start: 0,
    length: 480,
    key: 64,
    vel: 110,
  });
});

test("encodeSingleTrackSmf is deterministic and round-trips through the parser", () => {
  const input = {
    ppq: 960,
    channel: 0,
    notes: [
      { start: 0, length: 240, key: 60, vel: 100 },
      { start: 240, length: 120, key: 64, vel: 110 },
    ],
    ccs: [{ at: 120, cc: 1, value: 80 }],
  };

  const first = encodeSingleTrackSmf(input);
  const second = encodeSingleTrackSmf(input);
  assert.deepEqual(first, second);

  const parsed = parseMidiSmf(Uint8Array.from(first).buffer);
  const groups = buildMidiImportGroups(parsed, 960);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.notes, input.notes);
  assert.deepEqual(groups[0]?.ccs, input.ccs);
});

test("parseMidiSmf rejects malformed SMF boundaries", async (t) => {
  await t.test("truncated MThd", () => {
    assert.throws(
      () => parseMidiSmf(Uint8Array.from([0x4d, 0x54, 0x68, 0x64]).buffer),
      /Unexpected end of MIDI data while reading header length/,
    );
  });

  await t.test("invalid VLQ", () => {
    const source = buildSmf(480, [
      buildRawTrackChunk([0x80, 0x80, 0x80, 0x80]),
    ]);
    assert.throws(() => parseMidiSmf(source), /Invalid variable-length quantity in delta time/);
  });

  await t.test("truncated MTrk", () => {
    const source = buildSmf(480, [
      buildRawTrackChunk([0x00, 0xff, 0x2f, 0x00], 64),
    ]);
    assert.throws(() => parseMidiSmf(source), /Track 0 exceeds MIDI file length/);
  });

  await t.test("unknown status", () => {
    const source = buildSmf(480, [
      buildRawTrackChunk([0x00, 0xf4, 0x00]),
    ]);
    assert.throws(() => parseMidiSmf(source), /Unsupported MIDI status byte 0xf4/);
  });

  await t.test("running-status corruption", () => {
    const source = buildSmf(480, [
      buildRawTrackChunk([0x00, 0x3c, 0x64]),
    ]);
    assert.throws(() => parseMidiSmf(source), /Running status encountered without a prior status byte/);
  });

  await t.test("invalid chunk length leaves no unparsed trailing bytes", () => {
    const source = buildSmf(480, [
      buildRawTrackChunk(
        [0x00, 0xff, 0x2f, 0x00, 0x00, 0x90, 0x3c, 0x64],
        4,
      ),
    ]);
    assert.throws(() => parseMidiSmf(source), /Unexpected trailing MIDI data/);
  });
});

test("collectTrackMidiExportData uses visible windows and clip starts", () => {
  const document: ProjectDocument = {
    schema_version: 4,
    meta: {
      name: "demo",
      created_at: "2026-03-07T00:00:00Z",
      app_version: "0.1.0",
      project_sample_rate: 44100,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [
          {
            at: 0,
            micro_bpm: 120_000_000,
            time_sig: { num: 4, den: 4 },
          },
        ],
      },
      grid: {
        snap_enabled: true,
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [
        {
          id: "track-midi",
          name: "MIDI Track",
          kind: {
            track_type: "midi",
            audition_instrument: null,
            render_enabled: false,
          },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        },
      ],
      media: [],
      contents: [
        {
          type: "midi",
          id: "content-a",
          notes: [
            { id: "note-a", start: 0, length: 120, key: 60, vel: 100 },
            { id: "note-b", start: 240, length: 120, key: 62, vel: 96 },
          ],
          ccs: [
            { at: 60, cc: 1, value: 20 },
            { at: 270, cc: 1, value: 64 },
          ],
        },
      ],
      clips: [
        {
          id: "clip-a",
          track_id: "track-midi",
          start: 1000,
          length: 120,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "midi",
            content_id: "content-a",
            midi: {
              content_in: 240,
              content_out: 360,
              transpose_semitones: 0,
            },
          },
        },
        {
          id: "clip-b",
          track_id: "track-midi",
          start: 1500,
          length: 120,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "midi",
            content_id: "content-a",
            midi: {
              content_in: 0,
              content_out: 120,
              transpose_semitones: 0,
            },
          },
        },
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };

  assert.deepEqual(collectTrackMidiExportData(document, "track-midi"), {
    notes: [
      { start: 1000, length: 120, key: 62, vel: 96 },
      { start: 1500, length: 120, key: 60, vel: 100 },
    ],
    ccs: [
      { at: 1030, cc: 1, value: 64 },
      { at: 1560, cc: 1, value: 20 },
    ],
  });
});

test("collectTrackMidiExportData rejects notes crossing visible windows", () => {
  const document = {
    schema_version: 4,
    meta: {
      name: "demo",
      created_at: "2026-03-07T00:00:00Z",
      app_version: "0.1.0",
      project_sample_rate: 44100,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [
          {
            at: 0,
            micro_bpm: 120_000_000,
            time_sig: { num: 4, den: 4 },
          },
        ],
      },
      grid: {
        snap_enabled: true,
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [
        {
          id: "track-midi",
          name: "MIDI Track",
          kind: {
            track_type: "midi",
            audition_instrument: null,
            render_enabled: false,
          },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        },
      ],
      media: [],
      contents: [
        {
          type: "midi",
          id: "content-a",
          notes: [{ id: "note-a", start: 200, length: 200, key: 60, vel: 100 }],
          ccs: [],
        },
      ],
      clips: [
        {
          id: "clip-a",
          track_id: "track-midi",
          start: 1000,
          length: 120,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "midi",
            content_id: "content-a",
            midi: {
              content_in: 240,
              content_out: 360,
              transpose_semitones: 0,
            },
          },
        },
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  } satisfies ProjectDocument;

assert.throws(
  () => collectTrackMidiExportData(document, "track-midi"),
  /crossing its visible window/,
);
});

test("collectTrackMidiExportData applies clip-local transpose without mutating shared content", () => {
  const document = {
    schema_version: 4,
    meta: {
      name: "demo",
      created_at: "2026-03-07T00:00:00Z",
      app_version: "0.1.0",
      project_sample_rate: 44100,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
      },
      grid: {
        snap_enabled: true,
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [
        {
          id: "track-midi",
          name: "MIDI Track",
          kind: {
            track_type: "midi",
            audition_instrument: null,
            render_enabled: false,
          },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        },
      ],
      media: [],
      contents: [
        {
          type: "midi",
          id: "content-a",
          notes: [{ id: "note-a", start: 0, length: 120, key: 60, vel: 100 }],
          ccs: [],
        },
      ],
      clips: [
        {
          id: "clip-a",
          track_id: "track-midi",
          start: 1000,
          length: 120,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "midi",
            content_id: "content-a",
            midi: {
              content_in: 0,
              content_out: 120,
              transpose_semitones: 2,
            },
          },
        },
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  } satisfies ProjectDocument;

  assert.deepEqual(collectTrackMidiExportData(document, "track-midi"), {
    notes: [{ start: 1000, length: 120, key: 62, vel: 100 }],
    ccs: [],
  });
  if (document.edit.contents[0]?.type !== "midi") {
    throw new Error("expected MIDI content");
  }
  assert.equal(document.edit.contents[0].notes[0]?.key, 60);
});
