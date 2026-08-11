import assert from "node:assert/strict";
import test from "node:test";

import type { MediaAsset } from "@/types";
import { validateRelinkCandidate } from "../audio/mediaRelink.ts";

const asset: MediaAsset = {
  id: "media-1",
  in_zip_path: "media/media-1.wav",
  channels: 2,
  src_sample_rate: 48_000,
  length_src_frames: 96_000,
  hash: null,
  original_name: "source.wav",
};

test("manual relink accepts a user-selected file only when its runtime shape is compatible", () => {
  assert.equal(validateRelinkCandidate(asset, {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 96_000,
  }), null);

  assert.match(validateRelinkCandidate(asset, {
    numberOfChannels: 1,
    sampleRate: 48_000,
    length: 96_000,
  }) ?? "", /2 channel/);
  assert.match(validateRelinkCandidate(asset, {
    numberOfChannels: 2,
    sampleRate: 44_100,
    length: 96_000,
  }) ?? "", /48000 Hz/);
  assert.match(validateRelinkCandidate(asset, {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 95_999,
  }) ?? "", /96000 source frames/);
});
