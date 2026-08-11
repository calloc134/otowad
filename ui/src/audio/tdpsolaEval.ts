export interface TargetFundamentalEvaluationOptions {
  searchRangeCents?: number;
  searchSteps?: number;
  centralRatio?: number;
}

export interface TargetFundamentalEvaluation {
  targetF0Hz: number;
  estimatedF0Hz: number;
  centsError: number;
  amplitude: number;
  acRms: number;
  amplitudeToAcRmsRatio: number;
}

export interface HarmonicSpectralEnvelopeOptions {
  centerFrequenciesHz?: readonly number[];
  bandwidthOctaves?: number;
  centralRatio?: number;
  maximumFrequencyHz?: number;
}

export interface HarmonicSpectralEnvelope {
  centerFrequenciesHz: number[];
  normalizedDb: number[];
}

export interface HarmonicSpectralEnvelopeDistanceArgs {
  reference: Float32Array;
  referenceF0Hz: number;
  candidate: Float32Array;
  candidateF0Hz: number;
  sampleRate: number;
  options?: HarmonicSpectralEnvelopeOptions;
}

const DEFAULT_ENVELOPE_CENTERS_HZ = [
  250, 350, 500, 700, 1_000, 1_400, 2_000, 2_800, 4_000, 5_600, 7_800,
] as const;

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function resolveCentralBounds(length: number, centralRatio: number): [number, number] {
  if (!Number.isFinite(centralRatio) || centralRatio <= 0 || centralRatio > 1) {
    throw new RangeError("centralRatio must be in (0, 1]");
  }
  const margin = Math.floor(length * (1 - centralRatio) / 2);
  return [margin, Math.max(margin + 1, length - margin)];
}

function measureAcRms(samples: Float32Array, centralRatio: number): number {
  if (samples.length === 0) return 0;
  const [start, end] = resolveCentralBounds(samples.length, centralRatio);
  let mean = 0;
  for (let index = start; index < end; index++) mean += samples[index] ?? 0;
  mean /= end - start;
  let energy = 0;
  for (let index = start; index < end; index++) {
    const centered = (samples[index] ?? 0) - mean;
    energy += centered * centered;
  }
  return Math.sqrt(energy / (end - start));
}

/** Measure one sinusoidal component with a central Hann-weighted projection. */
export function measureSinusoidAmplitude(
  samples: Float32Array,
  sampleRate: number,
  frequencyHz: number,
  centralRatio = 0.8,
): number {
  assertFinitePositive(sampleRate, "sampleRate");
  assertFinitePositive(frequencyHz, "frequencyHz");
  if (frequencyHz >= sampleRate / 2) return 0;
  if (samples.length < 2) return 0;

  const [start, end] = resolveCentralBounds(samples.length, centralRatio);
  const length = end - start;
  let real = 0;
  let imaginary = 0;
  let weightSum = 0;
  for (let index = start; index < end; index++) {
    const localIndex = index - start;
    const weight = length > 1
      ? 0.5 - 0.5 * Math.cos((2 * Math.PI * localIndex) / (length - 1))
      : 1;
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    const sample = samples[index] ?? 0;
    real += sample * weight * Math.cos(phase);
    imaginary -= sample * weight * Math.sin(phase);
    weightSum += weight;
  }
  return weightSum > 0 ? Math.hypot(real, imaginary) / weightSum * 2 : 0;
}

/**
 * Search only around an already-known target F0.
 *
 * This is an acceptance measurement, not a general-purpose pitch detector:
 * it prevents a strong source harmonic or an identity render from being
 * mistaken for the requested fundamental.
 */
export function evaluateTargetFundamental(
  samples: Float32Array,
  sampleRate: number,
  targetF0Hz: number,
  options: TargetFundamentalEvaluationOptions = {},
): TargetFundamentalEvaluation {
  assertFinitePositive(sampleRate, "sampleRate");
  assertFinitePositive(targetF0Hz, "targetF0Hz");
  const searchRangeCents = options.searchRangeCents ?? 100;
  const searchSteps = options.searchSteps ?? 48;
  const centralRatio = options.centralRatio ?? 0.8;
  if (!Number.isFinite(searchRangeCents) || searchRangeCents < 0) {
    throw new RangeError("searchRangeCents must be finite and non-negative");
  }
  if (!Number.isInteger(searchSteps) || searchSteps < 1) {
    throw new RangeError("searchSteps must be a positive integer");
  }

  let estimatedF0Hz = targetF0Hz;
  let amplitude = 0;
  for (let step = 0; step <= searchSteps; step++) {
    const cents = -searchRangeCents + (2 * searchRangeCents * step) / searchSteps;
    const frequencyHz = targetF0Hz * 2 ** (cents / 1_200);
    const candidateAmplitude = measureSinusoidAmplitude(
      samples,
      sampleRate,
      frequencyHz,
      centralRatio,
    );
    if (candidateAmplitude > amplitude) {
      amplitude = candidateAmplitude;
      estimatedF0Hz = frequencyHz;
    }
  }

  const acRms = measureAcRms(samples, centralRatio);
  return {
    targetF0Hz,
    estimatedF0Hz,
    centsError: 1_200 * Math.log2(estimatedF0Hz / targetF0Hz),
    amplitude,
    acRms,
    amplitudeToAcRmsRatio: acRms > 1e-12 ? amplitude / (Math.SQRT2 * acRms) : 0,
  };
}

/** Gain-normalized waveform difference; zero means identity up to one gain. */
export function normalizedWaveformDifference(
  reference: Float32Array,
  candidate: Float32Array,
  centralRatio = 0.8,
): number {
  const length = Math.min(reference.length, candidate.length);
  if (length === 0) return 0;
  const [start, end] = resolveCentralBounds(length, centralRatio);
  let referenceEnergy = 0;
  let candidateEnergy = 0;
  let crossEnergy = 0;
  for (let index = start; index < end; index++) {
    const left = reference[index] ?? 0;
    const right = candidate[index] ?? 0;
    referenceEnergy += left * left;
    candidateEnergy += right * right;
    crossEnergy += left * right;
  }
  if (referenceEnergy <= 1e-20) return candidateEnergy <= 1e-20 ? 0 : 1;
  const candidateGain = candidateEnergy > 1e-20 ? crossEnergy / candidateEnergy : 0;
  let errorEnergy = 0;
  for (let index = start; index < end; index++) {
    const difference = (reference[index] ?? 0) - candidateGain * (candidate[index] ?? 0);
    errorEnergy += difference * difference;
  }
  return Math.sqrt(errorEnergy / referenceEnergy);
}

export function measureHarmonicSpectralEnvelope(
  samples: Float32Array,
  sampleRate: number,
  fundamentalHz: number,
  options: HarmonicSpectralEnvelopeOptions = {},
): HarmonicSpectralEnvelope {
  assertFinitePositive(sampleRate, "sampleRate");
  assertFinitePositive(fundamentalHz, "fundamentalHz");
  const centralRatio = options.centralRatio ?? 0.8;
  const bandwidthOctaves = options.bandwidthOctaves ?? 0.38;
  assertFinitePositive(bandwidthOctaves, "bandwidthOctaves");
  const maximumFrequencyHz = Math.min(
    options.maximumFrequencyHz ?? 8_000,
    sampleRate * 0.45,
  );
  assertFinitePositive(maximumFrequencyHz, "maximumFrequencyHz");
  const centerFrequenciesHz = [...(
    options.centerFrequenciesHz ?? DEFAULT_ENVELOPE_CENTERS_HZ
  )].filter((frequencyHz) => frequencyHz < maximumFrequencyHz);
  if (centerFrequenciesHz.length < 2) {
    throw new RangeError("at least two spectral-envelope centers are required");
  }
  for (const frequencyHz of centerFrequenciesHz) {
    assertFinitePositive(frequencyHz, "centerFrequenciesHz entry");
  }

  const harmonics: Array<{ frequencyHz: number; power: number }> = [];
  for (
    let harmonic = 1, frequencyHz = fundamentalHz;
    frequencyHz <= maximumFrequencyHz;
    harmonic++, frequencyHz = harmonic * fundamentalHz
  ) {
    const amplitude = measureSinusoidAmplitude(
      samples,
      sampleRate,
      frequencyHz,
      centralRatio,
    );
    harmonics.push({ frequencyHz, power: amplitude * amplitude });
  }

  const sigma = bandwidthOctaves * Math.LN2;
  const rawDb = centerFrequenciesHz.map((centerHz) => {
    let weightedPower = 0;
    let weightSum = 0;
    for (const harmonic of harmonics) {
      const logDistance = Math.log(harmonic.frequencyHz / centerHz);
      const weight = Math.exp(-0.5 * (logDistance / sigma) ** 2);
      weightedPower += harmonic.power * weight;
      weightSum += weight;
    }
    return 10 * Math.log10(Math.max(1e-12, weightedPower / Math.max(weightSum, 1e-12)));
  });
  const meanDb = rawDb.reduce((sum, value) => sum + value, 0) / rawDb.length;
  return {
    centerFrequenciesHz,
    normalizedDb: rawDb.map((value) => value - meanDb),
  };
}

export function harmonicSpectralEnvelopeDistanceDb({
  reference,
  referenceF0Hz,
  candidate,
  candidateF0Hz,
  sampleRate,
  options,
}: HarmonicSpectralEnvelopeDistanceArgs): number {
  const referenceEnvelope = measureHarmonicSpectralEnvelope(
    reference,
    sampleRate,
    referenceF0Hz,
    options,
  );
  const candidateEnvelope = measureHarmonicSpectralEnvelope(
    candidate,
    sampleRate,
    candidateF0Hz,
    {
      ...options,
      centerFrequenciesHz: referenceEnvelope.centerFrequenciesHz,
    },
  );
  const squaredDistance = referenceEnvelope.normalizedDb.reduce((sum, value, index) => {
    const difference = value - (candidateEnvelope.normalizedDb[index] ?? 0);
    return sum + difference * difference;
  }, 0);
  return Math.sqrt(squaredDistance / referenceEnvelope.normalizedDb.length);
}
