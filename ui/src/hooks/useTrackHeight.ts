import { useInteractionMode } from "@/app/interactionMode.tsx";
import { clampTrackHeight } from "@/components/editorGeometry.ts";
import { useViewportState } from "@/store";

/**
 * The height every track row and lane is drawn at.
 *
 * Two inputs decide it and they meet only here: the vertical zoom, and the
 * control size, which changes how much a row has to fit. Reading the zoom
 * without the second input is what left touch rows overflowing.
 */
export function useTrackHeight(): number {
  const { zoom } = useViewportState();
  const usesTouchControls = useInteractionMode() === "touch-like";
  return clampTrackHeight(zoom.y, usesTouchControls);
}
