import type { ClipWarpPlan } from "../pitchPlan.ts";
import {
  mapOutputSampleToSourceSample,
  renderWarpedLinear,
} from "../tdpsolaWarp.ts";

const UNVOICED_HOP_SAMPLES = 512;
const TRANSIENT_ANALYSIS_HOP_SAMPLES = UNVOICED_HOP_SAMPLES / 2;
const TRANSIENT_SYNTHESIS_HOP_SAMPLES = Math.round(UNVOICED_HOP_SAMPLES * 0.75);
const ALIGNMENT_SEARCH_RADIUS_SAMPLES = 256;
const ALIGNMENT_SAMPLE_STRIDE = 4;
const MINIMUM_ALIGNMENT_CORRELATION = 0.2;

interface BaseGrain {
  outputCenterSample: number;
  sourceLeftSample: number;
  window: Float32Array;
}

interface RenderUnvoicedTimeStretchBaseArgs {
  sourceChannels: readonly Float32Array[];
  /** Index in each source channel that corresponds to clip-local source sample 0. */
  sourceOffsetSamples?: number;
  warpPlan: ClipWarpPlan;
  outputLength: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isIdentityWarp(warpPlan: ClipWarpPlan, outputLength: number): boolean {
  if (warpPlan.segments.length === 0) return false;
  const last = warpPlan.segments[warpPlan.segments.length - 1]!;
  if (last.sourceEndSample !== outputLength || last.outputEndSample !== outputLength) {
    return false;
  }
  return warpPlan.segments.every((segment) =>
    segment.outputStartSample === segment.sourceStartSample &&
    segment.outputEndSample === segment.sourceEndSample
  );
}

function buildWindow(length: number, squareRoot: boolean): Float32Array {
  const size = Math.max(32, Math.round(length));
  const window = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const phase = index / Math.max(1, size - 1);
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    window[index] = squareRoot ? Math.sqrt(Math.max(0, hann)) : hann;
  }
  return window;
}

function mixClipToMono(
  sourceChannels: readonly Float32Array[],
  sourceOffsetSamples: number,
  sourceLength: number,
): Float32Array {
  const mono = new Float32Array(sourceLength);
  const channelScale = 1 / sourceChannels.length;
  for (const channel of sourceChannels) {
    for (let index = 0; index < sourceLength; index++) {
      mono[index] = (mono[index] ?? 0) +
        (channel[sourceOffsetSamples + index] ?? 0) * channelScale;
    }
  }
  return mono;
}

function buildTransientMask(samples: Float32Array): Uint8Array {
  const hop = TRANSIENT_ANALYSIS_HOP_SAMPLES;
  const frameLength = hop * 2;
  const frameCount = Math.max(1, Math.ceil(samples.length / hop));
  const positiveFlux = new Float32Array(frameCount);
  let meanFlux = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const start = frameIndex * hop;
    const end = Math.min(samples.length, start + frameLength);
    let flux = 0;
    for (let index = start; index < end; index++) {
      flux += Math.max(
        0,
        Math.abs(samples[index] ?? 0) - Math.abs(samples[index - hop] ?? 0),
      );
    }
    positiveFlux[frameIndex] = flux;
    meanFlux += flux;
  }

  meanFlux /= Math.max(1, frameCount);
  const threshold = Math.max(0.01, meanFlux * 2.5);
  const mask = new Uint8Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    if ((positiveFlux[frameIndex] ?? 0) < threshold) continue;
    mask[frameIndex] = 1;
    if (frameIndex > 0) mask[frameIndex - 1] = 1;
    if (frameIndex + 1 < frameCount) mask[frameIndex + 1] = 1;
  }
  return mask;
}

function isTransientAtSourceSample(mask: Uint8Array, sourceSample: number): boolean {
  const frameIndex = clamp(
    Math.floor(sourceSample / TRANSIENT_ANALYSIS_HOP_SAMPLES),
    0,
    Math.max(0, mask.length - 1),
  );
  return mask[frameIndex] === 1;
}

function selectAlignedSourceCenter(args: {
  monoSource: Float32Array;
  expectedSourceCenter: number;
  previousSourceCenter: number;
  outputCenterAdvance: number;
  halfWindow: number;
}): number {
  const {
    monoSource,
    expectedSourceCenter,
    previousSourceCenter,
    outputCenterAdvance,
    halfWindow,
  } = args;
  const maximumCenter = Math.max(0, monoSource.length - 1);
  const expected = clamp(Math.round(expectedSourceCenter), 0, maximumCenter);
  if (previousSourceCenter >= maximumCenter) return maximumCenter;

  const searchStart = clamp(
    expected - ALIGNMENT_SEARCH_RADIUS_SAMPLES,
    previousSourceCenter + 1,
    maximumCenter,
  );
  const searchEnd = clamp(
    expected + ALIGNMENT_SEARCH_RADIUS_SAMPLES,
    searchStart,
    maximumCenter,
  );
  const relativeStart = -halfWindow;
  const relativeEnd = halfWindow - outputCenterAdvance;
  if (relativeEnd <= relativeStart) return expected;

  let bestCenter = expected;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let candidate = searchStart; candidate <= searchEnd; candidate++) {
    let dot = 0;
    let previousEnergy = 0;
    let candidateEnergy = 0;
    let sampleCount = 0;
    for (
      let relative = relativeStart;
      relative < relativeEnd;
      relative += ALIGNMENT_SAMPLE_STRIDE
    ) {
      const previousIndex = previousSourceCenter + outputCenterAdvance + relative;
      const candidateIndex = candidate + relative;
      if (
        previousIndex < 0 ||
        previousIndex >= monoSource.length ||
        candidateIndex < 0 ||
        candidateIndex >= monoSource.length
      ) {
        continue;
      }
      const previous = monoSource[previousIndex] ?? 0;
      const current = monoSource[candidateIndex] ?? 0;
      dot += previous * current;
      previousEnergy += previous * previous;
      candidateEnergy += current * current;
      sampleCount++;
    }
    if (sampleCount < 16 || previousEnergy <= 1e-9 || candidateEnergy <= 1e-9) {
      continue;
    }
    const correlation = dot / Math.sqrt(previousEnergy * candidateEnergy);
    const deviationPenalty = 0.03 *
      Math.abs(candidate - expected) / ALIGNMENT_SEARCH_RADIUS_SAMPLES;
    const score = correlation - deviationPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCorrelation = correlation;
      bestCenter = candidate;
    }
  }
  return bestCorrelation >= MINIMUM_ALIGNMENT_CORRELATION ? bestCenter : expected;
}

function buildBaseSchedule(
  monoSource: Float32Array,
  warpPlan: ClipWarpPlan,
  outputLength: number,
): BaseGrain[] {
  const transientMask = buildTransientMask(monoSource);
  const unvoicedWindow = buildWindow(UNVOICED_HOP_SAMPLES * 3, false);
  const transientWindow = buildWindow(TRANSIENT_SYNTHESIS_HOP_SAMPLES * 4, true);
  const grains: BaseGrain[] = [];
  let outputCenterSample = 0;
  let previousOutputCenterSample: number | null = null;
  let previousSourceCenterSample: number | null = null;

  while (outputCenterSample < outputLength) {
    const expectedSourceCenter = mapOutputSampleToSourceSample(
      outputCenterSample,
      warpPlan,
    );
    const transient = isTransientAtSourceSample(transientMask, expectedSourceCenter);
    const window = transient ? transientWindow : unvoicedWindow;
    const sourceCenterSample: number = !transient &&
        previousOutputCenterSample !== null &&
        previousSourceCenterSample !== null
      ? selectAlignedSourceCenter({
          monoSource,
          expectedSourceCenter,
          previousSourceCenter: previousSourceCenterSample,
          outputCenterAdvance: outputCenterSample - previousOutputCenterSample,
          halfWindow: Math.floor(window.length / 2),
        })
      : clamp(Math.round(expectedSourceCenter), 0, Math.max(0, monoSource.length - 1));
    grains.push({
      outputCenterSample,
      sourceLeftSample: sourceCenterSample - Math.floor(window.length / 2),
      window,
    });
    previousOutputCenterSample = outputCenterSample;
    previousSourceCenterSample = sourceCenterSample;
    outputCenterSample += transient
      ? TRANSIENT_SYNTHESIS_HOP_SAMPLES
      : UNVOICED_HOP_SAMPLES;
  }
  return grains;
}

function renderChannel(
  source: Float32Array,
  sourceOffsetSamples: number,
  outputLength: number,
  grains: readonly BaseGrain[],
  linearFallback: Float32Array,
): Float32Array {
  const accumulated = new Float32Array(outputLength);
  const weights = new Float32Array(outputLength);

  for (const grain of grains) {
    const halfWindow = Math.floor(grain.window.length / 2);
    const outputStartSample = grain.outputCenterSample - halfWindow;
    for (let windowIndex = 0; windowIndex < grain.window.length; windowIndex++) {
      const outputSample = outputStartSample + windowIndex;
      const sourceSample = sourceOffsetSamples + grain.sourceLeftSample + windowIndex;
      if (
        outputSample < 0 ||
        outputSample >= outputLength ||
        sourceSample < 0 ||
        sourceSample >= source.length
      ) {
        continue;
      }
      const weight = grain.window[windowIndex] ?? 0;
      accumulated[outputSample] = (accumulated[outputSample] ?? 0) +
        (source[sourceSample] ?? 0) * weight;
      weights[outputSample] = (weights[outputSample] ?? 0) + weight;
    }
  }

  const output = new Float32Array(outputLength);
  for (let sample = 0; sample < outputLength; sample++) {
    const weight = weights[sample] ?? 0;
    output[sample] = weight > 1e-6
      ? (accumulated[sample] ?? 0) / weight
      : (linearFallback[sample] ?? 0);
  }
  return output;
}

/**
 * Render the non-voiced base with unit-step waveform grains. Warp changes the
 * source cursor between grains, never the read rate inside a grain, so blue
 * stretch keeps the source spectrum. One schedule is shared by all channels.
 */
export function renderUnvoicedTimeStretchBase(
  args: RenderUnvoicedTimeStretchBaseArgs,
): Float32Array[] {
  const {
    sourceChannels,
    sourceOffsetSamples = 0,
    warpPlan,
    outputLength,
  } = args;
  const sourceLength = Math.max(
    0,
    ...warpPlan.segments.map((segment) => segment.sourceEndSample),
  );
  const clipSources = sourceChannels.map((source) =>
    source.subarray(sourceOffsetSamples, sourceOffsetSamples + sourceLength)
  );
  if (isIdentityWarp(warpPlan, outputLength)) {
    return clipSources.map((source) => source.slice());
  }

  const monoSource = mixClipToMono(sourceChannels, sourceOffsetSamples, sourceLength);
  const schedule = buildBaseSchedule(monoSource, warpPlan, outputLength);
  return sourceChannels.map((source, channelIndex) =>
    renderChannel(
      source,
      sourceOffsetSamples,
      outputLength,
      schedule,
      renderWarpedLinear(clipSources[channelIndex]!, outputLength, warpPlan),
    )
  );
}
