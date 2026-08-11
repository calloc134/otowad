import type { ReactNode } from "react";
import { Grid3X3, Redo2, Undo2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import { Button, IconButton, ToolbarGroup } from "@/design-system/index.ts";
import { FullscreenToggle } from "./FullscreenToggle";
import {
  ToolSecondaryActions,
  type ToolSecondaryActionsProps,
} from "./ToolSecondaryActions";

interface ToolActionsSectionProps extends ToolSecondaryActionsProps {
  leadingControl: ReactNode;
  undoDisabled: boolean;
  redoDisabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleGrid: () => void;
}

export function ToolActionsSection({
  leadingControl,
  undoDisabled,
  redoDisabled,
  gridEnabled,
  onUndo,
  onRedo,
  onToggleGrid,
  ...secondaryActions
}: ToolActionsSectionProps) {
  return (
    <ToolbarGroup className={sectionClass}>
      {leadingControl}
      {leadingControl && <div className={dividerClass} />}
      <IconButton
        onClick={onUndo}
        disabled={undoDisabled}
        className={iconButtonClass}
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 size={16} />
      </IconButton>
      <IconButton
        onClick={onRedo}
        disabled={redoDisabled}
        className={iconButtonClass}
        title="Redo"
        aria-label="Redo"
      >
        <Redo2 size={16} />
      </IconButton>

      <div className={dividerClass} />

      <Button
        onClick={onToggleGrid}
        data-glow-state={gridEnabled ? "selected" : undefined}
        className={pillButtonClass}
        style={{
          color: gridEnabled ? "var(--accent-green)" : "var(--text-muted)",
          borderColor: gridEnabled
            ? "rgba(127, 229, 165, 0.38)"
            : "var(--border-subtle)",
          background: gridEnabled ? "rgba(127, 229, 165, 0.15)" : "var(--bg-button)",
          boxShadow: gridEnabled ? "var(--glow-green)" : "var(--panel-shadow-soft)",
        }}
        title="Toggle grid display and snapping"
        variant="secondary"
      >
        <Grid3X3 size={14} />
        <span>{gridEnabled ? "Grid On" : "Grid Off"}</span>
      </Button>

      {/* Sits with the grid toggle because both are view controls, not edits.
          It disappears entirely where the API is missing, so nothing here can
          assume it rendered. */}
      <FullscreenToggle />

      <ToolSecondaryActions gridEnabled={gridEnabled} {...secondaryActions} />
    </ToolbarGroup>
  );
}

const sectionClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
  rowGap: "8px",
});

const dividerClass = css({
  width: "1px",
  height: "28px",
  background:
    "linear-gradient(180deg, transparent, rgba(137, 154, 212, 0.28), transparent)",
  margin: "0 4px",
  flexShrink: 0,
});

const iconButtonClass = css({
  width: "36px",
  height: "36px",
});

const pillButtonClass = css({
  minHeight: "36px",
});
