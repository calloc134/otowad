import { useCallback, useEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

const UNMEASURED_SIZE: ElementSize = { width: 0, height: 0 };

/** Track an element's border-box size without making render read layout directly. */
export function useElementSize<T extends HTMLElement>(): [
  (element: T | null) => void,
  ElementSize,
] {
  const [size, setSize] = useState(UNMEASURED_SIZE);
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<T | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const measureRef = useCallback((element: T | null) => {
    if (elementRef.current === element) {
      return;
    }
    elementRef.current = element;
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!element) {
      setSize(UNMEASURED_SIZE);
      return;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = element.clientWidth || rect.width;
      const height = element.clientHeight || rect.height;
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return [measureRef, size];
}
