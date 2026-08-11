import { css } from "../../../styled-system/css";
import { EDITOR_HEADER_HEIGHT } from "../editorGeometry.ts";

export const TIMELINE_RULER_HEIGHT = EDITOR_HEADER_HEIGHT;

export const timelineSurfaceStyles = {
  emptyState: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--text-dim)",
    fontSize: "14px",
  }),
  rulerOuter: css({
    height: `${TIMELINE_RULER_HEIGHT}px`,
    overflow: "hidden",
    background: "var(--surface-editor-ruler)",
    borderBottom: "1px solid var(--border-subtle)",
    position: "relative",
    flexShrink: 0,
    boxShadow: "var(--shadow-inset-highlight)",
  }),
  rulerInner: css({
    position: "relative",
    height: "100%",
    cursor: "crosshair",
    touchAction: "none",
  }),
  lanesOuter: css({
    flex: 1,
    overflow: "auto",
    position: "relative",
    minHeight: 0,
    overscrollBehavior: "none",
  }),
  timelineCanvas: css({
    position: "relative",
    touchAction: "none",
  }),
  timeSelection: css({
    position: "absolute",
    top: 0,
    height: "100%",
    backgroundColor: "var(--overlay-time-selection)",
    borderLeft: "1px solid var(--overlay-time-selection-border)",
    borderRight: "1px solid var(--overlay-time-selection-border)",
    pointerEvents: "none",
  }),
};

export const timelinePresenterStyles = {
  desktopRoot: css({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--surface-editor-shell)",
    minWidth: 0,
    minHeight: 0,
  }),
  mobileRoot: css({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--surface-editor-shell)",
    minWidth: 0,
    minHeight: 0,
    padding: "4px",
    boxSizing: "border-box",
  }),
  mobileFrame: css({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: "14px",
    border: "1px solid var(--border-frame-soft)",
    boxShadow: "var(--shadow-inset-highlight)",
  }),
  mobileChromeRail: css({
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 10px 6px",
    borderBottom: "1px solid var(--border-frame-soft)",
    background: "var(--surface-mobile-chrome)",
  }),
};
