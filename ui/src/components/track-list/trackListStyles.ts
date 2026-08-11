import type { CSSProperties } from "react";
import { css, cx } from "../../../styled-system/css";
import { EDITOR_HEADER_HEIGHT } from "../editorGeometry.ts";

export const TRACK_LIST_WIDTH = 196;

/**
 * A phone spends 23% of an 844px landscape viewport on the 196px panel. With
 * import, export and delete moved to the overflow sheet, the row only has to
 * hold the name plus mute and solo.
 */
export const PHONE_TRACK_LIST_WIDTH = 132;

const headerButtonBase = css({
  padding: "4px 8px",
  fontSize: "10px",
  fontWeight: 700,
  borderRadius: "10px",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-button-muted)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  boxShadow: "var(--panel-shadow-soft)",
});

const headerButtonTouchExtras = css({
  minHeight: "30px",
  padding: "6px 10px",
});

const controlButtonBase = css({
  width: "26px",
  height: "24px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "8px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxShadow: "var(--panel-shadow-soft)",
});

const trackReorderButtonBase = css({
  width: "24px",
  height: "11px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "6px",
  background: "var(--bg-button-muted)",
  color: "var(--text-muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxShadow: "var(--panel-shadow-soft)",
});

const trackReorderButtonTouchExtras = css({
  width: "28px",
  height: "13px",
});

const trackRenameButtonBase = css({
  width: "22px",
  height: "22px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "8px",
  background: "var(--bg-button-muted)",
  color: "var(--text-muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
  boxShadow: "var(--panel-shadow-soft)",
});

const trackRenameButtonTouchExtras = css({
  width: "28px",
  height: "28px",
});

export const trackListStyles = {
  container: css({
    // Width comes from the layout at render time; see `TrackList`.
    background: "var(--surface-track-list)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 0,
    boxShadow: "var(--shadow-inset-frame-right)",
  }),
  surface: css({
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overscrollBehavior: "none",
  }),
  header: css({
    // Matches the timeline ruler. The lanes begin under both, so any
    // difference offsets every track header from its lane by that amount.
    height: `${EDITOR_HEADER_HEIGHT}px`,
    padding: "0 8px 0 10px",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  }),
  headerTitleRow: css({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minWidth: 0,
  }),
  headerActions: css({
    display: "flex",
    alignItems: "center",
    gap: "4px",
    width: "100%",
    minWidth: 0,
  }),
  headerButton: headerButtonBase,
  headerButtonTouch: cx(headerButtonBase, headerButtonTouchExtras),
  audioButton: cx(
    headerButtonBase,
    css({
      borderColor: "var(--border-info)",
      color: "var(--accent-blue)",
    }),
  ),
  audioButtonTouch: cx(
    headerButtonBase,
    headerButtonTouchExtras,
    css({
      borderColor: "var(--border-info)",
      color: "var(--accent-blue)",
    }),
  ),
  midiButton: cx(
    headerButtonBase,
    css({
      borderColor: "var(--border-success)",
      color: "var(--accent-green)",
    }),
  ),
  midiButtonTouch: cx(
    headerButtonBase,
    headerButtonTouchExtras,
    css({
      borderColor: "var(--border-success)",
      color: "var(--accent-green)",
    }),
  ),
  list: css({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    position: "relative",
    overscrollBehavior: "none",
  }),
  listInner: css({
    position: "relative",
    minHeight: "100%",
  }),
  empty: css({
    padding: "16px",
    fontSize: "12px",
    color: "var(--text-dim)",
    textAlign: "center",
  }),
  trackHeader: css({
    // Height comes from the viewport zoom at render time so the row matches
    // the lane beside it; see `panelStyle` in TrackListRowPresenterParts.
    overflow: "hidden",
    borderBottom: "1px solid var(--border-frame-soft)",
    padding: "6px 8px 6px 5px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    boxSizing: "border-box",
    background: "var(--surface-track-row)",
  }),
  trackTop: css({
    display: "flex",
    alignItems: "center",
    gap: "6px",
  }),
  trackGrip: css({
    width: "24px",
    height: "24px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "8px",
    background: "var(--bg-button-muted)",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    flexShrink: 0,
    boxShadow: "var(--panel-shadow-soft)",
  }),
  trackReorderStack: css({
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flexShrink: 0,
  }),
  trackReorderButton: trackReorderButtonBase,
  trackReorderButtonTouch: cx(trackReorderButtonBase, trackReorderButtonTouchExtras),
  trackTypeBadge: css({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "24px",
    minWidth: "24px",
    padding: "0 6px",
    borderRadius: "8px",
    border: "1px solid var(--track-type-badge-border)",
  }),
  trackName: css({
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  }),
  trackNameSlot: css({
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    flex: 1,
  }),
  trackRenameButton: trackRenameButtonBase,
  trackRenameButtonTouch: cx(trackRenameButtonBase, trackRenameButtonTouchExtras),
  nameInput: css({
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--text-primary)",
    backgroundColor: "var(--track-name-input-bg)",
    border: "1px solid var(--border-accent)",
    borderRadius: "8px",
    padding: "4px 8px",
    outline: "none",
    flex: 1,
    minWidth: 0,
  }),
  nameFeedbackRow: css({
    minHeight: "12px",
    display: "flex",
    alignItems: "center",
    paddingLeft: "2px",
  }),
  nameFeedbackText: css({
    fontSize: "10px",
    lineHeight: 1.2,
  }),
  pitchLinkPill: css({
    gap: "4px",
    paddingLeft: "6px",
    maxWidth: "100%",
    justifyContent: "flex-start",
  }),
  pitchLinkIcon: css({
    color: "var(--accent-amber)",
    display: "inline-flex",
    alignItems: "center",
  }),
  pitchLinkText: css({
    fontSize: "10px",
    color: "var(--track-pitch-link-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  trackMixRow: css({
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "6px",
    alignItems: "center",
  }),
  trackMixField: css({
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  }),
  trackMixLabel: css({
    fontSize: "10px",
    color: "var(--text-dim)",
    letterSpacing: "0.2px",
  }),
  trackMixSlider: css({
    width: "100%",
    margin: 0,
    accentColor: "var(--accent-blue)",
  }),
  trackControls: css({
    display: "flex",
    gap: "4px",
    alignItems: "center",
  }),
  toggleBtn: controlButtonBase,
  toggleBtnTouch: cx(
    controlButtonBase,
    css({ width: "30px", height: "28px" }),
  ),
  importBtn: cx(
    controlButtonBase,
    css({
      background: "var(--bg-button-muted)",
      color: "var(--text-secondary)",
    }),
  ),
  importBtnTouch: cx(
    controlButtonBase,
    css({
      background: "var(--bg-button-muted)",
      color: "var(--text-secondary)",
      width: "30px",
      height: "28px",
    }),
  ),
  exportBtn: cx(
    controlButtonBase,
    css({
      border: "1px solid var(--track-export-border)",
      background: "var(--track-export-bg)",
      color: "var(--accent-blue)",
    }),
  ),
  exportBtnTouch: cx(
    controlButtonBase,
    css({
      border: "1px solid var(--track-export-border)",
      background: "var(--track-export-bg)",
      color: "var(--accent-blue)",
      width: "30px",
      height: "28px",
    }),
  ),
  deleteBtn: cx(
    controlButtonBase,
    css({
      border: "1px solid var(--track-delete-border)",
      backgroundColor: "var(--danger-soft)",
      color: "var(--danger)",
      marginLeft: "auto",
    }),
  ),
  deleteBtnTouch: cx(
    controlButtonBase,
    css({
      border: "1px solid var(--track-delete-border)",
      backgroundColor: "var(--danger-soft)",
      color: "var(--danger)",
      marginLeft: "auto",
      width: "30px",
      height: "28px",
    }),
  ),
  dropIndicator: css({
    position: "absolute",
    left: "6px",
    right: "6px",
    height: "2px",
    borderRadius: "999px",
    backgroundColor: "var(--accent-green)",
    boxShadow: "var(--overlay-drop-indicator-glow)",
    pointerEvents: "none",
  }),
};

// Inline overrides used when a `<Button>` primitive needs to win over its own recipe.
// Panda `css()` classes can lose to recipe classes depending on load order, so these
// keep the previous CSSProperties spread contract exactly.
const HEADER_BUTTON_STYLE: CSSProperties = {
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 700,
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-button-muted)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  // The panel is a fixed 196px, so the two actions share the row rather than
  // each claiming their natural width and pushing the second one off the edge.
  flex: "1 1 0",
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  boxShadow: "var(--panel-shadow-soft)",
};
const HEADER_BUTTON_TOUCH_STYLE: CSSProperties = {
  minHeight: 30,
  padding: "6px 10px",
};
const AUDIO_BUTTON_STYLE: CSSProperties = {
  borderColor: "var(--border-info)",
  color: "var(--accent-blue)",
};
const MIDI_BUTTON_STYLE: CSSProperties = {
  borderColor: "var(--border-success)",
  color: "var(--accent-green)",
};

export const trackListButtonStyles = {
  headerAudio(usesTouchControls: boolean): CSSProperties {
    return {
      ...HEADER_BUTTON_STYLE,
      ...(usesTouchControls ? HEADER_BUTTON_TOUCH_STYLE : null),
      ...AUDIO_BUTTON_STYLE,
    };
  },
  headerMidi(usesTouchControls: boolean): CSSProperties {
    return {
      ...HEADER_BUTTON_STYLE,
      ...(usesTouchControls ? HEADER_BUTTON_TOUCH_STYLE : null),
      ...MIDI_BUTTON_STYLE,
    };
  },
};
