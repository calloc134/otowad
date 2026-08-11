import type { ClipWarpPlan, WarpSegment } from "./pitchPlan.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function slicePitchMarks(
  marks: number[] | undefined,
  startSample: number,
  endSample: number,
): number[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const sliced = marks
    .filter((mark) => mark >= startSample && mark < endSample)
    .map((mark) => mark - startSample);
  return sliced.length > 0 ? sliced : undefined;
}

export function localPitchMarksFromArtifact(
  marks: number[] | undefined,
  startSample: number,
  endSample: number,
): number[] | undefined {
  return slicePitchMarks(marks, startSample, endSample);
}

export function normalizeWarpPlan(
  warpPlan: ClipWarpPlan | undefined,
  sourceLength: number,
  targetLength: number,
): ClipWarpPlan {
  const fallback: ClipWarpPlan = {
    kind: "linear",
    segments: [{
      outputStartSample: 0,
      outputEndSample: targetLength,
      sourceStartSample: 0,
      sourceEndSample: sourceLength,
    }],
  };
  if (!warpPlan || warpPlan.segments.length === 0) {
    return fallback;
  }

  const segments = [...warpPlan.segments]
    .map((segment) => ({
      outputStartSample: clamp(Math.round(segment.outputStartSample), 0, targetLength),
      outputEndSample: clamp(Math.round(segment.outputEndSample), 0, targetLength),
      sourceStartSample: clamp(Math.round(segment.sourceStartSample), 0, sourceLength),
      sourceEndSample: clamp(Math.round(segment.sourceEndSample), 0, sourceLength),
    }))
    .filter((segment) =>
      segment.outputEndSample > segment.outputStartSample &&
      segment.sourceEndSample >= segment.sourceStartSample
    )
    .sort((left, right) =>
      left.outputStartSample - right.outputStartSample ||
      left.sourceStartSample - right.sourceStartSample
    );

  return segments.length > 0 ? { kind: warpPlan.kind, segments } : fallback;
}

export function mapOutputSampleToSourceSample(
  outputSample: number,
  warpPlan: ClipWarpPlan,
): number {
  const segments = warpPlan.segments;
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1]!;
  const clampedOutput = clamp(outputSample, 0, last.outputEndSample);

  let segment = segments[0]!;
  for (const candidate of segments) {
    segment = candidate;
    if (clampedOutput < candidate.outputEndSample || candidate === last) {
      break;
    }
  }

  const outputSpan = segment.outputEndSample - segment.outputStartSample;
  if (outputSpan <= 0) {
    return segment.sourceEndSample;
  }
  const t = clamp((clampedOutput - segment.outputStartSample) / outputSpan, 0, 1);
  return segment.sourceStartSample +
    (segment.sourceEndSample - segment.sourceStartSample) * t;
}

export function mapSourceSampleToOutputSample(
  sourceSample: number,
  warpPlan: ClipWarpPlan,
): number {
  const segments = warpPlan.segments;
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1]!;
  const clampedSource = clamp(sourceSample, 0, last.sourceEndSample);

  let segment = segments[0]!;
  for (const candidate of segments) {
    segment = candidate;
    if (clampedSource < candidate.sourceEndSample || candidate === last) {
      break;
    }
  }

  const sourceSpan = segment.sourceEndSample - segment.sourceStartSample;
  if (sourceSpan <= 0) {
    return segment.outputEndSample;
  }
  const t = clamp((clampedSource - segment.sourceStartSample) / sourceSpan, 0, 1);
  return segment.outputStartSample +
    (segment.outputEndSample - segment.outputStartSample) * t;
}

export function intersectWarpPlanWithSourceRange(
  startSample: number,
  endSample: number,
  warpPlan: ClipWarpPlan,
): WarpSegment[] {
  const pieces: WarpSegment[] = [];
  for (const segment of warpPlan.segments) {
    const sourceStartSample = Math.max(startSample, segment.sourceStartSample);
    const sourceEndSample = Math.min(endSample, segment.sourceEndSample);
    if (sourceEndSample <= sourceStartSample) continue;

    pieces.push({
      sourceStartSample,
      sourceEndSample,
      outputStartSample: mapSourceSampleToOutputSample(sourceStartSample, warpPlan),
      outputEndSample: mapSourceSampleToOutputSample(sourceEndSample, warpPlan),
    });
  }

  return pieces
    .filter((piece) => piece.outputEndSample > piece.outputStartSample)
    .sort((left, right) => left.outputStartSample - right.outputStartSample);
}

export function renderWarpedLinear(
  input: Float32Array,
  targetLength: number,
  warpPlan: ClipWarpPlan,
): Float32Array {
  const outLength = Math.max(1, Math.round(targetLength));
  const output = new Float32Array(outLength);
  if (input.length === 0) {
    return output;
  }
  if (input.length === 1) {
    output.fill(input[0] ?? 0);
    return output;
  }

  for (let i = 0; i < outLength; i++) {
    const sourcePos = mapOutputSampleToSourceSample(i, warpPlan);
    const left = clamp(Math.floor(sourcePos), 0, input.length - 1);
    const right = clamp(left + 1, 0, input.length - 1);
    const frac = clamp(sourcePos - left, 0, 1);
    const l = input[left] ?? 0;
    const r = input[right] ?? l;
    output[i] = l + (r - l) * frac;
  }
  return output;
}
