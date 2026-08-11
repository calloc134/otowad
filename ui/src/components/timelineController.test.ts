import assert from "node:assert/strict";
import test from "node:test";

import { createTimelineController } from "./timelineController.ts";
import { createBaseTimelineProject } from "../test/projectTestUtils.ts";

test("timeline controller creates empty MIDI clips through intent-built defaults", () => {
  const project = createBaseTimelineProject();
  const commands: unknown[] = [];
  const selections: unknown[] = [];
  const trackSelections: string[] = [];
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
  if (!midiTrack) {
    throw new Error("expected midi track");
  }

  const controller = createTimelineController({
    document: project,
    tracks: project.edit.tracks,
    clips: project.edit.clips,
    state: { selectedClipIds: [], primaryClipId: null, selectedClipKind: null },
    actions: {
      applyCommand(command) {
        commands.push(command);
      },
      selectTrack(trackId) {
        if (trackId) trackSelections.push(trackId);
      },
      setClipSelection(clipIds, primaryClipId) {
        selections.push({ clipIds, primaryClipId });
      },
      setPlayhead() {},
    },
    snapTick: (tick) => tick,
    ticksPerBar: 960,
    pitchLinkedAudioTrackIds: new Set(),
  });

  controller.createEmptyMidiClip(midiTrack.id, 1920);

  assert.equal(commands.length, 1);
  assert.equal(trackSelections[0], midiTrack.id);
  assert.equal(selections.length, 1);
});

test("timeline controller routes pitch adjustments through the shared command builder", () => {
  const project = createBaseTimelineProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
  if (!audioClip) {
    throw new Error("expected audio clip");
  }

  const commands: unknown[] = [];
  const controller = createTimelineController({
    document: project,
    tracks: project.edit.tracks,
    clips: project.edit.clips,
    state: {
      selectedClipIds: [audioClip.id],
      primaryClipId: audioClip.id,
      selectedClipKind: "audio",
    },
    actions: {
      applyCommand(command) {
        commands.push(command);
      },
      selectTrack() {},
      setClipSelection() {},
      setPlayhead() {},
    },
    snapTick: (tick) => tick,
    ticksPerBar: 960,
    pitchLinkedAudioTrackIds: new Set(),
  });

  controller.handlePitchChange(audioClip.id, 1);
  assert.equal(commands.length, 1);
});
