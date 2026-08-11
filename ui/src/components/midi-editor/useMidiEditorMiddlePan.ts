import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { MiddlePanPointerState } from "./midiEditorInteractionTypes";

interface UseMidiEditorMiddlePanArgs {
  gridScrollRef: React.RefObject<HTMLDivElement | null>;
  handleGridScroll: () => void;
}

interface MidiEditorMiddlePanResult {
  handleEditorBodyPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleEditorBodyPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishEditorBodyPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleAuxClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function useMidiEditorMiddlePan({
  gridScrollRef,
  handleGridScroll,
}: UseMidiEditorMiddlePanArgs): MidiEditorMiddlePanResult {
  const middlePanPointerRef = useRef<MiddlePanPointerState | null>(null);

  const handleEditorBodyPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse" || event.button !== 1) {
        return;
      }

      const grid = gridScrollRef.current;
      if (!grid) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      middlePanPointerRef.current = {
        pointerId: event.pointerId,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startScrollLeft: grid.scrollLeft,
        startScrollTop: grid.scrollTop,
      };
    },
    [gridScrollRef],
  );

  const handleEditorBodyPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const panState = middlePanPointerRef.current;
      const grid = gridScrollRef.current;
      if (!panState || panState.pointerId !== event.pointerId || !grid) {
        return;
      }

      event.preventDefault();
      const dx = event.clientX - panState.startMouseX;
      const dy = event.clientY - panState.startMouseY;

      grid.scrollLeft = Math.max(0, panState.startScrollLeft - dx);
      grid.scrollTop = Math.max(0, panState.startScrollTop - dy);
      handleGridScroll();
    },
    [gridScrollRef, handleGridScroll],
  );

  const finishEditorBodyPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const panState = middlePanPointerRef.current;
      if (!panState || panState.pointerId !== event.pointerId) {
        return;
      }

      middlePanPointerRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [],
  );

  const handleAuxClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  }, []);

  return {
    handleEditorBodyPointerDown,
    handleEditorBodyPointerMove,
    finishEditorBodyPointerGesture,
    handleAuxClick,
  };
}
