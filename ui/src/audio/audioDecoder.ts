import type { SrcFrame } from "../types/index.ts";
import {
  audioBufferDataToAudioBuffer,
  getAudioBufferChannelData,
  type AudioBufferData,
  type AudioBufferSource,
} from "./audioBufferData.ts";

export type AudioDecoderBackend = "native" | "ffmpeg_wasm";

interface AudioDecodeRange {
  /** Inclusive source-frame offset. */
  startSrcFrame: SrcFrame;
  /** Exclusive source-frame offset. */
  endSrcFrame: SrcFrame;
}

export interface PcmChunk {
  /** Inclusive source-frame offset of this chunk in the decoded source. */
  startSrcFrame: SrcFrame;
  lengthSrcFrames: number;
  sampleRate: number;
  numberOfChannels: number;
  channels: readonly Float32Array[];
}

export interface DecodedAudioSource {
  backend: AudioDecoderBackend;
  sampleRate: number;
  numberOfChannels: number;
  lengthSrcFrames: number;
  /**
   * Decode a half-open source-frame range. The initial adapters yield one
   * chunk, while the contract permits streaming decoders to yield many.
   */
  decode(range?: AudioDecodeRange): AsyncIterable<PcmChunk>;
  /** Materialize the current full-buffer DAW boundary. */
  toAudioBuffer(context: BaseAudioContext): AudioBuffer;
}

export function createNativeDecodedAudioSource(
  audioBuffer: AudioBuffer,
): DecodedAudioSource {
  return createDecodedAudioSource("native", audioBuffer, () => audioBuffer);
}

export function createPcmDecodedAudioSource(
  backend: Exclude<AudioDecoderBackend, "native">,
  buffer: AudioBufferData,
): DecodedAudioSource {
  return createDecodedAudioSource(
    backend,
    buffer,
    (context) => audioBufferDataToAudioBuffer(context, buffer),
  );
}

function createDecodedAudioSource(
  backend: AudioDecoderBackend,
  buffer: AudioBufferSource,
  materialize: (context: BaseAudioContext) => AudioBuffer,
): DecodedAudioSource {
  const { numberOfChannels, sampleRate, length } = buffer;

  return {
    backend,
    sampleRate,
    numberOfChannels,
    lengthSrcFrames: length,
    async *decode(range = { startSrcFrame: 0, endSrcFrame: length }) {
      validateDecodeRange(range, length);
      if (range.startSrcFrame === range.endSrcFrame) {
        return;
      }

      yield {
        startSrcFrame: range.startSrcFrame,
        lengthSrcFrames: range.endSrcFrame - range.startSrcFrame,
        sampleRate,
        numberOfChannels,
        channels: Array.from(
          { length: numberOfChannels },
          (_, channel) => getAudioBufferChannelData(buffer, channel).subarray(
            range.startSrcFrame,
            range.endSrcFrame,
          ),
        ),
      };
    },
    toAudioBuffer: materialize,
  };
}

function validateDecodeRange(range: AudioDecodeRange, length: number): void {
  if (!Number.isInteger(range.startSrcFrame) || !Number.isInteger(range.endSrcFrame)) {
    throw new Error("Audio decode range must use integer source frames.");
  }
  if (range.startSrcFrame < 0 || range.endSrcFrame > length) {
    throw new Error(`Audio decode range must stay within [0, ${length}].`);
  }
  if (range.endSrcFrame < range.startSrcFrame) {
    throw new Error("Audio decode range must be a forward half-open interval.");
  }
}
