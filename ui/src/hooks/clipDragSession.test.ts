import assert from "node:assert/strict";
import test from "node:test";

import { snapTickToGrid } from "../grid.ts";
import type { ProjectDocument } from "../types/index.ts";
import {
  buildClipDragSession,
  buildClipPreviewStarts,
  hasDragCrossedThreshold,
  resolveClipDragDelta,
  resolveClipTrackPreview,
  type ClipDragContext,
  type DragSession,
} from "./clipDragSession.ts";

function createDocument(): ProjectDocument {
  return {
    edit: {
      tracks: [
        { id: "audio-1", kind: { track_type: "audio" } },
        { id: "audio-2", kind: { track_type: "audio" } },
        { id: "midi-1", kind: { track_type: "midi" } },
      ],
      clips: [
        {
          id: "clip-a",
          track_id: "audio-1",
          start: 100,
          length: 20,
          kind: { clip_type: "audio" },
        },
        {
          id: "clip-b",
          track_id: "audio-1",
          start: 200,
          length: 40,
          kind: { clip_type: "audio" },
        },
        {
          id: "clip-midi",
          track_id: "midi-1",
          start: 300,
          length: 30,
          kind: { clip_type: "midi" },
        },
        {
          id: "snap-target",
          track_id: "audio-2",
          start: 135,
          length: 20,
          kind: { clip_type: "audio" },
        },
      ],
    },
  } as ProjectDocument;
}

function createContext(
  selectedClipIds = ["clip-a"],
  primaryClipId: string | null = "clip-a",
): ClipDragContext {
  return {
    document: createDocument(),
    selectedClipIds,
    primaryClipId,
    pixelsPerTick: 2,
  };
}

function createSession(
  selectedClipIds = ["clip-a"],
  primaryClipId: string | null = "clip-a",
): DragSession {
  const session = buildClipDragSession({
    clipId: "clip-a",
    trackHeight: 80,
    context: createContext(selectedClipIds, primaryClipId),
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    isSnapEnabled: true,
    magnetRangeTicks: 10,
  });
  assert.ok(session);
  return session;
}

test("drag session snapshots the selected clips and excludes them from snap candidates", () => {
  const session = createSession(["clip-a", "clip-b"], "clip-b");

  assert.deepEqual(session.draggedClipIds, ["clip-a", "clip-b"]);
  assert.deepEqual(session.originalStarts, { "clip-a": 100, "clip-b": 200 });
  assert.deepEqual(session.originalTrackIndices, { "clip-a": 0, "clip-b": 0 });
  assert.equal(session.primaryClipId, "clip-b");
  assert.equal(session.minStartTick, 100);
  assert.deepEqual(session.otherClipStarts, [300, 135]);
  assert.deepEqual(session.otherClipEnds, [330, 155]);
});

test("drag delta carries pixels through tick conversion and chooses the closest snap", () => {
  const session = createSession();

  // 100 px / 2 px-per-tick = +50 ticks. The grid proposes +60, while the
  // other clip end at tick 155 proposes +55 and therefore wins.
  assert.equal(
    resolveClipDragDelta(
      session,
      200,
      (tick) => snapTickToGrid(tick, 80, 10, true),
    ),
    55,
  );
  assert.deepEqual(buildClipPreviewStarts(session, 55), { "clip-a": 155 });

  // A group can never be moved before the earliest selected clip reaches tick zero.
  assert.equal(resolveClipDragDelta(session, -1_000, (tick) => tick), -100);
});

test("drag threshold starts at the exact configured pixel boundary", () => {
  const session = createSession();
  assert.equal(hasDragCrossedThreshold(session, 103.99, 103.99), false);
  assert.equal(hasDragCrossedThreshold(session, 104, 100), true);
  assert.equal(hasDragCrossedThreshold(session, 100, 96), true);
});

test("track preview preserves relative track offsets and rejects invalid targets", () => {
  const session = createSession();
  assert.deepEqual(resolveClipTrackPreview(session, 180, true), {
    previewTrackIds: { "clip-a": "audio-2" },
    primaryTargetTrackId: "audio-2",
  });

  // Two rows down is a MIDI track, and one row up is outside the track list.
  assert.deepEqual(resolveClipTrackPreview(session, 260, true), {
    previewTrackIds: {},
    primaryTargetTrackId: null,
  });
  assert.deepEqual(resolveClipTrackPreview(session, 20, true), {
    previewTrackIds: {},
    primaryTargetTrackId: null,
  });
  assert.deepEqual(resolveClipTrackPreview(session, 180, false), {
    previewTrackIds: {},
    primaryTargetTrackId: null,
  });
});

test("mixed-kind selection never produces a cross-track preview", () => {
  const session = createSession(["clip-a", "clip-midi"]);
  assert.equal(session.hasMixedKinds, true);
  assert.deepEqual(resolveClipTrackPreview(session, 180, true), {
    previewTrackIds: {},
    primaryTargetTrackId: null,
  });
});
