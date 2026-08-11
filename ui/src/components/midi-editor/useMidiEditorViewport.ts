import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { MidiEditorInteractionPolicy } from "@/app/deviceInteraction.ts";
import {
  getMaxScrollLeft,
  getPlayheadFollowScrollLeft,
} from "@/utils/timelineViewport";
import { resolveMidiEditorWheelIntent } from "@/utils/midiEditorWheel";
import type { MidiEditorGridActions } from "./midiEditorInteractionTypes";

interface UseMidiEditorViewportArgs {
  pxPerTick: number;
  rowHeight: number;
  interactionPolicy: MidiEditorInteractionPolicy;
  playheadX: number | null;
  actions: Pick<MidiEditorGridActions, "setZoomX" | "setScrollFromEvent">;
}

interface MidiEditorViewportResult {
  gridScrollRef: React.RefObject<HTMLDivElement | null>;
  pianoScrollRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  getGridContentPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
  handleGridScroll: () => void;
}

export function useMidiEditorViewport({
  pxPerTick,
  rowHeight,
  interactionPolicy,
  playheadX,
  actions,
}: UseMidiEditorViewportArgs): MidiEditorViewportResult {
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const pianoScrollRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const zoomXRef = useRef(pxPerTick);
  const didInitScroll = useRef(false);

  useEffect(() => {
    zoomXRef.current = pxPerTick;
  }, [pxPerTick]);

  const getGridContentPoint = useCallback((clientX: number, clientY: number) => {
    const grid = gridScrollRef.current;
    if (!grid) {
      return null;
    }
    const rect = grid.getBoundingClientRect();
    return {
      x: clientX - rect.left + grid.scrollLeft,
      y: clientY - rect.top + grid.scrollTop,
    };
  }, []);

  const handleGridScroll = useCallback(() => {
    const grid = gridScrollRef.current;
    if (!grid) {
      return;
    }
    actions.setScrollFromEvent(grid.scrollLeft, grid.scrollTop);
    if (
      pianoScrollRef.current &&
      Math.abs(pianoScrollRef.current.scrollTop - grid.scrollTop) >= 0.5
    ) {
      pianoScrollRef.current.scrollTop = grid.scrollTop;
    }
    if (
      rulerScrollRef.current &&
      Math.abs(rulerScrollRef.current.scrollLeft - grid.scrollLeft) >= 0.5
    ) {
      rulerScrollRef.current.scrollLeft = grid.scrollLeft;
    }
  }, [actions]);

  const setGridScrollTop = useCallback(
    (nextScrollTop: number) => {
      const grid = gridScrollRef.current;
      if (!grid) {
        return;
      }
      const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight);
      const clampedScrollTop = Math.min(Math.max(0, nextScrollTop), maxScrollTop);
      if (Math.abs(grid.scrollTop - clampedScrollTop) < 0.5) {
        return;
      }
      grid.scrollTop = clampedScrollTop;
      handleGridScroll();
    },
    [handleGridScroll],
  );

  const setGridScrollLeft = useCallback(
    (nextScrollLeft: number) => {
      const grid = gridScrollRef.current;
      if (!grid) {
        return;
      }
      const clampedScrollLeft = Math.min(
        Math.max(0, nextScrollLeft),
        getMaxScrollLeft(grid.scrollWidth, grid.clientWidth),
      );
      if (Math.abs(grid.scrollLeft - clampedScrollLeft) < 0.5) {
        return;
      }
      grid.scrollLeft = clampedScrollLeft;
      handleGridScroll();
    },
    [handleGridScroll],
  );

  const restoreLockedGridScrollTop = useCallback(
    (lockedScrollTop: number) => {
      const grid = gridScrollRef.current;
      if (!grid) {
        return;
      }
      const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight);
      const clampedScrollTop = Math.min(Math.max(0, lockedScrollTop), maxScrollTop);
      if (Math.abs(grid.scrollTop - clampedScrollTop) < 0.5) {
        return;
      }
      grid.scrollTop = clampedScrollTop;
      handleGridScroll();
    },
    [handleGridScroll],
  );

  useEffect(() => {
    if (didInitScroll.current) {
      return;
    }
    didInitScroll.current = true;
    const grid = gridScrollRef.current;
    if (grid) {
      const middleCRow = 127 - 60;
      const targetScrollTop = middleCRow * rowHeight - grid.clientHeight / 2;
      grid.scrollTop = Math.max(0, targetScrollTop);
      handleGridScroll();
    }
  }, [handleGridScroll, rowHeight]);

  useEffect(() => {
    const grid = gridScrollRef.current;
    const piano = pianoScrollRef.current;
    const ruler = rulerScrollRef.current;
    if (!grid || !piano || !ruler) {
      return;
    }

    const attachWheelListener = (
      element: HTMLDivElement,
      verticalScrollEnabled: boolean,
    ) => {
      const listener = (event: WheelEvent) => {
        const intent = resolveMidiEditorWheelIntent({
          deltaY: event.deltaY,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          verticalScrollEnabled,
          wheelMode: interactionPolicy.wheelMode,
        });
        if (intent.type === "ignore") {
          return;
        }

        event.preventDefault();
        switch (intent.type) {
          case "zoom": {
            const lockedScrollTop = grid.scrollTop;
            actions.setZoomX(zoomXRef.current * intent.factor);
            restoreLockedGridScrollTop(lockedScrollTop);
            requestAnimationFrame(() => {
              restoreLockedGridScrollTop(lockedScrollTop);
            });
            return;
          }
          case "scroll-horizontal":
            setGridScrollLeft(grid.scrollLeft + intent.delta);
            return;
          case "scroll-vertical":
            setGridScrollTop(grid.scrollTop + intent.delta);
            return;
        }
      };

      element.addEventListener("wheel", listener, { passive: false });
      return () => {
        element.removeEventListener("wheel", listener);
      };
    };

    const cleanups = [
      attachWheelListener(grid, true),
      attachWheelListener(ruler, true),
      attachWheelListener(piano, true),
    ];
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [
    actions,
    interactionPolicy.wheelMode,
    restoreLockedGridScrollTop,
    setGridScrollLeft,
    setGridScrollTop,
  ]);

  useLayoutEffect(() => {
    const grid = gridScrollRef.current;
    if (!grid || playheadX === null) {
      return;
    }

    const nextScrollLeft = getPlayheadFollowScrollLeft({
      currentScrollLeft: grid.scrollLeft,
      viewportWidth: grid.clientWidth,
      playheadX,
      maxScrollLeft: getMaxScrollLeft(grid.scrollWidth, grid.clientWidth),
    });
    if (nextScrollLeft !== null) {
      grid.scrollLeft = nextScrollLeft;
      handleGridScroll();
    }
  }, [handleGridScroll, playheadX]);

  return {
    gridScrollRef,
    pianoScrollRef,
    rulerScrollRef,
    getGridContentPoint,
    handleGridScroll,
  };
}
