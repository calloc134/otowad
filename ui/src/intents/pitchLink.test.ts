import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectDocument } from "../types/index.ts";
import {
  buildAddPitchLinkIntent,
  buildRemovePitchLinkIntent,
} from "./pitchLink.ts";

function createPitchLinkProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "pitch-link-project",
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
      contents: [],
      clips: [{
        id: "clip-audio",
        track_id: "track-audio",
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio" as const,
          content_id: "content-audio",
          audio: {
            src_in: 0,
            src_out: 44_100,
            warp: { warp_type: "none" as const },
            pitch: {
              mode: "ManualOnly" as const,
              manual_coarse_semitones: 0,
              manual_fine_cents: 0,
            },
            fades: { fade_in: 0, fade_out: 0 },
            time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
          },
        },
      }],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

function createPitchLinkProjectWithFollowMode(): ProjectDocument {
  const project = createPitchLinkProject();
  const audioClip = project.edit.clips[0];
  if (!audioClip || audioClip.kind.clip_type !== "audio") {
    throw new Error("expected audio clip");
  }

  project.edit.clips[0] = {
    ...audioClip,
    kind: {
      ...audioClip.kind,
      audio: {
        ...audioClip.kind.audio,
        pitch: {
          ...audioClip.kind.audio.pitch,
          mode: "FollowMidiOnly",
        },
      },
    },
  };
  project.edit.pitch_links = [{
    id: "link-1",
    midi_track: "track-midi",
    audio_track: "track-audio",
    no_note_behavior: "KeepOriginal",
    no_pitch_behavior: "Bypass",
    priority: "Highest",
  }];
  return project;
}

function createPitchLinkProjectWithManualPlusFollowMode(): ProjectDocument {
  const project = createPitchLinkProjectWithFollowMode();
  const audioClip = project.edit.clips[0];
  if (!audioClip || audioClip.kind.clip_type !== "audio") {
    throw new Error("expected audio clip");
  }

  project.edit.clips[0] = {
    ...audioClip,
    kind: {
      ...audioClip.kind,
      audio: {
        ...audioClip.kind.audio,
        pitch: {
          ...audioClip.kind.audio.pitch,
          mode: "ManualPlusFollow",
        },
      },
    },
  };
  return project;
}

test("add pitch-link intent batches link creation with follow-mode activation", () => {
  const project = createPitchLinkProject();
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!midiTrack || !audioTrack || !audioClip) {
    throw new Error("expected tracks and audio clip");
  }

  const command = buildAddPitchLinkIntent({
    document: project,
    midiTrackId: midiTrack.id,
    audioTrackId: audioTrack.id,
    noNoteBehavior: "KeepOriginal",
    notePriority: "Highest",
    createId: () => "link-1",
  });

  assert.deepEqual(command, {
    command: "batch",
    commands: [
      {
        command: "add_pitch_link",
        link: {
          id: "link-1",
          midi_track: midiTrack.id,
          audio_track: audioTrack.id,
          no_note_behavior: "KeepOriginal",
          no_pitch_behavior: "Bypass",
          priority: "Highest",
        },
      },
      {
        command: "set_pitch_mode",
        clip_id: audioClip.id,
        mode: "FollowMidiOnly",
      },
    ],
  });
});

test("remove pitch-link intent batches unlink with manual-mode restoration", () => {
  const project = createPitchLinkProjectWithFollowMode();
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!midiTrack || !audioTrack || !audioClip || audioClip.kind.clip_type !== "audio") {
    throw new Error("expected tracks and audio clip");
  }

  const command = buildRemovePitchLinkIntent(project, "link-1");
  assert.deepEqual(command, {
    command: "batch",
    commands: [
      { command: "remove_pitch_link", id: "link-1" },
      { command: "set_pitch_mode", clip_id: audioClip.id, mode: "ManualOnly" },
    ],
  });
});

test("add pitch-link intent preserves clips already using ManualPlusFollow", () => {
  const project = createPitchLinkProjectWithManualPlusFollowMode();
  project.edit.pitch_links = [];
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
  if (!midiTrack || !audioTrack) {
    throw new Error("expected tracks");
  }

  const command = buildAddPitchLinkIntent({
    document: project,
    midiTrackId: midiTrack.id,
    audioTrackId: audioTrack.id,
    noNoteBehavior: "KeepOriginal",
    notePriority: "Highest",
    createId: () => "link-2",
  });

  assert.deepEqual(command, {
    command: "add_pitch_link",
    link: {
      id: "link-2",
      midi_track: midiTrack.id,
      audio_track: audioTrack.id,
      no_note_behavior: "KeepOriginal",
      no_pitch_behavior: "Bypass",
      priority: "Highest",
    },
  });
});

test("add pitch-link intent rejects an audio target that already has a link", () => {
  const project = createPitchLinkProjectWithFollowMode();

  const command = buildAddPitchLinkIntent({
    document: project,
    midiTrackId: "track-midi",
    audioTrackId: "track-audio",
    noNoteBehavior: "KeepOriginal",
    notePriority: "Highest",
    createId: () => "link-2",
  });

  assert.equal(command, null);
});

test("remove pitch-link intent preserves clips already using ManualPlusFollow", () => {
  const project = createPitchLinkProjectWithManualPlusFollowMode();

  const command = buildRemovePitchLinkIntent(project, "link-1");

  assert.deepEqual(command, {
    command: "remove_pitch_link",
    id: "link-1",
  });
});
