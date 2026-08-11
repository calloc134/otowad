import type { CSSProperties } from "react";
import { css, cx } from "../../../../styled-system/css";
import { Pencil, Trash2 } from "lucide-react";
import {
  Button,
  IconButton,
  StatusPill,
} from "@/design-system/index.ts";
import type { BrowserProjectSummary } from "@/persist/index.ts";

interface ProjectManagementProjectRowProps {
  project: BrowserProjectSummary;
  isCurrent: boolean;
  isRenaming: boolean;
  renameValue: string;
  isDeleteConfirming: boolean;
  rowBusy: boolean;
  usesTouchActions: boolean;
  onBeginRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onClearDeleteConfirmation: () => void;
  onOpenProject: () => void;
}

export function ProjectManagementProjectRow({
  project,
  isCurrent,
  isRenaming,
  renameValue,
  isDeleteConfirming,
  rowBusy,
  usesTouchActions,
  onBeginRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  onClearDeleteConfirmation,
  onOpenProject,
}: ProjectManagementProjectRowProps) {
  return (
    <div
      data-glow-state={isCurrent ? "selected" : undefined}
      className={cx(
        projectRowClass,
        projectRowResponsiveClass,
        isCurrent ? projectRowCurrentClass : undefined,
      )}
    >
      <div className={projectMetaClass}>
        <div className={projectNameRowClass}>
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              className={renameInputClass}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              disabled={rowBusy}
            />
          ) : (
            <span
              className={projectNameClass}
              onDoubleClick={onBeginRename}
              title="Double-click to rename browser-saved project"
            >
              {project.name}
            </span>
          )}
          {usesTouchActions && !isRenaming && (
            <IconButton
              style={ICON_ACTION_TOUCH_STYLE}
              data-testid={`project-rename-${project.id}`}
              onClick={onBeginRename}
              disabled={rowBusy}
              title="Rename saved project"
              aria-label="Rename saved project"
            >
              <Pencil size={14} />
            </IconButton>
          )}
          {isCurrent && (
            <StatusPill tone="success" className={currentBadgeClass}>
              Current
            </StatusPill>
          )}
        </div>
        <div className={projectFactsClass}>
          <span>Opened {formatDateTime(project.lastOpenedAt)}</span>
          <span>Updated {formatDateTime(project.updatedAt)}</span>
          <span>{formatByteCount(project.archiveByteLength)}</span>
        </div>
      </div>

      <div className={projectActionsClass}>
        {!usesTouchActions && (
          <IconButton
            style={ICON_ACTION_STYLE}
            data-testid={`project-rename-${project.id}`}
            onClick={onBeginRename}
            disabled={rowBusy}
            title="Rename saved project"
            aria-label="Rename saved project"
          >
            <Pencil size={14} />
          </IconButton>
        )}
        <IconButton
          style={resolveDeleteIconStyle(usesTouchActions, isDeleteConfirming)}
          data-testid={`project-delete-${project.id}`}
          onClick={onDelete}
          disabled={rowBusy}
          title={isDeleteConfirming ? "Click again to confirm delete" : "Delete saved project"}
          aria-label={isDeleteConfirming ? "Confirm delete saved project" : "Delete saved project"}
          variant={isDeleteConfirming ? "danger" : "secondary"}
        >
          <Trash2 size={14} />
        </IconButton>
        <Button
          style={usesTouchActions ? OPEN_BUTTON_TOUCH_STYLE : OPEN_BUTTON_STYLE}
          data-testid={`project-open-${project.id}`}
          onClick={onOpenProject}
          disabled={rowBusy}
          variant="primary"
        >
          Open Project
        </Button>
      </div>

      {isDeleteConfirming && (
        <div className={deleteConfirmBarClass}>
          <span>Delete this browser-saved project?</span>
          <Button
            type="button"
            variant="secondary"
            style={DELETE_CANCEL_BUTTON_STYLE}
            onClick={onClearDeleteConfirmation}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function resolveDeleteIconStyle(usesTouchActions: boolean, isDeleteConfirming: boolean): CSSProperties {
  const base: CSSProperties = usesTouchActions ? ICON_ACTION_TOUCH_STYLE : ICON_ACTION_STYLE;
  if (!isDeleteConfirming) {
    return base;
  }
  return { ...base, ...ICON_ACTION_DANGER_ACTIVE_STYLE };
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "unknown time";
  }
  return new Date(parsed).toLocaleString();
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const projectRowClass = css({
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "14px",
  padding: "14px 14px 14px 16px",
  borderRadius: "16px",
  background: "rgba(11, 17, 36, 0.94)",
  border: "1px solid rgba(255,255,255,0.06)",
});

const projectRowCurrentClass = css({
  border: "1px solid rgba(127, 229, 165, 0.26)",
  boxShadow: "0 0 0 1px rgba(127, 229, 165, 0.08) inset",
});

const projectRowResponsiveClass = css({
  "@media (max-width: 840px)": {
    gridTemplateColumns: "1fr",
  },
});

const projectMetaClass = css({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

const projectNameRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
});

const projectNameClass = css({
  fontSize: "14px",
  fontWeight: 800,
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "text",
});

const renameInputClass = css({
  minWidth: 0,
  flex: 1,
  height: "34px",
  borderRadius: "10px",
  border: "1px solid rgba(105, 184, 255, 0.4)",
  background: "rgba(9, 14, 29, 0.96)",
  color: "var(--text-primary)",
  padding: "0 10px",
  fontSize: "14px",
  fontWeight: 700,
  outline: "none",
});

const currentBadgeClass = css({ flexShrink: 0 });

const projectFactsClass = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  fontSize: "11px",
  color: "var(--text-dim)",
});

const projectActionsClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

const deleteConfirmBarClass = css({
  gridColumn: "1 / -1",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  paddingTop: "8px",
  borderTop: "1px solid rgba(255,255,255,0.06)",
  color: "var(--text-dim)",
  fontSize: "12px",
});

// Inline CSSProperties -- passed to IconButton / Button primitives that
// otherwise let their own recipe classes win.
const ICON_ACTION_STYLE: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
  background: "rgba(11, 17, 36, 0.92)",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const ICON_ACTION_TOUCH_STYLE: CSSProperties = {
  ...ICON_ACTION_STYLE,
  width: 40,
  height: 40,
};

const ICON_ACTION_DANGER_ACTIVE_STYLE: CSSProperties = {
  border: "1px solid rgba(255, 117, 135, 0.42)",
  color: "var(--danger)",
  background: "var(--danger-soft)",
};

const OPEN_BUTTON_STYLE: CSSProperties = {
  flexShrink: 0,
  minWidth: 112,
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(105, 184, 255, 0.32)",
  background: "rgba(105, 184, 255, 0.1)",
  color: "var(--accent-blue)",
  fontWeight: 800,
  cursor: "pointer",
};

const OPEN_BUTTON_TOUCH_STYLE: CSSProperties = {
  ...OPEN_BUTTON_STYLE,
  minWidth: 132,
  height: 40,
};

const DELETE_CANCEL_BUTTON_STYLE: CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-button)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontWeight: 700,
};
