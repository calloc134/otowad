import assert from "node:assert/strict";
import test from "node:test";

import type { AnalysisArtifact } from "@/types";
import {
  buildMemoryScenarioMatrix,
  measureAnalysisArtifacts,
  measureAudioBufferSources,
  TransferMemoryTracker,
} from "./runtimeMemoryDiagnostics.ts";

test("runtime memory buckets count Float32 payload bytes without double-counting metadata", () => {
  const buffers = new Map([
    ["media-a", makeAudioBufferSource(2, 48_000, 48_000)],
    ["media-b", makeAudioBufferSource(1, 24_000, 48_000)],
  ]);

  assert.deepEqual(measureAudioBufferSources(buffers.values()), {
    count: 2,
    bytes: (2 * 48_000 + 24_000) * Float32Array.BYTES_PER_ELEMENT,
  });
});

test("analysis measurement reports serialized payload bytes separately from PCM", () => {
  const artifact: AnalysisArtifact = {
    kind: "f0_track",
    schema_version: 4,
    media_id: "media-a",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "test", params_hash: "test" },
    hop_src_frames: 256,
    f0_hz_x100: [22_000, 22_100],
    voiced_prob_permille: [1_000, 1_000],
    method: "test",
    params: "test",
  };

  const expectedBytes = new TextEncoder().encode(JSON.stringify([["analysis-a", artifact]])).byteLength;
  assert.deepEqual(measureAnalysisArtifacts(new Map([["analysis-a", artifact]])), {
    count: 1,
    bytes: expectedBytes,
  });
});

test("memory scenario matrix covers 10m, 30m, and two 30m stereo sources at target rates", () => {
  const matrix = buildMemoryScenarioMatrix();

  assert.equal(matrix.length, 9);
  assert.deepEqual(matrix[0], {
    label: "10m x1 @ 44100 Hz",
    durationMinutes: 10,
    sourceCount: 1,
    sampleRate: 44_100,
    channels: 2,
    pcmBytesPerCopy: 211_680_000,
  });
  assert.equal(
    matrix.find((entry) => entry.label === "30m x2 @ 96000 Hz")?.pcmBytesPerCopy,
    2_764_800_000,
  );
});

test("transfer tracker separates temporary PCM clones from other transfer payloads", () => {
  const tracker = new TransferMemoryTracker();
  tracker.begin("pcm_clone", 1_024);
  tracker.begin("pcm_clone", 512);
  tracker.end("pcm_clone", 512);
  tracker.end("pcm_clone", 1_024);
  tracker.begin("other", 64);
  tracker.end("other", 64);

  assert.deepEqual(tracker.getSnapshot(), {
    pcmCloneInFlightBytes: 0,
    pcmClonePeakBytes: 1_536,
    pcmCloneCumulativeBytes: 1_536,
    otherInFlightBytes: 0,
    otherPeakBytes: 64,
    otherCumulativeBytes: 64,
  });
});

function makeAudioBufferSource(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) {
  const channels = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(length),
  );
  return {
    numberOfChannels,
    length,
    sampleRate,
    getChannelData(channel: number) {
      const data = channels[channel];
      if (!data) {
        throw new RangeError(`Missing channel ${channel}`);
      }
      return data;
    },
  };
}
