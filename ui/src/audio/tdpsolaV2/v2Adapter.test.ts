import assert from "node:assert/strict";
import test from "node:test";

import { createAudioBufferData } from "../audioBufferData.ts";
import { renderAudioClipTdPsolaV2Data } from "./v2Adapter.ts";
import type { F0TrackArtifact, PitchMarksArtifact } from "../../types/index.ts";

const SAMPLE_RATE = 48_000;
const SOURCE_LENGTH = 4_800;
const PERIOD = 100;

function makeInput() {
  const input = createAudioBufferData(2, SOURCE_LENGTH, SAMPLE_RATE);
  for (let index = 0; index < SOURCE_LENGTH; index++) {
    const value =
      0.65 * Math.cos((2 * Math.PI * index) / PERIOD) +
      0.20 * Math.cos((4 * Math.PI * index) / PERIOD + 0.2);
    input.channels[0]![index] = value;
    input.channels[1]![index] = value * 0.8;
  }
  return input;
}

function makeF0Track(): F0TrackArtifact {
  const hop = 128;
  const frameCount = Math.ceil(SOURCE_LENGTH / hop) + 1;
  return {
    kind: "f0_track",
    schema_version: 1,
    media_id: "v2-adapter-test",
    src_sample_rate: SAMPLE_RATE,
    created_by: {
      app_version: "test",
      algo_version: "synthetic",
      params_hash: "synthetic",
    },
    hop_src_frames: hop,
    f0_hz_x100: Array.from({ length: frameCount }, () => 48_000),
    voiced_prob_permille: Array.from({ length: frameCount }, () => 1_000),
    method: "synthetic",
    params: "{}",
  };
}

function makePitchMarks(): PitchMarksArtifact {
  const marks: number[] = [];
  for (let mark = PERIOD; mark < SOURCE_LENGTH; mark += PERIOD) marks.push(mark);
  return {
    kind: "pitch_marks",
    schema_version: 1,
    media_id: "v2-adapter-test",
    src_sample_rate: SAMPLE_RATE,
    created_by: {
      app_version: "test",
      algo_version: "synthetic",
      params_hash: "synthetic",
    },
    marks_src_frames: marks,
    mark_policy: "synthetic",
    params: "{}",
  };
}

test("explicit v2 adapter uses provided source artifacts without legacy scheduler", () => {
  const input = makeInput();
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];
  const base = {
    inputBuffer: input,
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: 12,
    sourceF0Track: makeF0Track(),
    sourcePitchMarks: makePitchMarks(),
    preserveFormant: true,
    analysisPolicy: "voice_monophonic_v2" as const,
  };

  const oneSampleBlocks = renderAudioClipTdPsolaV2Data({
    ...base,
    blockSize: 1,
    diagnosticsCollector: (value) => diagnostics.push(value),
  });
  const largeBlocks = renderAudioClipTdPsolaV2Data({ ...base, blockSize: 257 });

  assert.ok(oneSampleBlocks);
  assert.ok(largeBlocks);
  assert.deepEqual(oneSampleBlocks.channels, largeBlocks.channels);
  assert.equal(diagnostics[0]?.analysisPolicy.id, "voice_monophonic_v2");
  assert.deepEqual(diagnostics[0]?.analysisPolicy.synthesisAdjuncts, {
    lpcFormantAssist: false,
    mixedExcitation: false,
    transientDirectCopy: false,
  });
  assert.equal(diagnostics[0]?.requestedAnalysisSource, "provided");
  assert.equal(diagnostics[0]?.analysisSource, "provided");
  assert.equal(diagnostics[0]?.analysisFallbackReason, null);
  assert.equal(diagnostics[0]?.operation, "pitch_only");
  assert.ok((diagnostics[0]?.sourceMarkCount ?? 0) >= 40);
  assert.ok((diagnostics[0]?.regionRender.renderedRegionCount ?? 0) >= 1);
  assert.ok(oneSampleBlocks.channels.every((channel) => channel.every(Number.isFinite)));
});

test("provided analysis request falls back explicitly when no artifact exists", () => {
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];
  const output = renderAudioClipTdPsolaV2Data({
    inputBuffer: makeInput(),
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: -12,
    analysisPolicy: "voice_monophonic_v2",
    diagnosticsCollector: (value) => diagnostics.push(value),
  });

  assert.ok(output);
  assert.equal(diagnostics[0]?.analysisPolicy.id, "voice_monophonic_v2");
  assert.equal(diagnostics[0]?.requestedAnalysisSource, "provided");
  assert.equal(diagnostics[0]?.analysisSource, "local");
  assert.equal(diagnostics[0]?.analysisFallbackReason, "provided_artifact_missing");
});

test("source-native adapter defaults to the provided monophonic analysis policy", () => {
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];
  const output = renderAudioClipTdPsolaV2Data({
    inputBuffer: makeInput(),
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: 12,
    sourceF0Track: makeF0Track(),
    sourcePitchMarks: makePitchMarks(),
    diagnosticsCollector: (value) => diagnostics.push(value),
  });

  assert.ok(output);
  assert.equal(diagnostics[0]?.analysisPolicy.id, "voice_monophonic_v2");
  assert.equal(diagnostics[0]?.requestedAnalysisSource, "provided");
  assert.equal(diagnostics[0]?.analysisSource, "provided");
});

test("Legacy local policy never mixes provided Voice marks into its source plan", () => {
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];
  const common = {
    inputBuffer: makeInput(),
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: -12,
    analysisPolicy: "legacy_local" as const,
  };
  const withoutArtifacts = renderAudioClipTdPsolaV2Data(common);
  const withVoiceArtifacts = renderAudioClipTdPsolaV2Data({
    ...common,
    sourceF0Track: makeF0Track(),
    sourcePitchMarks: makePitchMarks(),
    diagnosticsCollector: (value) => diagnostics.push(value),
  });

  assert.ok(withoutArtifacts);
  assert.ok(withVoiceArtifacts);
  assert.deepEqual(withVoiceArtifacts.channels, withoutArtifacts.channels);
  assert.equal(diagnostics[0]?.analysisPolicy.id, "legacy_local");
  assert.equal(diagnostics[0]?.requestedAnalysisSource, "local");
  assert.equal(diagnostics[0]?.analysisSource, "local");
  assert.equal(diagnostics[0]?.reusedProvidedMarks, false);
  assert.equal(diagnostics[0]?.providedPitchRangePolicy, null);
});

test("source-native v2 cannot silently enable legacy LPC through preserveFormant", () => {
  const common = {
    inputBuffer: makeInput(),
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: 12,
    sourceF0Track: makeF0Track(),
    sourcePitchMarks: makePitchMarks(),
    analysisPolicy: "voice_monophonic_v2" as const,
  };
  const disabled = renderAudioClipTdPsolaV2Data({
    ...common,
    preserveFormant: false,
  });
  const requested = renderAudioClipTdPsolaV2Data({
    ...common,
    preserveFormant: true,
  });

  assert.ok(disabled);
  assert.ok(requested);
  assert.deepEqual(requested.channels, disabled.channels);
});

test("provided analysis rejects sub-minimum interpolation residue before synthesis", () => {
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];
  const f0 = makeF0Track();
  for (let index = 0; index < f0.f0_hz_x100.length; index++) {
    f0.f0_hz_x100[index] = 1;
    f0.voiced_prob_permille![index] = 1_000;
  }
  const output = renderAudioClipTdPsolaV2Data({
    inputBuffer: makeInput(),
    sourceInFrame: 0,
    sourceOutFrame: SOURCE_LENGTH,
    targetDurationSec: SOURCE_LENGTH / SAMPLE_RATE,
    totalPitchSemitones: 12,
    sourceF0Track: f0,
    sourcePitchMarks: null,
    analysisPolicy: "voice_monophonic_v2",
    diagnosticsCollector: (value) => diagnostics.push(value),
  });

  assert.ok(output);
  assert.equal(diagnostics[0]?.analysisSource, "provided");
  assert.ok(
    (diagnostics[0]?.providedPitchRangePolicy?.rejectedBelowMinimumFrames ?? 0) >= 1,
    JSON.stringify(diagnostics[0]?.providedPitchRangePolicy),
  );
  assert.equal(diagnostics[0]?.sourcePitchHz.minimum, 0);
  assert.equal(diagnostics[0]?.sourceMarkCount, 0);
  assert.equal(diagnostics[0]?.regionRender.renderedRegionCount, 0);
  assert.ok(output.channels.every((channel) => channel.every(Number.isFinite)));
});

test("trimmed clips retain source context and do not limit linear fallback", () => {
  const input = makeInput();
  for (let channelIndex = 0; channelIndex < input.channels.length; channelIndex++) {
    input.channels[channelIndex]!.fill(1.25, SOURCE_LENGTH / 2);
  }
  const f0 = makeF0Track();
  for (let index = 0; index < f0.f0_hz_x100.length; index++) {
    const frameCenter = index * f0.hop_src_frames + f0.hop_src_frames * 0.5;
    if (frameCenter >= SOURCE_LENGTH / 2) {
      f0.f0_hz_x100[index] = -1;
      f0.voiced_prob_permille![index] = 0;
    }
  }
  const marks = makePitchMarks();
  marks.marks_src_frames = marks.marks_src_frames.filter(
    (mark) => mark < SOURCE_LENGTH / 2,
  );
  const diagnostics: Parameters<NonNullable<
    Parameters<typeof renderAudioClipTdPsolaV2Data>[0]["diagnosticsCollector"]
  >>[0][] = [];

  const output = renderAudioClipTdPsolaV2Data({
    inputBuffer: input,
    sourceInFrame: 400,
    sourceOutFrame: SOURCE_LENGTH - 400,
    targetDurationSec: (SOURCE_LENGTH - 800) / SAMPLE_RATE,
    totalPitchSemitones: 12,
    sourceF0Track: f0,
    sourcePitchMarks: marks,
    analysisPolicy: "voice_monophonic_v2",
    diagnosticsCollector: (value) => diagnostics.push(value),
  });

  assert.ok(output);
  assert.ok((diagnostics[0]?.sourceContext.leftSamples ?? 0) > 0);
  assert.ok((diagnostics[0]?.sourceContext.rightSamples ?? 0) > 0);
  assert.equal(output.channels[0]?.[output.length - 1], 1.25);
});
