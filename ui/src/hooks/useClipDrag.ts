import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useProjectActions } from "@/store";
import { useGridSnap } from "./useGridSnap";
import { buildDuplicatePlan, toCommandBatch } from "@/utils/clipPlacement";
import { buildMoveClipsCommand } from "@/intents/clipCommands.ts";
import type { ClipId } from "@/types";
import {
  buildClipDragSession,
  buildClipPreviewStarts,
  hasDragCrossedThreshold,
  resolveClipDragDelta,
  resolveClipTrackPreview,
  type ClipDragContext,
  type DragSession,
} from "./clipDragSession";
import {
  clearDragPreview,
  setDragPreview,
  useClipDragPreview,
} from "./clipDragPreviewStore";

export { useClipDragPreview } from "./clipDragPreviewStore";

export interface ClipDragResult {
  /** Attach to clip body pointerdown (not handles). */
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Whether a drag is in progress. */
  isDragging: boolean;
  /** Preview start tick during drag (null when not dragging). */
  previewStart: number | null;
  /** Preview mode during drag (null when not dragging). */
  previewMode: "move" | "copy" | null;
  /** Consume the click suppression flag after a completed drag. */
  consumeClickSuppression: () => boolean;
}

export function useClipDrag(
  args: {
    clipId: ClipId;
    trackHeight: number;
    context: ClipDragContext;
  },
): ClipDragResult {
  const { clipId, trackHeight, context } = args;
  const actions = useProjectActions();
  const { snapTick, isSnapEnabled, magnetRangeTicks } = useGridSnap();

  const preview = useClipDragPreview();
  const suppressClickRef = useRef(false);
  const dragRef = useRef<DragSession | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const session = buildClipDragSession({
        clipId,
        trackHeight,
        context,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        isSnapEnabled,
        magnetRangeTicks,
      });
      if (!session || !context.document) {
        return;
      }
      const document = context.document;

      event.preventDefault();
      event.stopPropagation();
      dragRef.current = session;

      let hasStartedDrag = false;
      const eventTarget = event.currentTarget;
      eventTarget.setPointerCapture?.(event.pointerId);

      const handlePointerMove = (ev: PointerEvent) => {
        const activeSession = dragRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }
        if (!hasStartedDrag && !hasDragCrossedThreshold(activeSession, ev.clientX, ev.clientY)) {
          return;
        }

        if (!hasStartedDrag) {
          hasStartedDrag = true;
          actions.selectTrack(activeSession.sourceTrackId);
          actions.setClipSelection(
            activeSession.draggedClipIds,
            activeSession.primaryClipId,
          );
        }

        const delta = resolveClipDragDelta(activeSession, ev.clientX, snapTick);
        const isCopyDrag = ev.ctrlKey || ev.metaKey;
        const trackPreview = resolveClipTrackPreview(activeSession, ev.clientY, !isCopyDrag);
        const previewStarts = buildClipPreviewStarts(activeSession, delta);
        setDragPreview(
          isCopyDrag ? "copy" : "move",
          activeSession.draggedClipIds,
          previewStarts,
          trackPreview.previewTrackIds,
        );
      };

      const cleanupPointerListeners = () => {
        eventTarget.removeEventListener("pointermove", handlePointerMove);
        eventTarget.removeEventListener("pointerup", handlePointerUp);
        eventTarget.removeEventListener("pointercancel", handlePointerCancel);
        if (dragRef.current) {
          eventTarget.releasePointerCapture?.(dragRef.current.pointerId);
        }
        dragRef.current = null;
      };

      const handlePointerUp = (ev: PointerEvent) => {
        const activeSession = dragRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }
        cleanupPointerListeners();

        if (!hasStartedDrag) {
          clearDragPreview();
          return;
        }

        const delta = Math.round(resolveClipDragDelta(activeSession, ev.clientX, snapTick));
        const isCopyDrag = ev.ctrlKey || ev.metaKey;
        const trackPreview = resolveClipTrackPreview(activeSession, ev.clientY, !isCopyDrag);

        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);

        if (delta !== 0 || Object.keys(trackPreview.previewTrackIds).length > 0) {
          if (isCopyDrag) {
            const duplicatePlan = buildDuplicatePlan(
              document,
              activeSession.draggedClipIds,
              activeSession.primaryClipId,
              {
                type: "offset",
                deltaTicks: delta,
              },
            );
            const command = duplicatePlan
              ? toCommandBatch(duplicatePlan.commands)
              : null;
            if (command && duplicatePlan) {
              actions.applyCommand(command);
              actions.setClipSelection(
                duplicatePlan.duplicatedClipIds,
                duplicatePlan.primaryDuplicateId,
              );
            }
          } else {
            const command = buildMoveClipsCommand({
              clipIds: activeSession.draggedClipIds,
              deltaTicks: delta,
              originalStarts: activeSession.originalStarts,
              originalTrackIds: activeSession.originalTrackIds,
              previewTrackIds: trackPreview.previewTrackIds,
            });
            if (command) {
              actions.applyCommand(command);
              if (trackPreview.primaryTargetTrackId) {
                actions.selectTrack(trackPreview.primaryTargetTrackId);
              }
              actions.setClipSelection(
                activeSession.draggedClipIds,
                activeSession.primaryClipId,
              );
            }
          }
        }

        clearDragPreview();
      };

      const handlePointerCancel = (ev: PointerEvent) => {
        const activeSession = dragRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }
        cleanupPointerListeners();
        clearDragPreview();
      };

      eventTarget.addEventListener("pointermove", handlePointerMove);
      eventTarget.addEventListener("pointerup", handlePointerUp);
      eventTarget.addEventListener("pointercancel", handlePointerCancel);
    },
    [
      actions,
      context.document,
      clipId,
      isSnapEnabled,
      magnetRangeTicks,
      snapTick,
      trackHeight,
      context,
    ],
  );

  const consumeClickSuppression = useCallback(() => {
    const shouldSuppress = suppressClickRef.current;
    suppressClickRef.current = false;
    return shouldSuppress;
  }, []);

  return {
    onPointerDown,
    isDragging: preview.activeClipIds.includes(clipId),
    previewStart: preview.previewStarts[clipId] ?? null,
    previewMode: preview.activeClipIds.includes(clipId) ? preview.mode : null,
    consumeClickSuppression,
  };
}
