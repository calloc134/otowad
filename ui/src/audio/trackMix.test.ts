import assert from "node:assert/strict";
import test from "node:test";

import {
  getStereoPannerCoefficients,
  gainMilliDbToLinear,
  panPermilleToUnit,
} from "./trackMix.ts";

test("gainMilliDbToLinear converts milli-dB values into linear gain", () => {
  assert.equal(gainMilliDbToLinear(0), 1);
  assert.equal(Number(gainMilliDbToLinear(-6000).toFixed(4)), 0.5012);
});

test("pan helpers clamp to the supported stereo range", () => {
  assert.equal(panPermilleToUnit(-1500), -1);
  assert.equal(panPermilleToUnit(0), 0);
  assert.equal(panPermilleToUnit(1500), 1);
});

test("StereoPanner coefficients preserve stereo center and cross-mix at the edges", () => {
  const roundCoefficients = (pan: number) => Object.fromEntries(
    Object.entries(getStereoPannerCoefficients(pan, 2)).map(([key, value]) => [
      key,
      Number(value.toFixed(4)),
    ]),
  );

  assert.deepEqual(
    roundCoefficients(0),
    { leftFromLeft: 1, leftFromRight: 0, rightFromLeft: 0, rightFromRight: 1 },
  );
  assert.deepEqual(
    roundCoefficients(-1),
    { leftFromLeft: 1, leftFromRight: 1, rightFromLeft: 0, rightFromRight: 0 },
  );
  assert.deepEqual(
    roundCoefficients(1),
    { leftFromLeft: 0, leftFromRight: 0, rightFromLeft: 1, rightFromRight: 1 },
  );
});

test("StereoPanner coefficients use equal-power gains for mono input", () => {
  const center = getStereoPannerCoefficients(0, 1);
  assert.equal(Number(center.leftFromLeft.toFixed(4)), 0.7071);
  assert.equal(Number(center.rightFromLeft.toFixed(4)), 0.7071);
  assert.equal(center.leftFromRight, 0);
  assert.equal(center.rightFromRight, 0);
  assert.deepEqual(
    getStereoPannerCoefficients(-2, 1),
    { leftFromLeft: 1, leftFromRight: 0, rightFromLeft: 0, rightFromRight: 0 },
  );
});
