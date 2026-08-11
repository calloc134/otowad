import assert from "node:assert/strict";
import test from "node:test";

import type { AudioBufferData } from "./audioBufferData.ts";
import {
  computeMediaContentHash,
  resolveMediaIdByContentHash,
} from "./mediaContentHash.ts";

function source(samples: number[]): AudioBufferData {
  return {
    numberOfChannels: 1,
    sampleRate: 48_000,
    length: samples.length,
    channels: [new Float32Array(samples)],
  };
}

test("media content hash is stable across canonical 24-bit quantization", async () => {
  const original = source([-1, -0.5, 0, 0.5, 1]);
  const quantized = source(Array.from(original.channels[0]!, (sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const integer = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
    return integer < 0 ? integer / 0x800000 : integer / 0x7fffff;
  }));

  assert.equal(
    await computeMediaContentHash(original),
    await computeMediaContentHash(quantized),
  );
  assert.notEqual(
    await computeMediaContentHash(original),
    await computeMediaContentHash(source([-1, -0.5, 0, 0.25, 1])),
  );
});

test("duplicate media resolution is deterministic across candidate order", () => {
  const knownMedia = [
    { mediaId: "media-b", contentHash: "matching" },
    { mediaId: "media-a", contentHash: "matching" },
    { mediaId: "media-c", contentHash: "different" },
  ];

  assert.equal(resolveMediaIdByContentHash("media-new", "matching", knownMedia), "media-a");
  assert.equal(
    resolveMediaIdByContentHash("media-new", "matching", [...knownMedia].reverse()),
    "media-a",
  );
  assert.equal(resolveMediaIdByContentHash("media-new", "missing", knownMedia), "media-new");
});
