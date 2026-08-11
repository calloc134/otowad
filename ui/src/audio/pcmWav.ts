import {
  createAudioBufferData,
  type AudioBufferData,
} from "./audioBufferData.ts";

export interface DecodePcmWavOptions {
  allowedBitsPerSample?: readonly (16 | 24)[];
  /**
   * Accept `WAVE_FORMAT_EXTENSIBLE` whose SubFormat GUID is PCM.
   *
   * Archive media is written by `wavEncoder.ts`, which always emits basic PCM,
   * so the archive path leaves this off and keeps rejecting anything else.
   * FFmpeg has no such choice: its WAV muxer always uses the extensible header
   * for 24-bit output, so the compatibility decoder opts in.
   */
  allowExtensiblePcm?: boolean;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** `KSDATAFORMAT_SUBTYPE_PCM` in the byte order it appears in a `fmt ` chunk. */
const PCM_SUBFORMAT_GUID = Uint8Array.of(
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
);

/** Offset of the SubFormat GUID from the start of an extensible `fmt ` chunk. */
const PCM_SUBFORMAT_GUID_OFFSET = 24;
const EXTENSIBLE_FMT_CHUNK_SIZE = PCM_SUBFORMAT_GUID_OFFSET + PCM_SUBFORMAT_GUID.length;

function assertExtensiblePcmSubFormat(
  view: DataView,
  chunkDataOffset: number,
  chunkSize: number,
): void {
  if (chunkSize < EXTENSIBLE_FMT_CHUNK_SIZE) {
    throw new Error("Extensible PCM WAV fmt chunk is too small for a SubFormat GUID.");
  }
  for (let index = 0; index < PCM_SUBFORMAT_GUID.length; index++) {
    const actual = view.getUint8(chunkDataOffset + PCM_SUBFORMAT_GUID_OFFSET + index);
    if (actual !== PCM_SUBFORMAT_GUID[index]) {
      throw new Error("Only PCM WAV archive media is supported.");
    }
  }
}

export function decodePcmWavToAudioBufferData(
  bytes: Uint8Array,
  options: DecodePcmWavOptions = {},
): AudioBufferData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Archive media must be PCM WAV.");
  }
  const allowedBitsPerSample = options.allowedBitsPerSample ?? [24];

  let offset = 12;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > bytes.byteLength) {
      throw new Error("Archive WAV chunk is truncated.");
    }

    if (chunkId === "fmt ") {
      const audioFormat = view.getUint16(chunkDataOffset, true);
      if (audioFormat === WAVE_FORMAT_EXTENSIBLE && options.allowExtensiblePcm) {
        assertExtensiblePcmSubFormat(view, chunkDataOffset, chunkSize);
      } else if (audioFormat !== WAVE_FORMAT_PCM) {
        throw new Error("Only PCM WAV archive media is supported.");
      }
      channelCount = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (channelCount <= 0 || sampleRate <= 0 || dataOffset < 0) {
    throw new Error("Archive WAV is missing required PCM chunks.");
  }
  if (!allowedBitsPerSample.includes(bitsPerSample as 16 | 24)) {
    throw new Error(
      `Only ${allowedBitsPerSample.join("/")}-bit PCM WAV archive media is supported.`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  if (blockAlign <= 0 || dataSize % blockAlign !== 0) {
    throw new Error("Archive WAV data size is invalid.");
  }

  const frameCount = dataSize / blockAlign;
  const buffer = createAudioBufferData(channelCount, frameCount, sampleRate);
  let sampleOffset = dataOffset;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const normalized = readPcmWavSampleNormalized(view, sampleOffset, bitsPerSample);
      buffer.channels[channel]![frame] = normalized;
      sampleOffset += bytesPerSample;
    }
  }

  return buffer;
}

function readPcmWavSampleNormalized(
  view: DataView,
  offset: number,
  bitsPerSample: number,
): number {
  if (bitsPerSample === 16) {
    const sample = view.getInt16(offset, true);
    return sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }

  if (bitsPerSample === 24) {
    const sample = readInt24LE(view, offset);
    return sample < 0 ? sample / 0x800000 : sample / 0x7fffff;
  }

  throw new Error(`Unsupported PCM WAV bit depth ${bitsPerSample}.`);
}

function readInt24LE(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  let value = b0 | (b1 << 8) | (b2 << 16);
  if (value & 0x800000) {
    value |= ~0xffffff;
  }
  return value;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}
