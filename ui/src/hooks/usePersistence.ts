import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analysisStore, mediaAvailabilityRegistry, mediaCache } from "@/audio";
import {
  autoSave,
  clearAutoSave,
  deleteBrowserProject,
  listBrowserProjects,
  openBrowserProject as loadBrowserProjectFromStore,
  openProjectFile,
  renameBrowserProject,
  saveBrowserProject,
  saveProjectAs,
  type BrowserProjectSummary,
} from "@/persist/index.ts";
import {
  isZipArchiveBytes,
  makeProjectArchiveFileName,
  parseProjectArchiveAnalysisFiles,
  PROJECT_ARCHIVE_EXTENSION,
  PROJECT_ARCHIVE_MIME,
} from "@/persist/projectArchive.ts";
import { loadProjectDocument } from "@/adapters/projectDocument.ts";
import { useDocumentState, useProjectActions } from "@/store";
import type { ProjectDocument } from "@/types";
import { projectWorkerClient } from "@/worker";
import {
  clearAudioEngineRuntimeCaches,
  ensureProjectWorkerRuntimeCaches,
  useAudioEngine,
} from "./useAudioEngine.ts";
import type { WorkerAnalysisArtifactEntry } from "@/worker";

const AUTOSAVE_INTERVAL_MS = 30_000;
const textDecoder = new TextDecoder();

export interface PersistenceAPI {
  createNewProject: () => void;
  save: () => Promise<boolean>;
  importProjectFile: () => Promise<boolean>;
  openBrowserProject: (projectId: string) => Promise<boolean>;
  renameBrowserProject: (projectId: string, nextName: string) => Promise<boolean>;
  deleteBrowserProject: (projectId: string) => Promise<boolean>;
  downloadProjectArchive: () => Promise<boolean>;
  refreshBrowserProjects: () => Promise<void>;
  browserProjects: BrowserProjectSummary[];
  currentBrowserProject: BrowserProjectSummary | null;
  isLoadingBrowserProjects: boolean;
  hasUnsavedChanges: boolean;
}

interface PersistenceStateSnapshot {
  document: ProjectDocument | null;
  projectRevision: number;
  hasUnsavedChanges: boolean;
}

export function usePersistence(): PersistenceAPI {
  const documentState = useDocumentState();
  const actions = useProjectActions();
  const { engine } = useAudioEngine();

  const stateRef = useRef<PersistenceStateSnapshot>({
    document: documentState.document,
    projectRevision: documentState.projectRevision,
    hasUnsavedChanges: documentState.hasUnsavedChanges,
  });
  const [browserProjects, setBrowserProjects] = useState<BrowserProjectSummary[]>([]);
  const [currentBrowserProject, setCurrentBrowserProject] = useState<BrowserProjectSummary | null>(null);
  const [isLoadingBrowserProjects, setIsLoadingBrowserProjects] = useState(false);
  const currentBrowserProjectRef = useRef<BrowserProjectSummary | null>(null);

  useLayoutEffect(() => {
    stateRef.current = {
      document: documentState.document,
      projectRevision: documentState.projectRevision,
      hasUnsavedChanges: documentState.hasUnsavedChanges,
    };
    currentBrowserProjectRef.current = currentBrowserProject;
  }, [currentBrowserProject, documentState]);

  const refreshBrowserProjects = useCallback(async () => {
    setIsLoadingBrowserProjects(true);
    try {
      setBrowserProjects(await listBrowserProjects());
    } finally {
      setIsLoadingBrowserProjects(false);
    }
  }, []);

  useEffect(() => {
    void refreshBrowserProjects();
  }, [refreshBrowserProjects]);

  const createNewProject = useCallback(() => {
    clearAudioEngineRuntimeCaches();
    actions.createProject("New Project", 120, 44100);
    actions.setHasUnsavedChanges(true);
    currentBrowserProjectRef.current = null;
    setCurrentBrowserProject(null);
    actions.setError(null);
  }, [actions]);

  const hydrateProjectFromArchive = useCallback(
    async (
      archiveBytes: Uint8Array,
      sourceName: string,
      nextRevision: number,
      browserProject: BrowserProjectSummary | null,
    ) => {
      await engine.init();
      const ctx = engine.audioContext;
      if (!ctx) {
        throw new Error("Audio context is unavailable for project media hydration.");
      }

      actions.setBusyTask({
        kind: "opening",
        title: "Opening project",
        detail: "Parsing archive in the background.",
        progress: 0.2,
      });
      const archive = await projectWorkerClient.parseProjectArchive(
        copyUint8ArrayToArrayBuffer(archiveBytes),
        sourceName,
      );
      const doc = loadProjectDocument(archive.projectJson);
      const archiveAnalysisMap = new Map(
        archive.analysisEntries.map((entry) => [entry.path, entry.bytes] as const),
      );
      const stagedAnalysis = parseProjectArchiveAnalysisFiles(archiveAnalysisMap);

      actions.setBusyTask({
        kind: "opening",
        title: "Opening project",
        detail: "Hydrating archived media.",
        progress: 0.55,
      });

      clearAudioEngineRuntimeCaches();
      analysisStore.clear();
      mediaCache.clear();
      for (const entry of archive.hydratedMediaEntries) {
        mediaCache.loadFromAudioBufferData(entry.mediaId, entry.buffer, ctx);
      }
      for (const [analysisId, artifact] of stagedAnalysis.entries()) {
        switch (artifact.kind) {
          case "f0_track":
            analysisStore.setF0(artifact.media_id, artifact, analysisId);
            break;
          case "pitch_marks":
            analysisStore.setPitchMarks(artifact.media_id, artifact, analysisId);
            break;
          case "waveform_peaks":
            break;
        }
      }

      actions.setBusyTask({
        kind: "opening",
        title: "Opening project",
        detail: "Syncing worker media cache.",
        progress: 0.85,
      });
      await projectWorkerClient.replaceMedia(
        archive.hydratedMediaEntries,
        nextRevision,
        "replace_all",
      );
      const analysisEntries: WorkerAnalysisArtifactEntry[] = Array.from(stagedAnalysis.entries()).map(
        ([analysisId, artifact]) => ({ analysisId, artifact }),
      );
      await projectWorkerClient.replaceAnalysisArtifacts(
        analysisEntries,
        nextRevision,
        "replace_all",
      );
      actions.setProject(doc, { resetRuntimeCaches: false, revision: nextRevision });
      for (const issue of archive.mediaIssues) {
        if (issue.status === "invalid") {
          mediaAvailabilityRegistry.markInvalid(issue.mediaId, issue.message);
        } else {
          mediaAvailabilityRegistry.markMissing(issue.mediaId, issue.message);
        }
      }
      currentBrowserProjectRef.current = browserProject;
      setCurrentBrowserProject(browserProject);
    },
    [actions, engine],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!current.document) {
      return false;
    }

    try {
      mediaAvailabilityRegistry.reconcile(
        current.document,
        (mediaId) => mediaCache.has(mediaId),
      );
      mediaAvailabilityRegistry.assertReferencedMediaAvailable(current.document, "save");
      actions.setBusyTask({
        kind: "saving",
        title: "Saving project",
        detail: "Building browser save archive.",
        progress: null,
      });
      await ensureProjectWorkerRuntimeCaches(current.projectRevision);
      const archiveBytes = await projectWorkerClient.buildProjectArchive(
        current.document,
        current.projectRevision,
      );
      if (stateRef.current.projectRevision !== current.projectRevision) {
        return false;
      }

      actions.setBusyTask({
        kind: "saving",
        title: "Saving project",
        detail: "Writing project into browser storage.",
        progress: null,
      });
      const savedProject = await saveBrowserProject({
        projectId: currentBrowserProjectRef.current?.id,
        name: current.document.meta.name,
        archiveBytes,
      });
      currentBrowserProjectRef.current = savedProject;
      setCurrentBrowserProject(savedProject);
      await refreshBrowserProjects();
      actions.markSaved();
      actions.setError(null);
      await clearAutoSave();
      return true;
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      actions.clearBusyTask();
    }
  }, [actions, refreshBrowserProjects]);

  const importProjectFile = useCallback(async (): Promise<boolean> => {
    try {
      actions.setBusyTask({
        kind: "opening",
        title: "Opening project",
        detail: "Reading project file.",
        progress: 0,
      });
      const result = await openProjectFile();
      if (!result) {
        return false;
      }

      const fileBytes = new Uint8Array(await result.file.arrayBuffer());
      const shouldParseArchive =
        isZipArchiveBytes(fileBytes) ||
        result.fileName.toLowerCase().endsWith(PROJECT_ARCHIVE_EXTENSION);
      const nextRevision = stateRef.current.projectRevision + 1;

      if (shouldParseArchive) {
        await hydrateProjectFromArchive(fileBytes, result.fileName, nextRevision, null);
      } else {
        const doc = loadProjectDocument(textDecoder.decode(fileBytes));
        clearAudioEngineRuntimeCaches();
        await projectWorkerClient.clearProjectCache(nextRevision);
        actions.setProject(doc, { revision: nextRevision });
        currentBrowserProjectRef.current = null;
        setCurrentBrowserProject(null);
      }

      actions.setBusyTask({
        kind: "opening",
        title: "Opening project",
        detail: "Finalizing project state.",
        progress: 1,
      });
      if (shouldParseArchive) {
        actions.markSaved();
      } else {
        // JSON imports intentionally contain no media bytes. Keep the project
        // dirty until the user relinks media and creates a complete archive.
        actions.setHasUnsavedChanges(true);
      }
      actions.setError(null);
      await clearAutoSave();
      return true;
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      actions.clearBusyTask();
    }
  }, [actions, hydrateProjectFromArchive]);

  const openBrowserProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      try {
        actions.setBusyTask({
          kind: "opening",
          title: "Opening project",
          detail: "Loading browser-saved project.",
          progress: 0,
        });
        const snapshot = await loadBrowserProjectFromStore(projectId);
        if (!snapshot) {
          actions.setError("The selected browser-saved project could not be found.");
          return false;
        }

        const nextRevision = stateRef.current.projectRevision + 1;
        await hydrateProjectFromArchive(
          snapshot.archiveBytes,
          `${snapshot.metadata.name}.zip`,
          nextRevision,
          snapshot.metadata,
        );

        actions.setBusyTask({
          kind: "opening",
          title: "Opening project",
          detail: "Refreshing recent projects.",
          progress: 1,
        });
        await refreshBrowserProjects();
        actions.markSaved();
        actions.setError(null);
        await clearAutoSave();
        return true;
      } catch (err) {
        actions.setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        actions.clearBusyTask();
      }
    },
    [actions, hydrateProjectFromArchive, refreshBrowserProjects],
  );

  const renameSavedBrowserProject = useCallback(
    async (projectId: string, nextName: string): Promise<boolean> => {
      try {
        actions.setBusyTask({
          kind: "saving",
          title: "Renaming saved project",
          detail: "Updating browser project metadata.",
          progress: null,
        });
        const renamed = await renameBrowserProject(projectId, nextName);
        if (!renamed) {
          actions.setError("The selected browser-saved project could not be renamed.");
          return false;
        }

        if (currentBrowserProjectRef.current?.id === projectId) {
          currentBrowserProjectRef.current = renamed;
          setCurrentBrowserProject(renamed);
          if (stateRef.current.document) {
            actions.setProjectName(renamed.name);
          }
        }

        await refreshBrowserProjects();
        actions.setError(null);
        return true;
      } catch (err) {
        actions.setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        actions.clearBusyTask();
      }
    },
    [actions, refreshBrowserProjects],
  );

  const deleteSavedBrowserProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      try {
        actions.setBusyTask({
          kind: "saving",
          title: "Deleting saved project",
          detail: "Removing browser project entry.",
          progress: null,
        });
        await deleteBrowserProject(projectId);

        if (currentBrowserProjectRef.current?.id === projectId) {
          currentBrowserProjectRef.current = null;
          setCurrentBrowserProject(null);
          actions.setHasUnsavedChanges(true);
        }

        await refreshBrowserProjects();
        actions.setError(null);
        return true;
      } catch (err) {
        actions.setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        actions.clearBusyTask();
      }
    },
    [actions, refreshBrowserProjects],
  );

  const downloadProjectArchive = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!current.document) {
      return false;
    }

    try {
      mediaAvailabilityRegistry.reconcile(
        current.document,
        (mediaId) => mediaCache.has(mediaId),
      );
      mediaAvailabilityRegistry.assertReferencedMediaAvailable(current.document, "save");
      actions.setBusyTask({
        kind: "saving",
        title: "Downloading project ZIP",
        detail: "Building project archive.",
        progress: null,
      });
      await ensureProjectWorkerRuntimeCaches(current.projectRevision);
      const archiveBytes = await projectWorkerClient.buildProjectArchive(
        current.document,
        current.projectRevision,
      );
      if (stateRef.current.projectRevision !== current.projectRevision) {
        return false;
      }

      actions.setBusyTask({
        kind: "saving",
        title: "Downloading project ZIP",
        detail: "Sending archive to the browser download flow.",
        progress: null,
      });
      const archiveBlob = new Blob([Uint8Array.from(archiveBytes)], {
        type: PROJECT_ARCHIVE_MIME,
      });
      const saved = await saveProjectAs(
        archiveBlob,
        makeProjectArchiveFileName(current.document.meta.name),
      );
      if (!saved) {
        return false;
      }

      actions.setError(null);
      return true;
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      actions.clearBusyTask();
    }
  }, [actions]);

  useEffect(() => {
    const id = setInterval(() => {
      const current = stateRef.current;
      if (current.hasUnsavedChanges && current.document) {
        const json = JSON.stringify(current.document, null, 2);
        autoSave(json).catch((err) => console.error("Autosave failed:", err));
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  return useMemo(
    () => ({
      createNewProject,
      save,
      importProjectFile,
      openBrowserProject,
      renameBrowserProject: renameSavedBrowserProject,
      deleteBrowserProject: deleteSavedBrowserProject,
      downloadProjectArchive,
      refreshBrowserProjects,
      browserProjects,
      currentBrowserProject,
      isLoadingBrowserProjects,
      hasUnsavedChanges: documentState.hasUnsavedChanges,
    }),
    [
      browserProjects,
      createNewProject,
      currentBrowserProject,
      deleteSavedBrowserProject,
      downloadProjectArchive,
      importProjectFile,
      isLoadingBrowserProjects,
      openBrowserProject,
      refreshBrowserProjects,
      renameSavedBrowserProject,
      save,
      documentState.hasUnsavedChanges,
    ],
  );
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
