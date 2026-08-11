import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createBaseTimelineProject } from "../test/projectTestUtils.ts";

import { initialProjectState, projectReducer } from "./projectReducer.ts";
import type { ProjectState } from "./projectStoreTypes.ts";

function createState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...initialProjectState,
    ...overrides,
  };
}

test("project reducer preserves viewport while resetting document-bound selection state", () => {
  const project = createBaseTimelineProject();
  const nextState = projectReducer(
    createState({
      wasmReady: true,
      playheadTick: 480,
      zoom: { x: 0.25, y: 96 },
      scrollX: 120,
      scrollY: 40,
      selectedTrackId: "track-a",
      selectedClipIds: ["clip-a"],
      primaryClipId: "clip-a",
      selectedClipKind: "audio",
      timeSelectionStartTick: 10,
      timeSelectionEndTick: 90,
      loopEnabled: true,
      error: "old-error",
    }),
    { type: "SET_PROJECT", document: project, revision: 7 },
  );

  assert.equal(nextState.wasmReady, true);
  assert.equal(nextState.projectRevision, 7);
  assert.equal(nextState.playheadTick, 480);
  assert.deepEqual(nextState.zoom, { x: 0.25, y: 96 });
  assert.equal(nextState.scrollX, 120);
  assert.equal(nextState.scrollY, 40);
  assert.equal(nextState.selectedTrackId, null);
  assert.deepEqual(nextState.selectedClipIds, []);
  assert.equal(nextState.primaryClipId, null);
  assert.equal(nextState.selectedClipKind, null);
  assert.equal(nextState.timeSelectionStartTick, null);
  assert.equal(nextState.timeSelectionEndTick, null);
  assert.equal(nextState.loopEnabled, false);
  assert.equal(nextState.error, null);
});

test("project reducer reconciles clip selection against the applied document", () => {
  const project = createBaseTimelineProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!audioClip) {
    throw new Error("expected audio clip");
  }

  const nextProject = applyCommand(project, {
    command: "remove_clip",
    clip_id: audioClip.id,
  });

  const nextState = projectReducer(
    createState({
      document: project,
      projectRevision: 3,
      selectedTrackId: audioClip.track_id,
      selectedClipIds: [audioClip.id],
      primaryClipId: audioClip.id,
      selectedClipKind: "audio",
    }),
    {
      type: "COMMAND_APPLIED",
      document: nextProject,
      inverse: '{"command":"noop"}',
    },
  );

  assert.equal(nextState.document, nextProject);
  assert.equal(nextState.projectRevision, 4);
  assert.equal(nextState.selectedTrackId, audioClip.track_id);
  assert.deepEqual(nextState.selectedClipIds, []);
  assert.equal(nextState.primaryClipId, null);
  assert.equal(nextState.selectedClipKind, null);
  assert.deepEqual(nextState.undoStack, ['{"command":"noop"}']);
  assert.equal(nextState.hasUnsavedChanges, true);
});

test("project reducer keeps loop enablement aligned with time selection state", () => {
  const selectedState = projectReducer(initialProjectState, {
    type: "SET_TIME_SELECTION",
    startTick: 96,
    endTick: 24,
  });

  assert.equal(selectedState.timeSelectionStartTick, 24);
  assert.equal(selectedState.timeSelectionEndTick, 96);
  assert.equal(selectedState.loopEnabled, false);

  const loopEnabledState = projectReducer(selectedState, {
    type: "SET_LOOP_ENABLED",
    enabled: true,
  });
  assert.equal(loopEnabledState.loopEnabled, true);

  const clearedState = projectReducer(loopEnabledState, {
    type: "SET_TIME_SELECTION",
    startTick: null,
    endTick: null,
  });
  assert.equal(clearedState.timeSelectionStartTick, null);
  assert.equal(clearedState.timeSelectionEndTick, null);
  assert.equal(clearedState.loopEnabled, false);
});

