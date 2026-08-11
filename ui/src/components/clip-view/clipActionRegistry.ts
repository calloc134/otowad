import type { ResolvedInteractionAction } from "@/app/interaction-contracts/actions.ts";
import {
  countVisibleActions,
  resolveActionRegistry,
  type InteractionActionDefinition,
} from "@/app/interaction-contracts/actions.ts";

export interface ClipActionContext {
  clipId: string;
  isAudio: boolean;
  isMidi: boolean;
  canUseModifierShortcuts: boolean;
  hasPitchLink: boolean;
  warpPlacementArmed: boolean;
  shouldShowMidiOpenAction: boolean;
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onDoubleClick?: (clipId: string) => void;
  onPitchChange?: (clipId: string, delta: number) => void;
  onFinePitchChange?: (clipId: string, delta: number) => void;
  onToggleWarpPlacementArmed: () => void;
}

const clipActionRegistry: readonly InteractionActionDefinition<ClipActionContext>[] = [
  {
    id: "delete",
    label: "x",
    title: "Delete clip (Del)",
    iconKey: "delete",
    tone: "danger",
    execute: ({ clipId, onDeleteClip }) => onDeleteClip?.(clipId),
  },
  {
    id: "duplicate",
    label: "D",
    title: ({ canUseModifierShortcuts }) =>
      canUseModifierShortcuts ? "Duplicate clip (Ctrl/Cmd+D)" : "Duplicate clip",
    iconKey: "duplicate",
    tone: "success",
    isVisible: ({ onDuplicateClip }) => Boolean(onDuplicateClip),
    execute: ({ clipId, onDuplicateClip }) => onDuplicateClip?.(clipId),
  },
  {
    id: "warp",
    label: "W",
    title: ({ canUseModifierShortcuts }) =>
      canUseModifierShortcuts
        ? "Add warp anchor: arm, then click clip body (desktop shortcut: Shift+click body)"
        : "Add warp anchor: arm, then click clip body",
    iconKey: "warp",
    tone: "warning",
    isVisible: ({ isAudio }) => isAudio,
    isActive: ({ warpPlacementArmed }) => warpPlacementArmed,
    execute: ({ onToggleWarpPlacementArmed }) => onToggleWarpPlacementArmed(),
  },
  {
    id: "open-midi",
    label: "O",
    title: "Open MIDI editor",
    iconKey: "open-midi",
    tone: "success",
    isVisible: ({ shouldShowMidiOpenAction }) => shouldShowMidiOpenAction,
    execute: ({ clipId, onDoubleClick }) => onDoubleClick?.(clipId),
  },
  {
    id: "midi-transpose-up",
    label: "+",
    title: "Transpose +1 (Shift+0)",
    iconKey: "transpose-up",
    tone: "success",
    isVisible: ({ isMidi, onPitchChange }) => isMidi && Boolean(onPitchChange),
    execute: ({ clipId, onPitchChange }) => onPitchChange?.(clipId, 1),
  },
  {
    id: "midi-transpose-down",
    label: "-",
    title: "Transpose -1 (Shift+9)",
    iconKey: "transpose-down",
    tone: "success",
    isVisible: ({ isMidi, onPitchChange }) => isMidi && Boolean(onPitchChange),
    execute: ({ clipId, onPitchChange }) => onPitchChange?.(clipId, -1),
  },
  {
    id: "audio-pitch-up",
    label: "+",
    title: "Pitch +1 (Shift+0)",
    iconKey: "pitch-up",
    tone: "accent",
    isVisible: ({ isAudio, hasPitchLink }) => isAudio && !hasPitchLink,
    execute: ({ clipId, onPitchChange }) => onPitchChange?.(clipId, 1),
  },
  {
    id: "audio-pitch-down",
    label: "-",
    title: "Pitch -1 (Shift+9)",
    iconKey: "pitch-down",
    tone: "accent",
    isVisible: ({ isAudio, hasPitchLink }) => isAudio && !hasPitchLink,
    execute: ({ clipId, onPitchChange }) => onPitchChange?.(clipId, -1),
  },
  {
    id: "audio-fine-up",
    label: "+f",
    title: "Fine +10c (Shift+8)",
    iconKey: "fine-up",
    tone: "accent",
    isVisible: ({ isAudio, hasPitchLink }) => isAudio && !hasPitchLink,
    execute: ({ clipId, onFinePitchChange }) => onFinePitchChange?.(clipId, 10),
  },
  {
    id: "audio-fine-down",
    label: "-f",
    title: "Fine -10c (Shift+7)",
    iconKey: "fine-down",
    tone: "accent",
    isVisible: ({ isAudio, hasPitchLink }) => isAudio && !hasPitchLink,
    execute: ({ clipId, onFinePitchChange }) => onFinePitchChange?.(clipId, -10),
  },
];

export function resolveClipActions(context: ClipActionContext): ResolvedInteractionAction[] {
  return resolveActionRegistry(clipActionRegistry, context);
}

export function countClipActions(context: ClipActionContext): number {
  return countVisibleActions(clipActionRegistry, context);
}
