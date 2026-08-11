import type {
  AnalysisArtifact,
  AnalysisId,
  AudioContentEdit,
  F0TrackArtifact,
  PitchMarkFeature,
  PitchMarksArtifact,
  ProjectDocument,
} from "../types/index.ts";

function hashNumberArray(values: readonly number[] | undefined | null): string {
  if (!values || values.length === 0) return "0";
  let hash = 2_166_136_261;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function hashPitchMarkFeatures(values: readonly PitchMarkFeature[] | undefined): string {
  if (!values || values.length === 0) return "0";
  let hash = 2_166_136_261;
  for (const feature of values) {
    const valuesToHash = [
      Math.round(feature.transient_value * 1_000),
      Math.round(feature.onset_value * 1_000),
      Math.round(feature.cycle_energy * 10_000),
      Math.round(feature.tonality * 1_000),
      Math.round(feature.confidence * 1_000),
      feature.local_pitch_hz_x100 ?? 0,
      Math.round((feature.epoch_strength ?? 0) * 1_000),
      Math.round((feature.gci_quality ?? 0) * 1_000),
      feature.left_period_samples ?? 0,
      feature.right_period_samples ?? 0,
      Math.round((feature.excitation_balance ?? 0) * 1_000),
      feature.expression_baseline_hz_x100 ?? 0,
      feature.expression_deviation_cents ?? 0,
    ];
    for (const value of valuesToHash) {
      hash ^= value | 0;
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(36);
}

export function buildAnalysisSignature(
  f0: F0TrackArtifact | undefined | null,
  pitchMarks: PitchMarksArtifact | undefined | null,
): string | undefined {
  if (!f0 && !pitchMarks) return undefined;
  const f0Key = f0
    ? [
        f0.src_sample_rate,
        f0.hop_src_frames,
        f0.created_by.params_hash,
        hashNumberArray(f0.f0_hz_x100),
        hashNumberArray(f0.voiced_prob_permille),
      ].join(":")
    : "no-f0";
  const marksKey = pitchMarks
    ? [
        pitchMarks.src_sample_rate,
        pitchMarks.created_by.params_hash,
        hashNumberArray(pitchMarks.marks_src_frames),
        hashPitchMarkFeatures(pitchMarks.mark_features),
      ].join(":")
    : "no-marks";
  return `${f0Key}|${marksKey}`;
}

export function serializeAnalysisRegistry(
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): string {
  if (artifactsById.size === 0) {
    return "{}";
  }

  const entries = [...artifactsById.entries()].sort(([leftId], [rightId]) =>
    leftId.localeCompare(rightId)
  );
  return JSON.stringify(Object.fromEntries(entries));
}

function sortAnalysisRefs(
  refs: readonly AnalysisId[],
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): AnalysisId[] {
  return [...new Set(refs)].sort((left, right) => {
    const leftKind = artifactsById.get(left)?.kind ?? "zzzz";
    const rightKind = artifactsById.get(right)?.kind ?? "zzzz";
    return leftKind.localeCompare(rightKind) || left.localeCompare(right);
  });
}

function collectMediaAnalysisRefs(
  mediaId: string,
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): AnalysisId[] {
  const refs: AnalysisId[] = [];
  for (const [analysisId, artifact] of artifactsById.entries()) {
    if (artifact.media_id === mediaId) {
      refs.push(analysisId);
    }
  }
  return sortAnalysisRefs(refs, artifactsById);
}

function cloneProjectWithAnalysisRefs(
  project: ProjectDocument,
  refsByContentId: ReadonlyMap<string, AnalysisId[]>,
): ProjectDocument {
  if (refsByContentId.size === 0) {
    return project;
  }

  return {
    ...project,
    edit: {
      ...project.edit,
      contents: project.edit.contents.map((content) => {
        if (content.type !== "audio") {
          return content;
        }
        const nextRefs = refsByContentId.get(content.id);
        return nextRefs ? { ...content, analysis_refs: nextRefs } : content;
      }),
    },
  };
}

function findArtifactRef(
  refs: readonly AnalysisId[],
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
  mediaId: string,
  kind: AnalysisArtifact["kind"],
): AnalysisId | undefined {
  return refs.find((analysisId) => {
    const artifact = artifactsById.get(analysisId);
    return artifact?.kind === kind && artifact.media_id === mediaId;
  });
}

function resolvePreferredAnalysisRefs(
  content: Pick<AudioContentEdit, "media_id" | "analysis_refs">,
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): AnalysisId[] {
  const explicitRefs = sortAnalysisRefs(content.analysis_refs, artifactsById);
  const mediaRefs = collectMediaAnalysisRefs(content.media_id, artifactsById)
    .filter((analysisId) => !explicitRefs.includes(analysisId));
  const orderedRefs = [...explicitRefs, ...mediaRefs];

  const f0Ref = findArtifactRef(orderedRefs, artifactsById, content.media_id, "f0_track");
  const pitchMarksRef = findArtifactRef(orderedRefs, artifactsById, content.media_id, "pitch_marks");
  return sortAnalysisRefs(
    [
      ...explicitRefs,
      ...(f0Ref ? [f0Ref] : []),
      ...(pitchMarksRef ? [pitchMarksRef] : []),
    ],
    artifactsById,
  );
}

export interface ResolvedAudioContentAnalysis {
  sourceF0Track: F0TrackArtifact | null;
  sourcePitchMarks: PitchMarksArtifact | null;
  analysisSignature?: string;
}

export function resolveAudioContentAnalysis(
  content: Pick<AudioContentEdit, "media_id" | "analysis_refs">,
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): ResolvedAudioContentAnalysis {
  const orderedRefs = resolvePreferredAnalysisRefs(content, artifactsById);
  const f0Ref = findArtifactRef(orderedRefs, artifactsById, content.media_id, "f0_track");
  const pitchMarksRef = findArtifactRef(orderedRefs, artifactsById, content.media_id, "pitch_marks");
  const sourceF0Track = f0Ref ? artifactsById.get(f0Ref) as F0TrackArtifact : null;
  const sourcePitchMarks = pitchMarksRef
    ? artifactsById.get(pitchMarksRef) as PitchMarksArtifact
    : null;

  return {
    sourceF0Track,
    sourcePitchMarks,
    analysisSignature: buildAnalysisSignature(sourceF0Track, sourcePitchMarks),
  };
}

export function buildProjectWithResolvedAnalysisRefs(
  project: ProjectDocument,
  artifactsById: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): ProjectDocument {
  if (artifactsById.size === 0) {
    return project;
  }

  const refsByContentId = new Map<string, AnalysisId[]>();
  for (const content of project.edit.contents) {
    if (content.type !== "audio") {
      continue;
    }

    const nextRefs = resolvePreferredAnalysisRefs(content, artifactsById);
    const changed =
      nextRefs.length !== content.analysis_refs.length ||
      nextRefs.some((ref, index) => ref !== content.analysis_refs[index]);
    if (changed) {
      refsByContentId.set(content.id, nextRefs);
    }
  }

  return cloneProjectWithAnalysisRefs(project, refsByContentId);
}
