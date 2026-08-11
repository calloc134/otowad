// =============================================================================
// WAV Encoder — pure function that encodes audio buffers to PCM WAV
// =============================================================================

import type { AudioBufferSource } from "../audio/audioBufferData.ts";
import {
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "../audio/audioBufferData.ts";

export const DEFAULT_WAV_BITS_PER_SAMPLE = 24;

export interface EncodeWavOptions {
  bitsPerSample?: 16 | 24;
}

export function encodeWav(
  audioBuffer: AudioBufferSource,
  options: EncodeWavOptions = {},
): ArrayBuffer {
  const numChannels = getAudioBufferChannelCount(audioBuffer);
  if (numChannels < 1) {
    throw new Error("WAV encoding requires at least one channel.");
  }
  const sampleRate = getAudioBufferSampleRate(audioBuffer);
  const numSamples = getAudioBufferLength(audioBuffer);
  const bitsPerSample = options.bitsPerSample ?? DEFAULT_WAV_BITS_PER_SAMPLE;
  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new Error(`Unsupported WAV PCM bit depth: ${bitsPerSample}`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  // WAV header is always 44 bytes
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let offset = 0;

  // --- RIFF header ---
  // ChunkID: "RIFF"
  writeString(view, offset, "RIFF");
  offset += 4;

  // ChunkSize: total file size - 8 (RIFF header)
  view.setUint32(offset, totalSize - 8, true);
  offset += 4;

  // Format: "WAVE"
  writeString(view, offset, "WAVE");
  offset += 4;

  // --- fmt sub-chunk ---
  // Subchunk1ID: "fmt "
  writeString(view, offset, "fmt ");
  offset += 4;

  // Subchunk1Size: 16 for PCM
  view.setUint32(offset, 16, true);
  offset += 4;

  // AudioFormat: 1 = PCM
  view.setUint16(offset, 1, true);
  offset += 2;

  // NumChannels
  view.setUint16(offset, numChannels, true);
  offset += 2;

  // SampleRate
  view.setUint32(offset, sampleRate, true);
  offset += 4;

  // ByteRate
  view.setUint32(offset, byteRate, true);
  offset += 4;

  // BlockAlign
  view.setUint16(offset, blockAlign, true);
  offset += 2;

  // BitsPerSample
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;

  // --- data sub-chunk ---
  // Subchunk2ID: "data"
  writeString(view, offset, "data");
  offset += 4;

  // Subchunk2Size
  view.setUint32(offset, dataSize, true);
  offset += 4;

  // --- PCM sample data ---
  // Get channel data arrays
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(getAudioBufferChannelData(audioBuffer, ch));
  }

  // Write interleaved PCM samples
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = channels[ch];
      if (!channelData) continue;
      const sample = channelData[i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      if (bitsPerSample === 16) {
        const int16 = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
        view.setInt16(offset, int16, true);
      } else {
        const int24 = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
        writeInt24LE(view, offset, int24);
      }
      offset += bytesPerSample;
    }
  }

  return buffer;
}

function writeInt24LE(view: DataView, offset: number, value: number): void {
  const clamped = Math.max(-0x800000, Math.min(0x7fffff, value));
  const encoded = clamped < 0 ? clamped + 0x1000000 : clamped;
  view.setUint8(offset, encoded & 0xff);
  view.setUint8(offset + 1, (encoded >> 8) & 0xff);
  view.setUint8(offset + 2, (encoded >> 16) & 0xff);
}

/** Write an ASCII string into a DataView at the given byte offset. */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
