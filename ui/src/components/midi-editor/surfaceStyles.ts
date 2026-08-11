import { css } from "../../../styled-system/css";

export const MIDI_EDITOR_PIANO_KEY_WIDTH = 48;
export const MIDI_EDITOR_RULER_HEIGHT = 30;
export const MIDI_EDITOR_HEADER_HEIGHT = 42;

export const midiEditorSurfaceStyles = {
  editorBody: css({
    flex: 1,
    display: "flex",
    overflow: "hidden",
  }),
  pianoColumn: css({
    width: `${MIDI_EDITOR_PIANO_KEY_WIDTH}px`,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border-subtle)",
  }),
  cornerSpacer: css({
    height: `${MIDI_EDITOR_RULER_HEIGHT}px`,
    background: "var(--surface-editor-ruler)",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
  }),
  pianoScroll: css({
    flex: 1,
    overflow: "hidden",
    overscrollBehavior: "contain",
    position: "relative",
  }),
  pianoInner: css({
    position: "relative",
  }),
  rightColumn: css({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }),
  rulerOuter: css({
    height: `${MIDI_EDITOR_RULER_HEIGHT}px`,
    overflow: "hidden",
    background: "var(--surface-editor-ruler)",
    borderBottom: "1px solid var(--border-subtle)",
    position: "relative",
    flexShrink: 0,
  }),
  rulerInner: css({
    position: "relative",
    height: "100%",
  }),
  gridOuter: css({
    flex: 1,
    overflow: "auto",
    overscrollBehavior: "contain",
    position: "relative",
    background: "var(--surface-editor-body)",
    cursor: "crosshair",
  }),
  gridInner: css({
    position: "relative",
  }),
};

export const midiEditorPresenterStyles = {
  desktopRoot: css({
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
    background: "var(--surface-editor-body)",
  }),
  desktopHeader: css({
    minHeight: `${MIDI_EDITOR_HEADER_HEIGHT}px`,
    background: "var(--surface-editor-header)",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "4px 12px",
    boxSizing: "border-box",
    flexShrink: 0,
  }),
  mobileRoot: css({
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
    background: "var(--surface-editor-body)",
    padding: "4px",
    boxSizing: "border-box",
  }),
  mobileHeader: css({
    minHeight: "56px",
    background: "var(--surface-editor-header)",
    border: "1px solid var(--border-frame-soft)",
    borderBottomColor: "var(--border-subtle)",
    borderRadius: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px 10px",
    boxSizing: "border-box",
    flexShrink: 0,
    marginBottom: "4px",
  }),
  headerTopRow: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
  }),
  headerBottomRow: css({
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  }),
  mobileToolRail: css({
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "4px",
  }),
  backButton: css({
    background: "var(--bg-button-muted)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "10px",
    color: "var(--text-secondary)",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  }),
  mobileBackButton: css({
    background: "var(--bg-button-muted)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "10px",
    color: "var(--text-secondary)",
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  }),
  clipTitle: css({
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--text-primary)",
  }),
  headerInfo: css({
    fontSize: "11px",
    color: "var(--text-muted)",
  }),
  desktopHeaderInfo: css({
    fontSize: "11px",
    color: "var(--text-muted)",
    marginLeft: "auto",
  }),
  modeLabel: css({
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  }),
};
