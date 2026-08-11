import { useEffect, useRef, useState } from "react";
import { FilePlus2, FolderCog, Menu, Save } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  Button,
  IconButton,
  StatusPill,
  ToolbarGroup,
} from "@/design-system/index.ts";

interface ProjectIdentitySectionProps {
  isBusy: boolean;
  projectName: string | null;
  editingName: boolean;
  nameValue: string;
  hasUnsavedChanges: boolean;
  hasCurrentBrowserProject: boolean;
  onCreateProject: () => void;
  onSave: () => void;
  onOpenProjectManager: () => void;
  onStartNameEdit: () => void;
  onNameValueChange: (value: string) => void;
  onCommitName: () => void;
  onCancelNameEdit: () => void;
}

export function ProjectIdentitySection({
  isBusy,
  projectName,
  editingName,
  nameValue,
  hasUnsavedChanges,
  hasCurrentBrowserProject,
  onCreateProject,
  onSave,
  onOpenProjectManager,
  onStartNameEdit,
  onNameValueChange,
  onCommitName,
  onCancelNameEdit,
}: ProjectIdentitySectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const projectStatusLabel = hasCurrentBrowserProject
    ? hasUnsavedChanges
      ? "Browser save behind"
      : "Saved in browser"
    : hasUnsavedChanges
      ? "Not saved yet"
      : "Unsynced project";

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <ToolbarGroup className={sectionClass}>
      <div ref={menuRootRef} className={menuRootClass}>
        <IconButton
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Project menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="Project menu"
          className={menuButtonClass}
        >
          <Menu size={18} />
        </IconButton>
        {menuOpen && (
          <div role="menu" aria-label="Project actions" className={menuPanelClass}>
            <Button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onCreateProject();
              }}
              className={menuItemClass}
              disabled={isBusy}
            >
              <FilePlus2 size={14} />
              <span>New Project</span>
            </Button>
            <Button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSave();
              }}
              className={menuItemClass}
              disabled={isBusy}
            >
              <Save size={14} />
              <span>Save Project</span>
            </Button>
            <Button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenProjectManager();
              }}
              className={menuItemClass}
              disabled={isBusy}
            >
              <FolderCog size={14} />
              <span>Project Manager</span>
            </Button>
          </div>
        )}
      </div>

      {projectName && (
        <>
          <div className={dividerClass} />
          <div
            className={cx(
              projectIdentityClass,
              editingName ? projectIdentityEditingClass : undefined,
            )}
          >
            {editingName ? (
              <input
                className={nameInputClass}
                value={nameValue}
                onChange={(event) => onNameValueChange(event.target.value)}
                onBlur={onCommitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCommitName();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelNameEdit();
                  }
                }}
                autoFocus
              />
            ) : (
              <div className={projectInfoClass}>
                <span
                  className={projectNameClass}
                  onDoubleClick={onStartNameEdit}
                  title="Double-click to edit project name"
                >
                  {hasUnsavedChanges ? "* " : ""}
                  {projectName}
                </span>
                <StatusPill
                  tone={
                    hasUnsavedChanges
                      ? "warning"
                      : hasCurrentBrowserProject
                        ? "success"
                        : "neutral"
                  }
                  className={projectStatusClass}
                >
                  {projectStatusLabel}
                </StatusPill>
              </div>
            )}
          </div>
        </>
      )}
    </ToolbarGroup>
  );
}

const sectionClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
  width: "100%",
});

const menuRootClass = css({
  position: "relative",
  flexShrink: 0,
});

const menuButtonClass = css({
  width: "38px",
  height: "38px",
});

const menuPanelClass = css({
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minWidth: "190px",
  padding: "8px",
  borderRadius: "12px",
  border: "1px solid var(--border-default)",
  background: "rgba(10, 15, 31, 0.99)",
  boxShadow: "0 20px 44px rgba(0, 0, 0, 0.46)",
});

const menuItemClass = css({
  width: "100%",
  justifyContent: "flex-start",
  minHeight: "36px",
});

const dividerClass = css({
  width: "1px",
  height: "28px",
  background:
    "linear-gradient(180deg, transparent, rgba(137, 154, 212, 0.28), transparent)",
  margin: "0 4px",
  flexShrink: 0,
});

const projectIdentityClass = css({
  flex: "1 1 240px",
  minWidth: 0,
  maxWidth: "300px",
});

const projectIdentityEditingClass = css({
  minWidth: "180px",
  maxWidth: "320px",
});

const projectInfoClass = css({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  width: "100%",
});

const projectStatusClass = css({
  alignSelf: "flex-start",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const projectNameClass = css({
  fontSize: "13px",
  fontWeight: "700",
  color: "var(--text-primary)",
  cursor: "pointer",
  display: "block",
  padding: "2px 8px",
  borderRadius: "8px",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const nameInputClass = css({
  fontSize: "13px",
  fontWeight: "700",
  color: "var(--text-primary)",
  backgroundColor: "rgba(9, 14, 29, 0.96)",
  border: "1px solid var(--border-accent)",
  borderRadius: "10px",
  padding: "7px 10px",
  outline: "none",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
});
