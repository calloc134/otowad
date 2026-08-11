import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_AFFORDANCE_PRINCIPLES } from "./mobileAffordancePrinciples.ts";

test("mobile affordance principles stay aligned with the documented policy set", () => {
  assert.deepEqual(
    MOBILE_AFFORDANCE_PRINCIPLES.map((principle) => principle.id),
    [
      "destructive-via-confirm-rail",
      "explicit-non-hover-actions",
      "no-modifier-dependency",
      "prefer-tool-and-action-rails",
    ],
  );
});
