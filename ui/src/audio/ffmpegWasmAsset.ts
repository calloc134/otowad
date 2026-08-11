export const FFMPEG_CORE_VERSION = "0.12.10";

const COMPRESSED_WASM_PATH =
  `assets/ffmpeg-core-${FFMPEG_CORE_VERSION}.wasm.gz`;
const WASM_MAGIC = Uint8Array.of(0x00, 0x61, 0x73, 0x6d);
const GZIP_MAGIC = Uint8Array.of(0x1f, 0x8b);

export async function createFfmpegCoreWasmBlobUrl(): Promise<string> {
  const response = await fetch(getFfmpegCoreWasmAssetUrl());
  return URL.createObjectURL(await materializeFfmpegCoreWasm(response));
}

function getFfmpegCoreWasmAssetUrl(): string {
  return resolveFfmpegCoreWasmAssetUrl(
    import.meta.env.BASE_URL,
    globalThis.location.href,
  );
}

export function resolveFfmpegCoreWasmAssetUrl(
  baseUrl: string,
  pageHref: string,
): string {
  return new URL(
    `${baseUrl}${COMPRESSED_WASM_PATH}`,
    pageHref,
  ).href;
}

export async function materializeFfmpegCoreWasm(
  response: Response,
): Promise<Blob> {
  if (!response.ok) {
    throw new Error(
      `Could not fetch the FFmpeg/WASM compatibility asset (${response.status}).`,
    );
  }

  let bytes = new Uint8Array(await response.arrayBuffer());
  if (hasMagic(bytes, GZIP_MAGIC)) {
    if (typeof DecompressionStream !== "function") {
      throw new Error(
        "This browser cannot decompress the FFmpeg/WASM compatibility asset.",
      );
    }
    const compressed = new Blob([bytes]).stream();
    const decompressed = compressed.pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
  } else if (!hasMagic(bytes, WASM_MAGIC)) {
    throw new Error("FFmpeg/WASM compatibility asset is neither WASM nor gzip.");
  }

  if (!hasMagic(bytes, WASM_MAGIC)) {
    throw new Error("FFmpeg/WASM compatibility asset did not expand to WASM.");
  }
  return new Blob([bytes], { type: "application/wasm" });
}

function hasMagic(bytes: Uint8Array, magic: Uint8Array): boolean {
  return magic.every((value, index) => bytes[index] === value);
}
