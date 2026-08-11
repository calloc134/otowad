import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";

interface ClipActionStripMobilePresenterProps {
  clipId: string;
  children: ReactNode;
}

/**
 * On touch the clip actions are a bar pinned to the bottom of the viewport,
 * not a strip inside the clip.
 *
 * Inside the clip they were bounded by the clip's own width: the strip needs
 * ~67px and the clip is `overflow: hidden`, so anything narrower cut the
 * buttons off — and a chopped-up otomad source is mostly narrow clips. Down
 * here the width is the screen's, so the buttons can also be a size a finger
 * can hit.
 *
 * Only the primary selection renders a strip, so there is exactly one bar.
 */
export function ClipActionStripMobilePresenter({
  clipId,
  children,
}: ClipActionStripMobilePresenterProps) {
  return (
    <div
      data-testid={`clip-action-strip-${clipId}`}
      data-clip-action-strip-variant="mobile"
      className={mobileBarClass}
    >
      {children}
    </div>
  );
}

const mobileBarClass = css({
  position: "fixed",
  left: "0",
  right: "0",
  bottom: "0",
  zIndex: "30",
  display: "flex",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: "8px",
  padding: "8px 10px calc(env(safe-area-inset-bottom, 0px) + 8px)",
  pointerEvents: "auto",
  background: "linear-gradient(180deg, rgba(19, 27, 54, 0.97), rgba(9, 13, 27, 0.99))",
  borderTop: "1px solid var(--border-default)",
  boxShadow: "0 -18px 36px rgba(0, 0, 0, 0.4)",
});
