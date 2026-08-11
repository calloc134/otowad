import type { AudioBufferSource } from "./audioBufferData.ts";
import {
  getAudioBufferChannelCount,
  getAudioBufferChannelData,
} from "./audioBufferData.ts";
import {
  analyze_f0_buffer_with_profile,
  generate_pitch_marks_buffer,
} from "../wasm/otomad_core.js";
import type {
  AnalysisArtifact,
  AnalysisId,
  AudioContentEdit,
  F0TrackArtifact,
  PitchMarksArtifact,
  ProjectDocument,
} from "../types/index.ts";
import type { MediaCache } from "./mediaCache.ts";
import {
  analysisArtifactMatchesSource,
  normalizeAnalysisArtifact,
} from "../utils/analysisArtifact.ts";

import {
  buildAnalysisSignature,
  buildProjectWithResolvedAnalysisRefs,
  resolveAudioContentAnalysis,
  serializeAnalysisRegistry,
  type ResolvedAudioContentAnalysis,
} from "./analysisResolution.ts";

function createAnalysisId(): AnalysisId {
  return crypto.randomUUID();
}

export const TDPSOLA_MONOPHONIC_V2_ANALYSIS_PROFILE = "tdpsola_monophonic_v2";

export type SourceF0AnalysisProfile =
  | "legacy_default"
  | typeof TDPSOLA_MONOPHONIC_V2_ANALYSIS_PROFILE;

export interface EnsureSourceAnalysisOptions {
  profile?: SourceF0AnalysisProfile;
  /** Rebuild derived F0/marks when their recorded algorithm contract is stale. */
  refreshIfProfileMismatch?: boolean;
}

const MONOPHONIC_V2_F0_ALGO_VERSION =
  "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2";
const LEGACY_F0_ALGO_VERSION = "loqa-voice-dsp-0.5.0-pyin";
const LEGACY_PITCH_MARKS_ALGO_VERSION = "peak-refinement-v2";
const MONOPHONIC_V2_PITCH_MARKS_ALGO_VERSION =
  "peak-refinement-v3-monophonic-gap-repair";

function expectedPitchMarksAlgoVersion(f0: F0TrackArtifact): string {
  return f0.created_by.algo_version === MONOPHONIC_V2_F0_ALGO_VERSION
    ? MONOPHONIC_V2_PITCH_MARKS_ALGO_VERSION
    : LEGACY_PITCH_MARKS_ALGO_VERSION;
}

function expectedPitchMarksParams(f0: F0TrackArtifact): string {
  return `f0_algo_version=${f0.created_by.algo_version};f0_params_hash=${f0.created_by.params_hash}`;
}

export function analysisArtifactMatchesProfile(
  artifact: F0TrackArtifact,
  profile: SourceF0AnalysisProfile,
): boolean {
  if (profile === TDPSOLA_MONOPHONIC_V2_ANALYSIS_PROFILE) {
    return artifact.created_by.algo_version === MONOPHONIC_V2_F0_ALGO_VERSION &&
      artifact.params.includes("profile=tdpsola_monophonic_v2") &&
      artifact.params.includes("max_f0=1200");
  }
  return artifact.created_by.algo_version === LEGACY_F0_ALGO_VERSION &&
    !artifact.params.includes("profile=") &&
    artifact.params.includes("max_f0=500");
}

export function pitchMarksMatchF0Artifact(
  artifact: PitchMarksArtifact,
  f0: F0TrackArtifact,
): boolean {
  const expectedParams = expectedPitchMarksParams(f0);
  return artifact.media_id === f0.media_id &&
    artifact.src_sample_rate === f0.src_sample_rate &&
    artifact.created_by.algo_version === expectedPitchMarksAlgoVersion(f0) &&
    artifact.created_by.params_hash === expectedParams &&
    artifact.params === expectedParams;
}

export interface MediaBufferLookup {
  get(mediaId: string): AudioBufferSource | undefined;
}

export function extractMonoFromBuffer(buffer: AudioBufferSource): Float32Array {
  const length = buffer.length;
  const channels = getAudioBufferChannelCount(buffer);
  const mono = new Float32Array(length);

  for (let ch = 0; ch < channels; ch++) {
    const data = getAudioBufferChannelData(buffer, ch);
    for (let i = 0; i < length; i++) {
      mono[i] = (mono[i] ?? 0) + (data[i] ?? 0);
    }
  }

  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i++) {
      mono[i] = (mono[i] ?? 0) * inv;
    }
  }

  return mono;
}

class AnalysisStore {
  private f0Map = new Map<string, F0TrackArtifact>();
  private pitchMarksMap = new Map<string, PitchMarksArtifact>();
  private artifactById = new Map<AnalysisId, AnalysisArtifact>();
  private f0IdByMediaId = new Map<string, AnalysisId>();
  private pitchMarksIdByMediaId = new Map<string, AnalysisId>();
  private signatureMap = new Map<string, string>();

  private setArtifact(analysisId: AnalysisId, artifact: AnalysisArtifact): void {
    this.artifactById.set(analysisId, artifact);
    this.signatureMap.delete(artifact.media_id);
    switch (artifact.kind) {
      case "f0_track":
        this.f0Map.set(artifact.media_id, artifact);
        this.f0IdByMediaId.set(artifact.media_id, analysisId);
        break;
      case "pitch_marks":
        this.pitchMarksMap.set(artifact.media_id, artifact);
        this.pitchMarksIdByMediaId.set(artifact.media_id, analysisId);
        break;
      case "waveform_peaks":
        break;
    }
  }

  private resolveAnalysisRefsForMedia(mediaId: string): AnalysisId[] {
    const refs: AnalysisId[] = [];
    const f0Id = this.f0IdByMediaId.get(mediaId);
    if (f0Id) {
      refs.push(f0Id);
    }
    const pitchMarksId = this.pitchMarksIdByMediaId.get(mediaId);
    if (pitchMarksId && pitchMarksId !== f0Id) {
      refs.push(pitchMarksId);
    }
    return refs;
  }

  getF0(mediaId: string): F0TrackArtifact | undefined {
    return this.f0Map.get(mediaId);
  }

  getPitchMarks(mediaId: string): PitchMarksArtifact | undefined {
    return this.pitchMarksMap.get(mediaId);
  }

  setF0(mediaId: string, artifact: F0TrackArtifact, analysisId = createAnalysisId()): AnalysisId {
    if (artifact.media_id !== mediaId) {
      throw new Error(`F0 artifact media_id ${artifact.media_id} does not match ${mediaId}.`);
    }
    this.setArtifact(analysisId, artifact);
    return analysisId;
  }

  setPitchMarks(
    mediaId: string,
    artifact: PitchMarksArtifact,
    analysisId = createAnalysisId(),
  ): AnalysisId {
    if (artifact.media_id !== mediaId) {
      throw new Error(`Pitch-mark artifact media_id ${artifact.media_id} does not match ${mediaId}.`);
    }
    this.setArtifact(analysisId, artifact);
    return analysisId;
  }

  hasF0(mediaId: string): boolean {
    return this.f0Map.has(mediaId);
  }

  hasPitchMarks(mediaId: string): boolean {
    return this.pitchMarksMap.has(mediaId);
  }

  clear(): void {
    this.f0Map.clear();
    this.pitchMarksMap.clear();
    this.artifactById.clear();
    this.f0IdByMediaId.clear();
    this.pitchMarksIdByMediaId.clear();
    this.signatureMap.clear();
  }

  deleteForMedia(mediaId: string): void {
    const f0Id = this.f0IdByMediaId.get(mediaId);
    if (f0Id) {
      this.artifactById.delete(f0Id);
      this.f0IdByMediaId.delete(mediaId);
    }
    const pitchMarksId = this.pitchMarksIdByMediaId.get(mediaId);
    if (pitchMarksId) {
      this.artifactById.delete(pitchMarksId);
      this.pitchMarksIdByMediaId.delete(mediaId);
    }
    this.f0Map.delete(mediaId);
    this.pitchMarksMap.delete(mediaId);
    this.signatureMap.delete(mediaId);
  }

  getStore(): Map<AnalysisId, AnalysisArtifact> {
    return this.artifactById;
  }

  getAnalysisSignature(mediaId: string): string | undefined {
    const cached = this.signatureMap.get(mediaId);
    if (cached !== undefined) {
      return cached;
    }
    const signature = buildAnalysisSignature(
      this.getF0(mediaId),
      this.getPitchMarks(mediaId),
    );
    if (signature !== undefined) {
      this.signatureMap.set(mediaId, signature);
    }
    return signature;
  }

  resolveForAudioContent(
    content: Pick<AudioContentEdit, "media_id" | "analysis_refs">,
  ): ResolvedAudioContentAnalysis {
    return resolveAudioContentAnalysis(content, this.artifactById);
  }

  async ensureForBuffer(
    mediaId: string,
    buffer: AudioBufferSource,
    options: EnsureSourceAnalysisOptions = {},
  ): Promise<{
    f0: F0TrackArtifact;
    pitchMarks?: PitchMarksArtifact;
    analysisRefs: AnalysisId[];
  }> {
    const analysisProfile = options.profile ?? TDPSOLA_MONOPHONIC_V2_ANALYSIS_PROFILE;
    const refreshIfProfileMismatch = options.refreshIfProfileMismatch ?? false;
    const existingF0 = this.getF0(mediaId);
    const existingPitchMarks = this.getPitchMarks(mediaId);
    const sourceContract = {
      mediaId,
      sampleRate: buffer.sampleRate,
      sourceLengthFrames: buffer.length,
    };
    const f0MatchesSource = existingF0
      ? analysisArtifactMatchesSource(existingF0, sourceContract)
      : false;
    const pitchMarksMatchSource = existingPitchMarks
      ? analysisArtifactMatchesSource(existingPitchMarks, sourceContract)
      : false;
    const f0IsCurrent = existingF0 && f0MatchesSource
      ? analysisArtifactMatchesProfile(existingF0, analysisProfile)
      : false;
    const pitchMarksAreCurrent = existingF0 && existingPitchMarks &&
        f0MatchesSource && pitchMarksMatchSource
      ? pitchMarksMatchF0Artifact(existingPitchMarks, existingF0)
      : false;
    if (
      existingF0 &&
      existingPitchMarks &&
      f0MatchesSource &&
      pitchMarksAreCurrent &&
      (!refreshIfProfileMismatch || f0IsCurrent)
    ) {
      return {
        f0: existingF0,
        pitchMarks: existingPitchMarks,
        analysisRefs: this.resolveAnalysisRefsForMedia(mediaId),
      };
    }

    const monoSamples = extractMonoFromBuffer(buffer);
    let f0 = !f0MatchesSource || (refreshIfProfileMismatch && !f0IsCurrent)
      ? undefined
      : existingF0;
    let f0AnalysisId = this.f0IdByMediaId.get(mediaId);
    if (!f0) {
      const f0Json = analyze_f0_buffer_with_profile(
        monoSamples,
        buffer.sampleRate,
        mediaId,
        analysisProfile,
      );
      const parsedArtifact = normalizeAnalysisArtifact(JSON.parse(f0Json));
      if (parsedArtifact.kind !== "f0_track") {
        throw new Error(`Expected f0_track artifact for media ${mediaId}.`);
      }
      f0 = parsedArtifact;
      f0AnalysisId = this.setF0(mediaId, f0, f0AnalysisId);
    }

    let pitchMarks = f0 !== existingF0 || !pitchMarksAreCurrent
      ? undefined
      : existingPitchMarks;
    let pitchMarksAnalysisId = this.pitchMarksIdByMediaId.get(mediaId);
    if (!pitchMarks) {
      try {
        const pitchMarksJson = generate_pitch_marks_buffer(
          monoSamples,
          JSON.stringify(f0),
        );
        const parsedArtifact = normalizeAnalysisArtifact(JSON.parse(pitchMarksJson));
        if (parsedArtifact.kind !== "pitch_marks") {
          throw new Error(`Expected pitch_marks artifact for media ${mediaId}.`);
        }
        pitchMarks = parsedArtifact;
        pitchMarksAnalysisId = this.setPitchMarks(mediaId, pitchMarks, pitchMarksAnalysisId);
      } catch (error) {
        console.warn("Pitch mark analysis failed for media", mediaId, error);
      }
    }

    const analysisRefs = [...new Set([
      ...(f0AnalysisId ? [f0AnalysisId] : []),
      ...(pitchMarksAnalysisId ? [pitchMarksAnalysisId] : []),
    ])].sort((left, right) => {
      const leftKind = this.artifactById.get(left)?.kind ?? "zzzz";
      const rightKind = this.artifactById.get(right)?.kind ?? "zzzz";
      return leftKind.localeCompare(rightKind) || left.localeCompare(right);
    });

    return { f0, pitchMarks, analysisRefs };
  }

  async ensureForProject(
    project: ProjectDocument,
    mediaCache: MediaCache | MediaBufferLookup,
    options: EnsureSourceAnalysisOptions = {},
  ): Promise<void> {
    const mediaIds = new Set<string>();
    for (const content of project.edit.contents) {
      if (content.type === "audio") {
        mediaIds.add(content.media_id);
      }
    }

    for (const mediaId of mediaIds) {
      const buffer = mediaCache.get(mediaId);
      if (!buffer) continue;
      await this.ensureForBuffer(mediaId, buffer, options);
    }
  }

  buildCompileInput(project: ProjectDocument): {
    project: ProjectDocument;
    analysisJson: string;
  } {
    return {
      project: buildProjectWithResolvedAnalysisRefs(project, this.artifactById),
      analysisJson: serializeAnalysisRegistry(this.artifactById),
    };
  }
}

export const analysisStore = new AnalysisStore();
export { AnalysisStore };
