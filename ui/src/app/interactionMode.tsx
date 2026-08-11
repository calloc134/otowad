import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  DEFAULT_INTERACTION_ENVIRONMENT,
  resolveInteractionEnvironment,
  useDeviceCapabilities,
  type AppShellVariant,
  type DeviceCapabilities,
  type DialogInteractionPolicy,
  type InteractionMode,
  type LayoutMode,
  type MidiEditorInteractionPolicy,
  type ResolvedInteractionEnvironment,
  type TimelineInteractionPolicy,
  type TrackListInteractionPolicy,
} from "./deviceInteraction.ts";

export type ShellVariantValueMap<T> = Record<AppShellVariant, T>;

const InteractionModeContext = createContext<ResolvedInteractionEnvironment>(
  DEFAULT_INTERACTION_ENVIRONMENT,
);

interface InteractionModeProviderProps {
  children: ReactNode;
}

export function InteractionModeProvider({ children }: InteractionModeProviderProps) {
  const capabilities = useDeviceCapabilities();
  const value = useMemo(
    () => resolveInteractionEnvironment(capabilities),
    [capabilities],
  );

  return (
    <InteractionModeContext.Provider value={value}>{children}</InteractionModeContext.Provider>
  );
}

export function useInteractionEnvironment(): ResolvedInteractionEnvironment {
  return useContext(InteractionModeContext);
}

export function useResolvedDeviceCapabilities(): DeviceCapabilities {
  return useInteractionEnvironment().capabilities;
}

export function useInteractionMode(): InteractionMode {
  return useInteractionEnvironment().interactionMode;
}

export function useShellVariant(): AppShellVariant {
  return useInteractionEnvironment().shellVariant;
}

/**
 * How much the screen can show, independent of how the user points at it.
 * Use this to decide what to collapse; use `useInteractionMode` for hit areas.
 */
export function useLayoutMode(): LayoutMode {
  return useInteractionEnvironment().layoutMode;
}

export function resolveShellVariantValue<T>(
  shellVariant: AppShellVariant,
  values: ShellVariantValueMap<T>,
): T {
  return values[shellVariant];
}

export function useShellVariantValue<T>(values: ShellVariantValueMap<T>): T {
  return resolveShellVariantValue(useShellVariant(), values);
}

export function useTimelineInteractionPolicy(): TimelineInteractionPolicy {
  return useInteractionEnvironment().timeline;
}

export function useMidiEditorInteractionPolicy(): MidiEditorInteractionPolicy {
  return useInteractionEnvironment().midiEditor;
}

export function useTrackListInteractionPolicy(): TrackListInteractionPolicy {
  return useInteractionEnvironment().trackList;
}

export function useDialogInteractionPolicy(): DialogInteractionPolicy {
  return useInteractionEnvironment().dialog;
}

export function usePortraitGuidance(): boolean {
  return useInteractionEnvironment().showPortraitGuidance;
}
