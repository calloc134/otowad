import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  TimelineInteractionContract,
  UseTimelineInteractionAdapterArgs,
} from "./contracts";
import {
  useTimelineInteractions,
  type TimelineInteractionsResult,
} from "./useTimelineInteractions";

export function buildTimelineDesktopContract(
  result: TimelineInteractionsResult,
): TimelineInteractionContract {
  const toolMode = createImplicitToolModeState(false);
  const transientSession: TimelineInteractionContract["transientSession"] = result.marquee
    ? { kind: "timeline-marquee", phase: "update" }
    : IDLE_TRANSIENT_SESSION;

  return {
    ...result,
    shellVariant: "desktop",
    toolMode,
    transientSession,
    mobileTransientActionBadge: {
      visible: false,
      label: "",
      tone: "info",
    },
  };
}

export function useTimelineInteractionsDesktop(
  args: UseTimelineInteractionAdapterArgs,
): TimelineInteractionContract {
  return buildTimelineDesktopContract(useTimelineInteractions(args));
}
