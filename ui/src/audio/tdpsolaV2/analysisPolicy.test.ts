import assert from "node:assert/strict";
import test from "node:test";

import {
  requireTdPsolaV2AnalysisPolicy,
  resolveTdPsolaV2AnalysisPolicy,
  resolveTdPsolaV2AnalysisSource,
  TDPSOLA_V2_ANALYSIS_POLICY_VERSION,
} from "./analysisPolicy.ts";

test("Legacy and Voice share synthesis-safe policy while differing only in analysis", () => {
  const legacy = resolveTdPsolaV2AnalysisPolicy("legacy_local");
  const voice = resolveTdPsolaV2AnalysisPolicy("voice_monophonic_v2");

  assert.equal(legacy.version, TDPSOLA_V2_ANALYSIS_POLICY_VERSION);
  assert.equal(voice.version, TDPSOLA_V2_ANALYSIS_POLICY_VERSION);
  assert.equal(legacy.analysis.preferredSource, "local");
  assert.equal(legacy.analysis.maximumF0Hz, 1_200);
  assert.equal(voice.analysis.preferredSource, "provided");
  assert.equal(voice.analysis.maximumF0Hz, 1_200);
  assert.deepEqual(legacy.candidateHistory, voice.candidateHistory);
  assert.deepEqual(legacy.voicing, voice.voicing);
  assert.deepEqual(legacy.synthesisAdjuncts, voice.synthesisAdjuncts);
  assert.deepEqual(voice.synthesisAdjuncts, {
    lpcFormantAssist: false,
    mixedExcitation: false,
    transientDirectCopy: false,
  });
  assert.equal(voice.candidateHistory.crossCandidateScoring, false);
  assert.equal(voice.candidateHistory.holdLastVoiced, false);
});

test("Voice falls back explicitly to local only when its artifact is absent", () => {
  const voice = resolveTdPsolaV2AnalysisPolicy("voice_monophonic_v2");
  assert.deepEqual(resolveTdPsolaV2AnalysisSource({
    policy: voice,
    hasProvidedTrack: true,
  }), {
    requestedSource: "provided",
    actualSource: "provided",
    fallbackReason: null,
  });
  assert.deepEqual(resolveTdPsolaV2AnalysisSource({
    policy: voice,
    hasProvidedTrack: false,
  }), {
    requestedSource: "provided",
    actualSource: "local",
    fallbackReason: "provided_artifact_missing",
  });
});

test("Legacy ignores provided candidates instead of mixing artifact marks into local F0", () => {
  const legacy = resolveTdPsolaV2AnalysisPolicy("legacy_local");
  assert.deepEqual(resolveTdPsolaV2AnalysisSource({
    policy: legacy,
    hasProvidedTrack: true,
  }), {
    requestedSource: "local",
    actualSource: "local",
    fallbackReason: null,
  });
});

test("source-native renderer rejects a non-applicable policy instead of inferring one", () => {
  assert.equal(requireTdPsolaV2AnalysisPolicy("legacy_local"), "legacy_local");
  assert.equal(
    requireTdPsolaV2AnalysisPolicy("voice_monophonic_v2"),
    "voice_monophonic_v2",
  );
  assert.throws(
    () => requireTdPsolaV2AnalysisPolicy("not_applicable"),
    /requires an applicable analysis policy/,
  );
});
