import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  FFMPEG_CORE_VERSION,
  materializeFfmpegCoreWasm,
  resolveFfmpegCoreWasmAssetUrl,
} from "./ffmpegWasmAsset.ts";

const WASM_BYTES = Uint8Array.of(
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
);

test("FFmpeg resolves the versioned gzip asset from the application base URL", () => {
  assert.equal(FFMPEG_CORE_VERSION, "0.12.10");
  assert.equal(
    resolveFfmpegCoreWasmAssetUrl("/", "https://example.test/editor"),
    "https://example.test/assets/ffmpeg-core-0.12.10.wasm.gz",
  );
  assert.equal(
    resolveFfmpegCoreWasmAssetUrl("/daw/", "https://example.test/daw/editor"),
    "https://example.test/daw/assets/ffmpeg-core-0.12.10.wasm.gz",
  );
});

test("FFmpeg materializes a gzip body returned without Content-Encoding", async () => {
  const blob = await materializeFfmpegCoreWasm(
    new Response(gzipSync(WASM_BYTES)),
  );

  assert.equal(blob.type, "application/wasm");
  assert.deepEqual(
    Array.from(new Uint8Array(await blob.arrayBuffer())),
    Array.from(WASM_BYTES),
  );
});

test("FFmpeg accepts a body the HTTP stack already decompressed", async () => {
  const blob = await materializeFfmpegCoreWasm(new Response(WASM_BYTES));

  assert.deepEqual(
    Array.from(new Uint8Array(await blob.arrayBuffer())),
    Array.from(WASM_BYTES),
  );
});

test("FFmpeg rejects deployment bodies that are neither WASM nor gzip", async () => {
  await assert.rejects(
    () => materializeFfmpegCoreWasm(new Response(Uint8Array.of(1, 2, 3, 4))),
    /neither WASM nor gzip/u,
  );
});
