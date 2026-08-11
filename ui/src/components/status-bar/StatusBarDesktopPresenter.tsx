import type { ReactNode } from "react";
import { css, cx } from "../../../styled-system/css";

interface StatusBarDesktopPresenterProps {
  statusContent: ReactNode;
  selectionContent: ReactNode;
}

export function StatusBarDesktopPresenter({
  statusContent,
  selectionContent,
}: StatusBarDesktopPresenterProps) {
  return (
    <div
      data-testid="status-bar-root"
      data-status-bar-variant="desktop"
      className={cx(statusBarDesktopClass, statusBarDesktopSurfaceClass)}
    >
      <div className={cx(slotClass, leftSlotClass)}>{statusContent}</div>
      <div className={cx(slotClass, centerSlotClass)}>{selectionContent}</div>
    </div>
  );
}

const statusBarDesktopClass = css({
  minHeight: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "0 14px",
  fontSize: "11px",
  flexShrink: "0",
});

const statusBarDesktopSurfaceClass = css({
  background:
    "linear-gradient(180deg, rgba(13, 18, 36, 0.98), rgba(8, 12, 24, 0.98))",
  borderTop: "1px solid var(--border-default)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
});

const slotClass = css({
  display: "flex",
  alignItems: "center",
  minWidth: 0,
});

const leftSlotClass = css({
  flex: "1",
});

const centerSlotClass = css({
  flex: "3",
  justifyContent: "flex-end",
});
