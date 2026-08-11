import { useEffect, useState } from "react";

export interface DeviceCapabilities {
  coarsePointer: boolean;
  supportsHover: boolean;
  maxTouchPoints: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface TimelineInteractionPolicy {
  dragThresholdPx: number;
  splitLongPressMs: number;
  splitMoveThresholdPx: number;
  supportsHover: boolean;
  allowsModifierShortcuts: boolean;
  wheelMode: "mixed" | "scroll";
  clipActionSize: "compact" | "touch";
}

export interface MidiEditorInteractionPolicy {
  noteCreateDragThresholdPx: number;
  noteMoveDragThresholdPx: number;
  supportsHover: boolean;
  allowsModifierShortcuts: boolean;
  wheelMode: "mixed" | "scroll";
}

export interface TrackListInteractionPolicy {
  controlSize: "compact" | "touch";
  showsExplicitRenameAction: boolean;
  showsExplicitReorderButtons: boolean;
}

export interface DialogInteractionPolicy {
  actionSize: "compact" | "touch";
}

/** How the user points at things: hit areas, hover, modifier shortcuts. */
export type InteractionMode = "desktop-like" | "touch-like";

/**
 * How much the screen can show at once: which shell, what gets collapsed.
 *
 * This is deliberately a separate axis from `InteractionMode`. Deciding the
 * shell from pointer type alone sent every touch device to the phone layout,
 * so an iPad in landscape — wider than most laptops — got a stacked toolbar
 * and no track list.
 */
export type LayoutMode = "phone" | "tablet" | "desktop";

export type AppShellVariant = "desktop" | "mobile";

export interface ResolvedInteractionEnvironment {
  capabilities: DeviceCapabilities;
  interactionMode: InteractionMode;
  layoutMode: LayoutMode;
  shellVariant: AppShellVariant;
  timeline: TimelineInteractionPolicy;
  midiEditor: MidiEditorInteractionPolicy;
  trackList: TrackListInteractionPolicy;
  dialog: DialogInteractionPolicy;
  showPortraitGuidance: boolean;
}

interface MatchMediaLike {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

interface DeviceEnvironmentLike {
  innerWidth: number;
  innerHeight: number;
  matchMedia: (query: string) => MatchMediaLike;
  navigator?: {
    maxTouchPoints?: number;
  };
}

export const desktopTimelinePolicy: TimelineInteractionPolicy = {
  dragThresholdPx: 4,
  splitLongPressMs: 500,
  splitMoveThresholdPx: 4,
  supportsHover: true,
  allowsModifierShortcuts: true,
  wheelMode: "mixed",
  clipActionSize: "compact",
};

export const touchTimelinePolicy: TimelineInteractionPolicy = {
  dragThresholdPx: 8,
  splitLongPressMs: 500,
  splitMoveThresholdPx: 8,
  supportsHover: false,
  allowsModifierShortcuts: false,
  wheelMode: "scroll",
  clipActionSize: "touch",
};

export const desktopMidiEditorPolicy: MidiEditorInteractionPolicy = {
  noteCreateDragThresholdPx: 8,
  noteMoveDragThresholdPx: 4,
  supportsHover: true,
  allowsModifierShortcuts: true,
  wheelMode: "mixed",
};

export const touchMidiEditorPolicy: MidiEditorInteractionPolicy = {
  noteCreateDragThresholdPx: 12,
  noteMoveDragThresholdPx: 8,
  supportsHover: false,
  allowsModifierShortcuts: false,
  wheelMode: "scroll",
};

export const desktopTrackListPolicy: TrackListInteractionPolicy = {
  controlSize: "compact",
  showsExplicitRenameAction: false,
  showsExplicitReorderButtons: false,
};

export const touchTrackListPolicy: TrackListInteractionPolicy = {
  controlSize: "touch",
  showsExplicitRenameAction: true,
  showsExplicitReorderButtons: true,
};

export const desktopDialogPolicy: DialogInteractionPolicy = {
  actionSize: "compact",
};

export const touchDialogPolicy: DialogInteractionPolicy = {
  actionSize: "touch",
};

const DEFAULT_DEVICE_CAPABILITIES: DeviceCapabilities = {
  coarsePointer: false,
  supportsHover: true,
  maxTouchPoints: 0,
  viewportWidth: 1280,
  viewportHeight: 720,
};

function createFallbackMatchMedia(): MatchMediaLike {
  return {
    matches: false,
  };
}

function resolveWindowDeviceCapabilities(windowLike: Window): DeviceCapabilities {
  const matchMedia = typeof windowLike.matchMedia === "function"
    ? windowLike.matchMedia.bind(windowLike)
    : () => createFallbackMatchMedia();

  return resolveDeviceCapabilities({
    innerWidth: windowLike.innerWidth,
    innerHeight: windowLike.innerHeight,
    matchMedia,
    navigator: windowLike.navigator,
  });
}

export const DEFAULT_INTERACTION_ENVIRONMENT: ResolvedInteractionEnvironment = {
  capabilities: DEFAULT_DEVICE_CAPABILITIES,
  interactionMode: "desktop-like",
  layoutMode: "desktop",
  shellVariant: "desktop",
  timeline: desktopTimelinePolicy,
  midiEditor: desktopMidiEditorPolicy,
  trackList: desktopTrackListPolicy,
  dialog: desktopDialogPolicy,
  showPortraitGuidance: false,
};

export function resolveDeviceCapabilities(
  env: DeviceEnvironmentLike,
): DeviceCapabilities {
  return {
    coarsePointer: env.matchMedia("(pointer: coarse)").matches,
    supportsHover: env.matchMedia("(hover: hover)").matches,
    maxTouchPoints: env.navigator?.maxTouchPoints ?? 0,
    viewportWidth: env.innerWidth,
    viewportHeight: env.innerHeight,
  };
}

export function isTouchLikeDevice(capabilities: DeviceCapabilities): boolean {
  return capabilities.coarsePointer || (!capabilities.supportsHover && capabilities.maxTouchPoints > 0);
}

export function resolveInteractionMode(capabilities: DeviceCapabilities): InteractionMode {
  return isTouchLikeDevice(capabilities) ? "touch-like" : "desktop-like";
}

/**
 * A phone is small in *both* orientations, so the short edge is what
 * separates it from a tablet — a phone held sideways is still a phone.
 */
const PHONE_MAX_SHORT_EDGE_PX = 520;

export function resolveLayoutMode(capabilities: DeviceCapabilities): LayoutMode {
  if (!isTouchLikeDevice(capabilities)) {
    // A pointer device keeps the desktop shell at any window size; the shell
    // collapses its own chrome rather than switching to a phone layout.
    return "desktop";
  }

  const shortEdge = Math.min(capabilities.viewportWidth, capabilities.viewportHeight);
  return shortEdge < PHONE_MAX_SHORT_EDGE_PX ? "phone" : "tablet";
}

export function resolveAppShellVariant(layoutMode: LayoutMode): AppShellVariant {
  return layoutMode === "phone" ? "mobile" : "desktop";
}

export function resolveTimelineInteractionPolicy(
  capabilities: DeviceCapabilities,
): TimelineInteractionPolicy {
  return isTouchLikeDevice(capabilities)
    ? touchTimelinePolicy
    : desktopTimelinePolicy;
}

export function resolveMidiEditorInteractionPolicy(
  capabilities: DeviceCapabilities,
): MidiEditorInteractionPolicy {
  return isTouchLikeDevice(capabilities)
    ? touchMidiEditorPolicy
    : desktopMidiEditorPolicy;
}

export function resolveTrackListInteractionPolicy(
  capabilities: DeviceCapabilities,
): TrackListInteractionPolicy {
  return isTouchLikeDevice(capabilities)
    ? touchTrackListPolicy
    : desktopTrackListPolicy;
}

export function resolveDialogInteractionPolicy(
  capabilities: DeviceCapabilities,
): DialogInteractionPolicy {
  return isTouchLikeDevice(capabilities)
    ? touchDialogPolicy
    : desktopDialogPolicy;
}

export function shouldShowPortraitGuidance(
  capabilities: DeviceCapabilities,
): boolean {
  // Only phones. The old width test also caught tablets in portrait, which
  // have room for the timeline and were being sent to a dead end.
  return (
    resolveLayoutMode(capabilities) === "phone" &&
    capabilities.viewportHeight > capabilities.viewportWidth
  );
}

export function resolveInteractionEnvironment(
  capabilities: DeviceCapabilities,
): ResolvedInteractionEnvironment {
  const interactionMode = resolveInteractionMode(capabilities);
  const layoutMode = resolveLayoutMode(capabilities);

  return {
    capabilities,
    interactionMode,
    layoutMode,
    shellVariant: resolveAppShellVariant(layoutMode),
    timeline: resolveTimelineInteractionPolicy(capabilities),
    midiEditor: resolveMidiEditorInteractionPolicy(capabilities),
    trackList: resolveTrackListInteractionPolicy(capabilities),
    dialog: resolveDialogInteractionPolicy(capabilities),
    showPortraitGuidance: shouldShowPortraitGuidance(capabilities),
  };
}

export function useDeviceCapabilities(): DeviceCapabilities {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DEVICE_CAPABILITIES;
    }
    return resolveWindowDeviceCapabilities(window);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const coarsePointerQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)")
      : createFallbackMatchMedia();
    const hoverQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover)")
      : createFallbackMatchMedia();
    const update = () => setCapabilities(resolveWindowDeviceCapabilities(window));
    const addQueryListener = (query: MatchMediaLike, listener: () => void) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", listener);
        return () => query.removeEventListener?.("change", listener);
      }
      query.addListener?.(listener);
      return () => query.removeListener?.(listener);
    };

    update();
    const removeCoarseListener = addQueryListener(coarsePointerQuery, update);
    const removeHoverListener = addQueryListener(hoverQuery, update);
    window.addEventListener("resize", update);

    return () => {
      removeCoarseListener();
      removeHoverListener();
      window.removeEventListener("resize", update);
    };
  }, []);

  return capabilities;
}
