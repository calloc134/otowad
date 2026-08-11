import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  ClipInteractionContract,
  UseClipInteractionAdapterArgs,
} from "./contracts";
import {
  useClipInteractions,
  type ClipInteractionsResult,
} from "./useClipInteractions";

export interface ClipContractBuilderState {
  isDragging: boolean;
  isResizing: boolean;
}

export function buildClipDesktopContract(
  result: ClipInteractionsResult,
  state: ClipContractBuilderState,
): ClipInteractionContract {
  const toolMode = createImplicitToolModeState(false, result.warpPlacementArmed ? "warp" : "implicit");
  const transientSession: ClipInteractionContract["transientSession"] = state.isResizing
    ? { kind: "clip-resize", phase: "update" }
    : state.isDragging
      ? { kind: "clip-drag", phase: "update" }
      : result.isSplitLongPressing
        ? { kind: "clip-long-press-split", phase: "update" }
        : result.warpPlacementArmed
          ? { kind: "clip-warp-arm", phase: "update" }
          : IDLE_TRANSIENT_SESSION;

  return {
    ...result,
    shellVariant: "desktop",
    toolMode,
    transientSession,
    mobileActionSheet: {
      open: false,
      title: "Clip actions",
      actions: [],
    },
    mobileTransientActionBadge: {
      visible: false,
      label: "",
      tone: "info",
    },
  };
}

export function useClipInteractionsDesktop(
  args: UseClipInteractionAdapterArgs,
): ClipInteractionContract {
  return buildClipDesktopContract(useClipInteractions(args), {
    isDragging: args.drag.isDragging,
    isResizing: args.resize.isResizing,
  });
}
