import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImportedAudioCommands,
  buildImportedMidiGroupCommands,
} from "./importFactories.ts";

function build(reuseMediaAsset: boolean) {
  return buildImportedAudioCommands({
    mediaId: "media-existing",
    contentId: "content-new",
    clipId: "clip-new",
    fileName: "voice.wav",
    trackId: "track-audio",
    startTick: 0,
    audioBuffer: {
      numberOfChannels: 1,
      sampleRate: 48_000,
      length: 48_000,
    } as AudioBuffer,
    analysisRefs: [],
    contentHash: "sha256-pcm24-v1:abc",
    reuseMediaAsset,
    microBpm: 120_000_000,
    ppq: 960,
  }, (mediaId) => `media/${mediaId}.wav`);
}

test("duplicate audio import reuses the content-addressed media asset", () => {
  assert.deepEqual(
    build(true).map((command) => command.command),
    ["add_content", "add_clip"],
  );
  const fresh = build(false);
  assert.deepEqual(
    fresh.map((command) => command.command),
    ["add_media_asset", "add_content", "add_clip"],
  );
  const addMedia = fresh[0];
  assert.equal(addMedia?.command, "add_media_asset");
  if (addMedia?.command === "add_media_asset") {
    assert.equal(addMedia.asset.hash, "sha256-pcm24-v1:abc");
  }
});

test("MIDI import assigns a stable unique ID to every persisted note", () => {
  const ids = ["content-1", "clip-1", "note-1", "note-2"];
  const commands = buildImportedMidiGroupCommands(
    {
      sourceTrackIndex: 0,
      midiChannel: 0,
      trackName: "Lead",
      sourcePpq: 960,
      notes: [
        { start: 0, length: 120, key: 60, vel: 100 },
        { start: 240, length: 120, key: 64, vel: 100 },
      ],
      ccs: [],
    },
    "track-1",
    0,
    () => ids.shift() ?? "unexpected-id",
  );

  const addContent = commands[0];
  assert.equal(addContent?.command, "add_content");
  if (addContent?.command === "add_content" && addContent.content.type === "midi") {
    assert.deepEqual(addContent.content.notes.map((note) => note.id), [
      "note-1",
      "note-2",
    ]);
  }
});
