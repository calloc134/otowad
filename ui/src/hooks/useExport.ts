// =============================================================================
// useExport — hook for offline WAV rendering and file export
// =============================================================================

import { useCallback, useRef, useState } from "react";
import { mediaAvailabilityRegistry, mediaCache } from "@/audio";
import type { RenderProgress } from "@/render";
import {
  getTimeSelectionRange,
  useDocumentState,
  useProjectActions,
  useSelectionState,
} from "@/store";
import { projectWorkerClient } from "@/worker";
import { ensureProjectWorkerRuntimeCaches } from "./useAudioEngine.ts";
import {
  collectTrackMidiExportData,
  encodeSingleTrackSmf,
  MIDI_EXPORT_CHANNEL,
} from "@/utils/midiSmf.ts";

const WAV_FILE_TYPE_OPTION: FilePickerAcceptType = {
  description: "WAV Audio",
  accept: { "audio/wav": [".wav"] },
};

const MIDI_FILE_TYPE_OPTION: FilePickerAcceptType = {
  description: "MIDI File",
  accept: {
    "audio/midi": [".mid", ".midi"],
    "application/x-midi": [".mid", ".midi"],
  },
};

function sanitizeFileStem(
  value: string | null | undefined,
  fallback: string,
): string {
  const baseName = (value ?? "").trim() || fallback;
  const sanitized = baseName
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized || fallback;
}

function makeMidiTrackFileName(
  projectName: string | null | undefined,
  trackName: string | null | undefined,
): string {
  return `${sanitizeFileStem(projectName, "project")}-${sanitizeFileStem(trackName, "midi-track")}.mid`;
}

function makeAudioTrackFileName(
  projectName: string | null | undefined,
  trackName: string | null | undefined,
): string {
  return `${sanitizeFileStem(projectName, "project")}-${sanitizeFileStem(trackName, "audio-track")}.wav`;
}

async function saveBinaryFile(
  bytes: ArrayBuffer | Uint8Array,
  suggestedName: string,
  typeOption: FilePickerAcceptType,
  mimeType: string,
): Promise<void> {
  const arrayBuffer = bytes instanceof Uint8Array
    ? Uint8Array.from(bytes).buffer
    : bytes;

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        types: [typeOption],
        suggestedName,
      });
      const writable = await handle.createWritable();
      await writable.write(arrayBuffer);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  }

  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function useExport() {
  const documentState = useDocumentState();
  const selectionState = useSelectionState();
  const actions = useProjectActions();
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(
    null,
  );
  const renderingRef = useRef(false);

  const exportWav = useCallback(async () => {
    const doc = documentState.document;
    if (!doc) {
      throw new Error("No project loaded");
    }

    if (renderingRef.current) return;
    renderingRef.current = true;
    setIsRendering(true);
    setRenderProgress({ phase: "preparing", progress: 0 });
    actions.setBusyTask({
      kind: "exporting",
      title: "Exporting WAV",
      detail: "Preparing offline render in the background.",
      progress: 0,
    });

    try {
      mediaAvailabilityRegistry.reconcile(doc, (mediaId) => mediaCache.has(mediaId));
      mediaAvailabilityRegistry.assertReferencedMediaAvailable(doc, "export");
      await ensureProjectWorkerRuntimeCaches(documentState.projectRevision);
      const { promise } = projectWorkerClient.renderWavExport(
        doc,
        documentState.projectRevision,
        {
          sampleRate: doc.meta.project_sample_rate,
          channels: 2,
          startTick: getTimeSelectionRange(selectionState)?.startTick,
          endTick: getTimeSelectionRange(selectionState)?.endTick,
        },
        (progress) => {
          const renderProgressPayload = {
            phase: progress.phase === "mixing"
              ? "rendering"
              : progress.phase === "done"
              ? "done"
              : "preparing",
            progress: progress.progress,
          } satisfies RenderProgress;
          setRenderProgress(renderProgressPayload);
          actions.setBusyTask({
            kind: "exporting",
            title: "Exporting WAV",
            detail: `Phase: ${progress.phase}`,
            progress: progress.progress,
          });
        },
      );
      const wavBytes = await promise;
      actions.setBusyTask({
        kind: "exporting",
        title: "Exporting WAV",
        detail: "Writing file to disk.",
        progress: 1,
      });

      const fileName = `${sanitizeFileStem(doc.meta.name, "project")}.wav`;
      await saveBinaryFile(
        wavBytes,
        fileName,
        WAV_FILE_TYPE_OPTION,
        "audio/wav",
      );
    } finally {
      renderingRef.current = false;
      setIsRendering(false);
      setRenderProgress(null);
      actions.clearBusyTask();
    }
  }, [actions, documentState, selectionState]);

  const exportMidiTrack = useCallback(
    async (trackId: string) => {
      try {
        const doc = documentState.document;
        if (!doc) {
          throw new Error("No project loaded.");
        }

        const track = doc.edit.tracks.find((candidate) => candidate.id === trackId);
        if (!track) {
          throw new Error(`Track ${trackId} was not found.`);
        }
        if (track.kind.track_type !== "midi") {
          throw new Error("Only MIDI tracks can be exported as .mid files.");
        }

        const exportData = collectTrackMidiExportData(doc, trackId);
        if (exportData.notes.length === 0) {
          throw new Error("Selected MIDI track has no visible MIDI notes to export.");
        }

        const midiBytes = encodeSingleTrackSmf({
          ppq: doc.edit.tempo.ppq,
          notes: exportData.notes,
          ccs: exportData.ccs,
          channel: MIDI_EXPORT_CHANNEL,
        });

        actions.setError(null);
        await saveBinaryFile(
          midiBytes,
          makeMidiTrackFileName(doc.meta.name, track.name),
          MIDI_FILE_TYPE_OPTION,
          "audio/midi",
        );
      } catch (error) {
        actions.setError(error instanceof Error ? error.message : String(error));
      }
    },
    [actions, documentState.document],
  );

  const exportAudioTrack = useCallback(
    async (trackId: string) => {
      const doc = documentState.document;
      if (!doc) {
        actions.setError("No project loaded.");
        return;
      }

      const track = doc.edit.tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        actions.setError(`Track ${trackId} was not found.`);
        return;
      }
      if (track.kind.track_type !== "audio") {
        actions.setError("Only audio tracks can be exported as .wav files.");
        return;
      }
      if (renderingRef.current) {
        return;
      }

      renderingRef.current = true;
      setIsRendering(true);
      setRenderProgress({ phase: "preparing", progress: 0 });
      actions.setBusyTask({
        kind: "exporting",
        title: "Exporting track WAV",
        detail: `Preparing ${track.name} for export.`,
        progress: 0,
      });

      try {
        mediaAvailabilityRegistry.reconcile(doc, (mediaId) => mediaCache.has(mediaId));
        mediaAvailabilityRegistry.assertReferencedMediaAvailable(
          doc,
          "export",
          new Set([trackId]),
        );
        await ensureProjectWorkerRuntimeCaches(documentState.projectRevision);
        const { promise } = projectWorkerClient.renderWavExport(
          doc,
          documentState.projectRevision,
          {
            sampleRate: doc.meta.project_sample_rate,
            channels: 2,
            startTick: getTimeSelectionRange(selectionState)?.startTick,
            endTick: getTimeSelectionRange(selectionState)?.endTick,
            trackIds: [trackId],
          },
          (progress) => {
            const renderProgressPayload = {
              phase: progress.phase === "mixing"
                ? "rendering"
                : progress.phase === "done"
                ? "done"
                : "preparing",
              progress: progress.progress,
            } satisfies RenderProgress;
            setRenderProgress(renderProgressPayload);
            actions.setBusyTask({
              kind: "exporting",
              title: "Exporting track WAV",
              detail: `Phase: ${progress.phase}`,
              progress: progress.progress,
            });
          },
        );
        const wavBytes = await promise;

        actions.setError(null);
        actions.setBusyTask({
          kind: "exporting",
          title: "Exporting track WAV",
          detail: "Writing file to disk.",
          progress: 1,
        });
        await saveBinaryFile(
          wavBytes,
          makeAudioTrackFileName(doc.meta.name, track.name),
          WAV_FILE_TYPE_OPTION,
          "audio/wav",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.setError(
          message === "No renderable audio clips found in the project."
            ? "Selected audio track has no renderable audio clips to export."
            : message,
        );
      } finally {
        renderingRef.current = false;
        setIsRendering(false);
        setRenderProgress(null);
        actions.clearBusyTask();
      }
    },
    [actions, documentState, selectionState],
  );

  return {
    exportWav,
    exportAudioTrack,
    exportMidiTrack,
    isRendering,
    renderProgress,
  };
}
