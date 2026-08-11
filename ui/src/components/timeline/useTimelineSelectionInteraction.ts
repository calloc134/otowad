import { useCallback, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { ProjectDocument } from "@/types";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { ProjectActions } from "@/store";
import { resolveTimelineTouchPanPreview } from "@/components/timelineGesture";
import { getMaxScrollLeft } from "@/utils/timelineViewport";
import {
  hasTimelineMarqueeMoved,
  resolveTimelineMarqueeSelection,
  type TimelineMarqueeSelection,
} from "./timelineInteractionsShared";
import {
  getPinchDistance,
  getPinchMidpointX,
  resolveTimelinePinch,
  resolveTimelinePinchAnchor,
  type TimelinePinchAnchor,
  type TimelinePinchPoint,
} from "./timelinePinch";

interface MobilePanState {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

interface TimelineMarqueePointerState {
  pointerId: number;
}

interface UseTimelineSelectionInteractionArgs {
  doc: ProjectDocument | null;
  pixelsPerTick: number;
  trackHeight: number;
  /** Passed through unchanged when a pinch writes the horizontal zoom. */
  zoomY: number;
  selectionState: {
    selectedClipIds: string[];
    selectedClipKind: "audio" | "midi" | null;
    primaryClipId: string | null;
  };
  interactionPolicy: TimelineInteractionPolicy;
  actions: ProjectActions;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  getViewportContentPoint: (
    clientX: number,
    clientY: number,
    viewport: HTMLDivElement | null,
  ) => { x: number; y: number } | null;
  setViewportScrollLeft: (nextScrollLeft: number) => void;
  setViewportScrollTop: (nextScrollTop: number) => void;
  seekToClientX: (clientX: number, viewport: HTMLDivElement | null) => void;
}

interface TimelineSelectionInteractionResult {
  marquee: TimelineMarqueeSelection | null;
  handleTimelineClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleTimelinePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishTimelinePointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useTimelineSelectionInteraction({
  doc,
  pixelsPerTick,
  trackHeight,
  zoomY,
  selectionState,
  interactionPolicy,
  actions,
  scrollRef,
  getViewportContentPoint,
  setViewportScrollLeft,
  setViewportScrollTop,
  seekToClientX,
}: UseTimelineSelectionInteractionArgs): TimelineSelectionInteractionResult {
  const marqueeRef = useRef<TimelineMarqueeSelection | null>(null);
  const marqueePointerRef = useRef<TimelineMarqueePointerState | null>(null);
  const mobilePanRef = useRef<MobilePanState | null>(null);
  const activeTouchesRef = useRef(new Map<number, TimelinePinchPoint>());
  const pinchAnchorRef = useRef<TimelinePinchAnchor | null>(null);
  const suppressTimelineClickRef = useRef(false);
  const [marquee, setMarquee] = useState<TimelineMarqueeSelection | null>(null);

  /** The two contact points, in the order the fingers landed. */
  const getPinchPoints = useCallback((): [TimelinePinchPoint, TimelinePinchPoint] | null => {
    const points = [...activeTouchesRef.current.values()];
    return points.length >= 2 ? [points[0]!, points[1]!] : null;
  }, []);

  const createPinchAnchor = useCallback(
    (viewport: HTMLDivElement): TimelinePinchAnchor | null => {
      const points = getPinchPoints();
      if (!points) {
        return null;
      }

      const rect = viewport.getBoundingClientRect();
      return resolveTimelinePinchAnchor({
        distance: getPinchDistance(points[0], points[1]),
        zoomX: pixelsPerTick,
        scrollLeft: viewport.scrollLeft,
        midpointOffsetX: getPinchMidpointX(points[0], points[1]) - rect.left,
      });
    },
    [getPinchPoints, pixelsPerTick],
  );

  const handleTimelineClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-clip-root='true']")
      ) {
        return;
      }
      if (suppressTimelineClickRef.current) {
        suppressTimelineClickRef.current = false;
        return;
      }
      seekToClientX(event.clientX, scrollRef.current);
    },
    [scrollRef, seekToClientX],
  );

  const handleTimelinePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button === 2) {
        if (!doc) {
          return;
        }

        const point = getViewportContentPoint(
          event.clientX,
          event.clientY,
          scrollRef.current,
        );
        if (!point) {
          return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const nextMarquee: TimelineMarqueeSelection = {
          startX: point.x,
          startY: point.y,
          currentX: point.x,
          currentY: point.y,
          union: event.ctrlKey || event.metaKey,
          baseSelection: selectionState.selectedClipIds,
          basePrimaryClipId: selectionState.primaryClipId,
        };
        marqueePointerRef.current = { pointerId: event.pointerId };
        marqueeRef.current = nextMarquee;
        setMarquee(nextMarquee);
        return;
      }

      if (event.pointerType !== "touch") {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("[data-clip-root='true']")
      ) {
        return;
      }

      const viewport = scrollRef.current;
      if (!viewport) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      activeTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (activeTouchesRef.current.size >= 2) {
        // A second finger takes over: one-finger panning stops and the pinch
        // anchor is captured from where the two fingers currently are.
        mobilePanRef.current = null;
        pinchAnchorRef.current = createPinchAnchor(viewport);
        return;
      }

      mobilePanRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
      };
    },
    [
      createPinchAnchor,
      doc,
      getViewportContentPoint,
      scrollRef,
      selectionState.primaryClipId,
      selectionState.selectedClipIds,
    ],
  );

  const handleTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const marqueePointer = marqueePointerRef.current;
      if (marqueePointer?.pointerId === event.pointerId) {
        const currentPoint = getViewportContentPoint(
          event.clientX,
          event.clientY,
          scrollRef.current,
        );
        if (!currentPoint || !marqueeRef.current) {
          return;
        }

        const updated: TimelineMarqueeSelection = {
          ...marqueeRef.current,
          currentX: currentPoint.x,
          currentY: currentPoint.y,
        };
        marqueeRef.current = updated;
        setMarquee(updated);
        return;
      }

      const viewport = scrollRef.current;

      if (activeTouchesRef.current.has(event.pointerId)) {
        activeTouchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      const anchor = pinchAnchorRef.current;
      const pinchPoints = getPinchPoints();
      if (anchor && pinchPoints && viewport) {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const next = resolveTimelinePinch({
          anchor,
          distance: getPinchDistance(pinchPoints[0], pinchPoints[1]),
          midpointOffsetX: getPinchMidpointX(pinchPoints[0], pinchPoints[1]) - rect.left,
          maxScrollLeft: getMaxScrollLeft(viewport.scrollWidth, viewport.clientWidth),
        });
        if (next) {
          actions.setZoom(next.zoomX, zoomY);
          setViewportScrollLeft(next.scrollLeft);
        }
        return;
      }

      const panState = mobilePanRef.current;
      if (!panState || panState.pointerId !== event.pointerId || !viewport) {
        return;
      }

      event.preventDefault();
      const preview = resolveTimelineTouchPanPreview({
        policy: interactionPolicy,
        startX: panState.startX,
        startY: panState.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        startScrollLeft: panState.startScrollLeft,
        startScrollTop: panState.startScrollTop,
        maxScrollTop: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      });
      if (!preview) {
        return;
      }

      setViewportScrollLeft(preview.scrollLeft);
      setViewportScrollTop(preview.scrollTop);
    },
    [
      actions,
      getPinchPoints,
      getViewportContentPoint,
      interactionPolicy,
      scrollRef,
      setViewportScrollLeft,
      setViewportScrollTop,
      zoomY,
    ],
  );

  const finishTimelinePointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const isCancel = event.type === "pointercancel";
      const marqueePointer = marqueePointerRef.current;
      if (marqueePointer?.pointerId === event.pointerId) {
        const currentMarquee = marqueeRef.current;
        marqueePointerRef.current = null;
        marqueeRef.current = null;
        setMarquee(null);

        if (!isCancel && currentMarquee) {
          const currentPoint = getViewportContentPoint(
            event.clientX,
            event.clientY,
            scrollRef.current,
          ) ?? {
            x: currentMarquee.currentX,
            y: currentMarquee.currentY,
          };
          const finalizedMarquee: TimelineMarqueeSelection = {
            ...currentMarquee,
            currentX: currentPoint.x,
            currentY: currentPoint.y,
          };

          if (hasTimelineMarqueeMoved(finalizedMarquee)) {
            actions.setClipSelection(
              resolveTimelineMarqueeSelection({
                document: doc,
                marquee: finalizedMarquee,
                pixelsPerTick,
                trackHeight,
                selectedClipKind: selectionState.selectedClipKind,
              }),
              finalizedMarquee.union ? finalizedMarquee.basePrimaryClipId : null,
            );
            suppressTimelineClickRef.current = true;
          }
        }

        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        return;
      }

      const wasPinching = pinchAnchorRef.current !== null;
      activeTouchesRef.current.delete(event.pointerId);
      if (wasPinching) {
        // Lifting one finger ends the gesture rather than falling back to a
        // one-finger pan from a stale start point. The remaining finger has to
        // be lifted and placed again.
        pinchAnchorRef.current = null;
        mobilePanRef.current = null;
        if (!isCancel) {
          suppressTimelineClickRef.current = true;
        }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        return;
      }

      const panState = mobilePanRef.current;
      if (!panState || panState.pointerId !== event.pointerId) {
        return;
      }

      const viewport = scrollRef.current;
      const preview = viewport
        ? resolveTimelineTouchPanPreview({
            policy: interactionPolicy,
            startX: panState.startX,
            startY: panState.startY,
            currentX: event.clientX,
            currentY: event.clientY,
            startScrollLeft: panState.startScrollLeft,
            startScrollTop: panState.startScrollTop,
            maxScrollTop: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          })
        : null;
      if (!isCancel && preview) {
        suppressTimelineClickRef.current = true;
      }

      mobilePanRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [
      actions,
      doc,
      getViewportContentPoint,
      interactionPolicy,
      pixelsPerTick,
      scrollRef,
      selectionState.selectedClipKind,
      trackHeight,
    ],
  );

  return {
    marquee,
    handleTimelineClick,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    finishTimelinePointerGesture,
  };
}
