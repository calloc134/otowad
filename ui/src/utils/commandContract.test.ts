import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  apply_command_json,
  apply_internal_command_json,
  initSync,
} from "../wasm/otomad_core.js";
import { applyProjectCommand } from "../adapters/projectDocument.ts";
import type { Command, ProjectDocument } from "../types/index.ts";

initSync({
  module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
});

function createMidiCommandProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "midi-command-contract",
      created_at: "2026-08-11T00:00:00Z",
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
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [],
      media: [],
      contents: [{
        type: "midi",
        id: "00000000-0000-0000-0000-000000000101",
        notes: [],
        ccs: [],
      }],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

test("project command adapter lets core reject an invalid MIDI note without repairing it", () => {
  const project = createMidiCommandProject();
  const midiContent = project.edit.contents[0];
  if (!midiContent || midiContent.type !== "midi") {
    throw new Error("expected MIDI content in command contract fixture");
  }
  const command: Command = {
    command: "add_midi_note",
    content_id: midiContent.id,
    note: {
      id: "00000000-0000-0000-0000-000000000301",
      start: 0,
      length: 0,
      key: 60,
      vel: 100,
    },
  };

  assert.throws(
    () => applyProjectCommand(project, command),
    (error) => String(error).includes("INVALID_MIDI_NOTE"),
  );
});

test("split_clip command contract omits legacy new_content_id and keeps shared MIDI content", () => {
  const project: ProjectDocument = {
    schema_version: 4,
    meta: {
      name: "command-contract",
      created_at: "2026-03-09T00:00:00Z",
      app_version: "0.1.0",
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
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          name: "Audio Track",
          kind: { track_type: "audio" },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        },
        {
          id: "00000000-0000-0000-0000-000000000002",
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
      contents: [{
        type: "midi",
        id: "00000000-0000-0000-0000-000000000101",
        notes: [
          { id: "00000000-0000-0000-0000-000000000301", start: 0, length: 240, key: 60, vel: 100 },
          { id: "00000000-0000-0000-0000-000000000302", start: 480, length: 240, key: 64, vel: 100 },
        ],
        ccs: [],
      }],
      clips: [{
        id: "00000000-0000-0000-0000-000000000201",
        track_id: "00000000-0000-0000-0000-000000000002",
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "midi",
          content_id: "00000000-0000-0000-0000-000000000101",
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
  const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
  if (!midiClip || midiClip.kind.clip_type !== "midi") {
    throw new Error("expected MIDI clip in test project");
  }

  const command: Command = {
    command: "split_clip",
    clip_id: midiClip.id,
    tick_in_clip: 480,
    new_clip_id: "00000000-0000-0000-0000-000000000999",
  };

  const commandJson = JSON.stringify(command);
  assert.equal(commandJson.includes("new_content_id"), false);

  const result = JSON.parse(
    apply_command_json(JSON.stringify(project), commandJson),
  ) as { project: ProjectDocument };

  const splitClips = result.project.edit.clips.filter((clip) => clip.kind.clip_type === "midi");
  assert.equal(splitClips.length, 2);
  const left = splitClips.find((clip) => clip.id === midiClip.id);
  const right = splitClips.find((clip) => clip.id === command.new_clip_id);
  if (
    !left ||
    !right ||
    left.kind.clip_type !== "midi" ||
    right.kind.clip_type !== "midi"
  ) {
    throw new Error("expected split MIDI clips");
  }

  assert.equal(left.kind.content_id, right.kind.content_id);
  assert.equal(left.kind.midi.content_out, 480);
  assert.equal(right.kind.midi.content_in, 480);
});

test("semantic clip commands serialize without exposing raw mutators", () => {
  const stretch: Command = {
    command: "audio_blue_stretch",
    clip_id: "00000000-0000-0000-0000-000000000201",
    new_start: 120,
    new_length: 1440,
  };
  const midiTrim: Command = {
    command: "midi_red_trim",
    clip_id: "00000000-0000-0000-0000-000000000201",
    new_start: 480,
    new_content_in: 480,
    new_content_out: 960,
  };
  const addWarpAtTick: Command = {
    command: "add_warp_anchor_at_tick",
    clip_id: "00000000-0000-0000-0000-000000000201",
    tick_in_clip: 240,
  };

  assert.equal(JSON.stringify(stretch).includes('"command":"resize_clip"'), false);
  assert.equal(
    JSON.stringify(midiTrim).includes('"command":"set_midi_content_window"'),
    false,
  );
  assert.equal(
    JSON.stringify(addWarpAtTick).includes('"command":"add_warp_anchor"'),
    false,
  );
});

test("command bridge returns and applies internal inverse commands without exposing them publicly", () => {
  const project: ProjectDocument = {
    schema_version: 4,
    meta: {
      name: "inverse-contract",
      created_at: "2026-03-09T00:00:00Z",
      app_version: "0.1.0",
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
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [{
        id: "00000000-0000-0000-0000-000000000001",
        name: "Audio",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      }],
      media: [{
        id: "00000000-0000-0000-0000-000000000002",
        in_zip_path: "media/test.wav",
        channels: 1,
        src_sample_rate: 44_100,
        length_src_frames: 44_100,
        hash: null,
        original_name: null,
      }],
      contents: [{
        type: "audio",
        id: "00000000-0000-0000-0000-000000000003",
        media_id: "00000000-0000-0000-0000-000000000002",
        analysis_refs: [],
      }],
      clips: [{
        id: "00000000-0000-0000-0000-000000000004",
        track_id: "00000000-0000-0000-0000-000000000001",
        start: 0,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio",
          content_id: "00000000-0000-0000-0000-000000000003",
          audio: {
            src_in: 0,
            src_out: 44_100,
            warp: { warp_type: "none" },
            pitch: {
              mode: "ManualOnly",
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

  const result = JSON.parse(
    apply_command_json(
      JSON.stringify(project),
      JSON.stringify({
        command: "audio_blue_stretch",
        clip_id: "00000000-0000-0000-0000-000000000004",
        new_start: 0,
        new_length: 480,
      } satisfies Command),
    ),
  ) as { inverse: { command: string } };

  assert.equal(result.inverse.command, "_set_clip_state");

  const initialPitch = JSON.parse(
    apply_command_json(
      JSON.stringify(project),
      JSON.stringify({
        command: "set_pitch_fine",
        clip_id: "00000000-0000-0000-0000-000000000004",
        cents: 90,
      } satisfies Command),
    ),
  ) as { project: ProjectDocument };
  const shiftedPitch = JSON.parse(
    apply_command_json(
      JSON.stringify(initialPitch.project),
      JSON.stringify({
        command: "set_pitch_fine",
        clip_id: "00000000-0000-0000-0000-000000000004",
        cents: 100,
      } satisfies Command),
    ),
  ) as {
    project: ProjectDocument;
    inverse: { command: string };
  };
  assert.equal(shiftedPitch.inverse.command, "_restore_pitch_control");

  const restoredPitch = JSON.parse(
    apply_internal_command_json(
      JSON.stringify(shiftedPitch.project),
      JSON.stringify(shiftedPitch.inverse),
    ),
  ) as { project: ProjectDocument };
  const restoredAudioClip = restoredPitch.project.edit.clips[0];
  if (!restoredAudioClip || restoredAudioClip.kind.clip_type !== "audio") {
    throw new Error("expected restored audio clip");
  }
  assert.equal(restoredAudioClip.kind.audio.pitch.manual_coarse_semitones, 0);
  assert.equal(restoredAudioClip.kind.audio.pitch.manual_fine_cents, 90);
});
