import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";

interface ClipActionStripDesktopPresenterProps {
  clipId: string;
  children: ReactNode;
}

export function ClipActionStripDesktopPresenter({
  clipId,
  children,
}: ClipActionStripDesktopPresenterProps) {
  return (
    <div
      data-testid={`clip-action-strip-${clipId}`}
      data-clip-action-strip-variant="desktop"
      className={desktopStripClass}
    >
      {children}
    </div>
  );
}

const desktopStripClass = css({
  position: "absolute",
  top: "1px",
  right: "4px",
  display: "flex",
  gap: "2px",
  maxWidth: "calc(100% - 8px)",
  overflow: "hidden",
  zIndex: 3,
  pointerEvents: "auto",
});
