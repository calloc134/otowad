import type { F0TrackArtifact, PitchMarksArtifact } from "../types/index.ts";
import { analysisArtifactMatchesSource } from "../utils/analysisArtifact.ts";
import type { AudioBufferData, AudioBufferSource } from "./audioBufferData.ts";
import type { ClipRenderPlan } from "./clipRenderPlan.ts";
import { renderDirectClipBufferData } from "./directClipRender.ts";
import { renderMusicPhaseVocoderBufferData } from "./musicPhaseVocoder.ts";
import { renderAudioClipTdPsolaData } from "./tdpsola.ts";
import { requireTdPsolaV2AnalysisPolicy } from "./tdpsolaV2/analysisPolicy.ts";
import { renderAudioClipTdPsolaV2Data } from "./tdpsolaV2/v2Adapter.ts";

export interface RenderClipFromPlanArgs {
  mediaId: string;
  inputBuffer: AudioBufferSource;
  sourceInFrame: number;
  sourceOutFrame: number;
  targetDurationSec: number;
  renderPlan: ClipRenderPlan;
  sourceF0Track: F0TrackArtifact | null;
  sourcePitchMarks: PitchMarksArtifact | null;
}

export function renderClipFromPlan({
  mediaId,
  inputBuffer,
  sourceInFrame,
  sourceOutFrame,
  targetDurationSec,
  renderPlan,
  sourceF0Track,
  sourcePitchMarks,
}: RenderClipFromPlanArgs): AudioBufferData | null {
  const backend = renderPlan.backend;
  if (backend !== "direct") {
    const sourceContract = {
      mediaId,
      sampleRate: inputBuffer.sampleRate,
      sourceLengthFrames: inputBuffer.length,
    };
    if (sourceF0Track && !analysisArtifactMatchesSource(sourceF0Track, sourceContract)) {
      throw new Error(`F0 artifact does not match the source contract for media ${mediaId}.`);
    }
    if (
      sourcePitchMarks &&
      !analysisArtifactMatchesSource(sourcePitchMarks, sourceContract)
    ) {
      throw new Error(`Pitch-mark artifact does not match the source contract for media ${mediaId}.`);
    }
  }
  switch (backend) {
    case "direct":
      return renderDirectClipBufferData(
        inputBuffer,
        sourceInFrame,
        sourceOutFrame,
        targetDurationSec,
      );
    case "voice_tdpsola":
      return renderAudioClipTdPsolaData({
        inputBuffer,
        sourceInFrame,
        sourceOutFrame,
        targetDurationSec,
        totalPitchSemitones: renderPlan.totalPitchSemitones,
        pitchSegments: renderPlan.pitchSegments,
        warpPlan: renderPlan.warpPlan,
        sourceF0Track,
        sourcePitchMarks,
        renderOperation: renderPlan.renderOperation,
        preserveFormant: renderPlan.preserveFormant,
      });
    case "source_native_tdpsola":
      return renderAudioClipTdPsolaV2Data({
        inputBuffer,
        sourceInFrame,
        sourceOutFrame,
        targetDurationSec,
        totalPitchSemitones: renderPlan.totalPitchSemitones,
        pitchSegments: renderPlan.pitchSegments,
        warpPlan: renderPlan.warpPlan,
        sourceF0Track,
        sourcePitchMarks,
        renderOperation: renderPlan.renderOperation,
        preserveFormant: renderPlan.preserveFormant,
        analysisPolicy: requireTdPsolaV2AnalysisPolicy(
          renderPlan.tdPsolaAnalysisPolicy,
        ),
      });
    case "music_phase_vocoder":
      return renderMusicPhaseVocoderBufferData({
        inputBuffer,
        sourceInFrame,
        sourceOutFrame,
        targetDurationSec,
        renderPlan,
        sourceF0Track,
        sourcePitchMarks,
      });
    default:
      return assertNeverBackend(backend);
  }
}

function assertNeverBackend(backend: never): never {
  throw new Error(`Unsupported clip render backend: ${String(backend)}`);
}
