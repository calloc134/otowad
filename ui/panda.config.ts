import { defineConfig } from "@pandacss/dev";

import {
  buttonRecipe,
  iconButtonRecipe,
} from "./src/design-system/recipes/button.recipe.ts";
import {
  dialogBodyRecipe,
  dialogButtonRowRecipe,
  dialogHeaderRecipe,
  dialogShellRecipe,
  fieldRowRecipe,
} from "./src/design-system/recipes/dialog.recipe.ts";
import {
  metricChipRecipe,
  panelRecipe,
  statusPillRecipe,
} from "./src/design-system/recipes/surface.recipe.ts";

export default defineConfig({
  preflight: false,
  jsxFramework: "react",
  outdir: "styled-system",
  include: ["./src/**/*.{ts,tsx}"],
  exclude: ["./styled-system/**/*"],
  theme: {
    extend: {
      recipes: {
        button: buttonRecipe,
        iconButton: iconButtonRecipe,
        dialogShell: dialogShellRecipe,
        dialogHeader: dialogHeaderRecipe,
        dialogBody: dialogBodyRecipe,
        fieldRow: fieldRowRecipe,
        dialogButtonRow: dialogButtonRowRecipe,
        panel: panelRecipe,
        metricChip: metricChipRecipe,
        statusPill: statusPillRecipe,
      },
    },
  },
});
