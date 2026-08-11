import assert from "node:assert/strict";
import test from "node:test";

import type { MediaAsset, ProjectDocument } from "@/types";
import {
  MediaAvailabilityError,
  MediaAvailabilityRegistry,
  validateRelinkContentIdentity,
} from "./mediaAvailability.ts";

test("media availability is runtime-only and reconciles against the current document", () => {
  const registry = new MediaAvailabilityRegistry();
  const document = makeProjectDocument();

  registry.reconcile(document, (mediaId) => mediaId === "media-available");

  assert.deepEqual(registry.getSnapshot(), [
    { mediaId: "media-available", status: "available", message: null },
    { mediaId: "media-missing", status: "missing", message: null },
    { mediaId: "media-unused", status: "missing", message: null },
  ]);
  assert.equal("availability" in document.edit.media[0]!, false);

  registry.markInvalid("media-missing", "The selected file has a different sample rate.");
  registry.reconcile(document, () => false);
  assert.equal(registry.get("media-missing")?.status, "invalid");
});

test("assertReferencedMediaAvailable blocks only unavailable media reached by audio clips", () => {
  const registry = new MediaAvailabilityRegistry();
  const document = makeProjectDocument();
  registry.reconcile(document, (mediaId) => mediaId === "media-available");

  assert.throws(
    () => registry.assertReferencedMediaAvailable(document, "play"),
    (error) => {
      assert.ok(error instanceof MediaAvailabilityError);
      assert.equal(error.operation, "play");
      assert.deepEqual(error.mediaIds, ["media-missing"]);
      assert.match(error.message, /missing\.wav/);
      return true;
    },
  );

  registry.markAvailable("media-missing");
  assert.doesNotThrow(() => registry.assertReferencedMediaAvailable(document, "save"));
});

test("relink identity prefers content hash and limits null hashes to original names", () => {
  const hashed = makeMedia("media-hashed", "voice.wav");
  hashed.hash = "sha256-pcm24-v1:expected";
  assert.equal(
    validateRelinkContentIdentity(hashed, "renamed.wav", "sha256-pcm24-v1:expected"),
    null,
  );
  assert.match(
    validateRelinkContentIdentity(hashed, "voice.wav", "sha256-pcm24-v1:other") ?? "",
    /content hash/i,
  );

  const unhashed = makeMedia("media-unhashed", "voice.wav");
  assert.equal(
    validateRelinkContentIdentity(unhashed, "voice.wav", "sha256-pcm24-v1:any"),
    null,
  );
  assert.match(
    validateRelinkContentIdentity(unhashed, "renamed.wav", "sha256-pcm24-v1:any") ?? "",
    /file name/i,
  );
});

function makeProjectDocument(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "Availability",
      created_at: "",
      app_version: "test",
      project_sample_rate: 44_100,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
      },
      grid: {
        snap_enabled: true,
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [{
        id: "track-audio",
        name: "Audio",
        kind: { track_type: "audio" },
        mute: false,
        solo: false,
        gain_milli_db: 0,
        pan_permille: 0,
        fx_chain: [],
        routing: { output: { bus: "master" }, sends: [] },
      }],
      media: [
        makeMedia("media-available", "available.wav"),
        makeMedia("media-missing", "missing.wav"),
        makeMedia("media-unused", "unused.wav"),
      ],
      contents: [
        { type: "audio", id: "content-available", media_id: "media-available", analysis_refs: [] },
        { type: "audio", id: "content-missing", media_id: "media-missing", analysis_refs: [] },
      ],
      clips: [
        makeAudioClip("clip-available", "content-available", 0),
        makeAudioClip("clip-missing", "content-missing", 960),
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

function makeMedia(id: string, originalName: string): MediaAsset {
  return {
    id,
    in_zip_path: `media/${id}.wav`,
    channels: 1,
    src_sample_rate: 44_100,
    length_src_frames: 44_100,
    hash: null,
    original_name: originalName,
  };
}

function makeAudioClip(id: string, contentId: string, start: number) {
  return {
    id,
    track_id: "track-audio",
    start,
    length: 960,
    lane: 0,
    muted: false,
    gain_milli_db: 0,
    kind: {
      clip_type: "audio" as const,
      content_id: contentId,
      audio: {
        src_in: 0,
        src_out: 44_100,
        warp: { warp_type: "none" as const },
        pitch: {
          mode: "ManualOnly" as const,
          manual_coarse_semitones: 0,
          manual_fine_cents: 0,
        },
        fades: { fade_in: 0, fade_out: 0 },
        time_pitch: {
          mode: "Voice" as const,
          analysis: "Local" as const,
          preserve_formant: false,
        },
      },
    },
  };
}
