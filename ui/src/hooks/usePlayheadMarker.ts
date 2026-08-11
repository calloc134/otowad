import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { livePlayheadStore } from "../audio/livePlayheadStore.ts";

type ApplyToElement<T extends HTMLElement> = (element: T, tick: number) => void;

/**
 * Attach an element to the live playhead tick and patch it imperatively.
 *
 * Playback advances the tick every frame. Routing that through React state
 * would re-render every subscriber of `useTransportState()` at ~60fps, which
 * in a timeline-heavy DAW means re-rendering hundreds of clips, so the
 * per-frame consumers patch their own DOM node instead.
 *
 * Elements driven this way must not also receive the same property from React
 * — render them without the corresponding prop so reconciliation leaves the
 * imperative value alone.
 */
export function useLivePlayheadElement<T extends HTMLElement>(
  apply: ApplyToElement<T>,
  deps: readonly unknown[],
): (element: T | null) => void {
  const elementRef = useRef<T | null>(null);
  const applyRef = useRef(apply);

  useLayoutEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  const applyCurrent = useCallback((tick: number) => {
    const element = elementRef.current;
    if (element) {
      applyRef.current(element, tick);
    }
  }, []);

  useEffect(() => {
    applyCurrent(livePlayheadStore.getSnapshot());
    return livePlayheadStore.subscribe(applyCurrent);
  }, [applyCurrent]);

  // Re-apply when the inputs the caller derives from change (zoom, resize,
  // tempo, time signature).
  useEffect(() => {
    applyCurrent(livePlayheadStore.getSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCurrent, ...deps]);

  return useCallback(
    (element: T | null) => {
      elementRef.current = element;
      if (element) {
        applyCurrent(livePlayheadStore.getSnapshot());
      }
    },
    [applyCurrent],
  );
}

/**
 * Position a DOM marker at the current playhead tick.
 *
 * The element's `left` is set to `tick * pixelsPerTick + offsetPx`. Passing
 * `offsetPx = -halfWidth` centres a triangle on the tick.
 */
export function usePlayheadMarker(pixelsPerTick: number, offsetPx = 0) {
  return useLivePlayheadElement<HTMLElement>(
    (element, tick) => {
      element.style.left = `${tick * pixelsPerTick + offsetPx}px`;
    },
    [pixelsPerTick, offsetPx],
  );
}

/**
 * Write the current playhead position into a DOM node as text.
 *
 * Render the target element without children so React does not overwrite the
 * text on its next reconciliation.
 */
export function usePlayheadReadout(format: (tick: number) => string) {
  return useLivePlayheadElement<HTMLElement>(
    (element, tick) => {
      element.textContent = format(tick);
    },
    [format],
  );
}
