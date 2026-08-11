/**
 * Shared palette for track / clip / file-drop visuals that need per-kind color.
 *
 * These are intentionally NOT lifted into Panda tokens because the values are
 * consumed as raw strings by `style` prop callers (Timeline drop preview,
 * TrackList badges) which need to pick a concrete color at render time.
 *
 * Order convention: `audio` → cyan/blue, `midi` → green, `other` (drag from
 * unresolved kind) → soft indigo.
 */

export const TRACK_KIND_SOLID = {
  audio: "#4fc3f7",
  midi: "#66bb6a",
  other: "#93a7e0",
} as const;

export const TRACK_KIND_GLOW = {
  audio: "0 0 10px rgba(79,195,247,0.45)",
  midi: "0 0 10px rgba(102,187,106,0.5)",
  other: "0 0 10px rgba(147,167,224,0.45)",
} as const;

export const TRACK_KIND_DROP_PREVIEW_ACTIVE = {
  audio: "rgba(79, 195, 247, 0.18)",
  midi: "rgba(102, 187, 106, 0.22)",
  other: "rgba(147, 167, 224, 0.18)",
} as const;

export const TRACK_KIND_DROP_PREVIEW_APPEND = {
  audio: "rgba(79, 195, 247, 0.08)",
  midi: "rgba(102, 187, 106, 0.12)",
  other: "rgba(147, 167, 224, 0.08)",
} as const;

export const TRACK_KIND_DROP_PREVIEW_HINT = {
  audio: "rgba(79, 195, 247, 0.12)",
  midi: "rgba(102, 187, 106, 0.14)",
} as const;

/**
 * Fill used to shade muted lanes in the timeline. Independent from the drop
 * preview palette on purpose — it should read as "disabled", not "targeted".
 */
export const TIMELINE_LANE_MUTED_BG = "rgba(128,128,128,0.15)";

export const TRACK_KIND_BADGE_BG = {
  audio: "rgba(105,184,255,0.16)",
  midi: "rgba(127,229,165,0.16)",
} as const;

export const TIMELINE_LANE_HOVER_BG = "rgba(30,42,74,0.3)";

export const TIMELINE_LANE_BORDER = "var(--border-lane-separator)";
export const TIMELINE_RULER_LABEL = "var(--text-timeline-ruler-label)";
export const TIMELINE_RULER_LABEL_BORDER = "var(--border-timeline-ruler-label)";
export const TIMELINE_PLAYHEAD = "var(--overlay-playhead)";

export const TRIM_HANDLE_STRETCH = "rgba(66,165,245,0.6)";
export const TRIM_HANDLE_TRIM = "rgba(239,83,80,0.6)";

export type TrackKindPalette = keyof typeof TRACK_KIND_SOLID;
