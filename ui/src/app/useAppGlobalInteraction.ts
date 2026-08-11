import { useState } from "react";
import type { PlaybackPrepareUiState } from "@/hooks/useAudioEngine.ts";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import type { ProjectActions } from "@/store";
import type { ProjectState } from "@/state/projectStoreTypes.ts";
import { useGlobalHotkeys } from "@/app/useGlobalHotkeys.ts";
import { useAnyDialogOpen } from "@/app/dialogStack.tsx";
import {
  usePortraitGuidance,
  useTimelineInteractionPolicy,
} from "@/app/interactionMode.tsx";
import {
  useServiceWorkerUpdate,
  type ServiceWorkerUpdate,
} from "@/hooks/useServiceWorkerUpdate.ts";

interface UseAppGlobalInteractionArgs {
  state: ProjectState;
  actions: ProjectActions;
  persistence: PersistenceAPI;
  playbackPrepareUi: PlaybackPrepareUiState;
  exportWav: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  isPlaying: boolean;
}

export interface AppGlobalInteraction {
  projectDialogOpen: boolean;
  openProjectDialog: () => void;
  closeProjectDialog: () => void;
  showPortraitNotice: boolean;
  dismissPortraitNotice: () => void;
  serviceWorkerUpdate: ServiceWorkerUpdate;
}

export function useAppGlobalInteraction({
  state,
  actions,
  persistence,
  playbackPrepareUi,
  exportWav,
  play,
  stop,
  isPlaying,
}: UseAppGlobalInteractionArgs): AppGlobalInteraction {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [portraitNoticeDismissed, setPortraitNoticeDismissed] = useState(false);
  const timelineInteractionPolicy = useTimelineInteractionPolicy();
  const showPortraitGuidance = usePortraitGuidance();
  const anyDialogOpen = useAnyDialogOpen();
  const serviceWorkerUpdate = useServiceWorkerUpdate();

  useGlobalHotkeys({
    document: state.document,
    selectedClipIds: state.selectedClipIds,
    primaryClipId: state.primaryClipId,
    playheadTick: state.playheadTick,
    midiEditorOpen: state.midiEditorTarget !== null,
    busy: state.busyTask !== null || playbackPrepareUi.active,
    anyDialogOpen,
    projectDialogOpen,
    setProjectDialogOpen,
    isPlaying,
    actions,
    saveProjectToBrowser: persistence.save,
    refreshBrowserProjects: persistence.refreshBrowserProjects,
    exportWav,
    play,
    stop,
    interactionPolicy: timelineInteractionPolicy,
  });

  return {
    projectDialogOpen,
    openProjectDialog: () => {
      setProjectDialogOpen(true);
      void persistence.refreshBrowserProjects();
    },
    closeProjectDialog: () => setProjectDialogOpen(false),
    showPortraitNotice: showPortraitGuidance && !portraitNoticeDismissed,
    dismissPortraitNotice: () => setPortraitNoticeDismissed(true),
    serviceWorkerUpdate,
  };
}
