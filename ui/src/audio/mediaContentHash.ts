import type { AudioBufferSource } from "./audioBufferData.ts";
import {
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "./audioBufferData.ts";

const HASH_VERSION = "sha256-pcm24-v1";
const HASH_CHUNK_FRAMES = 16_384;
const SHA256_BYTES = 32;
const textEncoder = new TextEncoder();

export function resolveMediaIdByContentHash(
  proposedMediaId: string,
  contentHash: string,
  knownMedia: readonly { mediaId: string; contentHash: string }[],
): string {
  const matches = knownMedia
    .filter((candidate) => candidate.contentHash === contentHash)
    .map((candidate) => candidate.mediaId)
    .sort();
  return matches[0] ?? proposedMediaId;
}

/**
 * Hash decoded audio in the same signed 24-bit normal form used by project
 * archives. Chunk digests avoid constructing a second full-length PCM buffer.
 */
export async function computeMediaContentHash(
  source: AudioBufferSource,
): Promise<string> {
  const channelCount = getAudioBufferChannelCount(source);
  const sampleRate = getAudioBufferSampleRate(source);
  const length = getAudioBufferLength(source);
  if (channelCount < 1) {
    throw new Error("Media content hashing requires at least one channel.");
  }

  const channels = Array.from(
    { length: channelCount },
    (_, channelIndex) => getAudioBufferChannelData(source, channelIndex),
  );
  const chunkDigests: Uint8Array[] = [];
  for (let startFrame = 0; startFrame < length; startFrame += HASH_CHUNK_FRAMES) {
    const frameCount = Math.min(HASH_CHUNK_FRAMES, length - startFrame);
    const pcm = new Uint8Array(frameCount * channelCount * 3);
    let offset = 0;
    for (let frameOffset = 0; frameOffset < frameCount; frameOffset += 1) {
      const frame = startFrame + frameOffset;
      for (const channel of channels) {
        writePcm24(pcm, offset, channel[frame] ?? 0);
        offset += 3;
      }
    }
    chunkDigests.push(new Uint8Array(await crypto.subtle.digest("SHA-256", pcm)));
  }

  const metadata = textEncoder.encode(
    `${HASH_VERSION}|${channelCount}|${sampleRate}|${length}|${HASH_CHUNK_FRAMES}|`,
  );
  const manifest = new Uint8Array(metadata.byteLength + chunkDigests.length * SHA256_BYTES);
  manifest.set(metadata, 0);
  let offset = metadata.byteLength;
  for (const digest of chunkDigests) {
    manifest.set(digest, offset);
    offset += digest.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", manifest));
  return `${HASH_VERSION}:${toHex(digest)}`;
}

function writePcm24(target: Uint8Array, offset: number, sample: number): void {
  const clamped = Math.max(-1, Math.min(1, sample));
  const integer = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
  const encoded = integer < 0 ? integer + 0x1000000 : integer;
  target[offset] = encoded & 0xff;
  target[offset + 1] = (encoded >> 8) & 0xff;
  target[offset + 2] = (encoded >> 16) & 0xff;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
