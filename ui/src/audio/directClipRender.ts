import type { AudioBufferData, AudioBufferSource } from "./audioBufferData.ts";
import {
  audioBufferDataToAudioBuffer,
  createAudioBufferData,
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
  getAudioBufferLength,
  getAudioBufferSampleRate,
} from "./audioBufferData.ts";
import type { ClipWarpPlan, PitchSegment } from "./pitchPlan.ts";
import { tickToSeconds } from "./playbackMath.ts";

const DIRECT_PITCH_EPSILON_SEMITONES = 0.01;
const DIRECT_PITCH_EPSILON_CENTS = 0.5;

export type ClipTdPsolaOperation =
  | "bypass"
  | "stretch_only"
  | "pitch_only"
  | "combined";

export interface ShouldBypassClipTdPsolaArgs {
  sourceInFrame: number;
  sourceOutFrame: number;
  sampleRate: number;
  targetDurationSec: number;
  totalPitchSemitones: number;
  pitchSegments?: PitchSegment[];
  warpPlan?: ClipWarpPlan;
  microBpm: number;
  ppq: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasAudiblePitchProcessing(
  totalPitchSemitones: number,
  pitchSegments?: PitchSegment[],
): boolean {
  if (Math.abs(totalPitchSemitones) >= DIRECT_PITCH_EPSILON_SEMITONES) {
    return true;
  }
  return pitchSegments?.some((segment) => Math.abs(segment.shiftCents) >= DIRECT_PITCH_EPSILON_CENTS) ??
    false;
}

function isDirectWarpPlan(warpPlan?: ClipWarpPlan): boolean {
  if (!warpPlan) {
    return true;
  }
  if (warpPlan.kind !== "linear" || warpPlan.segments.length !== 1) {
    return false;
  }

  const segment = warpPlan.segments[0]!;
  return segment.outputStartSample === 0 &&
    segment.sourceStartSample === 0 &&
    segment.outputEndSample > 0 &&
    segment.sourceEndSample > 0;
}

function getRoundedSourceFrameLength(sourceInFrame: number, sourceOutFrame: number): number {
  return Math.max(0, Math.round(sourceOutFrame) - Math.round(sourceInFrame));
}

function hasDirectCopyableTiming({
  sourceInFrame,
  sourceOutFrame,
  sampleRate,
  targetDurationSec,
  warpPlan,
  microBpm,
  ppq,
}: Pick<
  ShouldBypassClipTdPsolaArgs,
  "sourceInFrame" | "sourceOutFrame" | "sampleRate" | "targetDurationSec" | "warpPlan" | "microBpm" | "ppq"
>): boolean {
  if (sampleRate <= 0 || targetDurationSec <= 0) {
    return false;
  }
  if (!isDirectWarpPlan(warpPlan)) {
    return false;
  }

  const sourceFrames = getRoundedSourceFrameLength(sourceInFrame, sourceOutFrame);
  if (sourceFrames <= 0) {
    return false;
  }

  const sourceDurationSec = sourceFrames / sampleRate;
  const halfTickSec = tickToSeconds(1, microBpm, ppq) / 2;
  return Math.abs(sourceDurationSec - targetDurationSec) <= halfTickSec;
}

function hasExactPitchOnlyTiming({
  sourceInFrame,
  sourceOutFrame,
  sampleRate,
  targetDurationSec,
  warpPlan,
}: Pick<
  ShouldBypassClipTdPsolaArgs,
  "sourceInFrame" | "sourceOutFrame" | "sampleRate" | "targetDurationSec" | "warpPlan"
>): boolean {
  if (sampleRate <= 0 || targetDurationSec <= 0) {
    return false;
  }
  if (!isDirectWarpPlan(warpPlan)) {
    return false;
  }

  const sourceFrames = getRoundedSourceFrameLength(sourceInFrame, sourceOutFrame);
  if (sourceFrames <= 0) {
    return false;
  }

  const targetSamples = Math.max(1, Math.round(targetDurationSec * sampleRate));
  return targetSamples === sourceFrames;
}

export function classifyClipTdPsolaOperation(
  args: ShouldBypassClipTdPsolaArgs,
): ClipTdPsolaOperation {
  const hasPitch = hasAudiblePitchProcessing(args.totalPitchSemitones, args.pitchSegments);
  if (hasPitch) {
    return hasExactPitchOnlyTiming(args) ? "pitch_only" : "combined";
  }
  return hasDirectCopyableTiming(args) ? "bypass" : "stretch_only";
}

export function shouldBypassClipTdPsola(args: ShouldBypassClipTdPsolaArgs): boolean {
  return classifyClipTdPsolaOperation(args) === "bypass";
}

export function renderDirectClipBufferData(
  inputBuffer: AudioBufferSource,
  sourceInFrame: number,
  sourceOutFrame: number,
  targetDurationSec: number,
): AudioBufferData | null {
  if (targetDurationSec <= 0 || inputBuffer.length <= 0) {
    return null;
  }

  const sampleRate = getAudioBufferSampleRate(inputBuffer);
  const targetSamples = Math.max(1, Math.round(targetDurationSec * sampleRate));
  const inputLength = getAudioBufferLength(inputBuffer);
  const start = clamp(Math.round(sourceInFrame), 0, inputLength);
  const end = clamp(Math.round(sourceOutFrame), start, inputLength);
  const sourceLength = end - start;
  if (sourceLength <= 0) {
    return null;
  }

  const rendered = createAudioBufferData(
    getAudioBufferChannelCount(inputBuffer),
    targetSamples,
    sampleRate,
  );
  const copyLength = Math.min(sourceLength, targetSamples);
  for (let ch = 0; ch < getAudioBufferChannelCount(inputBuffer); ch++) {
    const destination = rendered.channels[ch];
    if (!destination) continue;
    destination.set(
      getAudioBufferChannelData(inputBuffer, ch).subarray(start, start + copyLength),
    );
  }
  return rendered;
}

export function renderDirectClipBuffer(
  context: BaseAudioContext,
  inputBuffer: AudioBufferSource,
  sourceInFrame: number,
  sourceOutFrame: number,
  targetDurationSec: number,
): AudioBuffer | null {
  const rendered = renderDirectClipBufferData(
    inputBuffer,
    sourceInFrame,
    sourceOutFrame,
    targetDurationSec,
  );
  return rendered ? audioBufferDataToAudioBuffer(context, rendered) : null;
}
