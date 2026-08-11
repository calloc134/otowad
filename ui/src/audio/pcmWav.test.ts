import assert from "node:assert/strict";
import test from "node:test";

import { computeMediaContentHash } from "./mediaContentHash.ts";
import { decodePcmWavToAudioBufferData } from "./pcmWav.ts";

const FFMPEG_GOLDEN_PCM24_WAV_HEX = [
  "524946463c00000057415645",
  "666d74201000000001000200",
  "80bb00000065040006001800",
  "6461746118000000",
  "000000000000",
  "0000400000c0",
  "ffff7f000080",
  "0000200000e0",
].join("");

/**
 * Byte-for-byte output of `ffmpeg -f s24le -ar 48000 -ac 2 -i - -c:a copy out.wav`
 * carrying the same known samples as the hand-written fixture above.
 *
 * The hand-written fixture is a *basic* PCM header (`fmt ` size 16,
 * audioFormat 1). Real FFmpeg never emits that for 24-bit: its WAV muxer writes
 * WAVE_FORMAT_EXTENSIBLE (`fmt ` size 40, audioFormat 0xFFFE, PCM SubFormat
 * GUID) and appends a `LIST`/`INFO` chunk. Keeping only the hand-written shape
 * let this test pass while the real compatibility path failed in production,
 * so this fixture is frozen real output and must not be hand-edited.
 */
const FFMPEG_REAL_PCM24_EXTENSIBLE_WAV_HEX = [
  "524946467600000057415645",
  "666d742028000000feff0200",
  "80bb0000006504000600" + "1800",
  "1600" + "1800" + "03000000",
  "0100000000001000800000aa00389b71",
  "4c4953541a000000494e464f",
  "495346540e0000004c61766636322e31322e31303100",
  "6461746118000000",
  "000000000000",
  "0000400000c0",
  "ffff7f000080",
  "0000200000e0",
].join("");

function decodeHex(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{2}/gu)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

test("fixed FFmpeg PCM24 WAV fixture has stable PCM shape and content hash", async () => {
  const decoded = decodePcmWavToAudioBufferData(
    decodeHex(FFMPEG_GOLDEN_PCM24_WAV_HEX),
  );

  assert.equal(decoded.numberOfChannels, 2);
  assert.equal(decoded.sampleRate, 48_000);
  assert.equal(decoded.length, 4);
  assert.deepEqual(
    Array.from(decoded.channels[0] ?? []).map((sample) => Number(sample.toFixed(6))),
    [0, 0.5, 1, 0.25],
  );
  assert.deepEqual(
    Array.from(decoded.channels[1] ?? []).map((sample) => Number(sample.toFixed(6))),
    [0, -0.5, -1, -0.25],
  );
  assert.equal(
    await computeMediaContentHash(decoded),
    "sha256-pcm24-v1:ed8fd8f769f07ea77c4f3970ba0fae14b6a0ed44b76ff5ea750e3fe0595ac37a",
  );
});

test("real FFmpeg PCM24 output decodes when extensible PCM is allowed", async () => {
  const decoded = decodePcmWavToAudioBufferData(
    decodeHex(FFMPEG_REAL_PCM24_EXTENSIBLE_WAV_HEX),
    { allowedBitsPerSample: [24], allowExtensiblePcm: true },
  );

  assert.equal(decoded.numberOfChannels, 2);
  assert.equal(decoded.sampleRate, 48_000);
  assert.equal(decoded.length, 4);
  assert.deepEqual(
    Array.from(decoded.channels[0] ?? []).map((sample) => Number(sample.toFixed(6))),
    [0, 0.5, 1, 0.25],
  );
  assert.deepEqual(
    Array.from(decoded.channels[1] ?? []).map((sample) => Number(sample.toFixed(6))),
    [0, -0.5, -1, -0.25],
  );
  // Same PCM as the basic-header fixture, so the content hash must match too.
  assert.equal(
    await computeMediaContentHash(decoded),
    "sha256-pcm24-v1:ed8fd8f769f07ea77c4f3970ba0fae14b6a0ed44b76ff5ea750e3fe0595ac37a",
  );
});

test("archive media still rejects extensible PCM by default", () => {
  assert.throws(
    () =>
      decodePcmWavToAudioBufferData(
        decodeHex(FFMPEG_REAL_PCM24_EXTENSIBLE_WAV_HEX),
      ),
    /Only PCM WAV archive media is supported/u,
  );
});
