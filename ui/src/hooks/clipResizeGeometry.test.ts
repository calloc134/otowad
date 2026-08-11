import assert from "node:assert/strict";
import test from "node:test";

import { snapTickToGrid } from "../grid.ts";
import {
  planAudioRedTrim,
  resolveResizePreviewState,
  roundHalfEven,
  type ResizeEdge,
  type ResizeSession,
} from "./clipResizeGeometry.ts";

function createResizeSession(
  edge: ResizeEdge,
  overrides: Partial<ResizeSession> = {},
): ResizeSession {
  return {
    pointerId: 1,
    edge,
    startMouseX: 50,
    origStart: 100,
    origLength: 100,
    origSrcIn: 1_000,
    origSrcOut: 2_000,
    origContentIn: 300,
    origContentOut: 400,
    pixelsPerTick: 2,
    maxSourceFrame: 4_000,
    isAudio: true,
    isSnapEnabled: true,
    magnetRangeTicks: 10,
    otherClipStarts: [],
    otherClipEnds: [],
    ...overrides,
  };
}

const snapToFifty = (tick: number) => snapTickToGrid(tick, 50, 10, true);

test("resize geometry carries pixel delta through grid snapping into audio source range", () => {
  const cases = [
    {
      edge: "end-red" as const,
      expected: {
        start: 100,
        length: 150,
        sourceIn: 1_000,
        sourceOut: 2_500,
        contentIn: null,
        contentOut: null,
      },
    },
    {
      edge: "start-red" as const,
      expected: {
        start: 150,
        length: 50,
        sourceIn: 1_500,
        sourceOut: 2_000,
        contentIn: null,
        contentOut: null,
      },
    },
    {
      edge: "end-blue" as const,
      expected: {
        start: 100,
        length: 150,
        sourceIn: 1_000,
        sourceOut: 2_000,
        contentIn: null,
        contentOut: null,
      },
    },
    {
      edge: "start-blue" as const,
      expected: {
        start: 150,
        length: 50,
        sourceIn: 1_000,
        sourceOut: 2_000,
        contentIn: null,
        contentOut: null,
      },
    },
  ];

  for (const { edge, expected } of cases) {
    // 80 px / 2 px-per-tick = +40 ticks. Both moving edges land at tick 140/240,
    // inside the 10-tick grid magnet range, and therefore snap to 150/250.
    assert.deepEqual(resolveResizePreviewState(createResizeSession(edge), 130, snapToFifty), expected);
  }
});

test("MIDI red trim changes the content window while keeping it equal to clip length", () => {
  const endPreview = resolveResizePreviewState(
    createResizeSession("end-red", { isAudio: false }),
    130,
    snapToFifty,
  );
  assert.deepEqual(endPreview, {
    start: 100,
    length: 150,
    sourceIn: null,
    sourceOut: null,
    contentIn: 300,
    contentOut: 450,
  });

  const startPreview = resolveResizePreviewState(
    createResizeSession("start-red", { isAudio: false }),
    130,
    snapToFifty,
  );
  assert.deepEqual(startPreview, {
    start: 150,
    length: 50,
    sourceIn: null,
    sourceOut: null,
    contentIn: 350,
    contentOut: 400,
  });

  for (const preview of [endPreview, startPreview]) {
    assert.equal(preview.contentOut! - preview.contentIn!, preview.length);
  }
});

test("item-edge snapping wins only when it is closer than the grid candidate", () => {
  const session = createResizeSession("end-red", {
    otherClipStarts: [245],
  });

  // Raw edge 240: item edge 245 is closer than grid line 250.
  assert.deepEqual(resolveResizePreviewState(session, 130, snapToFifty), {
    start: 100,
    length: 145,
    sourceIn: 1_000,
    sourceOut: 2_450,
    contentIn: null,
    contentOut: null,
  });

  // A tie keeps the grid candidate, making candidate ordering deterministic.
  assert.equal(
    resolveResizePreviewState(
      createResizeSession("end-red", { otherClipStarts: [230] }),
      130,
      snapToFifty,
    ).length,
    150,
  );
});

test("audio red trim preserves fixed endpoints, half-even scaling, and source bounds", () => {
  const session = createResizeSession("end-red");
  for (let requestedLength = 1; requestedLength <= 200; requestedLength += 1) {
    const endPlan = planAudioRedTrim(session, "end", requestedLength);
    assert.equal(endPlan.newStart, session.origStart);
    assert.equal(endPlan.newSrcIn, session.origSrcIn);
    assert.equal(endPlan.newSrcOut - endPlan.newSrcIn, requestedLength * 10);

    const startPlan = planAudioRedTrim(session, "start", requestedLength);
    assert.equal(startPlan.newStart + startPlan.newLength, session.origStart + session.origLength);
    assert.equal(startPlan.newSrcOut, session.origSrcOut);
    assert.equal(startPlan.newSrcOut - startPlan.newSrcIn, requestedLength * 10);
  }

  assert.deepEqual(
    planAudioRedTrim(
      createResizeSession("end-red", { maxSourceFrame: 2_200 }),
      "end",
      150,
    ),
    {
      newStart: 100,
      newLength: 120,
      newSrcIn: 1_000,
      newSrcOut: 2_200,
    },
  );
});

test("half-even rounding is deterministic at positive and negative ties", () => {
  const cases = [
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [-0.5, -0],
    [-1.5, -2],
    [-2.5, -2],
    [-3.5, -4],
  ] as const;

  for (const [value, expected] of cases) {
    assert.equal(roundHalfEven(value), expected);
  }
});
