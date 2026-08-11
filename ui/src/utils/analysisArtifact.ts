import type {
  AnalysisArtifact,
  F0TrackArtifact,
  PitchMarksArtifact,
} from "../types/index.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function inferAnalysisArtifactKind(
  value: Record<string, unknown>,
): AnalysisArtifact["kind"] | null {
  const explicitKind = value.kind;
  if (
    explicitKind === "waveform_peaks" ||
    explicitKind === "f0_track" ||
    explicitKind === "pitch_marks"
  ) {
    return explicitKind;
  }

  if ("hop_src_frames" in value && "f0_hz_x100" in value) {
    return "f0_track";
  }
  if ("marks_src_frames" in value && "mark_policy" in value) {
    return "pitch_marks";
  }
  if ("channels" in value && "levels" in value) {
    return "waveform_peaks";
  }
  return null;
}

export function normalizeAnalysisArtifact(value: unknown): AnalysisArtifact {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Analysis artifact must be a JSON object.");
  }

  const kind = inferAnalysisArtifactKind(record);
  if (!kind) {
    throw new Error("Analysis artifact is missing kind and could not be inferred.");
  }

  if (kind === "pitch_marks") {
    return {
      ...record,
      kind,
      mark_features: Array.isArray(record.mark_features) ? record.mark_features : [],
    } as unknown as PitchMarksArtifact;
  }

  return {
    ...record,
    kind,
  } as AnalysisArtifact;
}

export interface AnalysisArtifactSourceContract {
  mediaId: string;
  sampleRate: number;
  sourceLengthFrames: number;
}

const ANALYSIS_ARTIFACT_SCHEMA_VERSION = 1;

function isFiniteOptionalNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number.isFinite(value);
}

function isOptionalInteger(
  value: number | null | undefined,
  minimum: number,
): boolean {
  return value === null || value === undefined ||
    (Number.isSafeInteger(value) && value >= minimum);
}

function isValidPitchMarkFeature(
  feature: NonNullable<PitchMarksArtifact["mark_features"]>[number],
): boolean {
  return Number.isFinite(feature.transient_value) &&
    Number.isFinite(feature.onset_value) &&
    Number.isFinite(feature.cycle_energy) &&
    Number.isFinite(feature.tonality) &&
    Number.isFinite(feature.confidence) &&
    isOptionalInteger(feature.local_pitch_hz_x100, 1) &&
    isFiniteOptionalNumber(feature.epoch_strength) &&
    isFiniteOptionalNumber(feature.gci_quality) &&
    isOptionalInteger(feature.left_period_samples, 1) &&
    isOptionalInteger(feature.right_period_samples, 1) &&
    isFiniteOptionalNumber(feature.excitation_balance) &&
    isOptionalInteger(feature.expression_baseline_hz_x100, 1) &&
    isOptionalInteger(feature.expression_deviation_cents, Number.MIN_SAFE_INTEGER);
}

export function analysisArtifactMatchesSource(
  artifact: F0TrackArtifact | PitchMarksArtifact,
  source: AnalysisArtifactSourceContract,
): boolean {
  if (
    artifact.schema_version !== ANALYSIS_ARTIFACT_SCHEMA_VERSION ||
    artifact.media_id !== source.mediaId ||
    artifact.src_sample_rate !== source.sampleRate ||
    !Number.isSafeInteger(source.sourceLengthFrames) ||
    source.sourceLengthFrames < 0
  ) {
    return false;
  }

  if (artifact.kind === "f0_track") {
    return Number.isSafeInteger(artifact.hop_src_frames) &&
      artifact.hop_src_frames > 0 &&
      Array.isArray(artifact.f0_hz_x100) &&
      artifact.f0_hz_x100.every(Number.isSafeInteger) &&
      (artifact.voiced_prob_permille === null || (
        Array.isArray(artifact.voiced_prob_permille) &&
        artifact.voiced_prob_permille.length === artifact.f0_hz_x100.length &&
        artifact.voiced_prob_permille.every((value) =>
          Number.isSafeInteger(value) && value >= 0 && value <= 1_000
        )
      ));
  }

  const marksAreValid = artifact.marks_src_frames.every((mark, index, marks) =>
    Number.isSafeInteger(mark) &&
    mark >= 0 &&
    mark < source.sourceLengthFrames &&
    (index === 0 || mark > (marks[index - 1] ?? mark))
  );
  const featureCount = artifact.mark_features?.length ?? 0;
  return marksAreValid &&
    (featureCount === 0 || featureCount === artifact.marks_src_frames.length) &&
    (artifact.mark_features?.every(isValidPitchMarkFeature) ?? true);
}
