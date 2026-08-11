import assert from "node:assert/strict";
import test from "node:test";

import { createAudioBufferData } from "./audioBufferData.ts";
import {
  createNativeDecodedAudioSource,
  createPcmDecodedAudioSource,
  type DecodedAudioSource,
  type PcmChunk,
} from "./audioDecoder.ts";

async function collectChunks(source: DecodedAudioSource): Promise<PcmChunk[]> {
  const chunks: PcmChunk[] = [];
  for await (const chunk of source.decode()) {
    chunks.push(chunk);
  }
  return chunks;
}

async function collectRange(
  source: DecodedAudioSource,
  startSrcFrame: number,
  endSrcFrame: number,
): Promise<PcmChunk[]> {
  const chunks: PcmChunk[] = [];
  for await (const chunk of source.decode({ startSrcFrame, endSrcFrame })) {
    chunks.push(chunk);
  }
  return chunks;
}

test("decoded PCM sources expose a half-open chunk-aware source-frame contract", async () => {
  const pcm = createAudioBufferData(2, 4, 48_000);
  pcm.channels[0]?.set([0, 0.25, 0.5, 0.75]);
  pcm.channels[1]?.set([0, -0.25, -0.5, -0.75]);
  const source = createPcmDecodedAudioSource("ffmpeg_wasm", pcm);

  const chunks = await collectRange(source, 1, 3);

  assert.equal(source.backend, "ffmpeg_wasm");
  assert.equal(source.sampleRate, 48_000);
  assert.equal(source.numberOfChannels, 2);
  assert.equal(source.lengthSrcFrames, 4);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.startSrcFrame, 1);
  assert.equal(chunks[0]?.lengthSrcFrames, 2);
  assert.deepEqual(Array.from(chunks[0]?.channels[0] ?? []), [0.25, 0.5]);
  assert.deepEqual(Array.from(chunks[0]?.channels[1] ?? []), [-0.25, -0.5]);
});

test("decoded sources reject non-integral and out-of-bounds source-frame ranges", async () => {
  const source = createPcmDecodedAudioSource(
    "ffmpeg_wasm",
    createAudioBufferData(1, 4, 48_000),
  );

  await assert.rejects(
    () => collectRange(source, -1, 2),
    /within \[0, 4\]/,
  );
  await assert.rejects(
    () => collectRange(source, 2, 5),
    /within \[0, 4\]/,
  );
  await assert.rejects(
    () => collectRange(source, 3, 2),
    /half-open interval/,
  );
  await assert.rejects(
    () => collectRange(source, 0.5, 2),
    /integer source frames/,
  );
});

test("empty ranges yield no PCM chunks", async () => {
  const source = createPcmDecodedAudioSource(
    "ffmpeg_wasm",
    createAudioBufferData(1, 4, 48_000),
  );

  assert.deepEqual(await collectRange(source, 2, 2), []);
});

test("native decoded sources keep the decodeAudioData AudioBuffer identity", async () => {
  const channel = new Float32Array([0.1, 0.2, 0.3]);
  const nativeBuffer = {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 3,
    getChannelData: (channelIndex: number) => {
      assert.equal(channelIndex, 0);
      return channel;
    },
  } as unknown as AudioBuffer;
  const source = createNativeDecodedAudioSource(nativeBuffer);

  assert.equal(source.toAudioBuffer({} as BaseAudioContext), nativeBuffer);
  const chunks = await collectChunks(source);
  assert.deepEqual(
    Array.from(chunks[0]?.channels[0] ?? []).map((sample) => Number(sample.toFixed(6))),
    [0.1, 0.2, 0.3],
  );
});
