import assert from "node:assert/strict";
import test from "node:test";

import {
  transcodeAudioToPcm24Wav,
  type FfmpegFileRuntime,
} from "./ffmpegTranscode.ts";

class FakeFfmpegRuntime implements FfmpegFileRuntime {
  readonly calls: string[] = [];
  readonly output = new Uint8Array([9, 8, 7]);
  exitCode = 0;

  async writeFile(path: string, data: Uint8Array): Promise<boolean> {
    this.calls.push(`write:${path}:${Array.from(data).join(",")}`);
    return true;
  }

  async exec(args: string[]): Promise<number> {
    this.calls.push(`exec:${args.join(" ")}`);
    return this.exitCode;
  }

  async readFile(path: string): Promise<Uint8Array | string> {
    this.calls.push(`read:${path}`);
    return this.output;
  }

  async deleteFile(path: string): Promise<boolean> {
    this.calls.push(`delete:${path}`);
    return true;
  }
}

test("FFmpeg compatibility transcode emits deterministic PCM24 WAV arguments and cleans files", async () => {
  const runtime = new FakeFfmpegRuntime();

  const output = await transcodeAudioToPcm24Wav(
    runtime,
    "input-1.ogg",
    "output-1.wav",
    new Uint8Array([1, 2, 3]),
  );

  assert.deepEqual(Array.from(output), [9, 8, 7]);
  assert.notEqual(output, runtime.output);
  assert.deepEqual(runtime.calls, [
    "write:input-1.ogg:1,2,3",
    "exec:-i input-1.ogg -map 0:a:0 -vn -c:a pcm_s24le output-1.wav",
    "read:output-1.wav",
    "delete:input-1.ogg",
    "delete:output-1.wav",
  ]);
});

test("FFmpeg compatibility transcode rejects a nonzero exit and still cleans files", async () => {
  const runtime = new FakeFfmpegRuntime();
  runtime.exitCode = 1;

  await assert.rejects(
    () => transcodeAudioToPcm24Wav(
      runtime,
      "input-2.flac",
      "output-2.wav",
      new Uint8Array([4, 5, 6]),
    ),
    /exit code 1/,
  );

  assert.deepEqual(runtime.calls.slice(-2), [
    "delete:input-2.flac",
    "delete:output-2.wav",
  ]);
});
