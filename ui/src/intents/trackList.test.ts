import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMoveTrackCommand,
  buildRemoveTrackCommand,
  buildRenameTrackCommand,
  buildSetTrackGainCommand,
  buildSetTrackPanCommand,
  buildTrackCreateIntent,
  buildTrackMuteToggleCommand,
  buildTrackSoloToggleCommand,
  getPitchLinkInfo,
} from "./trackList.ts";
import type { TrackEdit } from "../types/index.ts";

const AUDIO_TRACK: TrackEdit = {
  id: "track-audio",
  name: "Audio",
  kind: { track_type: "audio" },
  mute: false,
  solo: false,
  gain_milli_db: 0,
  pan_permille: 0,
  fx_chain: [],
  routing: { output: { bus: "master" }, sends: [] },
};

const MIDI_TRACK: TrackEdit = {
  id: "track-midi",
  name: "MIDI",
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
};

test("track create intent centralizes default audio and midi track shapes", () => {
  const ids = [
    "track-new",
    "content-new",
    "clip-new",
  ];
  const createId = () => ids.shift() ?? crypto.randomUUID();

  const audioIntent = buildTrackCreateIntent("audio", 960, { num: 4, den: 4 }, () => "track-audio-new");
  const midiIntent = buildTrackCreateIntent("midi", 960, { num: 4, den: 4 }, createId);

  assert.equal(audioIntent.trackId, "track-audio-new");
  assert.equal(audioIntent.command.command, "add_track");
  assert.equal(midiIntent.trackId, "track-new");
  assert.equal(midiIntent.command.command, "batch");
  if (midiIntent.command.command !== "batch") {
    throw new Error("expected batch command");
  }
  assert.equal(midiIntent.command.commands.length, 3);
  const midiClipCommand = midiIntent.command.commands[2];
  if (!midiClipCommand || midiClipCommand.command !== "add_clip") {
    throw new Error("expected midi add_clip command");
  }
  if (midiClipCommand.clip.kind.clip_type !== "midi") {
    throw new Error("expected midi clip");
  }
  assert.equal(midiClipCommand.clip.kind.midi.transpose_semitones, 0);
});

test("track toggle and rename intents emit semantic track commands", () => {
  assert.deepEqual(buildTrackMuteToggleCommand(AUDIO_TRACK), {
    command: "set_track_mute",
    id: "track-audio",
    mute: true,
  });
  assert.deepEqual(buildTrackSoloToggleCommand(MIDI_TRACK), {
    command: "set_track_solo",
    id: "track-midi",
    solo: true,
  });
  assert.deepEqual(buildRenameTrackCommand("track-audio", "Renamed"), {
    command: "set_track_name",
    id: "track-audio",
    name: "Renamed",
  });
  assert.deepEqual(buildSetTrackGainCommand("track-audio", -6000.4), {
    command: "set_track_gain",
    id: "track-audio",
    gain_milli_db: -6000,
  });
  assert.deepEqual(buildSetTrackPanCommand("track-midi", 125.6), {
    command: "set_track_pan",
    id: "track-midi",
    pan_permille: 126,
  });
  assert.deepEqual(buildRemoveTrackCommand("track-midi"), {
    command: "remove_track",
    id: "track-midi",
  });
});

test("move track intent clamps invalid operations to null", () => {
  const tracks = [AUDIO_TRACK, MIDI_TRACK];
  assert.equal(buildMoveTrackCommand(tracks, "missing", 1), null);
  assert.equal(buildMoveTrackCommand(tracks, "track-audio", 0), null);
  assert.deepEqual(buildMoveTrackCommand(tracks, "track-audio", 1), {
    command: "move_track",
    id: "track-audio",
    new_index: 1,
  });
});

test("pitch link info stays in intent/helper layer instead of TrackList component", () => {
  const info = getPitchLinkInfo(
    "track-audio",
    [{
      id: "link-1",
      midi_track: "track-midi",
      audio_track: "track-audio",
      no_note_behavior: "KeepOriginal",
      no_pitch_behavior: "Bypass",
      priority: "Highest",
    }],
    [AUDIO_TRACK, MIDI_TRACK],
  );

  assert.deepEqual(info, {
    label: "<- MIDI",
    tooltip: "Pitch target from: MIDI",
  });
});
