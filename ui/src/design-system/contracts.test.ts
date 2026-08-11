import assert from "node:assert/strict";
import test from "node:test";

import {
  buttonVariants,
  controlSizes,
  dialogCloseActionSizes,
  metricChipTones,
  panelVariants,
  statusPillTones,
} from "./contracts.ts";

test("design-system primitive variant API stays stable", () => {
  assert.deepEqual(buttonVariants, [
    "primary",
    "secondary",
    "ghost",
    "danger",
    "transport",
  ]);
  assert.deepEqual(controlSizes, ["compact", "sm", "md", "touch"]);
  assert.deepEqual(panelVariants, ["raised", "inset", "muted", "accent"]);
  assert.deepEqual(dialogCloseActionSizes, ["compact", "touch"]);
  assert.deepEqual(metricChipTones, ["neutral", "info", "success", "warning"]);
  assert.deepEqual(statusPillTones, [
    "neutral",
    "info",
    "success",
    "warning",
    "danger",
  ]);
});
