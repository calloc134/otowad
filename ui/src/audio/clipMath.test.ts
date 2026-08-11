import assert from "node:assert/strict";
import test from "node:test";
import { getBoundedClipRenderWindow } from "./clipMath.ts";
import { tickToSeconds } from "./playbackMath.ts";

const MICRO_BPM = 120_000_000;
const PPQ = 480;

test("bounded render window skips clips that do not overlap the selection", () => {
  assert.equal(
    getBoundedClipRenderWindow({
      clipStartTick: 0,
      clipLengthTicks: 120,
      selectionStartTick: 240,
      selectionEndTick: 480,
      microBpm: MICRO_BPM,
      ppq: PPQ,
    }),
    null,
  );
});

test("bounded render window preserves fully contained clips", () => {
  assert.deepEqual(
    getBoundedClipRenderWindow({
      clipStartTick: 240,
      clipLengthTicks: 120,
      selectionStartTick: 120,
      selectionEndTick: 480,
      microBpm: MICRO_BPM,
      ppq: PPQ,
    }),
    {
      overlapStartTick: 240,
      overlapEndTick: 360,
      renderStartSec: tickToSeconds(120, MICRO_BPM, PPQ),
      bufferOffsetSec: 0,
      durationSec: tickToSeconds(120, MICRO_BPM, PPQ),
    },
  );
});

test("bounded render window trims partially overlapping clips", () => {
  assert.deepEqual(
    getBoundedClipRenderWindow({
      clipStartTick: 0,
      clipLengthTicks: 480,
      selectionStartTick: 120,
      selectionEndTick: 360,
      microBpm: MICRO_BPM,
      ppq: PPQ,
    }),
    {
      overlapStartTick: 120,
      overlapEndTick: 360,
      renderStartSec: 0,
      bufferOffsetSec: tickToSeconds(120, MICRO_BPM, PPQ),
      durationSec: tickToSeconds(240, MICRO_BPM, PPQ),
    },
  );
});
