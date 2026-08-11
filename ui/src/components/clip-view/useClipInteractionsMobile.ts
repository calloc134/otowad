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
import type { ClipContractBuilderState } from "./useClipInteractionsDesktop";

export function buildClipMobileContract(
  result: ClipInteractionsResult,
  state: ClipContractBuilderState,
): ClipInteractionContract {
  const toolMode = createImplicitToolModeState(true, result.warpPlacementArmed ? "warp" : "implicit");
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
    shellVariant: "mobile",
    toolMode,
    transientSession,
    mobileActionSheet: {
      open: false,
      title: "Clip actions",
      actions: [],
    },
    mobileTransientActionBadge: {
      visible: transientSession.kind !== "idle",
      label:
        transientSession.kind === "clip-long-press-split"
          ? "Split armed"
          : transientSession.kind === "clip-warp-arm"
            ? "Warp action armed"
            : transientSession.kind === "clip-resize"
              ? "Resizing clip"
              : "Moving clip",
      tone:
        transientSession.kind === "clip-warp-arm" || transientSession.kind === "clip-long-press-split"
          ? "warning"
          : "info",
    },
  };
}

export function useClipInteractionsMobile(
  args: UseClipInteractionAdapterArgs,
): ClipInteractionContract {
  return buildClipMobileContract(useClipInteractions(args), {
    isDragging: args.drag.isDragging,
    isResizing: args.resize.isResizing,
  });
}
