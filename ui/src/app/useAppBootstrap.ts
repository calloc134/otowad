import { useEffect, useRef } from "react";
import init from "@/wasm/otomad_core";
import type { ProjectActions } from "@/store";
import { clearAudioEngineRuntimeCaches } from "@/hooks/useAudioEngine.ts";
import { loadAutoSave, quarantineAutoSave } from "@/persist/index.ts";
import { loadProjectDocument } from "@/adapters/projectDocument.ts";

export const AUTOSAVE_RESTORE_CONFIRM_MESSAGE =
  "An autosaved project was found. Restore JSON-only crash recovery data?\n\nImported media buffers are not fully recoverable from autosave alone. Reopen a saved project archive if you need media restored.";

export function useAppBootstrap(
  actions: ProjectActions,
  refreshBrowserProjects: () => Promise<void>,
): void {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) {
      return;
    }
    initialized.current = true;

    void init().then(async () => {
      actions.initWasm();

      try {
        const autoSaveJson = await loadAutoSave();
        if (autoSaveJson) {
          const shouldRestore = window.confirm(AUTOSAVE_RESTORE_CONFIRM_MESSAGE);
          if (shouldRestore) {
            try {
              const document = loadProjectDocument(autoSaveJson);
              clearAudioEngineRuntimeCaches();
              actions.setProject(document);
              actions.setHasUnsavedChanges(true);
              return;
            } catch (error) {
              console.error("Failed to parse autosaved project:", error);
              await quarantineAutoSave();
            }
          } else {
            await quarantineAutoSave();
          }
        }
      } catch (error) {
        console.error("Failed to check autosave:", error);
      }

      await refreshBrowserProjects();
      actions.createProject("Untitled Project", 120, 44100);
    });
  }, [actions, refreshBrowserProjects]);
}
