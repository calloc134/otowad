import type { ReactNode } from "react";
import { css, cx } from "../../../styled-system/css";

interface StatusBarMobilePresenterProps {
  /** Null while there is nothing worth taking a phone's height for. */
  alertContent: ReactNode | null;
}

/**
 * On a phone this is an alert strip, not a status bar.
 *
 * The three permanent rows — status, selection summary and metric chips —
 * cost 122px of a 390px landscape viewport while saying "Ready". The metrics
 * duplicate the toolbar (BPM, grid, zoom) and the selection summary needs a
 * per-clip surface rather than permanent chrome, so only conditions the user
 * has to act on are left: busy tasks, missing media, and errors.
 */
export function StatusBarMobilePresenter({ alertContent }: StatusBarMobilePresenterProps) {
  if (!alertContent) {
    return null;
  }

  return (
    <div
      data-testid="status-bar-root"
      data-status-bar-variant="mobile"
      className={cx(statusBarMobileClass, statusBarMobileSurfaceClass)}
    >
      {alertContent}
    </div>
  );
}

const statusBarMobileClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  padding: "6px 10px",
  fontSize: "11px",
  flexShrink: "0",
});

const statusBarMobileSurfaceClass = css({
  background:
    "linear-gradient(180deg, rgba(13, 18, 36, 0.98), rgba(8, 12, 24, 0.98))",
  borderTop: "1px solid var(--border-default)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
});
