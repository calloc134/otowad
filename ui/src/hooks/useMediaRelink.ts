import { useCallback, useSyncExternalStore } from "react";

import {
  mediaAvailabilityRegistry,
  mediaCache,
  type MediaAvailabilityEntry,
  validateRelinkCandidate,
  validateRelinkContentIdentity,
} from "@/audio";
import { decodeAudioFile } from "@/audio/audioFileDecoder.ts";
import { useDocumentState, useProjectActions } from "@/store";
import { projectWorkerClient } from "@/worker";
import {
  clearAudioEngineRuntimeCaches,
  useAudioEngine,
} from "./useAudioEngine.ts";

export interface MediaRelinkAPI {
  unavailableMedia: readonly MediaAvailabilityEntry[];
  relinkNextUnavailableMedia: () => Promise<boolean>;
}

export function useMediaRelink(): MediaRelinkAPI {
  const documentState = useDocumentState();
  const actions = useProjectActions();
  const { engine } = useAudioEngine();
  useSyncExternalStore(
    mediaAvailabilityRegistry.subscribe,
    mediaAvailabilityRegistry.getSnapshot,
    mediaAvailabilityRegistry.getSnapshot,
  );

  const document = documentState.document;
  const unavailableMedia = document
    ? mediaAvailabilityRegistry.collectUnavailableReferencedMedia(document)
    : [];

  const relinkNextUnavailableMedia = useCallback(async (): Promise<boolean> => {
    const currentDocument = documentState.document;
    if (!currentDocument) {
      return false;
    }
    const target = mediaAvailabilityRegistry.collectUnavailableReferencedMedia(currentDocument)[0];
    if (!target) {
      return false;
    }
    const asset = currentDocument.edit.media.find((candidate) => candidate.id === target.mediaId);
    if (!asset) {
      return false;
    }

    const file = await pickAudioRelinkFile();
    if (!file) {
      return false;
    }

    let accepted = false;
    mediaAvailabilityRegistry.markRelinking(asset.id);
    actions.setBusyTask({
      kind: "importing",
      title: "Relinking media",
      detail: `Checking ${file.name} for ${asset.original_name || asset.id}.`,
      progress: null,
    });
    try {
      const audioContext = engine.ensureAudioContext();
      const decodedSource = await decodeAudioFile(file, audioContext);
      const buffer = decodedSource.toAudioBuffer(audioContext);
      const validationError = validateRelinkCandidate(asset, buffer);
      if (validationError) {
        throw new Error(validationError);
      }
      const contentHash = await projectWorkerClient.hashAudioBuffer(
        buffer,
        documentState.projectRevision,
      );
      const identityError = validateRelinkContentIdentity(asset, file.name, contentHash);
      if (identityError) {
        throw new Error(identityError);
      }

      mediaCache.set(asset.id, buffer);
      mediaAvailabilityRegistry.markAvailable(asset.id);
      clearAudioEngineRuntimeCaches();
      accepted = true;
      await projectWorkerClient.upsertMediaBuffer(
        asset.id,
        buffer,
        documentState.projectRevision,
      );
      actions.setHasUnsavedChanges(true);
      actions.setError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!accepted) {
        mediaAvailabilityRegistry.markInvalid(asset.id, message);
      }
      actions.setError(`Failed to relink ${asset.original_name || asset.id}: ${message}`);
      return false;
    } finally {
      actions.clearBusyTask();
    }
  }, [actions, documentState.document, documentState.projectRevision, engine]);

  return { unavailableMedia, relinkNextUnavailableMedia };
}

function pickAudioRelinkFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
