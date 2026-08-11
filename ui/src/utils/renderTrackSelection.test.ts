import assert from "node:assert/strict";
import test from "node:test";

import type { TrackEdit } from "@/types";

import { selectTracksForOfflineRender } from "./renderTrackSelection.ts";

function makeAudioTrack(id: string, options?: Partial<TrackEdit>): TrackEdit {
  return {
    id,
    name: `Track ${id}`,
    kind: { track_type: "audio" },
    mute: false,
    solo: false,
    gain_milli_db: 0,
    pan_permille: 0,
    fx_chain: [],
    routing: { output: { bus: "master" }, sends: [] },
    ...options,
  };
}

test("selectTracksForOfflineRender respects project solo state by default", () => {
  const tracks = [
    makeAudioTrack("a"),
    makeAudioTrack("b", { solo: true }),
  ];

  assert.deepEqual(
    selectTracksForOfflineRender(tracks).map((track) => track.id),
    ["b"],
  );
});

test("selectTracksForOfflineRender scopes solo evaluation to requested tracks", () => {
  const tracks = [
    makeAudioTrack("a"),
    makeAudioTrack("b", { solo: true }),
  ];

  assert.deepEqual(
    selectTracksForOfflineRender(tracks, ["a"]).map((track) => track.id),
    ["a"],
  );
});

test("selectTracksForOfflineRender still excludes muted requested tracks", () => {
  const tracks = [
    makeAudioTrack("a", { mute: true }),
    makeAudioTrack("b", { solo: true }),
  ];

  assert.deepEqual(
    selectTracksForOfflineRender(tracks, ["a"]).map((track) => track.id),
    [],
  );
});
