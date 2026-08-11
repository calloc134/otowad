import { compile_pitch_plan_json } from "../wasm/otomad_core.js";
import type {
  AnalysisArtifact,
  ClipId,
  CompiledPitchPlan,
  CompiledWarpPlan,
  PitchControlMode,
  ProjectDocument,
  TrackId,
} from "../types/index.ts";
import {
  buildProjectWithResolvedAnalysisRefs,
  serializeAnalysisRegistry,
} from "./analysisResolution.ts";

export interface PitchSegment {
  startSample: number;
  endSample: number;
  shiftCents: number;
}

export interface WarpSegment {
  outputStartSample: number;
  outputEndSample: number;
  sourceStartSample: number;
  sourceEndSample: number;
}

export interface ClipWarpPlan {
  kind: "linear" | "piecewise";
  segments: WarpSegment[];
}

export interface ClipPitchRenderPlan {
  totalPitchSemitones: number;
  pitchSegments?: PitchSegment[];
  warpPlan?: ClipWarpPlan;
}

interface BuildClipPitchRenderPlanArgs {
  compiledPlan: CompiledPitchPlan;
  clipId: ClipId;
  trackId: TrackId;
  outputSamples: number;
  manualCents: number;
  storedMode: PitchControlMode;
}

export interface PitchPlanCompileInput {
  project: ProjectDocument;
  analysisJson: string;
}

export interface PitchPlanAnalysisLookup {
  buildCompileInput(project: ProjectDocument): PitchPlanCompileInput;
}

export function buildPitchPlanCompileInput(
  project: ProjectDocument,
  analysisInput?: PitchPlanAnalysisLookup | Map<string, AnalysisArtifact>,
): PitchPlanCompileInput {
  if (analysisInput instanceof Map) {
    return {
      project: buildProjectWithResolvedAnalysisRefs(project, analysisInput),
      analysisJson: serializeAnalysisRegistry(analysisInput),
    };
  }

  if (analysisInput) {
    return analysisInput.buildCompileInput(project);
  }

  return { project, analysisJson: "{}" };
}

export function compilePitchPlanFromInput(
  compileInput: PitchPlanCompileInput,
): CompiledPitchPlan {
  const runtimeJson = compile_pitch_plan_json(
    JSON.stringify(compileInput.project),
    compileInput.analysisJson,
  );
  return JSON.parse(runtimeJson) as CompiledPitchPlan;
}

export function compilePitchPlan(
  project: ProjectDocument,
  analysisInput?: PitchPlanAnalysisLookup | Map<string, AnalysisArtifact>,
): CompiledPitchPlan {
  return compilePitchPlanFromInput(buildPitchPlanCompileInput(project, analysisInput));
}

function mapFrameToSample(
  frame: number,
  clipStartFrame: number,
  clipFrameLength: number,
  outputSamples: number,
): number {
  if (clipFrameLength <= 0 || outputSamples <= 0) return 0;
  const ratio = (frame - clipStartFrame) / clipFrameLength;
  return Math.round(ratio * outputSamples);
}

function buildClipWarpPlan(
  compiledWarpPlan: CompiledWarpPlan,
  clipStartFrame: number,
  clipFrameLength: number,
  outputSamples: number,
  clipSourceInFrame: number,
  clipSourceLength: number,
): ClipWarpPlan {
  const segments = compiledWarpPlan.segments
    .map((segment) => ({
      outputStartSample: mapFrameToSample(
        segment.dst_start_frame,
        clipStartFrame,
        clipFrameLength,
        outputSamples,
      ),
      outputEndSample: mapFrameToSample(
        segment.dst_end_frame,
        clipStartFrame,
        clipFrameLength,
        outputSamples,
      ),
      sourceStartSample: segment.src_start_frame - clipSourceInFrame,
      sourceEndSample: segment.src_end_frame - clipSourceInFrame,
    }))
    .filter((segment) =>
      segment.outputEndSample > segment.outputStartSample &&
      segment.sourceEndSample >= segment.sourceStartSample
    );

  if (segments.length === 0) {
    return {
      kind: "linear",
      segments: [{
        outputStartSample: 0,
        outputEndSample: outputSamples,
        sourceStartSample: 0,
        sourceEndSample: Math.max(0, clipSourceLength),
      }],
    };
  }

  return {
    kind: compiledWarpPlan.kind,
    segments,
  };
}

function mergeAdjacentSegments(segments: PitchSegment[]): PitchSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort(
    (left, right) => left.startSample - right.startSample || left.endSample - right.endSample,
  );

  const merged: PitchSegment[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const previous = merged[merged.length - 1]!;
    if (
      previous.endSample === current.startSample &&
      previous.shiftCents === current.shiftCents
    ) {
      previous.endSample = current.endSample;
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function buildCoverageSegments(
  outputSamples: number,
  baseCents: number,
  followSegments: PitchSegment[],
): PitchSegment[] {
  const boundaries = new Set<number>([0, outputSamples]);
  for (const segment of followSegments) {
    boundaries.add(segment.startSample);
    boundaries.add(segment.endSample);
  }

  const sortedBoundaries = [...boundaries]
    .filter((value) => value >= 0 && value <= outputSamples)
    .sort((left, right) => left - right);

  const covered: PitchSegment[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const startSample = sortedBoundaries[i]!;
    const endSample = sortedBoundaries[i + 1]!;
    if (endSample <= startSample) continue;

    const follow = followSegments.find(
      (segment) =>
        segment.startSample <= startSample &&
        segment.endSample >= endSample,
    );
    covered.push({
      startSample,
      endSample,
      shiftCents: baseCents + (follow?.shiftCents ?? 0),
    });
  }

  return mergeAdjacentSegments(covered);
}

export function buildClipPitchRenderPlan({
  compiledPlan,
  clipId,
  trackId,
  outputSamples,
  manualCents,
  storedMode,
}: BuildClipPitchRenderPlanArgs): ClipPitchRenderPlan {
  const effectiveMode = storedMode;
  const clipPlan = compiledPlan.audio_clips.find((clip) => clip.clip_id === clipId);
  const warpPlan = clipPlan
    ? buildClipWarpPlan(
        clipPlan.warp_plan,
        clipPlan.start_frame,
        clipPlan.end_frame - clipPlan.start_frame,
        outputSamples,
        clipPlan.src_in_frame,
        clipPlan.src_out_frame - clipPlan.src_in_frame,
      )
    : undefined;
  if (effectiveMode === "ManualOnly") {
    return { totalPitchSemitones: manualCents / 100, warpPlan };
  }

  const baseCents = effectiveMode === "ManualPlusFollow" ? manualCents : 0;
  if (!clipPlan) {
    return { totalPitchSemitones: baseCents / 100, warpPlan };
  }

  const clipFrameLength = clipPlan.end_frame - clipPlan.start_frame;
  if (clipFrameLength <= 0 || outputSamples <= 0) {
    return { totalPitchSemitones: baseCents / 100, warpPlan };
  }

  const followSegments = compiledPlan.pitch_plan
    .filter(
      (segment) =>
        segment.clip_id === clipId &&
        segment.audio_track === trackId &&
        segment.start_frame < clipPlan.end_frame &&
        segment.end_frame > clipPlan.start_frame,
    )
    .map((segment) => {
      const intersectStart = Math.max(segment.start_frame, clipPlan.start_frame);
      const intersectEnd = Math.min(segment.end_frame, clipPlan.end_frame);
      return {
        startSample: mapFrameToSample(
          intersectStart,
          clipPlan.start_frame,
          clipFrameLength,
          outputSamples,
        ),
        endSample: mapFrameToSample(
          intersectEnd,
          clipPlan.start_frame,
          clipFrameLength,
          outputSamples,
        ),
        shiftCents: segment.shift_cents,
      };
    })
    .filter((segment) => segment.endSample > segment.startSample);

  if (followSegments.length === 0) {
    return { totalPitchSemitones: baseCents / 100, warpPlan };
  }

  const segments = buildCoverageSegments(outputSamples, baseCents, followSegments);
  if (segments.length === 0) {
    return { totalPitchSemitones: baseCents / 100, warpPlan };
  }

  if (
    segments.length === 1 &&
    segments[0]!.startSample === 0 &&
    segments[0]!.endSample === outputSamples
  ) {
    return {
      totalPitchSemitones: segments[0]!.shiftCents / 100,
      warpPlan,
    };
  }

  return {
    totalPitchSemitones: 0,
    pitchSegments: segments,
    warpPlan,
  };
}
