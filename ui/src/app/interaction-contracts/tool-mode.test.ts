import assert from "node:assert/strict";
import test from "node:test";

import { createImplicitToolModeState, IDLE_TRANSIENT_SESSION } from "./tool-mode.ts";

test("createImplicitToolModeState preserves explicit-mode capability and current mode", () => {
  const desktop = createImplicitToolModeState(false);
  const mobileWarp = createImplicitToolModeState(true, "warp");

  assert.deepEqual(desktop, {
    current: "implicit",
    allowsExplicitMode: false,
  });
  assert.deepEqual(mobileWarp, {
    current: "warp",
    allowsExplicitMode: true,
  });
});

test("idle transient session stays stable for contract defaults", () => {
  assert.deepEqual(IDLE_TRANSIENT_SESSION, {
    kind: "idle",
    phase: "idle",
  });
});
