import type { ReactNode } from "react";
import { css, cx } from "../../../styled-system/css";

interface ToolbarDesktopPresenterProps {
  leftSection: ReactNode;
  centerSection: ReactNode | null;
  rightSection: ReactNode | null;
  /** Rendered on its own row while the tool row is collapsed and expanded. */
  secondaryRow: ReactNode | null;
}

export function ToolbarDesktopPresenter({
  leftSection,
  centerSection,
  rightSection,
  secondaryRow,
}: ToolbarDesktopPresenterProps) {
  return (
    <div
      data-testid="toolbar-root"
      data-toolbar-variant="desktop"
      className={cx(toolbarDesktopClass, toolbarDesktopSurfaceClass)}
    >
      <div data-testid="toolbar-primary-row" className={rowClass}>
        <div className={cx(slotClass, leftSlotClass)}>{leftSection}</div>
        {centerSection && <div className={cx(slotClass, centerSlotClass)}>{centerSection}</div>}
        {rightSection && <div className={cx(slotClass, rightSlotClass)}>{rightSection}</div>}
      </div>
      {secondaryRow && (
        <div data-testid="toolbar-secondary-row" className={secondaryRowClass}>
          {secondaryRow}
        </div>
      )}
    </div>
  );
}

const toolbarDesktopClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  minHeight: "60px",
  padding: "10px 14px",
  flexShrink: "0",
  minWidth: 0,
});

const toolbarDesktopSurfaceClass = css({
  background: "var(--surface-shell)",
  borderBottom: "1px solid var(--border-default)",
  boxShadow:
    "0 18px 36px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
});

const rowClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "18px",
  minWidth: 0,
  flexWrap: "wrap",
});

const secondaryRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
  rowGap: "8px",
});

const slotClass = css({
  display: "flex",
  minWidth: 0,
});

const leftSlotClass = css({
  flex: "1 1 380px",
});

const centerSlotClass = css({
  flex: "0 0 auto",
  justifyContent: "center",
});

const rightSlotClass = css({
  flex: "0 0 auto",
  justifyContent: "flex-end",
});
