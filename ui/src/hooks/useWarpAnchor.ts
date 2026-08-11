import { useCallback } from "react";

import { buildAddWarpAnchorAtTickCommand } from "@/intents/clipCommands.ts";
import { useDocumentState, useProjectActions } from "@/store";

export interface WarpAnchorResult {
  addAnchorAtClientX: (target: HTMLElement, clientX: number) => boolean;
}

/**
 * `pixelsPerTick` is passed in rather than read from the viewport store: the
 * clip is drawn with the scale its parent handed down, so resolving a click
 * against a second source lets the anchor land somewhere the user did not
 * click if the two ever disagree.
 */
export function useWarpAnchor(clipId: string, pixelsPerTick: number): WarpAnchorResult {
  const { document } = useDocumentState();
  const actions = useProjectActions();

  const addAnchorAtClientX = useCallback(
    (target: HTMLElement, clientX: number) => {
      if (!document) {
        return false;
      }

      const rect = target.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const tickInClip = Math.max(0, Math.round(relativeX / pixelsPerTick));
      const command = buildAddWarpAnchorAtTickCommand(document, clipId, tickInClip);
      if (!command) {
        return false;
      }

      actions.applyCommand(command);
      return true;
    },
    [actions, clipId, document, pixelsPerTick],
  );

  return { addAnchorAtClientX };
}
