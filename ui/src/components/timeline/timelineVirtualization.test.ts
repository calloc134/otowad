import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTimelineVisibleWindow,
  selectVisibleTimelineClips,
  selectVisibleTimelineStepIndices,
  selectVisibleTimelineTrackIndices,
  type TimelineVirtualClip,
} from "./timelineVirtualization.ts";

function buildClipFixture(count: number): TimelineVirtualClip[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`,
    track_id: `track-${index % 12}`,
    start: Math.floor(index / 12) * 240,
    length: 60 + (index % 5) * 60,
  }));
}

function referenceVisibleClipIds(args: {
  clips: readonly TimelineVirtualClip[];
  trackIndexById: ReadonlyMap<string, number>;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  pixelsPerTick: number;
  trackHeight: number;
  horizontalOverscanPx: number;
  verticalOverscanTracks: number;
}): string[] {
  const left = Math.max(0, args.scrollX - args.horizontalOverscanPx);
  const right = args.scrollX + args.viewportWidth + args.horizontalOverscanPx;
  const top = Math.max(0, args.scrollY - args.verticalOverscanTracks * args.trackHeight);
  const bottom = args.scrollY +
    args.viewportHeight +
    args.verticalOverscanTracks * args.trackHeight;

  return args.clips.flatMap((clip) => {
    const trackIndex = args.trackIndexById.get(clip.track_id);
    if (trackIndex === undefined) {
      return [];
    }
    const clipLeft = clip.start * args.pixelsPerTick;
    const clipRight = (clip.start + clip.length) * args.pixelsPerTick;
    const clipTop = trackIndex * args.trackHeight;
    const clipBottom = clipTop + args.trackHeight;
    return clipLeft < right && clipRight > left && clipTop < bottom && clipBottom > top
      ? [clip.id]
      : [];
  });
}

test("3,000-clip visibility matches a naive pixel-rectangle reference", () => {
  const clips = buildClipFixture(3_000);
  const trackIndexById = new Map(
    Array.from({ length: 12 }, (_, index) => [`track-${index}`, index]),
  );
  const viewportWidth = 1_280;
  const viewportHeight = 720;
  const pixelsPerTick = 0.125;
  const trackHeight = 80;
  const horizontalOverscanPx = 320;
  const verticalOverscanTracks = 1;

  for (let sample = 0; sample < 50; sample += 1) {
    const scrollX = sample * 173;
    const scrollY = (sample * 47) % 500;
    const visibleWindow = resolveTimelineVisibleWindow({
      scrollX,
      scrollY,
      viewportWidth,
      viewportHeight,
      pixelsPerTick,
      trackHeight,
      trackCount: 12,
      horizontalOverscanPx,
      verticalOverscanTracks,
    });
    const actual = selectVisibleTimelineClips({
      clips,
      trackIndexById,
      visibleWindow,
    }).map((clip) => clip.id);
    const expected = referenceVisibleClipIds({
      clips,
      trackIndexById,
      scrollX,
      scrollY,
      viewportWidth,
      viewportHeight,
      pixelsPerTick,
      trackHeight,
      horizontalOverscanPx,
      verticalOverscanTracks,
    });
    assert.deepEqual(actual, expected, `visibility mismatch at sample ${sample}`);
  }
});

test("visibility uses half-open clip bounds and preserves source ordering", () => {
  const clips = [
    { id: "left-touch", track_id: "track-0", start: 0, length: 100 },
    { id: "visible-b", track_id: "track-0", start: 150, length: 50 },
    { id: "visible-a", track_id: "track-0", start: 100, length: 50 },
    { id: "right-touch", track_id: "track-0", start: 200, length: 50 },
  ];
  const visibleWindow = {
    startTick: 100,
    endTick: 200,
    startTrackIndex: 0,
    endTrackIndex: 1,
  };

  assert.deepEqual(
    selectVisibleTimelineClips({
      clips,
      trackIndexById: new Map([["track-0", 0]]),
      visibleWindow,
    }).map((clip) => clip.id),
    ["visible-b", "visible-a"],
  );
});

test("active gestures remain mounted outside the visible window", () => {
  const clips = buildClipFixture(30);
  assert.deepEqual(
    selectVisibleTimelineClips({
      clips,
      trackIndexById: new Map(
        Array.from({ length: 12 }, (_, index) => [`track-${index}`, index]),
      ),
      visibleWindow: {
        startTick: 0,
        endTick: 100,
        startTrackIndex: 0,
        endTrackIndex: 1,
      },
      alwaysIncludeClipIds: new Set(["clip-29"]),
    }).map((clip) => clip.id),
    ["clip-0", "clip-29"],
  );
});

test("unmeasured viewports render all valid tracks and track ranges are overscanned", () => {
  assert.equal(
    resolveTimelineVisibleWindow({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 0,
      viewportHeight: 720,
      pixelsPerTick: 1,
      trackHeight: 80,
      trackCount: 12,
    }),
    null,
  );

  const clips = [
    { id: "valid", track_id: "track-0", start: 0, length: 1 },
    { id: "orphan", track_id: "missing", start: 0, length: 1 },
  ];
  assert.deepEqual(
    selectVisibleTimelineClips({
      clips,
      trackIndexById: new Map([["track-0", 0]]),
      visibleWindow: null,
    }).map((clip) => clip.id),
    ["valid"],
  );

  assert.deepEqual(
    selectVisibleTimelineTrackIndices(12, {
      startTick: 0,
      endTick: 1,
      startTrackIndex: 3,
      endTrackIndex: 7,
    }),
    [3, 4, 5, 6],
  );
  assert.deepEqual(
    selectVisibleTimelineStepIndices(100, 10, {
      startTick: 24,
      endTick: 51,
      startTrackIndex: 0,
      endTrackIndex: 1,
    }),
    [2, 3, 4, 5],
  );
});
