import assert from "node:assert/strict";
import test from "node:test";

import type { ClipWarpPlan } from "../pitchPlan.ts";
import { buildSourceNativeSynthesisPlan } from "./synthesisPlan.ts";

const SAMPLE_RATE = 48_000;
const SOURCE_MARKS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function linearWarp(sourceLength: number, outputLength: number): ClipWarpPlan {
  return {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: outputLength,
      sourceStartSample: 0,
      sourceEndSample: sourceLength,
    }],
  };
}

function centersOf(plan: ReturnType<typeof buildSourceNativeSynthesisPlan>): number[] {
  return plan.marks.map((mark) => mark.outputCenterSample);
}

function indicesOf(plan: ReturnType<typeof buildSourceNativeSynthesisPlan>): number[] {
  return plan.marks.map((mark) => mark.sourceMarkIndex);
}

function assertClose(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("identity plan preserves source mark centers and periods", () => {
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 1_000),
    outputStartSample: 0,
    outputEndSample: 1_000,
    sampleRate: SAMPLE_RATE,
  });

  assert.deepEqual(centersOf(plan), [...SOURCE_MARKS]);
  assert.deepEqual(indicesOf(plan), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plan.diagnostics.repeatedSourceMarkCount, 0);
  assert.equal(plan.diagnostics.skippedSourceMarkCount, 0);
  assert.equal(plan.diagnostics.sourceSpanCoverageRatio, 1);
  assert.equal(plan.diagnostics.medianSourcePeriodSamples, 100);
  assert.equal(plan.diagnostics.medianTargetOutputPeriodSamples, 100);
  assert.equal(plan.diagnostics.medianPlannedOutputPeriodSamples, 100);
  assert.equal(plan.diagnostics.medianSourceF0Hz, 480);
  assert.equal(plan.diagnostics.medianTargetF0Hz, 480);
  assert.equal(plan.diagnostics.medianPlannedF0Hz, 480);
});

test("pitch up repeats source marks while pitch down skips them", () => {
  const pitchUp = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 1_000),
    outputStartSample: 0,
    outputEndSample: 1_000,
    defaultShiftCents: 1_200,
    sampleRate: SAMPLE_RATE,
  });
  const pitchDown = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 1_000),
    outputStartSample: 0,
    outputEndSample: 1_000,
    defaultShiftCents: -1_200,
    sampleRate: SAMPLE_RATE,
  });

  assert.deepEqual(centersOf(pitchUp), [
    100, 150, 200, 250, 300, 350, 400, 450, 500,
    550, 600, 650, 700, 750, 800, 850, 900, 950,
  ]);
  assert.deepEqual(indicesOf(pitchUp), [
    0, 0, 1, 1, 2, 2, 3, 3, 4,
    4, 5, 5, 6, 6, 7, 7, 8, 8,
  ]);
  assert.equal(pitchUp.diagnostics.repeatedSourceMarkCount, 9);
  assert.equal(pitchUp.diagnostics.skippedSourceMarkCount, 0);
  assert.equal(pitchUp.diagnostics.medianTargetF0Hz, 960);

  assert.deepEqual(centersOf(pitchDown), [100, 300, 500, 700, 900]);
  assert.deepEqual(indicesOf(pitchDown), [0, 2, 4, 6, 8]);
  assert.equal(pitchDown.diagnostics.repeatedSourceMarkCount, 0);
  assert.equal(pitchDown.diagnostics.skippedSourceMarkCount, 4);
  assert.equal(pitchDown.diagnostics.medianTargetF0Hz, 240);
});

test("stretch repeats and compression skips source marks without changing output F0", () => {
  const stretched = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 2_000),
    outputStartSample: 0,
    outputEndSample: 2_000,
    sampleRate: SAMPLE_RATE,
  });
  const compressed = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 500),
    outputStartSample: 0,
    outputEndSample: 500,
    sampleRate: SAMPLE_RATE,
  });

  assert.deepEqual(indicesOf(stretched), [
    0, 0, 1, 1, 2, 2, 3, 3, 4,
    4, 5, 5, 6, 6, 7, 7, 8, 8,
  ]);
  assert.equal(stretched.marks[0]?.outputCenterSample, 200);
  assert.equal(stretched.diagnostics.repeatedSourceMarkCount, 9);
  assert.equal(stretched.diagnostics.medianTargetF0Hz, 480);
  assert.equal(stretched.diagnostics.medianPlannedF0Hz, 480);

  assert.deepEqual(indicesOf(compressed), [0, 2, 4, 6, 8]);
  assert.deepEqual(centersOf(compressed), [50, 150, 250, 350, 450]);
  assert.equal(compressed.diagnostics.skippedSourceMarkCount, 4);
  assert.equal(compressed.diagnostics.medianTargetF0Hz, 480);
  assert.equal(compressed.diagnostics.medianPlannedF0Hz, 480);
});

test("piecewise warp changes source selection but never grain-internal pitch", () => {
  const warpPlan: ClipWarpPlan = {
    kind: "piecewise",
    segments: [
      {
        outputStartSample: 0,
        outputEndSample: 400,
        sourceStartSample: 0,
        sourceEndSample: 200,
      },
      {
        outputStartSample: 400,
        outputEndSample: 800,
        sourceStartSample: 200,
        sourceEndSample: 1_000,
      },
    ],
  };
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: SOURCE_MARKS,
    warpPlan,
    outputStartSample: 0,
    outputEndSample: 800,
    sampleRate: SAMPLE_RATE,
  });

  assert.deepEqual(centersOf(plan), [200, 300, 400, 500, 600, 700]);
  assert.deepEqual(indicesOf(plan), [0, 0, 1, 3, 5, 7]);
  assert.equal(plan.diagnostics.repeatedSourceMarkCount, 1);
  assert.equal(plan.diagnostics.skippedSourceMarkCount, 3);
  assert.ok(plan.marks.every((mark) => mark.localSourcePeriodSamples === 100));
  assert.ok(plan.marks.every((mark) => mark.targetOutputPeriodSamples === 100));
});

test("pitch segments change only synthesis spacing at their half-open boundary", () => {
  const plan = buildSourceNativeSynthesisPlan({
    sourceMarks: [100, 200, 300, 400, 500, 600],
    warpPlan: linearWarp(700, 700),
    outputStartSample: 0,
    outputEndSample: 700,
    pitchSegments: [
      { startSample: 0, endSample: 300, shiftCents: 0 },
      { startSample: 300, endSample: 700, shiftCents: 1_200 },
    ],
    sampleRate: SAMPLE_RATE,
  });

  assert.deepEqual(centersOf(plan), [100, 200, 300, 350, 400, 450, 500, 550, 600, 650]);
  assert.deepEqual(
    plan.marks.map((mark) => mark.shiftCents),
    [0, 0, 1_200, 1_200, 1_200, 1_200, 1_200, 1_200, 1_200, 1_200],
  );
  assert.deepEqual(
    plan.marks.map((mark) => mark.targetOutputPeriodSamples),
    [100, 100, 50, 50, 50, 50, 50, 50, 50, 50],
  );
});

test("fractional synthesis centers are deterministic", () => {
  const args = {
    sourceMarks: SOURCE_MARKS,
    warpPlan: linearWarp(1_000, 1_000),
    outputStartSample: 0,
    outputEndSample: 1_000,
    defaultShiftCents: 700,
    sampleRate: SAMPLE_RATE,
  } as const;

  const first = buildSourceNativeSynthesisPlan(args);
  const second = buildSourceNativeSynthesisPlan(args);

  assert.deepEqual(first, second);
  assert.ok(first.marks.slice(1).some((mark) => !Number.isInteger(mark.outputCenterSample)));
  assertClose(
    first.marks[1]!.outputCenterSample - first.marks[0]!.outputCenterSample,
    100 / (2 ** (700 / 1_200)),
  );
});

test("invalid analysis and ambiguous segment inputs are rejected", () => {
  const base = {
    warpPlan: linearWarp(1_000, 1_000),
    outputStartSample: 0,
    outputEndSample: 1_000,
    sampleRate: SAMPLE_RATE,
  } as const;

  assert.throws(
    () => buildSourceNativeSynthesisPlan({ ...base, sourceMarks: [100] }),
    /at least two/,
  );
  assert.throws(
    () => buildSourceNativeSynthesisPlan({ ...base, sourceMarks: [100, 100, 200] }),
    /strictly increasing/,
  );
  assert.throws(
    () => buildSourceNativeSynthesisPlan({
      ...base,
      sourceMarks: SOURCE_MARKS,
      pitchSegments: [
        { startSample: 0, endSample: 400, shiftCents: 0 },
        { startSample: 300, endSample: 500, shiftCents: 100 },
      ],
    }),
    /sorted and non-overlapping/,
  );
  assert.throws(
    () => buildSourceNativeSynthesisPlan({
      ...base,
      sourceMarks: SOURCE_MARKS,
      initialOutputCenterSample: 1_000,
    }),
    /inside the output range/,
  );
  assert.throws(
    () => buildSourceNativeSynthesisPlan({
      ...base,
      sourceMarks: SOURCE_MARKS,
      defaultShiftCents: 1_200,
      maxSynthesisMarkCount: 2,
    }),
    /exceeded/,
  );
});
