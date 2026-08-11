import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  TrackListInteractionContract,
  UseTrackListInteractionAdapterArgs,
} from "./contracts";
import { useTrackListInteractions } from "./useTrackListInteractions";
import type { TrackListInteractionsResult } from "./useTrackListInteractions";

export function buildTrackListMobileContract(
  result: TrackListInteractionsResult,
): TrackListInteractionContract {
  const toolMode = createImplicitToolModeState(true, result.reorderState ? "reorder" : "implicit");
  const transientSession: TrackListInteractionContract["transientSession"] = result.reorderState
    ? { kind: "track-reorder", phase: "update" }
    : result.pendingTrackDeleteTrack
      ? { kind: "track-delete-confirm", phase: "update" }
      : IDLE_TRANSIENT_SESSION;

  return {
    ...result,
    shellVariant: "mobile",
    toolMode,
    transientSession,
    mobileActionSheet: {
      open: result.actionSheetTrack !== null,
      title: result.actionSheetTrack?.name ?? "Track actions",
      actions: [],
      onRequestClose: result.closeTrackActionSheet,
    },
    mobileTransientActionBadge: {
      visible: transientSession.kind !== "idle",
      label:
        transientSession.kind === "track-reorder"
          ? "Reordering track"
          : "Confirm track delete",
      tone: transientSession.kind === "track-delete-confirm" ? "warning" : "info",
    },
  };
}

export function useTrackListInteractionsMobile(
  args: UseTrackListInteractionAdapterArgs,
): TrackListInteractionContract {
  return buildTrackListMobileContract(useTrackListInteractions(args));
}
