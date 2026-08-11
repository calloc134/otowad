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

export function buildTimelineMobileContract(
  result: TimelineInteractionsResult,
): TimelineInteractionContract {
  const toolMode = createImplicitToolModeState(true);
  const transientSession: TimelineInteractionContract["transientSession"] = result.marquee
    ? { kind: "timeline-marquee", phase: "update" }
    : IDLE_TRANSIENT_SESSION;

  return {
    ...result,
    shellVariant: "mobile",
    toolMode,
    transientSession,
    mobileTransientActionBadge: {
      visible: transientSession.kind !== "idle",
      label:
        transientSession.kind === "timeline-marquee"
          ? "Selecting range"
          : transientSession.kind === "timeline-touch-pan"
            ? "Panning timeline"
            : "Timeline active",
      tone: transientSession.kind === "timeline-marquee" ? "warning" : "info",
    },
  };
}

export function useTimelineInteractionsMobile(
  args: UseTimelineInteractionAdapterArgs,
): TimelineInteractionContract {
  return buildTimelineMobileContract(useTimelineInteractions(args));
}
