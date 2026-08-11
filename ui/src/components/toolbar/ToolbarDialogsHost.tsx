import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import { BpmDialog } from "@/components/dialogs/BpmDialog";
import { GridDialog } from "@/components/dialogs/GridDialog";
import { PitchLinkDialog } from "@/components/dialogs/PitchLinkDialog";
import { ProjectManagementDialog } from "@/components/dialogs/ProjectManagementDialog";
import { TimeSignatureDialog } from "@/components/dialogs/TimeSignatureDialog";

interface ToolbarDialogsHostProps {
  persistence: PersistenceAPI;
  projectDialogOpen: boolean;
  onProjectDialogClose: () => void;
  bpmDialogOpen: boolean;
  onBpmDialogClose: () => void;
  timeSignatureDialogOpen: boolean;
  onTimeSignatureDialogClose: () => void;
  gridDialogOpen: boolean;
  onGridDialogClose: () => void;
  pitchLinkDialogOpen: boolean;
  onPitchLinkDialogClose: () => void;
  isBusy: boolean;
}

export function ToolbarDialogsHost({
  persistence,
  projectDialogOpen,
  onProjectDialogClose,
  bpmDialogOpen,
  onBpmDialogClose,
  timeSignatureDialogOpen,
  onTimeSignatureDialogClose,
  gridDialogOpen,
  onGridDialogClose,
  pitchLinkDialogOpen,
  onPitchLinkDialogClose,
  isBusy,
}: ToolbarDialogsHostProps) {
  return (
    <>
      <BpmDialog open={bpmDialogOpen} onClose={onBpmDialogClose} />
      <TimeSignatureDialog
        open={timeSignatureDialogOpen}
        onClose={onTimeSignatureDialogClose}
      />
      <GridDialog open={gridDialogOpen} onClose={onGridDialogClose} />
      <PitchLinkDialog
        open={pitchLinkDialogOpen}
        onClose={onPitchLinkDialogClose}
      />

      <ProjectManagementDialog
        open={projectDialogOpen}
        onClose={onProjectDialogClose}
        browserProjects={persistence.browserProjects}
        currentProjectId={persistence.currentBrowserProject?.id ?? null}
        hasUnsavedChanges={persistence.hasUnsavedChanges}
        isBusy={isBusy}
        isLoading={persistence.isLoadingBrowserProjects}
        onNewProject={() => {
          persistence.createNewProject();
          onProjectDialogClose();
        }}
        onSave={() => persistence.save()}
        onOpenProject={async (projectId: string) => {
          const opened = await persistence.openBrowserProject(projectId);
          if (opened) {
            onProjectDialogClose();
          }
        }}
        onImportProject={async () => {
          const opened = await persistence.importProjectFile();
          if (opened) {
            onProjectDialogClose();
          }
        }}
        onDownloadProject={async () => {
          await persistence.downloadProjectArchive();
        }}
        onRefresh={() => persistence.refreshBrowserProjects()}
        onRenameProject={(projectId, nextName) =>
          persistence.renameBrowserProject(projectId, nextName)
        }
        onDeleteProject={(projectId) =>
          persistence.deleteBrowserProject(projectId)
        }
      />
    </>
  );
}
