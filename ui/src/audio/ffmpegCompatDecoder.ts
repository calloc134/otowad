import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";

import {
  createPcmDecodedAudioSource,
  type DecodedAudioSource,
} from "./audioDecoder.ts";
import { transcodeAudioToPcm24Wav } from "./ffmpegTranscode.ts";
import { createFfmpegCoreWasmBlobUrl } from "./ffmpegWasmAsset.ts";
import { decodePcmWavToAudioBufferData } from "./pcmWav.ts";

let ffmpegPromise: Promise<FFmpeg> | null = null;
let decodeQueue: Promise<void> = Promise.resolve();
let nextJobId = 1;

export async function decodeAudioFileWithFfmpeg(
  file: File,
): Promise<DecodedAudioSource> {
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  return runExclusive(async () => {
    const ffmpeg = await loadFfmpeg();
    const jobId = nextJobId;
    nextJobId += 1;
    const inputPath = `input-${jobId}${getFileExtension(file.name)}`;
    const outputPath = `output-${jobId}.wav`;
    const wavBytes = await transcodeAudioToPcm24Wav(
      ffmpeg,
      inputPath,
      outputPath,
      inputBytes,
    );
    const pcm = decodePcmWavToAudioBufferData(wavBytes, {
      allowedBitsPerSample: [24],
      // FFmpeg's WAV muxer always writes WAVE_FORMAT_EXTENSIBLE for 24-bit.
      allowExtensiblePcm: true,
    });
    return createPcmDecodedAudioSource("ffmpeg_wasm", pcm);
  });
}

function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    const ffmpeg = new FFmpeg();
    ffmpegPromise = (async () => {
      let wasmURL: string | null = null;
      try {
        wasmURL = await createFfmpegCoreWasmBlobUrl();
        await ffmpeg.load({ coreURL, wasmURL });
        return ffmpeg;
      } catch (error: unknown) {
        ffmpeg.terminate();
        ffmpegPromise = null;
        throw error;
      } finally {
        if (wasmURL) {
          URL.revokeObjectURL(wasmURL);
        }
      }
    })();
  }
  return ffmpegPromise;
}

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = decodeQueue.then(task, task);
  decodeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getFileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/u.exec(fileName);
  return match ? `.${match[1]!.toLowerCase()}` : ".bin";
}
