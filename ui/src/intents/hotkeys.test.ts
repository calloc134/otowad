import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectDocument } from "../types/index.ts";
import {
  buildDeleteSelectionIntent,
  buildDuplicateClipIntent,
  buildDuplicateSelectionIntent,
  buildPitchHotkeyIntent,
  buildSelectAllClipsOfPrimaryKindIntent,
  buildSplitAtPlayheadIntent,
} from "./hotkeys.ts";

function createIntentProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "intent-project",
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
        start: 960,
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
      }, {
        id: "clip-audio-2",
        track_id: "track-audio",
        start: 2400,
        length: 960,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "audio" as const,
          content_id: "content-audio-2",
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
      }, {
        id: "clip-midi",
        track_id: "track-midi",
        start: 0,
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

test("duplicate hotkey intent returns a stable batch and new primary clip", () => {
  const project = createIntentProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!audioClip) {
    throw new Error("expected audio clip");
  }

  let idCalls = 0;
  const intent = buildDuplicateSelectionIntent(
    project,
    [audioClip.id],
    audioClip.id,
    () => {
      idCalls += 1;
      return `dup-${idCalls}`;
    },
  );

  assert.ok(intent);
  assert.equal(intent.command.command, "add_clip");
  assert.equal(intent.primaryDuplicateId, "dup-1");
  assert.deepEqual(intent.duplicatedClipIds, ["dup-1"]);
});

test("duplicate clip intent reuses the same duplication plan for touch affordances", () => {
  const project = createIntentProject();
  const intent = buildDuplicateClipIntent(project, "clip-audio", () => "dup-touch-1");

  assert.ok(intent);
  assert.equal(intent.primaryDuplicateId, "dup-touch-1");
  assert.deepEqual(intent.duplicatedClipIds, ["dup-touch-1"]);
});

test("split-at-playhead hotkey intent only returns a split command for a single focused clip", () => {
  const project = createIntentProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!audioClip) {
    throw new Error("expected audio clip");
  }

  const command = buildSplitAtPlayheadIntent(
    project,
    [audioClip.id],
    audioClip.id,
    audioClip.start + 240,
    () => "split-1",
  );
  assert.deepEqual(command, {
    command: "split_clip",
    clip_id: audioClip.id,
    tick_in_clip: 240,
    new_clip_id: "split-1",
  });

  const invalid = buildSplitAtPlayheadIntent(
    project,
    [audioClip.id, "second"],
    audioClip.id,
    audioClip.start + 240,
    () => "split-2",
  );
  assert.equal(invalid, null);
});

test("pitch hotkey intent skips pitch-linked audio clips and preserves coarse/fine semantics", () => {
  const project = createIntentProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!audioClip || audioClip.kind.clip_type !== "audio") {
    throw new Error("expected audio clip");
  }

  const coarse = buildPitchHotkeyIntent(
    project,
    [audioClip.id],
    new Set<string>(),
    { kind: "coarse", delta: 1 },
  );
  assert.deepEqual(coarse, {
    command: "set_pitch_coarse",
    clip_id: audioClip.id,
    semitones: 1,
  });

  const fine = buildPitchHotkeyIntent(
    project,
    [audioClip.id],
    new Set<string>(),
    { kind: "fine", delta: -10 },
  );
  assert.deepEqual(fine, {
    command: "set_pitch_fine",
    clip_id: audioClip.id,
    cents: -10,
  });

  const blocked = buildPitchHotkeyIntent(
    project,
    [audioClip.id],
    new Set<string>([audioClip.track_id]),
    { kind: "coarse", delta: 1 },
  );
  assert.equal(blocked, null);
});

test("pitch hotkey intent uses clip-local transpose for MIDI clips", () => {
  const project = createIntentProject();

  const coarse = buildPitchHotkeyIntent(
    project,
    ["clip-midi"],
    new Set<string>(),
    { kind: "coarse", delta: -1 },
  );
  assert.deepEqual(coarse, {
    command: "set_midi_transpose",
    clip_id: "clip-midi",
    semitones: -1,
  });

  const fine = buildPitchHotkeyIntent(
    project,
    ["clip-midi"],
    new Set<string>(),
    { kind: "fine", delta: 10 },
  );
  assert.equal(fine, null);
});

test("delete selection hotkey intent returns a batch for all selected clips", () => {
  const command = buildDeleteSelectionIntent(["clip-a", "clip-b"]);
  assert.deepEqual(command, {
    command: "batch",
    commands: [
      { command: "remove_clip", clip_id: "clip-a" },
      { command: "remove_clip", clip_id: "clip-b" },
    ],
  });
});

test("select-all intent scopes to the primary clip kind", () => {
  const project = createIntentProject();

  assert.deepEqual(
    buildSelectAllClipsOfPrimaryKindIntent(project, "clip-audio"),
    {
      clipIds: ["clip-audio", "clip-audio-2"],
      primaryClipId: "clip-audio",
      clipKind: "audio",
    },
  );

  assert.deepEqual(
    buildSelectAllClipsOfPrimaryKindIntent(project, "clip-midi"),
    {
      clipIds: ["clip-midi"],
      primaryClipId: "clip-midi",
      clipKind: "midi",
    },
  );

  assert.equal(buildSelectAllClipsOfPrimaryKindIntent(project, null), null);
});
