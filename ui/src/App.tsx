import { ProjectProvider, useProject, useProjectActions } from "@/store";
import {
  useAudioEngine,
  usePlaybackPrepareUiState,
} from "@/hooks/useAudioEngine.ts";
import { usePersistence } from "@/hooks/usePersistence.ts";
import { useExport } from "@/hooks/useExport.ts";
import { DialogStackProvider } from "@/app/dialogStack.tsx";
import { InteractionModeProvider } from "@/app/interactionMode.tsx";
import {
  AUTOSAVE_RESTORE_CONFIRM_MESSAGE,
  useAppBootstrap,
} from "@/app/useAppBootstrap.ts";
import { usePersistenceLifecycle } from "@/app/usePersistenceLifecycle.ts";
import { useAppGlobalInteraction } from "@/app/useAppGlobalInteraction.ts";
import { DawShell } from "@/components/app-shell/DawShell.tsx";

export { AUTOSAVE_RESTORE_CONFIRM_MESSAGE };

function DawLayout() {
  const { state } = useProject();
  const actions = useProjectActions();
  const audio = useAudioEngine();
  const playbackPrepareUi = usePlaybackPrepareUiState();
  const persistence = usePersistence();
  const { exportWav } = useExport();

  useAppBootstrap(actions, persistence.refreshBrowserProjects);
  usePersistenceLifecycle(persistence.hasUnsavedChanges);
  const interaction = useAppGlobalInteraction({
    state,
    actions,
    persistence,
    playbackPrepareUi,
    exportWav,
    play: audio.play,
    stop: audio.stop,
    isPlaying: audio.isPlaying,
  });

  return (
    <DawShell
      wasmReady={state.wasmReady}
      midiEditorTarget={state.midiEditorTarget}
      busyTask={state.busyTask}
      playbackPrepareUi={playbackPrepareUi}
      persistence={persistence}
      interaction={interaction}
    />
  );
}

export function App() {
  return (
    <ProjectProvider>
      <InteractionModeProvider>
        <DialogStackProvider>
          <DawLayout />
        </DialogStackProvider>
      </InteractionModeProvider>
    </ProjectProvider>
  );
}
