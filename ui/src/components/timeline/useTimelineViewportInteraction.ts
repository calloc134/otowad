import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import { livePlayheadStore } from "@/audio/livePlayheadStore.ts";
import { clampZoomX } from "@/state/zoomLimits.ts";
import type { ProjectActions } from "@/store";
import {
  getBiasedZoomScrollLeft,
  getMaxScrollLeft,
  getPlayheadFollowScrollLeft,
} from "@/utils/timelineViewport";
import { resolveTimelineWheelIntent } from "@/utils/timelineWheel.ts";
import {
  resolveViewportContentPoint,
  tickFromViewportClientX,
} from "@/utils/timelineInteractions";

const PLAYHEAD_ZOOM_BIAS = 0.5;

interface UseTimelineViewportInteractionArgs {
  pixelsPerTick: number;
  selectionState: {
    scrollX: number;
    scrollY: number;
    zoom: { x: number; y: number };
  };
  interactionPolicy: TimelineInteractionPolicy;
  actions: ProjectActions;
}

interface TimelineViewportInteractionResult {
  rootRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  getViewportContentPoint: (
    clientX: number,
    clientY: number,
    viewport: HTMLDivElement | null,
  ) => { x: number; y: number } | null;
  getTickFromViewportClientX: (
    clientX: number,
    viewport: HTMLDivElement | null,
  ) => number;
  setViewportScrollLeft: (nextScrollLeft: number) => void;
  setViewportScrollTop: (nextScrollTop: number) => void;
  handleLanesScroll: () => void;
}

export function useTimelineViewportInteraction({
  pixelsPerTick,
  selectionState,
  interactionPolicy,
  actions,
}: UseTimelineViewportInteractionArgs): TimelineViewportInteractionResult {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const prevZoomRef = useRef(selectionState.zoom.x);

  const getViewportContentPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      viewport: HTMLDivElement | null,
    ): { x: number; y: number } | null => {
      if (!viewport) {
        return null;
      }
      const rect = viewport.getBoundingClientRect();
      return resolveViewportContentPoint({
        clientX,
        clientY,
        viewportLeft: rect.left,
        viewportTop: rect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      });
    },
    [],
  );

  const getTickFromViewportClientX = useCallback(
    (clientX: number, viewport: HTMLDivElement | null) => {
      if (!viewport) {
        return 0;
      }
      const rect = viewport.getBoundingClientRect();
      return tickFromViewportClientX({
        clientX,
        viewportLeft: rect.left,
        scrollLeft: viewport.scrollLeft,
        pixelsPerTick,
      });
    },
    [pixelsPerTick],
  );

  const syncRulerScroll = useCallback((scrollLeft: number) => {
    if (rulerRef.current) {
      rulerRef.current.scrollLeft = scrollLeft;
    }
  }, []);

  const setViewportScrollLeft = useCallback(
    (nextScrollLeft: number) => {
      const viewport = scrollRef.current;
      if (!viewport) {
        return;
      }

      const clampedScrollLeft = Math.min(
        Math.max(nextScrollLeft, 0),
        getMaxScrollLeft(viewport.scrollWidth, viewport.clientWidth),
      );
      if (Math.abs(viewport.scrollLeft - clampedScrollLeft) >= 0.5) {
        viewport.scrollLeft = clampedScrollLeft;
      }
      syncRulerScroll(viewport.scrollLeft);
    },
    [syncRulerScroll],
  );

  const setViewportScrollTop = useCallback((nextScrollTop: number) => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const clampedScrollTop = Math.min(Math.max(nextScrollTop, 0), maxScrollTop);
    if (Math.abs(viewport.scrollTop - clampedScrollTop) >= 0.5) {
      viewport.scrollTop = clampedScrollTop;
    }
  }, []);

  const handleWheelIntent = useCallback(
    (event: WheelEvent) => {
      const viewport = scrollRef.current;
      if (!viewport) {
        return;
      }

      const intent = resolveTimelineWheelIntent({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        wheelMode: interactionPolicy.wheelMode,
      });

      if (intent.type === "native-scroll") {
        setViewportScrollTop(viewport.scrollTop + event.deltaY);
        actions.setScroll(viewport.scrollLeft, viewport.scrollTop);
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (intent.type === "zoom") {
        actions.setZoom(
          clampZoomX(selectionState.zoom.x * intent.factor),
          selectionState.zoom.y,
        );
        return;
      }

      if (intent.type === "scroll-horizontal") {
        setViewportScrollLeft(viewport.scrollLeft + intent.delta);
        actions.setScroll(viewport.scrollLeft, viewport.scrollTop);
        return;
      }

      setViewportScrollTop(viewport.scrollTop + intent.delta);
      actions.setScroll(viewport.scrollLeft, viewport.scrollTop);
    },
    [
      actions,
      interactionPolicy.wheelMode,
      selectionState.zoom.x,
      selectionState.zoom.y,
      setViewportScrollLeft,
      setViewportScrollTop,
    ],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    root.addEventListener("wheel", handleWheelIntent, { passive: false });
    return () => {
      root.removeEventListener("wheel", handleWheelIntent);
    };
  }, [handleWheelIntent]);

  const handleLanesScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    syncRulerScroll(scrollRef.current.scrollLeft);
    actions.setScroll(scrollRef.current.scrollLeft, scrollRef.current.scrollTop);
  }, [actions, syncRulerScroll]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }

    if (Math.abs(viewport.scrollLeft - selectionState.scrollX) >= 0.5) {
      viewport.scrollLeft = selectionState.scrollX;
      syncRulerScroll(viewport.scrollLeft);
    }
    if (Math.abs(viewport.scrollTop - selectionState.scrollY) >= 0.5) {
      viewport.scrollTop = selectionState.scrollY;
    }
  }, [selectionState.scrollX, selectionState.scrollY, syncRulerScroll]);

  useLayoutEffect(() => {
    const previousZoom = prevZoomRef.current;
    prevZoomRef.current = pixelsPerTick;

    const viewport = scrollRef.current;
    if (!viewport || previousZoom === pixelsPerTick) {
      return;
    }

    const nextScrollLeft = getBiasedZoomScrollLeft({
      currentScrollLeft: viewport.scrollLeft,
      viewportWidth: viewport.clientWidth,
      oldPixelsPerTick: previousZoom,
      newPixelsPerTick: pixelsPerTick,
      // Anchor on where the playhead is *now*. The reducer's copy is frozen
      // for the whole of playback, so zooming mid-playback used to recentre
      // on wherever playback started.
      playheadTick: livePlayheadStore.getSnapshot(),
      contentWidth: viewport.scrollWidth,
      bias: PLAYHEAD_ZOOM_BIAS,
    });
    setViewportScrollLeft(nextScrollLeft);
  }, [pixelsPerTick, setViewportScrollLeft]);

  // Follow the playhead off the right edge. This subscribes to the live store
  // rather than reading the reducer, which does not advance during playback —
  // the marker used to run off-screen and the viewport never chased it.
  useEffect(() => {
    const followPlayhead = (tick: number) => {
      const viewport = scrollRef.current;
      if (!viewport) {
        return;
      }

      const nextScrollLeft = getPlayheadFollowScrollLeft({
        currentScrollLeft: viewport.scrollLeft,
        viewportWidth: viewport.clientWidth,
        playheadX: tick * pixelsPerTick,
        maxScrollLeft: getMaxScrollLeft(viewport.scrollWidth, viewport.clientWidth),
      });
      if (nextScrollLeft !== null) {
        setViewportScrollLeft(nextScrollLeft);
      }
    };

    followPlayhead(livePlayheadStore.getSnapshot());
    return livePlayheadStore.subscribe(followPlayhead);
  }, [pixelsPerTick, setViewportScrollLeft]);

  return {
    rootRef,
    scrollRef,
    rulerRef,
    timelineRef,
    getViewportContentPoint,
    getTickFromViewportClientX,
    setViewportScrollLeft,
    setViewportScrollTop,
    handleLanesScroll,
  };
}
