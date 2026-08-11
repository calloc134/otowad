import assert from "node:assert/strict";
import test from "node:test";

import { createPcmDecodedAudioSource } from "./audioDecoder.ts";
import { createAudioBufferData } from "./audioBufferData.ts";
import {
  createAudioFileDecoder,
  decodeAudioFile,
} from "./audioFileDecoder.ts";

test("native audio import reads once and preserves decodeAudioData buffer identity", async () => {
  const bytes = new Uint8Array([0, 1, 2, 3]);
  let readCount = 0;
  const file = {
    name: "voice.wav",
    type: "audio/wav",
    arrayBuffer: async () => {
      readCount += 1;
      return bytes.slice().buffer;
    },
  } as File;
  const nativeBuffer = {
    numberOfChannels: 1,
    sampleRate: 48_000,
    length: 4,
    getChannelData: () => new Float32Array(4),
  } as unknown as AudioBuffer;
  let receivedBytes: ArrayBuffer | null = null;
  const context = {
    decodeAudioData: async (input: ArrayBuffer) => {
      receivedBytes = input;
      return nativeBuffer;
    },
  } as unknown as AudioContext;

  const decoded = await decodeAudioFile(file, context);

  assert.equal(readCount, 1);
  assert.deepEqual(Array.from(new Uint8Array(receivedBytes ?? new ArrayBuffer(0))), [0, 1, 2, 3]);
  assert.equal(decoded.backend, "native");
  assert.equal(decoded.toAudioBuffer(context), nativeBuffer);
});

test("compatibility decoder is loaded only after native decodeAudioData rejects", async () => {
  const nativeError = new DOMException("unsupported codec", "EncodingError");
  const context = {
    decodeAudioData: async () => Promise.reject(nativeError),
  } as unknown as AudioContext;
  const file = {
    name: "voice.ogg",
    type: "audio/ogg",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File;
  const compatibilitySource = createPcmDecodedAudioSource(
    "ffmpeg_wasm",
    createAudioBufferData(1, 4, 48_000),
  );
  let loaderCalls = 0;
  let compatibilityCalls = 0;
  const decoder = createAudioFileDecoder(async () => {
    loaderCalls += 1;
    return async (receivedFile) => {
      compatibilityCalls += 1;
      assert.equal(receivedFile, file);
      return compatibilitySource;
    };
  });

  const decoded = await decoder(file, context);

  assert.equal(loaderCalls, 1);
  assert.equal(compatibilityCalls, 1);
  assert.equal(decoded, compatibilitySource);
});

test("non-codec native failures do not load the compatibility decoder", async () => {
  for (const errorName of ["InvalidStateError", "DataCloneError"]) {
    const nativeError = new DOMException("native decoder precondition failed", errorName);
    const context = {
      decodeAudioData: async () => Promise.reject(nativeError),
    } as unknown as AudioContext;
    const file = {
      name: "voice.wav",
      type: "audio/wav",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    let loaderCalls = 0;
    const decoder = createAudioFileDecoder(async () => {
      loaderCalls += 1;
      throw new Error("compatibility decoder must stay lazy");
    });

    await assert.rejects(() => decoder(file, context), (error) => error === nativeError);
    assert.equal(loaderCalls, 0, errorName);
  }
});

test("native success never loads the compatibility decoder", async () => {
  const nativeBuffer = {
    numberOfChannels: 1,
    sampleRate: 48_000,
    length: 4,
    getChannelData: () => new Float32Array(4),
  } as unknown as AudioBuffer;
  const context = {
    decodeAudioData: async () => nativeBuffer,
  } as unknown as AudioContext;
  const file = {
    name: "voice.mp3",
    type: "audio/mpeg",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File;
  let loaderCalls = 0;
  const decoder = createAudioFileDecoder(async () => {
    loaderCalls += 1;
    throw new Error("compatibility decoder must stay lazy");
  });

  const decoded = await decoder(file, context);

  assert.equal(decoded.backend, "native");
  assert.equal(loaderCalls, 0);
});

test("dual decoder failure reports both the native and compatibility causes", async () => {
  const nativeError = new DOMException("unsupported codec", "EncodingError");
  const compatibilityError = new Error("FFmpeg found no audio stream");
  const context = {
    decodeAudioData: async () => Promise.reject(nativeError),
  } as unknown as AudioContext;
  const file = {
    name: "broken.bin",
    type: "application/octet-stream",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File;
  const decoder = createAudioFileDecoder(async () => {
    return async () => Promise.reject(compatibilityError);
  });

  await assert.rejects(
    () => decoder(file, context),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /broken\.bin/);
      assert.match(error.message, /unsupported codec/);
      assert.match(error.message, /FFmpeg found no audio stream/);
      assert.ok("causes" in error);
      assert.deepEqual(
        (error as Error & { causes: readonly unknown[] }).causes,
        [nativeError, compatibilityError],
      );
      return true;
    },
  );
});
