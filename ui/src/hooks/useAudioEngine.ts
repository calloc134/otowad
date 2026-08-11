import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  getTimeSelectionRange,
  useDocumentState,
  useProjectActions,
  useSelectionState,
  useTransportState,
} from "@/store";
import {
  PlaybackEngine,
  PlaybackRuntimeCaches,
  analysisStore,
  buildMemoryScenarioMatrix,
  getEffectivePlaybackStartTick,
  getLoopRestartTick,
  mediaAvailabilityRegistry,
  mediaCache,
  measureAnalysisArtifacts,
  measureAudioBufferSources,
  nowPerfEpochMs,
} from "@/audio";
import type { PreparePlaybackRequestMeasurement } from "@/audio";
import type { MemoryScenarioEstimate, RuntimeMemoryDiagnosticsReport } from "@/audio";
import {
  ProjectWorkerClientError,
  ProjectWorkerRecovery,
  projectWorkerClient,
} from "@/worker";
import { livePlayheadStore } from "@/audio/livePlayheadStore";

/** Singleton engine shared across all hook consumers. */
const engine = new PlaybackEngine();
const runtimeCaches = new PlaybackRuntimeCaches(engine);
const projectWorkerRecovery = new ProjectWorkerRecovery(
  projectWorkerClient,
  () => ({
    analysisEntries: Array.from(
      analysisStore.getStore(),
      ([analysisId, artifact]) => ({ analysisId, artifact }),
    ),
  }),
);
const sharedPlaybackState = {
  rafId: 0,
  playStartTick: 0,
};
let pendingPlaybackRequestId: string | null = null;
let consumerCount = 0;
let latestBusyProgressUpdate: { phase: string; progressBucket: number } | null = null;
// Identifies which play() invocation currently owns the shared prepare UI
// state, so a superseded invocation's cleanup cannot wipe the overlay that a
// newer invocation just put up.
let playbackPrepareOwnerToken = 0;

export interface PlaybackPrepareUiState {
  active: boolean;
  overlayVisible: boolean;
  title: string;
  detail: string;
  progress: number | null;
}

const initialPlaybackPrepareUiState: PlaybackPrepareUiState = {
  active: false,
  overlayVisible: false,
  title: "Preparing playback",
  detail: "",
  progress: null,
};

let playbackPrepareUiState: PlaybackPrepareUiState = initialPlaybackPrepareUiState;
const playbackPrepareUiListeners = new Set<() => void>();

declare global {
  interface Window {
    __OTOMAD_PREPARE_PLAYBACK_MEASUREMENT__?: PreparePlaybackRequestMeasurement;
    __OTOMAD_CAPTURE_MEMORY_DIAGNOSTICS__?: () => Promise<RuntimeMemoryDiagnosticsReport>;
    __OTOMAD_RESET_TRANSFER_MEMORY_DIAGNOSTICS__?: () => void;
    __OTOMAD_MEMORY_SCENARIOS__?: MemoryScenarioEstimate[];
  }
}

function updateLatestPreparePlaybackMeasurement(
  mutate: (measurement: PreparePlaybackRequestMeasurement) => void,
): void {
  const measurement = projectWorkerClient.getLatestPreparePlaybackMeasurement();
  if (!measurement) {
    return;
  }
  mutate(measurement);
  window.__OTOMAD_PREPARE_PLAYBACK_MEASUREMENT__ = measurement;
  console.info("[prepare-playback-measurement]", measurement);
}

function collectKnownMainRenderKeys(): Set<string> {
  return runtimeCaches.collectKnownRenderKeys();
}

function subscribePlaybackPrepareUiState(listener: () => void): () => void {
  playbackPrepareUiListeners.add(listener);
  return () => {
    playbackPrepareUiListeners.delete(listener);
  };
}

function getPlaybackPrepareUiStateSnapshot(): PlaybackPrepareUiState {
  return playbackPrepareUiState;
}

function setPlaybackPrepareUiState(nextState: PlaybackPrepareUiState): void {
  playbackPrepareUiState = nextState;
  for (const listener of playbackPrepareUiListeners) {
    listener();
  }
}

function resetPlaybackPrepareUiState(): void {
  setPlaybackPrepareUiState(initialPlaybackPrepareUiState);
}

function getPreparePlaybackPhaseLabel(phase: string): string {
  switch (phase) {
    case "analyzing":
      return "Analyzing source audio";
    case "compiling":
      return "Compiling pitch plan";
    case "enumerating_candidates":
      return "Enumerating playback clips";
    case "building_render_keys":
      return "Reusing cached clip buffers";
    case "rendering_missing_buffers":
      return "Rendering missing clip buffers";
    case "finalizing":
      return "Finalizing playback";
    default:
      return "Finalizing playback";
  }
}

function shouldDispatchBusyProgressUpdate(phase: string, progress: number): boolean {
  const progressBucket = progress >= 1 ? 100 : Math.floor(progress * 10);
  if (!latestBusyProgressUpdate) {
    latestBusyProgressUpdate = { phase, progressBucket };
    return true;
  }
  if (
    latestBusyProgressUpdate.phase === phase &&
    latestBusyProgressUpdate.progressBucket === progressBucket
  ) {
    return false;
  }
  latestBusyProgressUpdate = { phase, progressBucket };
  return true;
}

export function usePlaybackPrepareUiState(): PlaybackPrepareUiState {
  return useSyncExternalStore(
    subscribePlaybackPrepareUiState,
    getPlaybackPrepareUiStateSnapshot,
    getPlaybackPrepareUiStateSnapshot,
  );
}

export function clearAudioEngineRuntimeCaches(): void {
  playbackPrepareOwnerToken += 1;
  runtimeCaches.clear();
  latestBusyProgressUpdate = null;
  resetPlaybackPrepareUiState();
}

export async function ensureProjectWorkerRuntimeCaches(
  projectRevision: number,
): Promise<void> {
  await projectWorkerRecovery.ensureWorkerCaches(projectRevision);
}

async function captureRuntimeMemoryDiagnostics(): Promise<RuntimeMemoryDiagnosticsReport> {
  const worker = await projectWorkerClient.measureRuntimeMemory();
  const playback = runtimeCaches.getMemorySnapshot();
  const main = {
    sourceAudioBuffers: measureAudioBufferSources(
      Array.from(mediaCache.entries(), ([, buffer]) => buffer),
    ),
    renderedAudioBuffers: playback.renderedAudioBuffers,
    preparedRenderedPcm: playback.preparedRenderedPcm,
    analysis: measureAnalysisArtifacts(analysisStore.getStore()),
  };
  // Capture UA memory after deterministic JSON-size probes have released
  // their temporary strings, so the diagnostic itself does not inflate the
  // browser-wide number.
  const userAgentSpecificBytes = await measureUserAgentSpecificBytes();
  return {
    capturedAt: new Date().toISOString(),
    workerGeneration: projectWorkerClient.getWorkerGeneration(),
    main,
    worker,
    transfer: projectWorkerClient.getTransferMemorySnapshot(),
    userAgentSpecificBytes,
  };
}

function resetTransferMemoryDiagnostics(): void {
  projectWorkerClient.resetTransferMemorySnapshot();
}

async function measureUserAgentSpecificBytes(): Promise<number | null> {
  const memoryPerformance = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (!memoryPerformance.measureUserAgentSpecificMemory) {
    return null;
  }
  try {
    return (await memoryPerformance.measureUserAgentSpecificMemory()).bytes;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  window.__OTOMAD_CAPTURE_MEMORY_DIAGNOSTICS__ = captureRuntimeMemoryDiagnostics;
  window.__OTOMAD_RESET_TRANSFER_MEMORY_DIAGNOSTICS__ = resetTransferMemoryDiagnostics;
  window.__OTOMAD_MEMORY_SCENARIOS__ = buildMemoryScenarioMatrix();
}

projectWorkerClient.subscribeWorkerReset(({ workerGeneration }) => {
  pendingPlaybackRequestId = null;
  clearAudioEngineRuntimeCaches();
  projectWorkerRecovery.markWorkerReset(workerGeneration);
});

interface PlaybackStateSnapshot {
  document: ReturnType<typeof useDocumentState>["document"];
  projectRevision: number;
  playheadTick: number;
  loopEnabled: boolean;
  timeSelectionStartTick: number | null;
  timeSelectionEndTick: number | null;
}

/**
 * React hook that integrates PlaybackEngine with the project store.
 *
 * Provides play/stop controls, media loading, and automatic playhead
 * updates via requestAnimationFrame while playing.
 */
export function useAudioEngine() {
  const documentState = useDocumentState();
  const selectionState = useSelectionState();
  const transportState = useTransportState();
  const actions = useProjectActions();
  const stopRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<PlaybackStateSnapshot>({
    document: documentState.document,
    projectRevision: documentState.projectRevision,
    playheadTick: transportState.playheadTick,
    loopEnabled: transportState.loopEnabled,
    timeSelectionStartTick: selectionState.timeSelectionStartTick,
    timeSelectionEndTick: selectionState.timeSelectionEndTick,
  });
  useLayoutEffect(() => {
    stateRef.current = {
      document: documentState.document,
      projectRevision: documentState.projectRevision,
      playheadTick: transportState.playheadTick,
      loopEnabled: transportState.loopEnabled,
      timeSelectionStartTick: selectionState.timeSelectionStartTick,
      timeSelectionEndTick: selectionState.timeSelectionEndTick,
    };
  }, [documentState, selectionState, transportState]);

  // Initialize AudioContext on first user interaction
  const ensureInit = useCallback(async () => {
    await engine.init();
  }, []);

  // Playhead update loop
  const startPlayheadLoop = useCallback(() => {
    if (sharedPlaybackState.rafId) {
      cancelAnimationFrame(sharedPlaybackState.rafId);
      sharedPlaybackState.rafId = 0;
    }

    const tick = () => {
      const currentState = stateRef.current;
      const doc = currentState.document;
      if (doc && engine.playing) {
        const currentTick = engine.getCurrentTick(doc);
        const loopRange = getTimeSelectionRange(currentState);
        const restartTick = getLoopRestartTick(
          currentTick,
          currentState.loopEnabled,
          loopRange?.startTick ?? null,
          loopRange?.endTick ?? null,
        );
        if (restartTick !== null) {
          sharedPlaybackState.playStartTick = restartTick;
          // Loop restart is a *boundary* — commit into React state.
          livePlayheadStore.set(restartTick);
          actions.setPlayhead(restartTick);
          const cachedSchedule = runtimeCaches.getPreparedSchedule();
          if (runtimeCaches.canReusePreparedSchedule(
            currentState.projectRevision,
            restartTick,
          )) {
            engine.playPrepared(cachedSchedule!);
          } else {
            stopRef.current?.();
          }
          sharedPlaybackState.rafId = requestAnimationFrame(tick);
          return;
        }

        // Per-frame updates bypass React: the live store notifies imperative
        // subscribers (playhead markers), the transport store is untouched.
        livePlayheadStore.set(Math.round(currentTick));
        sharedPlaybackState.rafId = requestAnimationFrame(tick);
        return;
      }
      sharedPlaybackState.rafId = 0;
    };
    sharedPlaybackState.rafId = requestAnimationFrame(tick);
  }, [actions]);

  const stopPlayheadLoop = useCallback(() => {
    if (sharedPlaybackState.rafId) {
      cancelAnimationFrame(sharedPlaybackState.rafId);
      sharedPlaybackState.rafId = 0;
    }
    // Commit the last live tick back into React state so consumers that read
    // `transportState.playheadTick` see the position where playback stopped.
    actions.setPlayhead(livePlayheadStore.getSnapshot());
  }, [actions]);

  // Play: build schedule from current project state
  const play = useCallback(async () => {
    const doc = stateRef.current.document;
    if (!doc) return;

    mediaAvailabilityRegistry.reconcile(doc, (mediaId) => mediaCache.has(mediaId));
    try {
      mediaAvailabilityRegistry.assertReferencedMediaAvailable(doc, "play");
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : String(error));
      return;
    }

    await ensureInit();
    const loopRange = getTimeSelectionRange(stateRef.current);
    const startTick = getEffectivePlaybackStartTick(
      stateRef.current.playheadTick,
      stateRef.current.loopEnabled,
      loopRange?.startTick ?? null,
      loopRange?.endTick ?? null,
    );
    sharedPlaybackState.playStartTick = startTick;
    stopPlayheadLoop();
    livePlayheadStore.set(startTick);
    actions.setPlayhead(startTick);

    const projectRevision = stateRef.current.projectRevision;
    const cachedSchedule = runtimeCaches.getPreparedSchedule();
    const cacheMissReason: "empty" | "project_revision" | "start_tick" = cachedSchedule === null
      ? "empty"
      : cachedSchedule.projectRevision !== projectRevision
      ? "project_revision"
      : "start_tick";
    if (runtimeCaches.canReusePreparedSchedule(projectRevision, startTick)) {
      engine.playPrepared(cachedSchedule!);
      actions.setPlaying(true);
      startPlayheadLoop();
      return;
    }

    if (pendingPlaybackRequestId) {
      projectWorkerClient.cancelRequest(
        pendingPlaybackRequestId,
        projectRevision,
      );
      pendingPlaybackRequestId = null;
    }

    const initialBusyTaskStartedAt = performance.now();
    latestBusyProgressUpdate = null;
    const prepareToken = ++playbackPrepareOwnerToken;
    const showPrepareOverlay = cacheMissReason !== "start_tick";
    setPlaybackPrepareUiState({
      active: true,
      overlayVisible: showPrepareOverlay,
      title: "Preparing playback",
      detail: showPrepareOverlay ? "Analyzing clips and building playback buffers." : "",
      progress: showPrepareOverlay ? 0 : null,
    });
    const initialBusyTaskDispatchDurationMs = performance.now() - initialBusyTaskStartedAt;

    let requestId: string | null = null;

    try {
      await ensureProjectWorkerRuntimeCaches(projectRevision);
      if (playbackPrepareOwnerToken !== prepareToken) {
        return;
      }
      const request = projectWorkerClient.preparePlayback(
        doc,
        projectRevision,
        startTick,
        collectKnownMainRenderKeys(),
        {
          scheduleCacheMissReason: cacheMissReason,
          outputSampleRate: engine.audioContext?.sampleRate ?? doc.meta.project_sample_rate,
        },
        (progress) => {
          if (!showPrepareOverlay) {
            return;
          }
          if (!shouldDispatchBusyProgressUpdate(progress.phase, progress.progress)) {
            return;
          }
          setPlaybackPrepareUiState({
            active: true,
            overlayVisible: true,
            title: "Preparing playback",
            detail: getPreparePlaybackPhaseLabel(progress.phase),
            progress: progress.progress,
          });
        },
      );
      requestId = request.requestId;
      pendingPlaybackRequestId = requestId;
      const { promise } = request;
      const schedule = await promise;
      pendingPlaybackRequestId = null;
      if (stateRef.current.projectRevision !== schedule.projectRevision) {
        return;
      }
      const playPreparedStartAtMs = nowPerfEpochMs();
      engine.playPrepared(schedule);
      runtimeCaches.setPreparedSchedule(schedule);
      const playPreparedEndAtMs = nowPerfEpochMs();
      updateLatestPreparePlaybackMeasurement((measurement) => {
        measurement.ui.initialBusyTaskDispatchDurationMs = initialBusyTaskDispatchDurationMs;
        measurement.ui.playPreparedStartAtMs = playPreparedStartAtMs;
        measurement.ui.playPreparedEndAtMs = playPreparedEndAtMs;
        measurement.ui.playPreparedDurationMs = playPreparedEndAtMs - playPreparedStartAtMs;
      });
      actions.setPlaying(true);
      startPlayheadLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const requestCanceled =
        error instanceof ProjectWorkerClientError && error.code === "REQUEST_CANCELED";
      if (!requestCanceled) {
        actions.setError(message);
      }
    } finally {
      if (requestId !== null && pendingPlaybackRequestId === requestId) {
        pendingPlaybackRequestId = null;
      }
      if (playbackPrepareOwnerToken === prepareToken) {
        latestBusyProgressUpdate = null;
        const busyTaskClearedAtMs = nowPerfEpochMs();
        updateLatestPreparePlaybackMeasurement((measurement) => {
          measurement.ui.busyTaskClearedAtMs = busyTaskClearedAtMs;
        });
        resetPlaybackPrepareUiState();
      }
    }
  }, [actions, ensureInit, startPlayheadLoop, stopPlayheadLoop]);

  // Stop: stop playback, restore playhead to play-start position
  const stop = useCallback(() => {
    playbackPrepareOwnerToken += 1;
    if (pendingPlaybackRequestId) {
      projectWorkerClient.cancelRequest(
        pendingPlaybackRequestId,
        stateRef.current.projectRevision,
      );
      pendingPlaybackRequestId = null;
    }
    latestBusyProgressUpdate = null;
    resetPlaybackPrepareUiState();
    stopPlayheadLoop();
    livePlayheadStore.set(sharedPlaybackState.playStartTick);
    actions.setPlayhead(sharedPlaybackState.playStartTick);
    engine.stop();
    actions.setPlaying(false);
  }, [stopPlayheadLoop, actions]);

  useLayoutEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // Load a media file into the cache
  const loadMediaFile = useCallback(
    async (mediaId: string, file: File) => {
      await ensureInit();
      const ctx = engine.audioContext;
      if (!ctx) return;
      const buffer = await mediaCache.loadFromFile(mediaId, file, ctx);
      mediaAvailabilityRegistry.markAvailable(mediaId);
      await projectWorkerClient.upsertMediaBuffer(
        mediaId,
        buffer,
        stateRef.current.projectRevision,
      );
    },
    [ensureInit],
  );

  useEffect(() => {
    runtimeCaches.clearPreparedSchedule();
  }, [documentState.projectRevision]);

  // Cleanup on unmount
  useEffect(() => {
    consumerCount += 1;
    return () => {
      consumerCount -= 1;
      if (consumerCount <= 0) {
        consumerCount = 0;
        stopPlayheadLoop();
        clearAudioEngineRuntimeCaches();
      }
    };
  }, [stopPlayheadLoop]);

  return {
    play,
    stop,
    isPlaying: transportState.isPlaying,
    loadMediaFile,
    audioContext: engine.audioContext,
    engine,
  };
}
