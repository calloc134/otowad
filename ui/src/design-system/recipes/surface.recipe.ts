import { defineRecipe } from "@pandacss/dev";

export const panelRecipe = defineRecipe({
  className: "daw-panel",
  base: {
    borderRadius: "18px",
    borderWidth: "1px",
    borderStyle: "solid",
  },
  variants: {
    variant: {
      raised: {
        background: "var(--surface-panel-raised)",
        borderColor: "var(--border-default)",
        boxShadow: "var(--shadow-panel)",
      },
      inset: {
        background: "var(--surface-panel)",
        borderColor: "rgba(255,255,255,0.04)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      },
      muted: {
        background: "var(--surface-panel-muted)",
        borderColor: "var(--border-default)",
      },
      accent: {
        background:
          "radial-gradient(circle at top right, rgba(97, 164, 255, 0.18), transparent 36%), linear-gradient(180deg, rgba(18, 28, 58, 0.98), rgba(10, 16, 31, 0.98))",
        borderColor: "var(--border-info)",
      },
    },
  },
  defaultVariants: {
    variant: "raised",
  },
});

export const metricChipRecipe = defineRecipe({
  className: "daw-metric-chip",
  base: {
    appearance: "none",
    fontFamily: "var(--font-family-mono)",
    fontSize: "12px",
    fontWeight: "700",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    // A chip holds one reading. Left wrappable, "120.0 BPM" broke after the
    // number in a narrow toolbar — 49px tall against 36px for its neighbours —
    // and, because a wrappable item may shrink to its longest word, it let the
    // row squash itself instead of overflowing into the scroller built for it.
    whiteSpace: "nowrap",
  },
  variants: {
    tone: {
      neutral: {
        color: "var(--text-secondary)",
        background: "var(--surface-chip-neutral)",
        borderColor: "var(--border-default)",
      },
      info: {
        color: "var(--feedback-info)",
        background: "var(--surface-chip-info)",
        borderColor: "var(--border-info)",
      },
      success: {
        color: "var(--feedback-success)",
        background: "var(--surface-chip-success)",
        borderColor: "var(--border-success)",
      },
      warning: {
        color: "var(--feedback-warning)",
        background: "var(--surface-chip-warning)",
        borderColor: "var(--border-warning)",
      },
    },
    active: {
      true: {
        boxShadow: "var(--shadow-glow-info)",
      },
      false: {
        boxShadow: "var(--shadow-soft)",
      },
    },
  },
  defaultVariants: {
    tone: "neutral",
    active: false,
  },
});

export const statusPillRecipe = defineRecipe({
  className: "daw-status-pill",
  base: {
    fontFamily: "var(--font-family-mono)",
    fontSize: "11px",
    fontWeight: "700",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    borderRadius: "999px",
    borderWidth: "1px",
    borderStyle: "solid",
    // Same reason as the chip, and one more: the playhead readout rewrites
    // this text every frame, so a width that can reflow is a height that can
    // change during playback.
    whiteSpace: "nowrap",
  },
  variants: {
    tone: {
      neutral: {
        color: "var(--text-muted)",
        background: "var(--surface-chip-neutral)",
        borderColor: "var(--border-default)",
      },
      info: {
        color: "var(--feedback-info)",
        background: "var(--surface-chip-info)",
        borderColor: "var(--border-info)",
      },
      success: {
        color: "var(--feedback-success)",
        background: "var(--surface-chip-success)",
        borderColor: "var(--border-success)",
      },
      warning: {
        color: "var(--feedback-warning)",
        background: "var(--surface-chip-warning)",
        borderColor: "var(--border-warning)",
      },
      danger: {
        color: "var(--feedback-danger)",
        background: "var(--surface-chip-danger)",
        borderColor: "var(--border-danger)",
      },
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});
