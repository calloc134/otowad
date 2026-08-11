import { getStereoPannerCoefficients } from "./trackMix.ts";

export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferData {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  readonly channels: Float32Array[];
}

export type AudioBufferSource = AudioBufferLike | AudioBufferData;

export interface MixAudioBufferIntoTargetOptions {
  source: AudioBufferSource;
  target: AudioBufferData;
  targetStartSample: number;
  sourceOffsetSec?: number;
  durationSec?: number;
  gain?: number;
  stereoPan?: number;
}

function isAudioBufferData(buffer: AudioBufferSource): buffer is AudioBufferData {
  return "channels" in buffer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getAudioBufferChannelCount(buffer: AudioBufferSource): number {
  return buffer.numberOfChannels;
}

export function getAudioBufferSampleRate(buffer: AudioBufferSource): number {
  return buffer.sampleRate;
}

export function getAudioBufferLength(buffer: AudioBufferSource): number {
  return buffer.length;
}

export function getAudioBufferChannelData(
  buffer: AudioBufferSource,
  channel: number,
): Float32Array {
  if (isAudioBufferData(buffer)) {
    return buffer.channels[channel] ?? new Float32Array(buffer.length);
  }
  return buffer.getChannelData(channel);
}

export function createAudioBufferData(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBufferData {
  const resolvedLength = Math.max(0, Math.round(length));
  return {
    numberOfChannels: Math.max(1, Math.round(numberOfChannels)),
    sampleRate: Math.max(1, Math.round(sampleRate)),
    length: resolvedLength,
    channels: Array.from(
      { length: Math.max(1, Math.round(numberOfChannels)) },
      () => new Float32Array(resolvedLength),
    ),
  };
}

export function cloneAudioBufferSource(buffer: AudioBufferSource): AudioBufferData {
  const numberOfChannels = getAudioBufferChannelCount(buffer);
  const length = getAudioBufferLength(buffer);
  const sampleRate = getAudioBufferSampleRate(buffer);
  return {
    numberOfChannels,
    sampleRate,
    length,
    channels: Array.from(
      { length: numberOfChannels },
      (_, channel) => Float32Array.from(getAudioBufferChannelData(buffer, channel)),
    ),
  };
}

export function cloneAudioBufferData(buffer: AudioBufferData): AudioBufferData {
  return {
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    channels: buffer.channels.map((channel) => Float32Array.from(channel)),
  };
}

export function resampleAudioBufferData(
  source: AudioBufferSource,
  targetSampleRate: number,
): AudioBufferData {
  const sourceSampleRate = getAudioBufferSampleRate(source);
  const resolvedSampleRate = Math.max(1, Math.round(targetSampleRate));
  if (sourceSampleRate <= 0) {
    return createAudioBufferData(
      getAudioBufferChannelCount(source),
      0,
      resolvedSampleRate,
    );
  }
  const targetLength = Math.ceil(
    getAudioBufferLength(source) / sourceSampleRate * resolvedSampleRate,
  );
  const target = createAudioBufferData(
    getAudioBufferChannelCount(source),
    targetLength,
    resolvedSampleRate,
  );
  mixAudioBufferIntoTarget({ source, target, targetStartSample: 0 });
  return target;
}

export function audioBufferDataToAudioBuffer(
  context: BaseAudioContext,
  buffer: AudioBufferData,
): AudioBuffer {
  const audioBuffer = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = Float32Array.from(
      buffer.channels[channel] ?? new Float32Array(buffer.length),
    );
    if ("copyToChannel" in audioBuffer && typeof audioBuffer.copyToChannel === "function") {
      audioBuffer.copyToChannel(channelData, channel);
    } else {
      audioBuffer.getChannelData(channel).set(channelData);
    }
  }
  return audioBuffer;
}

export function collectAudioBufferTransferables(buffer: AudioBufferData): Transferable[] {
  return buffer.channels.map((channel) => channel.buffer as ArrayBuffer);
}

function interpolateSample(channelData: Float32Array, position: number): number {
  if (channelData.length === 0) return 0;
  if (channelData.length === 1) return channelData[0] ?? 0;

  const clamped = clamp(position, 0, channelData.length - 1);
  const left = Math.floor(clamped);
  const right = Math.min(channelData.length - 1, left + 1);
  const fraction = clamped - left;
  const leftSample = channelData[left] ?? 0;
  const rightSample = channelData[right] ?? leftSample;
  return leftSample + (rightSample - leftSample) * fraction;
}

function readSourceSample(
  source: AudioBufferSource,
  sourcePosition: number,
  targetChannel: number,
  targetChannelCount: number,
): number {
  const sourceChannelCount = getAudioBufferChannelCount(source);
  if (sourceChannelCount <= 0) {
    return 0;
  }

  if (sourceChannelCount === 1 && targetChannelCount > 1) {
    return interpolateSample(getAudioBufferChannelData(source, 0), sourcePosition);
  }

  if (targetChannelCount === 1 && sourceChannelCount > 1) {
    let sum = 0;
    for (let sourceChannel = 0; sourceChannel < sourceChannelCount; sourceChannel++) {
      sum += interpolateSample(
        getAudioBufferChannelData(source, sourceChannel),
        sourcePosition,
      );
    }
    return sum / sourceChannelCount;
  }

  const sourceChannel = Math.min(targetChannel, sourceChannelCount - 1);
  return interpolateSample(getAudioBufferChannelData(source, sourceChannel), sourcePosition);
}

export function mixAudioBufferIntoTarget({
  source,
  target,
  targetStartSample,
  sourceOffsetSec = 0,
  durationSec,
  gain = 1,
  stereoPan,
}: MixAudioBufferIntoTargetOptions): void {
  const sourceSampleRate = getAudioBufferSampleRate(source);
  const sourceLength = getAudioBufferLength(source);
  const targetSampleRate = target.sampleRate;
  if (sourceSampleRate <= 0 || targetSampleRate <= 0 || sourceLength <= 0) {
    return;
  }

  const startSample = Math.max(0, Math.round(targetStartSample));
  if (startSample >= target.length) {
    return;
  }

  const sourceStartSample = Math.max(0, sourceOffsetSec * sourceSampleRate);
  const sourceRemainingSamples = Math.max(0, sourceLength - sourceStartSample);
  if (sourceRemainingSamples <= 0) {
    return;
  }

  const requestedTargetSamples = durationSec === undefined
    ? Math.ceil((sourceRemainingSamples / sourceSampleRate) * targetSampleRate)
    : Math.max(0, Math.round(durationSec * targetSampleRate));
  if (requestedTargetSamples <= 0) {
    return;
  }

  const writableSamples = Math.min(requestedTargetSamples, target.length - startSample);
  const sourceStep = sourceSampleRate / targetSampleRate;
  const useStereoPanner = stereoPan !== undefined && target.numberOfChannels >= 2;
  const sourceChannelCount = getAudioBufferChannelCount(source);
  const pannerCoefficients = useStereoPanner
    ? getStereoPannerCoefficients(stereoPan, sourceChannelCount === 1 ? 1 : 2)
    : null;
  const sourceLeft = pannerCoefficients
    ? getAudioBufferChannelData(source, 0)
    : null;
  const sourceRight = pannerCoefficients && sourceChannelCount > 1
    ? getAudioBufferChannelData(source, 1)
    : null;
  for (let sampleOffset = 0; sampleOffset < writableSamples; sampleOffset++) {
    const sourcePosition = sourceStartSample + sampleOffset * sourceStep;
    if (sourcePosition >= sourceLength - 1) {
      if (sourcePosition > sourceLength - 1) {
        break;
      }
    }

    const targetIndex = startSample + sampleOffset;
    if (pannerCoefficients && sourceLeft) {
      const inputLeft = interpolateSample(sourceLeft, sourcePosition);
      const inputRight = sourceRight
        ? interpolateSample(sourceRight, sourcePosition)
        : 0;
      const targetLeft = target.channels[0];
      const targetRight = target.channels[1];
      if (targetLeft) {
        targetLeft[targetIndex] = (targetLeft[targetIndex] ?? 0) + gain * (
          inputLeft * pannerCoefficients.leftFromLeft +
          inputRight * pannerCoefficients.leftFromRight
        );
      }
      if (targetRight) {
        targetRight[targetIndex] = (targetRight[targetIndex] ?? 0) + gain * (
          inputLeft * pannerCoefficients.rightFromLeft +
          inputRight * pannerCoefficients.rightFromRight
        );
      }
      continue;
    }

    for (let channel = 0; channel < target.numberOfChannels; channel++) {
      const targetChannelData = target.channels[channel];
      if (!targetChannelData) continue;
      targetChannelData[targetIndex] = (targetChannelData[targetIndex] ?? 0) +
        readSourceSample(source, sourcePosition, channel, target.numberOfChannels) * gain;
    }
  }
}
