export interface FfmpegFileRuntime {
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  exec(args: string[]): Promise<number>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
}

export async function transcodeAudioToPcm24Wav(
  runtime: FfmpegFileRuntime,
  inputPath: string,
  outputPath: string,
  inputBytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    await runtime.writeFile(inputPath, inputBytes);
    const exitCode = await runtime.exec([
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "pcm_s24le",
      outputPath,
    ]);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg audio decode failed with exit code ${exitCode}.`);
    }

    const output = await runtime.readFile(outputPath);
    if (!(output instanceof Uint8Array)) {
      throw new Error("FFmpeg audio decode returned non-binary output.");
    }
    return Uint8Array.from(output);
  } finally {
    await Promise.allSettled([
      runtime.deleteFile(inputPath),
      runtime.deleteFile(outputPath),
    ]);
  }
}
