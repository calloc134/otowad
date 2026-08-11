import { getBoundedClipRenderWindow } from "../audio/clipMath.ts";
import {
  createAudioBufferData,
  mixAudioBufferIntoTarget,
  type AudioBufferData,
} from "../audio/audioBufferData.ts";
import {
  buildClipRenderPlan,
  DEFAULT_TDPSOLA_CORE,
  type ClipRenderPlan,
  type TdPsolaSynthesisCore,
} from "../audio/clipRenderPlan.ts";
import { renderClipFromPlan } from "../audio/clipRenderDispatch.ts";
import {
  buildPitchPlanCompileInput,
  compilePitchPlanFromInput,
} from "../audio/pitchPlan.ts";
import { tickToSeconds } from "../audio/playbackMath.ts";
import {
  gainMilliDbToLinear,
  panPermilleToUnit,
} from "../audio/trackMix.ts";
import type { AnalysisArtifactLookup, MediaSourceLookup } from "../audio/playbackPreparation.ts";
import type { F0TrackArtifact, PitchMarksArtifact, ProjectDocument, TrackId } from "../types";
import { selectTracksForOfflineRender } from "../utils/renderTrackSelection.ts";

export interface RenderMixdownOptions {
  sampleRate?: number;
  channels: number;
  startTick?: number;
  endTick?: number;
  trackIds?: TrackId[];
  /** Runtime-only A/B selector. The persisted project model remains unchanged. */
  tdPsolaCore?: TdPsolaSynthesisCore;
}

export interface RenderMixdownProgress {
  phase: "analyzing" | "compiling" | "preparing" | "mixing" | "done";
  progress: number;
}

interface ClipSchedule extends ClipRenderPlan {
  mediaId: string;
  inputBuffer: NonNullable<ReturnType<MediaSourceLookup["get"]>>;
  sourceInFrame: number;
  sourceOutFrame: number;
  clipDurationSec: number;
  renderStartSec: number;
  bufferOffsetSec: number;
  renderDurationSec: number;
  clipGain: number;
  trackGain: number;
  trackPan: number;
  sourceF0Track: F0TrackArtifact | null;
  sourcePitchMarks: PitchMarksArtifact | null;
}

const DEFAULT_OPTIONS: RenderMixdownOptions = {
  channels: 2,
};

export async function renderProjectToAudioBufferData(
  project: ProjectDocument,
  mediaLookup: MediaSourceLookup,
  analysisLookup: AnalysisArtifactLookup,
  options?: Partial<RenderMixdownOptions>,
  onProgress?: (progress: RenderMixdownProgress) => void,
): Promise<AudioBufferData> {
  const opts: RenderMixdownOptions = { ...DEFAULT_OPTIONS, ...options };
  const tdPsolaCore = opts.tdPsolaCore ?? DEFAULT_TDPSOLA_CORE;
  const sampleRate = opts.sampleRate ?? project.meta.project_sample_rate;
  const report = (phase: RenderMixdownProgress["phase"], progress: number) => {
    onProgress?.({ phase, progress });
  };

  report("analyzing", 0);
  const needsMonophonicV2Analysis = tdPsolaCore === "source_native_v2" &&
    project.edit.clips.some((clip) =>
      clip.kind.clip_type === "audio" &&
      clip.kind.audio.time_pitch.mode === "Voice" &&
      clip.kind.audio.time_pitch.analysis === "Source"
    );
  await analysisLookup.ensureForProject(
    project,
    mediaLookup,
    needsMonophonicV2Analysis
      ? {
          profile: "tdpsola_monophonic_v2",
          refreshIfProfileMismatch: true,
        }
      : undefined,
  );
  report("analyzing", 1);

  report("compiling", 0);
  const compileInput = buildPitchPlanCompileInput(project, analysisLookup);
  const compiledPitchPlan = compilePitchPlanFromInput(compileInput);
  report("compiling", 1);

  report("preparing", 0);
  const edit = compileInput.project.edit;
  const microBpm = edit.tempo.points[0]?.micro_bpm ?? 120_000_000;
  const ppq = edit.tempo.ppq;
  const hasRenderRange =
    opts.startTick !== undefined &&
    opts.endTick !== undefined &&
    opts.endTick > opts.startTick;
  const renderStartTick = hasRenderRange ? opts.startTick ?? 0 : 0;
  const renderEndTick = hasRenderRange ? opts.endTick ?? 0 : 0;
  const renderDurationSec = hasRenderRange
    ? tickToSeconds(renderEndTick - renderStartTick, microBpm, ppq)
    : null;
  const tracks = selectTracksForOfflineRender(edit.tracks, opts.trackIds);

  const schedules: ClipSchedule[] = [];
  for (const track of tracks) {
    const trackClips = edit.clips.filter((clip) => clip.track_id === track.id);
    for (const clip of trackClips) {
      if (clip.muted || clip.kind.clip_type !== "audio") continue;

      const content = edit.contents.find((item) => item.id === clip.kind.content_id);
      if (!content || content.type !== "audio") continue;

      const buffer = mediaLookup.get(content.media_id);
      if (!buffer) continue;

      const clipDurationSec = tickToSeconds(clip.length, microBpm, ppq);
      const sourceInSec = clip.kind.audio.src_in / buffer.sampleRate;
      const sourceOutSec = clip.kind.audio.src_out / buffer.sampleRate;
      const sourceDurationSec = sourceOutSec - sourceInSec;
      if (sourceDurationSec <= 0 || clipDurationSec <= 0) continue;

      const boundedWindow = hasRenderRange
        ? getBoundedClipRenderWindow({
            clipStartTick: clip.start,
            clipLengthTicks: clip.length,
            selectionStartTick: renderStartTick,
            selectionEndTick: renderEndTick,
            microBpm,
            ppq,
          })
        : {
            overlapStartTick: clip.start,
            overlapEndTick: clip.start + clip.length,
            renderStartSec: tickToSeconds(clip.start, microBpm, ppq),
            bufferOffsetSec: 0,
            durationSec: clipDurationSec,
          };
      if (!boundedWindow) continue;

      const renderPlan = buildClipRenderPlan({
        compiledPlan: compiledPitchPlan,
        clipId: clip.id,
        trackId: track.id,
        audio: clip.kind.audio,
        clipDurationSec,
        mediaSampleRate: buffer.sampleRate,
        microBpm,
        ppq,
        tdPsolaCore,
      });

      schedules.push({
        mediaId: content.media_id,
        inputBuffer: buffer,
        sourceInFrame: clip.kind.audio.src_in,
        sourceOutFrame: clip.kind.audio.src_out,
        clipDurationSec,
        renderStartSec: boundedWindow.renderStartSec,
        bufferOffsetSec: boundedWindow.bufferOffsetSec,
        renderDurationSec: boundedWindow.durationSec,
        clipGain: gainMilliDbToLinear(clip.gain_milli_db),
        trackGain: gainMilliDbToLinear(track.gain_milli_db),
        trackPan: panPermilleToUnit(track.pan_permille),
        sourceF0Track: analysisLookup.resolveForAudioContent(content).sourceF0Track,
        sourcePitchMarks: analysisLookup.resolveForAudioContent(content).sourcePitchMarks,
        ...renderPlan,
      });
    }
  }

  if (schedules.length === 0 && !hasRenderRange) {
    throw new Error("No renderable audio clips found in the project.");
  }

  const totalLengthSamples = hasRenderRange && renderDurationSec !== null
    ? Math.max(1, Math.ceil(renderDurationSec * sampleRate))
    : Math.ceil(
        (schedules.reduce((maxEndSec, schedule) => {
          const endSec = schedule.renderStartSec + schedule.renderDurationSec;
          return endSec > maxEndSec ? endSec : maxEndSec;
        }, 0) + 0.05) * sampleRate,
      );
  report("preparing", 1);

  const output = createAudioBufferData(opts.channels, totalLengthSamples, sampleRate);
  report("mixing", 0);
  const totalSchedules = Math.max(1, schedules.length);
  for (let index = 0; index < schedules.length; index++) {
    const schedule = schedules[index];
    if (!schedule || !schedule.inputBuffer) continue;

    report("mixing", index / totalSchedules);
    const processed = renderClipFromPlan({
      mediaId: schedule.mediaId,
      inputBuffer: schedule.inputBuffer,
      sourceInFrame: schedule.sourceInFrame,
      sourceOutFrame: schedule.sourceOutFrame,
      targetDurationSec: schedule.clipDurationSec,
      renderPlan: schedule,
      sourceF0Track: schedule.sourceF0Track,
      sourcePitchMarks: schedule.sourcePitchMarks,
    });
    if (!processed) continue;

    const boundedDurationSec = Math.min(
      schedule.renderDurationSec,
      Math.max(0, processed.length / processed.sampleRate - schedule.bufferOffsetSec),
    );
    if (boundedDurationSec <= 0) continue;

    mixAudioBufferIntoTarget({
      source: processed,
      target: output,
      targetStartSample: Math.round(schedule.renderStartSec * sampleRate),
      sourceOffsetSec: schedule.bufferOffsetSec,
      durationSec: boundedDurationSec,
      gain: schedule.clipGain * schedule.trackGain,
      stereoPan: schedule.trackPan,
    });
  }

  report("done", 1);
  return output;
}
