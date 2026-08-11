import { useEffect, useMemo, useState } from "react";
import { css } from "../../../styled-system/css";
import { useDialogInteractionPolicy } from "@/app/interactionMode.tsx";
import type { BrowserProjectSummary } from "@/persist/index.ts";
import { DialogWrapper } from "./DialogWrapper";
import { ProjectManagementSummaryCard } from "./project-management/ProjectManagementSummaryCard";
import { ProjectManagementActionGrid } from "./project-management/ProjectManagementActionGrid";
import { ProjectManagementListHeader } from "./project-management/ProjectManagementListHeader";
import { ProjectManagementProjectRow } from "./project-management/ProjectManagementProjectRow";

interface ProjectManagementDialogProps {
  open: boolean;
  onClose: () => void;
  browserProjects: BrowserProjectSummary[];
  currentProjectId: string | null;
  hasUnsavedChanges: boolean;
  isBusy: boolean;
  isLoading: boolean;
  onNewProject: () => void;
  onSave: () => Promise<boolean>;
  onOpenProject: (projectId: string) => Promise<void>;
  onImportProject: () => Promise<void>;
  onDownloadProject: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onRenameProject: (projectId: string, nextName: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
}

export function ProjectManagementDialog({
  open,
  onClose,
  browserProjects,
  currentProjectId,
  hasUnsavedChanges,
  isBusy,
  isLoading,
  onNewProject,
  onSave,
  onOpenProject,
  onImportProject,
  onDownloadProject,
  onRefresh,
  onRenameProject,
  onDeleteProject,
}: ProjectManagementDialogProps) {
  const interactionPolicy = useDialogInteractionPolicy();
  const usesTouchActions = interactionPolicy.actionSize === "touch";
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const hasProjects = browserProjects.length > 0;
  const renamingProject = useMemo(
    () => browserProjects.find((project) => project.id === renamingProjectId) ?? null,
    [browserProjects, renamingProjectId],
  );

  useEffect(() => {
    if (!open) {
      setRenamingProjectId(null);
      setRenameValue("");
      setPendingDeleteProjectId(null);
      setBusyProjectId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!renamingProject) {
      return;
    }
    setRenameValue(renamingProject.name);
  }, [renamingProject]);

  const beginRename = (project: BrowserProjectSummary) => {
    if (isBusy || busyProjectId) {
      return;
    }
    setPendingDeleteProjectId(null);
    setRenamingProjectId(project.id);
    setRenameValue(project.name);
  };

  const commitRename = async () => {
    if (!renamingProjectId) {
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName) {
      const currentName = browserProjects.find((project) => project.id === renamingProjectId)?.name ?? "";
      setRenameValue(currentName);
      setRenamingProjectId(null);
      return;
    }

    setBusyProjectId(renamingProjectId);
    const renamed = await onRenameProject(renamingProjectId, nextName);
    setBusyProjectId(null);
    if (renamed) {
      setRenamingProjectId(null);
    }
  };

  const cancelRename = () => {
    setRenamingProjectId(null);
    setRenameValue("");
  };

  const handleDelete = async (projectId: string) => {
    if (pendingDeleteProjectId !== projectId) {
      setRenamingProjectId(null);
      setPendingDeleteProjectId(projectId);
      return;
    }

    setBusyProjectId(projectId);
    const deleted = await onDeleteProject(projectId);
    setBusyProjectId(null);
    if (deleted) {
      setPendingDeleteProjectId(null);
      if (renamingProjectId === projectId) {
        setRenamingProjectId(null);
      }
    }
  };

  const clearDeleteConfirmation = (projectId: string) => {
    if (pendingDeleteProjectId === projectId) {
      setPendingDeleteProjectId(null);
    }
  };

  return (
    <DialogWrapper open={open} onClose={onClose} title="Project Management" width={760}>
      <div className={projectManagementDialogClass} style={styles.layout}>
        <ProjectManagementSummaryCard hasUnsavedChanges={hasUnsavedChanges} />

        <ProjectManagementActionGrid
          usesTouchActions={usesTouchActions}
          isBusy={isBusy}
          onSave={() => {
            void onSave();
          }}
          onNewProject={onNewProject}
          onImportProject={() => {
            void onImportProject();
          }}
          onDownloadProject={() => {
            void onDownloadProject();
          }}
        />

        <ProjectManagementListHeader
          usesTouchActions={usesTouchActions}
          isBusy={isBusy}
          isLoading={isLoading}
          onRefresh={() => {
            void onRefresh();
          }}
        />

        <div style={styles.projectList}>
          {!hasProjects && (
            <div style={styles.emptyState}>
              No browser-saved projects yet. Save the current project to populate this list.
            </div>
          )}

          {browserProjects.map((project) => {
            const isCurrent = currentProjectId === project.id;
            const isRenaming = renamingProjectId === project.id;
            const isDeleteConfirming = pendingDeleteProjectId === project.id;
            const rowBusy = isBusy || busyProjectId === project.id;

            return (
              <ProjectManagementProjectRow
                key={project.id}
                project={project}
                isCurrent={isCurrent}
                isRenaming={isRenaming}
                renameValue={renameValue}
                isDeleteConfirming={isDeleteConfirming}
                rowBusy={rowBusy}
                usesTouchActions={usesTouchActions}
                onBeginRename={() => beginRename(project)}
                onRenameValueChange={setRenameValue}
                onCommitRename={() => {
                  void commitRename();
                }}
                onCancelRename={cancelRename}
                onDelete={() => {
                  void handleDelete(project.id);
                }}
                onClearDeleteConfirmation={() => clearDeleteConfirmation(project.id)}
                onOpenProject={() => {
                  void onOpenProject(project.id);
                }}
              />
            );
          })}
        </div>
      </div>
    </DialogWrapper>
  );
}

const projectManagementDialogClass = css({
  maxHeight: "min(78vh, 760px)",
});

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  projectList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    maxHeight: 360,
    overflow: "auto",
    paddingRight: 4,
  },
  emptyState: {
    padding: "18px 16px",
    borderRadius: 16,
    border: "1px dashed rgba(162, 179, 219, 0.2)",
    background: "rgba(8, 12, 25, 0.74)",
    color: "var(--text-dim)",
    fontSize: 13,
    lineHeight: 1.5,
  },
};
