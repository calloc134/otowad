import { css } from "../../../../styled-system/css";
import { Download, FolderOpen, Plus, Save } from "lucide-react";
import { LargeTouchActionButton } from "@/design-system/index.ts";

interface ProjectManagementActionGridProps {
  usesTouchActions: boolean;
  isBusy: boolean;
  onSave: () => void;
  onNewProject: () => void;
  onImportProject: () => void;
  onDownloadProject: () => void;
}

export function ProjectManagementActionGrid({
  usesTouchActions,
  isBusy,
  onSave,
  onNewProject,
  onImportProject,
  onDownloadProject,
}: ProjectManagementActionGridProps) {
  const actionClassName = usesTouchActions ? touchActionClass : undefined;

  return (
    <div className={actionGridClass}>
      <LargeTouchActionButton
        type="button"
        emphasis="primary"
        className={actionClassName}
        style={primaryActionStyle}
        onClick={onSave}
        disabled={isBusy}
      >
        <Save size={16} />
        <span>Save to Browser</span>
      </LargeTouchActionButton>
      <LargeTouchActionButton
        type="button"
        className={actionClassName}
        style={secondaryActionStyle}
        onClick={onNewProject}
        disabled={isBusy}
      >
        <Plus size={16} />
        <span>New Project</span>
      </LargeTouchActionButton>
      <LargeTouchActionButton
        type="button"
        className={actionClassName}
        style={secondaryActionStyle}
        onClick={onImportProject}
        disabled={isBusy}
      >
        <FolderOpen size={16} />
        <span>Open Project File</span>
      </LargeTouchActionButton>
      <LargeTouchActionButton
        type="button"
        className={actionClassName}
        style={secondaryActionStyle}
        onClick={onDownloadProject}
        disabled={isBusy}
      >
        <Download size={16} />
        <span>Download ZIP</span>
      </LargeTouchActionButton>
    </div>
  );
}

const actionGridClass = css({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "10px",
});

const touchActionClass = css({
  minHeight: "60px",
});

const primaryActionStyle = {
  minHeight: 52,
  borderRadius: 16,
  border: "1px solid var(--border-info)",
  background: "linear-gradient(180deg, rgba(69, 137, 223, 0.28), rgba(30, 60, 108, 0.28))",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 800,
  justifyContent: "center",
  gap: 10,
} as const;

const secondaryActionStyle = {
  minHeight: 52,
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "rgba(11, 17, 36, 0.92)",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 700,
  justifyContent: "center",
  gap: 10,
} as const;
