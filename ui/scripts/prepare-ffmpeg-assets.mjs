import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants, createGzip } from "node:zlib";

const expectedCoreVersion = "0.12.10";
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = path.join(uiRoot, "node_modules", "@ffmpeg", "core");
const packageJson = JSON.parse(
  await readFile(path.join(coreRoot, "package.json"), "utf8"),
);
if (packageJson.version !== expectedCoreVersion) {
  throw new Error(
    `Expected @ffmpeg/core ${expectedCoreVersion}, found ${packageJson.version}.`,
  );
}

const sourcePath = path.join(coreRoot, "dist", "umd", "ffmpeg-core.wasm");
const assetsRoot = path.join(uiRoot, "public", "assets");
const outputPath = path.join(
  assetsRoot,
  `ffmpeg-core-${expectedCoreVersion}.wasm.gz`,
);
await mkdir(assetsRoot, { recursive: true });
await pipeline(
  createReadStream(sourcePath),
  createGzip({ level: constants.Z_BEST_COMPRESSION }),
  createWriteStream(outputPath),
);

const sourceBytes = (await stat(sourcePath)).size;
const outputBytes = (await stat(outputPath)).size;
console.log(
  `Prepared self-hosted FFmpeg WASM: ${sourceBytes} bytes -> ${outputBytes} gzip bytes.`,
);
