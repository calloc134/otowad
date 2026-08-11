import type { ResolvedInteractionAction } from "@/app/interaction-contracts/actions.ts";
import {
  resolveActionRegistry,
  type InteractionActionDefinition,
} from "@/app/interaction-contracts/actions.ts";
import type { TrackEdit } from "@/types";

export interface TrackActionContext {
  track: TrackEdit;
  isSelected: boolean;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onImport: () => void;
  onExport?: () => void;
  onDelete: () => void;
  usesTouchControls: boolean;
}

const trackActionRegistry: readonly InteractionActionDefinition<TrackActionContext>[] = [
  {
    id: "mute",
    label: "mute",
    title: "Mute",
    iconKey: "mute",
    tone: "danger",
    isActive: ({ track }) => track.mute,
    present: ({ track, usesTouchControls }) => ({
      style: {
        backgroundColor: track.mute ? "rgba(255, 117, 135, 0.22)" : "rgba(18, 26, 52, 0.96)",
        color: track.mute ? "var(--danger)" : "var(--text-dim)",
        borderColor: track.mute ? "rgba(255, 117, 135, 0.42)" : "var(--border-subtle)",
        ...(usesTouchControls ? { width: 30, height: 28 } : null),
      },
    }),
    execute: ({ onMuteToggle }) => onMuteToggle(),
  },
  {
    id: "solo",
    label: "solo",
    title: "Solo",
    iconKey: "solo",
    tone: "warning",
    isActive: ({ track }) => track.solo,
    present: ({ track, usesTouchControls }) => ({
      style: {
        backgroundColor: track.solo ? "rgba(246, 197, 108, 0.18)" : "rgba(18, 26, 52, 0.96)",
        color: track.solo ? "var(--accent-amber)" : "var(--text-dim)",
        borderColor: track.solo ? "rgba(246, 197, 108, 0.4)" : "var(--border-subtle)",
        ...(usesTouchControls ? { width: 30, height: 28 } : null),
      },
    }),
    execute: ({ onSoloToggle }) => onSoloToggle(),
  },
  {
    id: "import",
    label: "import",
    title: ({ track }) =>
      track.kind.track_type === "audio" ? "Import audio file" : "Import MIDI file",
    iconKey: "import",
    tone: "accent",
    present: ({ track, usesTouchControls }) => ({
      style: {
        backgroundColor:
          track.kind.track_type === "audio"
            ? "rgba(127, 229, 165, 0.14)"
            : "rgba(105, 184, 255, 0.12)",
        color:
          track.kind.track_type === "audio" ? "var(--accent-green)" : "var(--accent-blue)",
        borderColor:
          track.kind.track_type === "audio"
            ? "rgba(127, 229, 165, 0.3)"
            : "rgba(105, 184, 255, 0.28)",
        ...(usesTouchControls ? { width: 30, height: 28 } : null),
      },
    }),
    execute: ({ onImport }) => onImport(),
  },
  {
    id: "export",
    label: "export",
    title: ({ track }) =>
      track.kind.track_type === "audio"
        ? "Export selected audio track as WAV"
        : "Export selected MIDI track",
    iconKey: "export",
    tone: "accent",
    isVisible: ({ isSelected, onExport }) => isSelected && Boolean(onExport),
    present: ({ track, usesTouchControls }) => ({
      style: {
        backgroundColor:
          track.kind.track_type === "audio"
            ? "rgba(127, 229, 165, 0.14)"
            : "rgba(105, 184, 255, 0.14)",
        color:
          track.kind.track_type === "audio" ? "var(--accent-green)" : "var(--accent-blue)",
        borderColor:
          track.kind.track_type === "audio"
            ? "rgba(127, 229, 165, 0.3)"
            : "rgba(105, 184, 255, 0.32)",
        ...(usesTouchControls ? { width: 30, height: 28 } : null),
      },
    }),
    execute: ({ onExport }) => onExport?.(),
  },
  {
    id: "delete",
    label: "delete",
    title: "Delete track",
    iconKey: "delete",
    tone: "danger",
    present: ({ usesTouchControls }) => ({
      style: {
        ...(usesTouchControls ? { width: 30, height: 28 } : null),
      },
    }),
    execute: ({ onDelete }) => onDelete(),
  },
];

export function resolveTrackActions(context: TrackActionContext): ResolvedInteractionAction[] {
  return resolveActionRegistry(trackActionRegistry, context);
}
