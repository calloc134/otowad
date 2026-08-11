import { useCallback, useEffect, useState } from "react";

/**
 * The prefixed Fullscreen API Safari still ships, including on iPadOS. The DOM
 * lib has no types for it, so declare the parts we touch.
 */
interface WebkitFullscreenDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function fullscreenDocument(): (Document & WebkitFullscreenDocument) | null {
  return typeof document === "undefined" ? null : document;
}

function readFullscreenElement(): Element | null {
  const doc = fullscreenDocument();
  if (!doc) {
    return null;
  }
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Whether element fullscreen can actually be entered here.
 *
 * Probing `fullscreenEnabled` rather than the presence of `requestFullscreen`
 * matters twice: an iframe that withholds the `fullscreen` permission still
 * exposes the method, and iPhone Safari exposes the prefixed method while
 * reporting `webkitFullscreenEnabled === false`. Only video goes fullscreen on
 * iPhone, so callers must be prepared for this to be `false` on a phone and
 * fall back to installing the PWA.
 */
function readSupported(): boolean {
  const doc = fullscreenDocument();
  if (!doc) {
    return false;
  }
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false);
}

export interface FullscreenControl {
  /** `false` on iPhone Safari and anywhere the permission is withheld. */
  supported: boolean;
  /** Whether the document is currently displayed fullscreen. */
  active: boolean;
  /** Enter when windowed, leave when fullscreen. Must run in a user gesture. */
  toggle: () => void;
}

/**
 * Drive the document in and out of fullscreen, tracking the browser's own idea
 * of the current state rather than a local boolean.
 *
 * The distinction is load-bearing: a user can leave fullscreen with Escape or
 * the system gesture without touching our button, and a mirrored boolean would
 * then describe a state the page is no longer in.
 */
export function useFullscreen(): FullscreenControl {
  const [supported] = useState(readSupported);
  const [active, setActive] = useState(() => readFullscreenElement() !== null);

  useEffect(() => {
    const sync = () => setActive(readFullscreenElement() !== null);
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const doc = fullscreenDocument();
    if (!doc) {
      return;
    }
    const element: HTMLElement & WebkitFullscreenElement = doc.documentElement;
    const result = readFullscreenElement()
      ? (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
      : (element.requestFullscreen?.() ?? element.webkitRequestFullscreen?.());

    // Browsers reject when the call did not come from a trusted gesture, or
    // when the user has blocked fullscreen for the site. Neither is actionable
    // and neither should surface as an unhandled rejection; `fullscreenchange`
    // stays authoritative for what the state actually became.
    void Promise.resolve(result).catch(() => undefined);
  }, []);

  return { supported, active, toggle };
}
