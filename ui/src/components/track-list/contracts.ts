import type { AppShellVariant } from "@/app/deviceInteraction.ts";
import type {
  MobileBottomSheetModel,
  MobileTransientActionBadge,
} from "@/app/interaction-contracts/mobile.ts";
import type {
  SurfaceToolModeState,
  TransientPointerSession,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  TrackListInteractionsResult,
  UseTrackListInteractionsArgs,
} from "./useTrackListInteractions";

export type TrackListInteractionToolMode = "implicit" | "select" | "reorder";

export type TrackListTransientSessionKind =
  | "idle"
  | "track-reorder"
  | "track-delete-confirm";

export interface TrackListInteractionContract extends TrackListInteractionsResult {
  shellVariant: AppShellVariant;
  toolMode: SurfaceToolModeState<TrackListInteractionToolMode>;
  transientSession: TransientPointerSession<TrackListTransientSessionKind>;
  mobileActionSheet: MobileBottomSheetModel;
  mobileTransientActionBadge: MobileTransientActionBadge;
}

export type UseTrackListInteractionAdapterArgs = UseTrackListInteractionsArgs;
