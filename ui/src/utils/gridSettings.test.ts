import assert from "node:assert/strict";
import test from "node:test";
import { buildGridSettings, snapTickToGrid } from "../grid.ts";

test("buildGridSettings preserves the current magnet range when omitted from a patch", () => {
  assert.deepEqual(
    buildGridSettings(
      {
        snap_enabled: true,
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 400,
        snap_strength_permille: 1000,
      },
      {
        snap_enabled: false,
      },
    ),
    {
      snap_enabled: false,
      division: "Beat",
      swing_permille: 0,
      magnet_range_permille: 400,
      snap_strength_permille: 1000,
    },
  );
});

test("snapTickToGrid supports stronger UI-local magnetic thresholds", () => {
  assert.equal(snapTickToGrid(87, 100, 12, true), 87);
  assert.equal(snapTickToGrid(87, 100, 13, true), 100);
  assert.equal(snapTickToGrid(87, 100, 13, false), 87);
});
