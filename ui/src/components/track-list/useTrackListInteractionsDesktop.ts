import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  TrackListInteractionContract,
  UseTrackListInteractionAdapterArgs,
} from "./contracts";
import {
  useTrackListInteractions,
  type TrackListInteractionsResult,
} from "./useTrackListInteractions";

export function buildTrackListDesktopContract(
  result: TrackListInteractionsResult,
): TrackListInteractionContract {
  const toolMode = createImplicitToolModeState(false, result.reorderState ? "reorder" : "implicit");
  const transientSession: TrackListInteractionContract["transientSession"] = result.reorderState
    ? { kind: "track-reorder", phase: "update" }
    : result.pendingTrackDeleteTrack
      ? { kind: "track-delete-confirm", phase: "update" }
      : IDLE_TRANSIENT_SESSION;

  return {
    ...result,
    shellVariant: "desktop",
    toolMode,
    transientSession,
    mobileActionSheet: {
      open: false,
      title: "Track actions",
      actions: [],
    },
    mobileTransientActionBadge: {
      visible: false,
      label: "",
      tone: "info",
    },
  };
}

export function useTrackListInteractionsDesktop(
  args: UseTrackListInteractionAdapterArgs,
): TrackListInteractionContract {
  return buildTrackListDesktopContract(useTrackListInteractions(args));
}
