import type { AppShellVariant } from "@/app/deviceInteraction.ts";
import type { MobileTransientActionBadge } from "@/app/interaction-contracts/mobile.ts";
import type {
  SurfaceToolModeState,
  TransientPointerSession,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  TimelineInteractionsResult,
  UseTimelineInteractionsArgs,
} from "./useTimelineInteractions";

export type TimelineInteractionToolMode = "implicit" | "select" | "pan";

export type TimelineTransientSessionKind =
  | "idle"
  | "timeline-marquee"
  | "timeline-scrub"
  | "timeline-touch-pan";

export interface TimelineInteractionContract extends TimelineInteractionsResult {
  shellVariant: AppShellVariant;
  toolMode: SurfaceToolModeState<TimelineInteractionToolMode>;
  transientSession: TransientPointerSession<TimelineTransientSessionKind>;
  mobileTransientActionBadge: MobileTransientActionBadge;
}

export type UseTimelineInteractionAdapterArgs = UseTimelineInteractionsArgs;
