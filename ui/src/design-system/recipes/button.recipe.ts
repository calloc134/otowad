import { defineRecipe } from "@pandacss/dev";

export const buttonRecipe = defineRecipe({
  className: "daw-button",
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontWeight: "700",
    borderWidth: "1px",
    borderStyle: "solid",
    transitionProperty: "transform, border-color, background, box-shadow, color, opacity",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease",
  },
  variants: {
    variant: {
      primary: {
        borderColor: "var(--border-info)",
        background: "var(--surface-interactive-active)",
        color: "var(--text-primary)",
      },
      secondary: {
        borderColor: "var(--border-default)",
        background: "var(--surface-interactive)",
        color: "var(--text-secondary)",
        boxShadow: "var(--shadow-soft)",
      },
      ghost: {
        borderColor: "var(--border-default)",
        background: "transparent",
        color: "var(--text-secondary)",
      },
      danger: {
        borderColor: "var(--border-danger)",
        background: "var(--surface-interactive-danger)",
        color: "var(--feedback-danger)",
      },
      transport: {
        borderColor: "var(--border-default)",
        background:
          "linear-gradient(180deg, rgba(27, 37, 71, 0.96), rgba(14, 20, 40, 0.96))",
        color: "var(--text-primary)",
      },
    },
    size: {
      compact: {
        minHeight: "30px",
        padding: "0 10px",
        fontSize: "10px",
        borderRadius: "10px",
      },
      sm: {
        minHeight: "30px",
        padding: "0 10px",
        fontSize: "10px",
        borderRadius: "10px",
      },
      md: {
        minHeight: "36px",
        padding: "0 12px",
        fontSize: "12px",
        borderRadius: "12px",
      },
      touch: {
        minHeight: "40px",
        padding: "0 16px",
        fontSize: "12px",
        borderRadius: "12px",
      },
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "md",
  },
});

export const iconButtonRecipe = defineRecipe({
  className: "daw-icon-button",
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: "0",
    borderWidth: "1px",
    borderStyle: "solid",
    transitionProperty: "transform, border-color, background, box-shadow, color, opacity",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease",
  },
  variants: {
    variant: {
      primary: {
        borderColor: "var(--border-info)",
        background: "var(--surface-interactive-active)",
        color: "var(--text-primary)",
      },
      secondary: {
        borderColor: "var(--border-default)",
        background: "var(--surface-interactive)",
        color: "var(--text-secondary)",
        boxShadow: "var(--shadow-soft)",
      },
      ghost: {
        borderColor: "var(--border-default)",
        background: "transparent",
        color: "var(--text-secondary)",
      },
      danger: {
        borderColor: "var(--border-danger)",
        background: "var(--surface-interactive-danger)",
        color: "var(--feedback-danger)",
      },
      transport: {
        borderColor: "var(--border-default)",
        background:
          "linear-gradient(180deg, rgba(27, 37, 71, 0.96), rgba(14, 20, 40, 0.96))",
        color: "var(--text-primary)",
      },
    },
    size: {
      compact: {
        width: "28px",
        height: "28px",
        borderRadius: "10px",
      },
      sm: {
        width: "28px",
        height: "28px",
        borderRadius: "10px",
      },
      md: {
        width: "36px",
        height: "36px",
        borderRadius: "12px",
      },
      touch: {
        width: "40px",
        height: "40px",
        borderRadius: "12px",
      },
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "md",
  },
});
