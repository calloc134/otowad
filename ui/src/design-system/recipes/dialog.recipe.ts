import { defineRecipe } from "@pandacss/dev";

/**
 * The shell is capped by `maxHeight` (see `DialogWrapper`). It is a flex column
 * so the header keeps its size and the body absorbs the remainder — without
 * that split, `overflow: hidden` silently cut the tail off a tall dialog and
 * took the action buttons with it.
 */
export const dialogShellRecipe = defineRecipe({
  className: "daw-dialog-shell",
  base: {
    display: "flex",
    flexDirection: "column",
    minHeight: "0",
    borderRadius: "16px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border-emphasis)",
    background:
      "linear-gradient(180deg, rgba(22, 31, 60, 0.98), rgba(10, 15, 30, 0.98))",
    boxShadow: "var(--shadow-panel)",
    outline: "none",
    // Keeps the header gradient inside the rounded corners.
    overflow: "hidden",
  },
});

export const dialogHeaderRecipe = defineRecipe({
  className: "daw-dialog-header",
  base: {
    display: "flex",
    flexShrink: "0",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border-default)",
    background:
      "linear-gradient(180deg, rgba(38, 51, 94, 0.84), rgba(16, 23, 47, 0.84))",
  },
});

export const dialogBodyRecipe = defineRecipe({
  className: "daw-dialog-body",
  base: {
    flex: "1",
    // Without `minHeight: 0` a flex item refuses to shrink below its content,
    // so the scrollbar never appears and the overflow is clipped instead.
    minHeight: "0",
    overflowY: "auto",
    padding: "16px",
  },
});

export const fieldRowRecipe = defineRecipe({
  className: "daw-field-row",
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },
});

export const dialogButtonRowRecipe = defineRecipe({
  className: "daw-dialog-button-row",
  base: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "16px",
    paddingTop: "12px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "var(--border-default)",
  },
});
