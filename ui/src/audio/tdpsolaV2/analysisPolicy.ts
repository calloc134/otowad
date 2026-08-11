export type TdPsolaAnalysisPolicy =
  | "legacy_local"
  | "voice_monophonic_v2"
  | "not_applicable";

export type TdPsolaV2AnalysisPolicyId = Exclude<
  TdPsolaAnalysisPolicy,
  "not_applicable"
>;

export type TdPsolaV2AnalysisSource = "local" | "provided";

export const TDPSOLA_V2_ANALYSIS_POLICY_VERSION =
  "source-native-analysis-policy-v2-edge-coverage";

export interface TdPsolaV2AnalysisPolicyContract {
  id: TdPsolaV2AnalysisPolicyId;
  version: typeof TDPSOLA_V2_ANALYSIS_POLICY_VERSION;
  analysis: {
    preferredSource: TdPsolaV2AnalysisSource;
    providedArtifactFallback: "local";
    minimumF0Hz: number;
    maximumF0Hz: number;
  };
  candidateHistory: {
    selection: "single_resolved_track";
    crossCandidateScoring: false;
    octaveCorrection: "analysis_backend_only";
    holdLastVoiced: false;
    gapRepair: "bounded_interpolation_and_edge_extrapolation";
    maximumGapSeconds: number;
  };
  voicing: {
    voicedThreshold: number;
    edgeContinuationThreshold: number;
    edgeContinuationEvidence: "selected_track_or_local_periodicity";
    minimumVoicedRunSeconds: number;
  };
  synthesisAdjuncts: {
    lpcFormantAssist: false;
    mixedExcitation: false;
    transientDirectCopy: false;
  };
}

export interface TdPsolaV2AnalysisResolution {
  requestedSource: TdPsolaV2AnalysisSource;
  actualSource: TdPsolaV2AnalysisSource;
  fallbackReason: "provided_artifact_missing" | null;
}

const SHARED_SOURCE_NATIVE_POLICY = {
  version: TDPSOLA_V2_ANALYSIS_POLICY_VERSION,
  candidateHistory: {
    selection: "single_resolved_track",
    crossCandidateScoring: false,
    octaveCorrection: "analysis_backend_only",
    holdLastVoiced: false,
    gapRepair: "bounded_interpolation_and_edge_extrapolation",
    maximumGapSeconds: 0.06,
  },
  voicing: {
    voicedThreshold: 0.6,
    edgeContinuationThreshold: 0.45,
    edgeContinuationEvidence: "selected_track_or_local_periodicity",
    minimumVoicedRunSeconds: 0.02,
  },
  synthesisAdjuncts: {
    lpcFormantAssist: false,
    mixedExcitation: false,
    transientDirectCopy: false,
  },
} as const;

const POLICY_CONTRACTS: Record<
  TdPsolaV2AnalysisPolicyId,
  TdPsolaV2AnalysisPolicyContract
> = {
  legacy_local: {
    ...SHARED_SOURCE_NATIVE_POLICY,
    id: "legacy_local",
    analysis: {
      preferredSource: "local",
      providedArtifactFallback: "local",
      minimumF0Hz: 60,
      maximumF0Hz: 1_200,
    },
  },
  voice_monophonic_v2: {
    ...SHARED_SOURCE_NATIVE_POLICY,
    id: "voice_monophonic_v2",
    analysis: {
      preferredSource: "provided",
      providedArtifactFallback: "local",
      minimumF0Hz: 60,
      maximumF0Hz: 1_200,
    },
  },
};

export function resolveTdPsolaV2AnalysisPolicy(
  id: TdPsolaV2AnalysisPolicyId,
): TdPsolaV2AnalysisPolicyContract {
  return POLICY_CONTRACTS[id];
}

export function requireTdPsolaV2AnalysisPolicy(
  id: TdPsolaAnalysisPolicy,
): TdPsolaV2AnalysisPolicyId {
  if (id === "not_applicable") {
    throw new RangeError("source-native TD-PSOLA requires an applicable analysis policy");
  }
  return id;
}

export function resolveTdPsolaV2AnalysisSource(args: {
  policy: TdPsolaV2AnalysisPolicyContract;
  hasProvidedTrack: boolean;
}): TdPsolaV2AnalysisResolution {
  const { policy, hasProvidedTrack } = args;
  const requestedSource = policy.analysis.preferredSource;
  if (requestedSource === "provided" && !hasProvidedTrack) {
    return {
      requestedSource,
      actualSource: policy.analysis.providedArtifactFallback,
      fallbackReason: "provided_artifact_missing",
    };
  }
  return {
    requestedSource,
    actualSource: requestedSource,
    fallbackReason: null,
  };
}
