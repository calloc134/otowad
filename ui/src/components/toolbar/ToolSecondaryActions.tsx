import { Link2, SlidersHorizontal } from "lucide-react";
import { css } from "../../../styled-system/css";
import { Button, IconButton } from "@/design-system/index.ts";
import { ZoomControls } from "@/components/ZoomControls";

export interface ToolSecondaryActionsProps {
  gridEnabled: boolean;
  toolbarMagnetRange: number;
  pitchLinkCount: number;
  onToolbarMagnetRangeChange: (value: number) => void;
  onCommitToolbarMagnetRange: () => void;
  onResetToolbarMagnetRange: () => void;
  onOpenGridDialog: () => void;
  onOpenPitchLinkDialog: () => void;
}

/**
 * The controls that step aside when the toolbar runs out of width. They render
 * inline on a wide toolbar and inside the tools row when it is collapsed, so
 * the markup lives here rather than being duplicated per layout.
 */
export function ToolSecondaryActions({
  gridEnabled,
  toolbarMagnetRange,
  pitchLinkCount,
  onToolbarMagnetRangeChange,
  onCommitToolbarMagnetRange,
  onResetToolbarMagnetRange,
  onOpenGridDialog,
  onOpenPitchLinkDialog,
}: ToolSecondaryActionsProps) {
  return (
    <>
      <div
        className={snapRangeGroupClass}
        style={{ opacity: gridEnabled ? 1 : 0.45 }}
        title="Snap range controls how close the cursor must be before it snaps to the grid. Double-click to reset."
        onDoubleClick={onResetToolbarMagnetRange}
      >
        <span className={snapLabelClass}>Snap</span>
        <input
          className={snapSliderClass}
          style={{ accentColor: "var(--accent-green)" }}
          type="range"
          min={0}
          max={1000}
          step={25}
          value={toolbarMagnetRange}
          disabled={!gridEnabled}
          aria-label="Snap range"
          onChange={(event) => onToolbarMagnetRangeChange(Number(event.target.value))}
          onMouseUp={onCommitToolbarMagnetRange}
          onTouchEnd={onCommitToolbarMagnetRange}
          onBlur={onCommitToolbarMagnetRange}
        />
        <span className={snapValueClass}>±{(toolbarMagnetRange / 10).toFixed(1)}%</span>
      </div>
      <IconButton
        onClick={onOpenGridDialog}
        className={iconButtonClass}
        title="Grid settings"
        aria-label="Open grid settings"
      >
        <SlidersHorizontal size={16} />
      </IconButton>
      <Button
        onClick={onOpenPitchLinkDialog}
        className={pillButtonClass}
        style={{
          color: pitchLinkCount > 0 ? "var(--accent-amber)" : "var(--text-secondary)",
          borderColor: pitchLinkCount > 0
            ? "rgba(246, 197, 108, 0.4)"
            : "var(--border-subtle)",
          background: pitchLinkCount > 0
            ? "rgba(246, 197, 108, 0.14)"
            : "var(--bg-button)",
        }}
        title="Pitch Links (MIDI -> Audio)"
        variant="secondary"
      >
        <Link2 size={14} />
        <span>Pitch{pitchLinkCount > 0 ? ` ${pitchLinkCount}` : ""}</span>
      </Button>

      <div className={dividerClass} />

      <ZoomControls />
    </>
  );
}

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

const snapRangeGroupClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 10px",
  height: "36px",
  borderRadius: "12px",
  border: "1px solid var(--border-subtle)",
  background: "rgba(11, 16, 34, 0.92)",
  boxShadow: "var(--panel-shadow-soft)",
});

const snapLabelClass = css({
  fontSize: "11px",
  fontWeight: "700",
  color: "var(--text-muted)",
  letterSpacing: "0.4px",
  textTransform: "uppercase",
});

const snapSliderClass = css({
  width: "108px",
  cursor: "pointer",
});

const snapValueClass = css({
  minWidth: "54px",
  fontSize: "11px",
  fontWeight: "700",
  color: "var(--text-secondary)",
  textAlign: "right",
  fontFamily: "monospace",
});
