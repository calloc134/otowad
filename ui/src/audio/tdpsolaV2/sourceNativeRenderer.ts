import type {
  RenderSourceNativePlanArgs,
  SourceNativeRendererDiagnostics,
  SourceNativeRenderResult,
  SourceNativeSynthesisMark,
  SourceNativeSynthesisPlan,
} from "./types.ts";

interface GrainDescriptor {
  mark: SourceNativeSynthesisMark;
  leftSpanSamples: number;
  rightSpanSamples: number;
  outputStartSample: number;
  outputEndSample: number;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function validateRendererInputs(
  source: Float32Array,
  sourceMarks: readonly number[],
  plan: SourceNativeSynthesisPlan,
): void {
  assertPositiveInteger(plan.outputEndSample - plan.outputStartSample, "output length");
  if (!Number.isInteger(plan.outputStartSample) || !Number.isInteger(plan.outputEndSample)) {
    throw new RangeError("renderer output bounds must be integer sample positions");
  }
  if (source.length === 0) {
    throw new RangeError("source must contain at least one sample");
  }
  if (sourceMarks.length < 2) {
    throw new RangeError("sourceMarks must contain at least two marks");
  }

  let previousOutputCenter = Number.NEGATIVE_INFINITY;
  for (const mark of plan.marks) {
    if (mark.outputCenterSample <= previousOutputCenter) {
      throw new RangeError("plan output centers must be strictly increasing");
    }
    if (mark.sourceMarkIndex < 0 || mark.sourceMarkIndex >= sourceMarks.length) {
      throw new RangeError("plan contains a source mark index outside sourceMarks");
    }
    if (sourceMarks[mark.sourceMarkIndex] !== mark.sourceCenterSample) {
      throw new RangeError("plan source centers must match sourceMarks");
    }
    previousOutputCenter = mark.outputCenterSample;
  }
}

function resolveAdjacentSpans(
  sourceMarks: readonly number[],
  sourceMarkIndex: number,
): { leftSpanSamples: number; rightSpanSamples: number } {
  const center = sourceMarks[sourceMarkIndex]!;
  const leftSpanSamples = sourceMarkIndex > 0
    ? center - sourceMarks[sourceMarkIndex - 1]!
    : sourceMarks[1]! - center;
  const rightSpanSamples = sourceMarkIndex + 1 < sourceMarks.length
    ? sourceMarks[sourceMarkIndex + 1]! - center
    : center - sourceMarks[sourceMarkIndex - 1]!;
  if (leftSpanSamples <= 0 || rightSpanSamples <= 0) {
    throw new RangeError("sourceMarks must be strictly increasing");
  }
  return { leftSpanSamples, rightSpanSamples };
}

function buildGrainDescriptors(
  sourceMarks: readonly number[],
  plan: SourceNativeSynthesisPlan,
): GrainDescriptor[] {
  return plan.marks.map((mark) => {
    const adjacentSpans = resolveAdjacentSpans(
      sourceMarks,
      mark.sourceMarkIndex,
    );
    // A source-period Hann cancels a periodic carrier when synthesis marks
    // are closer than the source period (the exact-octave-up case collapses
    // to silence). Keep unit-step source reads, but contract each half-window
    // to the target period on pitch-up. At identity/down shifts the accepted
    // adjacent source periods remain the window support.
    const leftSpanSamples = Math.min(
      adjacentSpans.leftSpanSamples,
      mark.targetOutputPeriodSamples,
    );
    const rightSpanSamples = Math.min(
      adjacentSpans.rightSpanSamples,
      mark.targetOutputPeriodSamples,
    );
    return {
      mark,
      leftSpanSamples,
      rightSpanSamples,
      outputStartSample: Math.ceil(mark.outputCenterSample - leftSpanSamples),
      outputEndSample: Math.ceil(mark.outputCenterSample + rightSpanSamples),
    };
  });
}

function buildSuffixMinimumStarts(
  descriptors: readonly GrainDescriptor[],
  outputStartSample: number,
  outputEndSample: number,
): Int32Array {
  const suffix = new Int32Array(descriptors.length + 1);
  suffix[descriptors.length] = outputEndSample;
  for (let index = descriptors.length - 1; index >= 0; index--) {
    const descriptorStart = Math.max(
      outputStartSample,
      Math.min(outputEndSample, descriptors[index]!.outputStartSample),
    );
    suffix[index] = Math.min(descriptorStart, suffix[index + 1]!);
  }
  return suffix;
}

function halfHannWeight(
  outputSample: number,
  outputCenterSample: number,
  leftSpanSamples: number,
  rightSpanSamples: number,
): number {
  if (outputSample < outputCenterSample) {
    const phase = Math.max(
      0,
      Math.min(1, (outputSample - (outputCenterSample - leftSpanSamples)) / leftSpanSamples),
    );
    return 0.5 - 0.5 * Math.cos(Math.PI * phase);
  }
  const phase = Math.max(
    0,
    Math.min(1, (outputSample - outputCenterSample) / rightSpanSamples),
  );
  return 0.5 + 0.5 * Math.cos(Math.PI * phase);
}

function readSourceLinear(
  source: Float32Array,
  sourcePosition: number,
  sourceOffsetSamples: number,
  sourceBoundaryExtension: RenderSourceNativePlanArgs["sourceBoundaryExtension"],
): { sample: number; zeroPadded: boolean; periodicExtended: boolean } {
  let resolvedPosition = sourcePosition;
  let periodicExtended = false;
  if (sourcePosition < 0 || sourcePosition > source.length - 1) {
    const cycle = sourcePosition < 0
      ? sourceBoundaryExtension?.leftCycle
      : sourceBoundaryExtension?.rightCycle;
    if (!cycle) {
      return { sample: 0, zeroPadded: true, periodicExtended: false };
    }
    const cycleStart = sourceOffsetSamples + cycle.startSample;
    const cycleEnd = sourceOffsetSamples + cycle.endSample;
    const cycleLength = cycleEnd - cycleStart;
    const phase = ((sourcePosition - cycleStart) % cycleLength + cycleLength) % cycleLength;
    resolvedPosition = cycleStart + phase;
    periodicExtended = true;
  }
  const leftIndex = Math.floor(resolvedPosition);
  const rightIndex = Math.min(source.length - 1, leftIndex + 1);
  const fraction = resolvedPosition - leftIndex;
  const left = source[leftIndex] ?? 0;
  const right = source[rightIndex] ?? left;
  return {
    sample: left + (right - left) * fraction,
    zeroPadded: false,
    periodicExtended,
  };
}

function validateBoundaryExtension(
  sourceLength: number,
  sourceOffsetSamples: number,
  sourceBoundaryExtension: RenderSourceNativePlanArgs["sourceBoundaryExtension"],
): void {
  for (const cycle of [
    sourceBoundaryExtension?.leftCycle,
    sourceBoundaryExtension?.rightCycle,
  ]) {
    if (!cycle) continue;
    if (
      !Number.isFinite(cycle.startSample) ||
      !Number.isFinite(cycle.endSample) ||
      cycle.endSample <= cycle.startSample ||
      sourceOffsetSamples + cycle.startSample < 0 ||
      sourceOffsetSamples + cycle.endSample > sourceLength - 1
    ) {
      throw new RangeError("source boundary extension must reference a complete source cycle");
    }
  }
}

/**
 * Stateful one-channel renderer for a precomputed source-native mark plan.
 *
 * Each grain reads source samples at unit increments. Fractional synthesis
 * centers alter only the initial fractional source phase. Windowed audio is
 * accumulated into a real pending tail, and samples are committed only after
 * no future grain can reach them. No window-weight division is performed.
 */
export class SourceNativePendingTailRenderer {
  readonly diagnostics: SourceNativeRendererDiagnostics = {
    grainCount: 0,
    sourceReadStep: 1,
    maxPendingTailSamples: 0,
    zeroPaddedSourceReadCount: 0,
    periodicExtendedSourceReadCount: 0,
    committedOutputSamples: 0,
  };

  private readonly descriptors: GrainDescriptor[];
  private readonly suffixMinimumStarts: Int32Array;
  private readonly output: Float32Array;
  private readonly source: Float32Array;
  private readonly sourceOffsetSamples: number;
  private readonly sourceBoundaryExtension: RenderSourceNativePlanArgs["sourceBoundaryExtension"];
  private readonly plan: SourceNativeSynthesisPlan;
  private descriptorIndex = 0;
  private committedThroughSample: number;
  private readThroughSample: number;
  private pendingStartSample = 0;
  private pendingSamples = new Float64Array(0);

  constructor(
    source: Float32Array,
    sourceMarks: readonly number[],
    plan: SourceNativeSynthesisPlan,
    sourceOffsetSamples = 0,
    sourceBoundaryExtension?: RenderSourceNativePlanArgs["sourceBoundaryExtension"],
  ) {
    validateRendererInputs(source, sourceMarks, plan);
    this.source = source;
    this.sourceOffsetSamples = sourceOffsetSamples;
    this.sourceBoundaryExtension = sourceBoundaryExtension;
    this.plan = plan;
    this.descriptors = buildGrainDescriptors(sourceMarks, plan);
    this.suffixMinimumStarts = buildSuffixMinimumStarts(
      this.descriptors,
      plan.outputStartSample,
      plan.outputEndSample,
    );
    this.output = new Float32Array(plan.outputEndSample - plan.outputStartSample);
    this.committedThroughSample = plan.outputStartSample;
    this.readThroughSample = plan.outputStartSample;
  }

  get done(): boolean {
    return this.readThroughSample >= this.plan.outputEndSample;
  }

  pull(maxFrames: number): Float32Array {
    assertPositiveInteger(maxFrames, "maxFrames");
    if (this.done) return new Float32Array(0);

    const requestedEnd = Math.min(
      this.plan.outputEndSample,
      this.readThroughSample + maxFrames,
    );
    while (this.committedThroughSample < requestedEnd) {
      if (this.descriptorIndex < this.descriptors.length) {
        this.processNextGrain();
      } else {
        this.commitUntil(this.plan.outputEndSample);
      }
    }

    const availableEnd = Math.min(requestedEnd, this.committedThroughSample);
    const startIndex = this.readThroughSample - this.plan.outputStartSample;
    const endIndex = availableEnd - this.plan.outputStartSample;
    const block = this.output.slice(startIndex, endIndex);
    this.readThroughSample = availableEnd;
    return block;
  }

  private processNextGrain(): void {
    const descriptor = this.descriptors[this.descriptorIndex]!;
    this.addGrainToPendingTail(descriptor);
    this.descriptorIndex++;
    this.diagnostics.grainCount++;
    const safeCommitBoundary = this.suffixMinimumStarts[this.descriptorIndex]!;
    this.commitUntil(safeCommitBoundary);
  }

  private addGrainToPendingTail(descriptor: GrainDescriptor): void {
    const grainStart = Math.max(
      this.plan.outputStartSample,
      this.committedThroughSample,
      descriptor.outputStartSample,
    );
    const grainEnd = Math.min(this.plan.outputEndSample, descriptor.outputEndSample);
    if (grainEnd <= grainStart) return;

    const pendingEnd = this.pendingStartSample + this.pendingSamples.length;
    const mergedStart = this.pendingSamples.length === 0
      ? grainStart
      : Math.min(this.pendingStartSample, grainStart);
    const mergedEnd = Math.max(pendingEnd, grainEnd);
    const merged = new Float64Array(mergedEnd - mergedStart);
    if (this.pendingSamples.length > 0) {
      merged.set(this.pendingSamples, this.pendingStartSample - mergedStart);
    }

    for (let outputSample = grainStart; outputSample < grainEnd; outputSample++) {
      const sourcePosition = descriptor.mark.sourceCenterSample +
        (outputSample - descriptor.mark.outputCenterSample);
      const sourceRead = readSourceLinear(
        this.source,
        sourcePosition + this.sourceOffsetSamples,
        this.sourceOffsetSamples,
        this.sourceBoundaryExtension,
      );
      if (sourceRead.zeroPadded) {
        this.diagnostics.zeroPaddedSourceReadCount++;
      }
      if (sourceRead.periodicExtended) {
        this.diagnostics.periodicExtendedSourceReadCount++;
      }
      const windowWeight = halfHannWeight(
        outputSample,
        descriptor.mark.outputCenterSample,
        descriptor.leftSpanSamples,
        descriptor.rightSpanSamples,
      );
      const index = outputSample - mergedStart;
      merged[index] = (merged[index] ?? 0) +
        sourceRead.sample * windowWeight;
    }

    this.pendingStartSample = mergedStart;
    this.pendingSamples = merged;
    this.diagnostics.maxPendingTailSamples = Math.max(
      this.diagnostics.maxPendingTailSamples,
      merged.length,
    );
  }

  private commitUntil(boundarySample: number): void {
    const commitEnd = Math.max(
      this.committedThroughSample,
      Math.min(this.plan.outputEndSample, Math.floor(boundarySample)),
    );
    const pendingEnd = this.pendingStartSample + this.pendingSamples.length;
    for (
      let outputSample = this.committedThroughSample;
      outputSample < commitEnd;
      outputSample++
    ) {
      const pendingIndex = outputSample - this.pendingStartSample;
      const value = pendingIndex >= 0 && outputSample < pendingEnd
        ? this.pendingSamples[pendingIndex] ?? 0
        : 0;
      this.output[outputSample - this.plan.outputStartSample] = value;
    }
    this.committedThroughSample = commitEnd;
    this.diagnostics.committedOutputSamples =
      commitEnd - this.plan.outputStartSample;

    if (this.pendingSamples.length === 0 || commitEnd <= this.pendingStartSample) return;
    if (commitEnd >= pendingEnd) {
      this.pendingSamples = new Float64Array(0);
      this.pendingStartSample = commitEnd;
      return;
    }
    this.pendingSamples = this.pendingSamples.slice(commitEnd - this.pendingStartSample);
    this.pendingStartSample = commitEnd;
  }
}

export function renderSourceNativePlan({
  sourceChannels,
  sourceOffsetSamples = 0,
  sourceMarks,
  plan,
  blockSize,
  sourceBoundaryExtension,
}: RenderSourceNativePlanArgs): SourceNativeRenderResult {
  assertPositiveInteger(blockSize, "blockSize");
  if (sourceChannels.length === 0) {
    throw new RangeError("sourceChannels must contain at least one channel");
  }
  const sourceLength = sourceChannels[0]!.length;
  if (sourceChannels.some((channel) => channel.length !== sourceLength)) {
    throw new RangeError("all source channels must have the same length");
  }
  if (
    !Number.isInteger(sourceOffsetSamples) ||
    sourceOffsetSamples < 0 ||
    sourceOffsetSamples > sourceLength
  ) {
    throw new RangeError("sourceOffsetSamples must be inside the source channels");
  }
  validateBoundaryExtension(sourceLength, sourceOffsetSamples, sourceBoundaryExtension);

  const renderers = sourceChannels.map(
    (source) =>
      new SourceNativePendingTailRenderer(
        source,
        sourceMarks,
        plan,
        sourceOffsetSamples,
        sourceBoundaryExtension,
      ),
  );
  const outputLength = plan.outputEndSample - plan.outputStartSample;
  const channels = renderers.map(() => new Float32Array(outputLength));

  for (let channelIndex = 0; channelIndex < renderers.length; channelIndex++) {
    const renderer = renderers[channelIndex]!;
    const output = channels[channelIndex]!;
    let offset = 0;
    while (!renderer.done) {
      const block = renderer.pull(blockSize);
      if (block.length === 0) {
        throw new Error("renderer made no progress");
      }
      output.set(block, offset);
      offset += block.length;
    }
  }

  return {
    channels,
    channelDiagnostics: renderers.map((renderer) => ({ ...renderer.diagnostics })),
  };
}
