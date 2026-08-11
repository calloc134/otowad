import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectDocument } from "../types/index.ts";
import {
  buildSetBpmCommand,
  buildSetGridSettingsCommand,
  buildSetTimeSignatureCommand,
  buildToggleGridCommand,
} from "./projectSettings.ts";

function createProjectSettingsIntentProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "project-settings-intent",
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
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [],
      media: [],
      contents: [],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

test("grid settings intent centralizes toolbar and dialog mutations", () => {
  const project = createProjectSettingsIntentProject();

  assert.deepEqual(
    buildSetGridSettingsCommand(project, {
      snap_enabled: false,
      division: "Sixteenth",
      magnet_range_permille: 500,
    }),
    {
      command: "set_grid_settings",
      grid: {
        snap_enabled: false,
        division: "Sixteenth",
        swing_permille: 0,
        magnet_range_permille: 500,
        snap_strength_permille: 1_000,
      },
    },
  );
  assert.equal(buildSetGridSettingsCommand(project, {}), null);
  assert.deepEqual(buildToggleGridCommand(project), {
    command: "set_grid_settings",
    grid: {
      snap_enabled: false,
      division: "Beat",
      swing_permille: 0,
      magnet_range_permille: 250,
      snap_strength_permille: 1_000,
    },
  });
});

test("bpm intent handles follow-tempo and preserve-seconds modes without dialog literals", () => {
  const project = createProjectSettingsIntentProject();

  assert.equal(buildSetBpmCommand(project, 120_000_000), null);
  assert.deepEqual(buildSetBpmCommand(project, 132_500_000), {
    command: "set_bpm",
    micro_bpm: 132_500_000,
  });
  assert.deepEqual(
    buildSetBpmCommand(project, 132_500_000, { preserveSeconds: true }),
    {
      command: "set_bpm_preserve_seconds",
      micro_bpm: 132_500_000,
    },
  );
});

test("time signature intent rejects no-op updates and normalizes values", () => {
  const project = createProjectSettingsIntentProject();

  assert.equal(
    buildSetTimeSignatureCommand(project, { num: 4, den: 4 }),
    null,
  );
  assert.deepEqual(
    buildSetTimeSignatureCommand(project, { num: 3.2, den: 7.7 }),
    {
      command: "set_time_signature",
      time_sig: { num: 3, den: 8 },
    },
  );
});
