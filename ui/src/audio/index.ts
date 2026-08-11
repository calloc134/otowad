export { mediaCache } from "./mediaCache.ts";
export type { MediaCache } from "./mediaCache.ts";
export {
  mediaAvailabilityRegistry,
  validateRelinkContentIdentity,
} from "./mediaAvailability.ts";
export type {
  MediaAvailabilityEntry,
} from "./mediaAvailability.ts";
export { validateRelinkCandidate } from "./mediaRelink.ts";
export {
  buildMemoryScenarioMatrix,
  measureAnalysisArtifacts,
  measureAudioBufferSources,
} from "./runtimeMemoryDiagnostics.ts";
export type {
  MemoryScenarioEstimate,
  RuntimeMemoryDiagnosticsReport,
} from "./runtimeMemoryDiagnostics.ts";
export { analysisStore } from "./analysisStore.ts";
export type { AnalysisStore } from "./analysisStore.ts";
export {
  buildAnalysisSignature,
  buildProjectWithResolvedAnalysisRefs,
  resolveAudioContentAnalysis,
  serializeAnalysisRegistry,
} from "./analysisResolution.ts";
export type { ResolvedAudioContentAnalysis } from "./analysisResolution.ts";
export {
  audioBufferDataToAudioBuffer,
  cloneAudioBufferData,
  cloneAudioBufferSource,
  collectAudioBufferTransferables,
  createAudioBufferData,
  mixAudioBufferIntoTarget,
} from "./audioBufferData.ts";
export type { AudioBufferData, AudioBufferSource } from "./audioBufferData.ts";
export { gainMilliDbToLinear, panPermilleToUnit } from "./trackMix.ts";
export { PlaybackEngine } from "./playbackEngine.ts";
export { PlaybackRuntimeCaches } from "./playbackRuntimeCaches.ts";
export {
  getEffectivePlaybackStartTick,
  getLoopRestartTick,
  tickToSeconds,
} from "./playbackMath.ts";
export {
  buildClipRenderPlan,
} from "./clipRenderPlan.ts";
export type {
  BuildClipRenderPlanArgs,
  ClipRenderPlan,
} from "./clipRenderPlan.ts";
export {
  createPlaybackPreparationPhaseCounts,
  measureJsonBytes,
  nowPerfEpochMs,
  preparePlaybackSchedule,
} from "./playbackPreparation.ts";
export type {
  AnalysisArtifactLookup,
  MediaSourceLookup,
  PlaybackPreparationProgress,
  PreparePlaybackRequestMeasurement,
  PreparedPlaybackClip,
} from "./playbackPreparation.ts";
export {
  buildClipPitchRenderPlan,
  buildPitchPlanCompileInput,
  compilePitchPlanFromInput,
  compilePitchPlan,
} from "./pitchPlan.ts";
export type { ClipPitchRenderPlan, PitchSegment } from "./pitchPlan.ts";
