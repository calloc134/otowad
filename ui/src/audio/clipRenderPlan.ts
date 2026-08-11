import type {
  AudioClipEdit,
  ClipId,
  CompiledPitchPlan,
  TimePitchModeKind,
  TrackId,
} from "../types/index.ts";
import {
  classifyClipTdPsolaOperation,
  shouldBypassClipTdPsola,
  type ClipTdPsolaOperation,
} from "./directClipRender.ts";
import {
  buildClipPitchRenderPlan,
  type ClipPitchRenderPlan,
} from "./pitchPlan.ts";
import type { TdPsolaAnalysisPolicy } from "./tdpsolaV2/analysisPolicy.ts";

export type { TdPsolaAnalysisPolicy } from "./tdpsolaV2/analysisPolicy.ts";

export interface BuildClipRenderPlanArgs {
  compiledPlan: CompiledPitchPlan;
  clipId: ClipId;
  trackId: TrackId;
  audio: AudioClipEdit;
  clipDurationSec: number;
  mediaSampleRate: number;
  microBpm: number;
  ppq: number;
  tdPsolaCore?: TdPsolaSynthesisCore;
}

export type TdPsolaSynthesisCore = "legacy_v1" | "source_native_v2";
export const DEFAULT_TDPSOLA_CORE: TdPsolaSynthesisCore = "source_native_v2";

export interface ClipRenderPlan extends ClipPitchRenderPlan {
  preserveFormant: boolean;
  renderOperation: ClipTdPsolaOperation;
  useDirectRender: boolean;
  timePitchMode: TimePitchModeKind;
  tdPsolaCore: TdPsolaSynthesisCore;
  tdPsolaAnalysisPolicy: TdPsolaAnalysisPolicy;
  backend:
    | "direct"
    | "voice_tdpsola"
    | "source_native_tdpsola"
    | "music_phase_vocoder";
  backendVersion: string;
}

function resolveClipRenderBackend(
  timePitchMode: TimePitchModeKind,
  useDirectRender: boolean,
  tdPsolaCore: TdPsolaSynthesisCore,
): Pick<ClipRenderPlan, "backend" | "backendVersion"> {
  if (useDirectRender) {
    return {
      backend: "direct",
      backendVersion: "direct-v1",
    };
  }

  if (timePitchMode === "Music") {
    return {
      backend: "music_phase_vocoder",
      backendVersion: "music-phase-vocoder-v1",
    };
  }

  if (tdPsolaCore === "source_native_v2") {
    return {
      backend: "source_native_tdpsola",
      backendVersion: "source-native-tdpsola-v2-a5-unvoiced-stretch",
    };
  }

  return {
    backend: "voice_tdpsola",
    backendVersion: "voice-tdpsola-v1",
  };
}

function resolveTdPsolaAnalysisPolicy(
  timePitch: AudioClipEdit["time_pitch"],
): TdPsolaAnalysisPolicy {
  if (timePitch.mode === "Music") return "not_applicable";
  return timePitch.analysis === "Local" ? "legacy_local" : "voice_monophonic_v2";
}

export function buildClipRenderPlan({
  compiledPlan,
  clipId,
  trackId,
  audio,
  clipDurationSec,
  mediaSampleRate,
  microBpm,
  ppq,
  tdPsolaCore = DEFAULT_TDPSOLA_CORE,
}: BuildClipRenderPlanArgs): ClipRenderPlan {
  const manualCents =
    audio.pitch.manual_coarse_semitones * 100 + audio.pitch.manual_fine_cents;
  const outputSamples = Math.round(clipDurationSec * mediaSampleRate);
  const timePitch = audio.time_pitch;
  const timePitchMode = timePitch.mode;
  const preserveFormant = "preserve_formant" in timePitch
    ? timePitch.preserve_formant
    : false;
  const pitchPlan = buildClipPitchRenderPlan({
    compiledPlan,
    clipId,
    trackId,
    outputSamples,
    manualCents,
    storedMode: audio.pitch.mode,
  });

  const directRenderArgs = {
    sourceInFrame: audio.src_in,
    sourceOutFrame: audio.src_out,
    sampleRate: mediaSampleRate,
    targetDurationSec: clipDurationSec,
    totalPitchSemitones: pitchPlan.totalPitchSemitones,
    pitchSegments: pitchPlan.pitchSegments,
    warpPlan: pitchPlan.warpPlan,
    microBpm,
    ppq,
  };
  const renderOperation = classifyClipTdPsolaOperation(directRenderArgs);
  const useDirectRender = shouldBypassClipTdPsola(directRenderArgs);
  const backend = resolveClipRenderBackend(timePitchMode, useDirectRender, tdPsolaCore);
  const tdPsolaAnalysisPolicy = resolveTdPsolaAnalysisPolicy(timePitch);

  return {
    ...pitchPlan,
    preserveFormant,
    renderOperation,
    useDirectRender,
    timePitchMode,
    tdPsolaCore,
    tdPsolaAnalysisPolicy,
    ...backend,
  };
}
