import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { ProjectActions } from "@/store";
import { resolveRulerSelectionPreview } from "@/components/timelineGesture";

interface RulerDragState {
  pointerId: number;
  startX: number;
  startY: number;
  anchorTick: number;
}

interface UseTimelineScrubInteractionArgs {
  interactionPolicy: TimelineInteractionPolicy;
  actions: ProjectActions;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  getTickFromViewportClientX: (
    clientX: number,
    viewport: HTMLDivElement | null,
  ) => number;
  seekToClientX: (clientX: number, viewport: HTMLDivElement | null) => void;
}

interface TimelineScrubInteractionResult {
  handleRulerClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleRulerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishRulerPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useTimelineScrubInteraction({
  interactionPolicy,
  actions,
  rulerRef,
  getTickFromViewportClientX,
  seekToClientX,
}: UseTimelineScrubInteractionArgs): TimelineScrubInteractionResult {
  const rulerDragRef = useRef<RulerDragState | null>(null);
  const suppressRulerClickRef = useRef(false);

  const handleRulerClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressRulerClickRef.current) {
        suppressRulerClickRef.current = false;
        return;
      }
      seekToClientX(event.clientX, rulerRef.current);
    },
    [rulerRef, seekToClientX],
  );

  const handleRulerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture?.(event.pointerId);
      rulerDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        anchorTick: getTickFromViewportClientX(event.clientX, rulerRef.current),
      };
    },
    [getTickFromViewportClientX, rulerRef],
  );

  const handleRulerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = rulerDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const preview = resolveRulerSelectionPreview({
        policy: interactionPolicy,
        startX: dragState.startX,
        startY: dragState.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        anchorTick: dragState.anchorTick,
        resolveTickFromClientX: (clientX) =>
          getTickFromViewportClientX(clientX, rulerRef.current),
      });
      if (!preview) {
        return;
      }

      actions.setTimeSelection(preview.startTick, preview.endTick);
    },
    [actions, getTickFromViewportClientX, interactionPolicy, rulerRef],
  );

  const finishRulerPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = rulerDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const preview = resolveRulerSelectionPreview({
        policy: interactionPolicy,
        startX: dragState.startX,
        startY: dragState.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        anchorTick: dragState.anchorTick,
        resolveTickFromClientX: (clientX) =>
          getTickFromViewportClientX(clientX, rulerRef.current),
      });

      if (preview) {
        actions.setTimeSelection(preview.startTick, preview.endTick);
        suppressRulerClickRef.current = true;
      }

      rulerDragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [actions, getTickFromViewportClientX, interactionPolicy, rulerRef],
  );

  return {
    handleRulerClick,
    handleRulerPointerDown,
    handleRulerPointerMove,
    finishRulerPointerGesture,
  };
}
