import assert from "node:assert/strict";
import test from "node:test";
import {
  canImportFileToTrack,
  classifyImportableFile,
  isFileDragType,
  resolveDroppedImport,
  resolveTimelineFileDrop,
} from "./fileDrop.ts";

test("classifyImportableFile recognizes MIDI files before generic audio MIME types", () => {
  assert.equal(classifyImportableFile({ name: "part.mid", type: "" }), "midi");
  assert.equal(
    classifyImportableFile({ name: "part.bin", type: "audio/midi" }),
    "midi",
  );
  assert.equal(
    classifyImportableFile({ name: "voice.wav", type: "audio/wav" }),
    "audio",
  );
  assert.equal(classifyImportableFile({ name: "notes.txt", type: "text/plain" }), null);
});

test("resolveDroppedImport rejects empty, multiple, and unsupported drops", () => {
  assert.deepEqual(resolveDroppedImport([]), { error: "No file was dropped." });
  assert.deepEqual(resolveDroppedImport([
    { name: "a.mid", type: "" },
    { name: "b.mid", type: "" },
  ]), { error: "Drop one file at a time." });
  assert.deepEqual(resolveDroppedImport([{ name: "notes.txt", type: "text/plain" }]), {
    error: "Unsupported file type: notes.txt.",
  });
  assert.deepEqual(resolveDroppedImport([{ name: "riff.mid", type: "" }]), {
    kind: "midi",
  });
});

test("canImportFileToTrack enforces same-kind drops", () => {
  assert.equal(canImportFileToTrack("audio", "audio"), true);
  assert.equal(canImportFileToTrack("midi", "midi"), true);
  assert.equal(canImportFileToTrack("audio", "midi"), false);
  assert.equal(canImportFileToTrack("midi", "audio"), false);
});

test("isFileDragType only depends on drag types, not resolved files", () => {
  assert.equal(isFileDragType(["text/plain", "Files"]), true);
  assert.equal(isFileDragType(["text/plain"]), false);
});

test("resolveTimelineFileDrop converts pointer coordinates into track and tick", () => {
  assert.deepEqual(
    resolveTimelineFileDrop({
      clientX: 110,
      clientY: 190,
      viewportLeft: 10,
      viewportTop: 30,
      scrollLeft: 20,
      scrollTop: 40,
      pixelsPerTick: 2,
      trackCount: 4,
      trackHeight: 80,
    }),
    { trackIndex: 2, tick: 60, appendNewTrack: false },
  );
  assert.equal(
    resolveTimelineFileDrop({
      clientX: 0,
      clientY: 10,
      viewportLeft: 0,
      viewportTop: 30,
      scrollLeft: 0,
      scrollTop: 0,
      pixelsPerTick: 2,
      trackCount: 2,
      trackHeight: 80,
    }),
    null,
  );
});

test("resolveTimelineFileDrop allows drops below existing tracks as append-new-track targets", () => {
  assert.deepEqual(
    resolveTimelineFileDrop({
      clientX: 110,
      clientY: 380,
      viewportLeft: 10,
      viewportTop: 30,
      scrollLeft: 20,
      scrollTop: 40,
      pixelsPerTick: 2,
      trackCount: 4,
      trackHeight: 80,
    }),
    { trackIndex: null, tick: 60, appendNewTrack: true },
  );
});
