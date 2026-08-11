import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);
const expectedExpandedWasmBytes = 32_232_419;
const expectedExpandedWasmSha256 =
  "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(uiRoot, "dist");
const serviceWorkerPath = path.join(distRoot, "sw.js");
const thirdPartyNoticePath = path.join(
  distRoot,
  "third-party",
  "ffmpeg-wasm-NOTICE.txt",
);
const gplLicensePath = path.join(distRoot, "third-party", "GPL-2.0.txt");
const headersPath = path.join(distRoot, "_headers");
const ffmpegAssets = (await listFiles(distRoot))
  .filter((filePath) => path.basename(filePath).toLowerCase().includes("ffmpeg"));
const ffmpegWasmAssets = ffmpegAssets.filter((filePath) => filePath.endsWith(".wasm.gz"));
const uncompressedFfmpegWasmAssets = ffmpegAssets.filter((filePath) => filePath.endsWith(".wasm"));

if (uncompressedFfmpegWasmAssets.length > 0) {
  throw new Error(
    `Uncompressed FFmpeg WASM cannot be deployed to Cloudflare: ${uncompressedFfmpegWasmAssets.join(", ")}`,
  );
}

if (ffmpegWasmAssets.length !== 1) {
  throw new Error(
    `Expected one self-hosted compressed FFmpeg WASM asset, found ${ffmpegWasmAssets.length}.`,
  );
}

const wasmBytes = (await stat(ffmpegWasmAssets[0])).size;
if (wasmBytes <= 5 * 1024 * 1024) {
  throw new Error(`Compressed FFmpeg WASM asset is unexpectedly small (${wasmBytes} bytes).`);
}
const cloudflareAssetLimit = 25 * 1024 * 1024;
if (wasmBytes > cloudflareAssetLimit) {
  throw new Error(
    `Compressed FFmpeg WASM exceeds the Cloudflare asset limit (${wasmBytes} bytes).`,
  );
}

const expandedWasm = await gunzipAsync(await readFile(ffmpegWasmAssets[0]));
const expandedWasmSha256 = createHash("sha256").update(expandedWasm).digest("hex");
if (
  expandedWasm.length !== expectedExpandedWasmBytes ||
  expandedWasmSha256 !== expectedExpandedWasmSha256
) {
  throw new Error(
    `Compressed FFmpeg WASM does not restore the pinned core (${expandedWasm.length} bytes, ${expandedWasmSha256}).`,
  );
}

const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const precachedFfmpegAssets = ffmpegAssets.filter((filePath) => {
  return serviceWorker.includes(path.basename(filePath));
});
if (precachedFfmpegAssets.length > 0) {
  throw new Error(
    `FFmpeg compatibility assets leaked into the PWA precache: ${precachedFfmpegAssets.join(", ")}`,
  );
}

await Promise.all([stat(thirdPartyNoticePath), stat(gplLicensePath)]);
const thirdPartyNotice = await readFile(thirdPartyNoticePath, "utf8");
for (const requiredNotice of [
  "@ffmpeg/core 0.12.10",
  "GPL-2.0-or-later",
  "71aa99d37c02a7b4c435275ca9ef50e612f6efa1",
  expectedExpandedWasmSha256,
]) {
  if (!thirdPartyNotice.includes(requiredNotice)) {
    throw new Error(`FFmpeg third-party notice is missing: ${requiredNotice}`);
  }
}
const headers = await readFile(headersPath, "utf8");
for (const requiredHeader of [
  "/assets/ffmpeg-core-*.wasm.gz",
  "Content-Type: application/gzip",
]) {
  if (!headers.includes(requiredHeader)) {
    throw new Error(`FFmpeg deployment header is missing: ${requiredHeader}`);
  }
}

console.log(
  `Verified ${wasmBytes} byte compressed FFmpeg WASM restores the ${expandedWasm.length} byte pinned core, stays under the Cloudflare limit, includes deployment headers/notices, and remains outside PWA precache.`,
);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}
