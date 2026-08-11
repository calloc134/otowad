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
  ClipInteractionsResult,
  UseClipInteractionsArgs,
} from "./useClipInteractions";

export type ClipInteractionToolMode = "implicit" | "select" | "trim" | "stretch" | "warp";

export type ClipTransientSessionKind =
  | "idle"
  | "clip-drag"
  | "clip-resize"
  | "clip-long-press-split"
  | "clip-warp-arm";

export interface ClipInteractionContract extends ClipInteractionsResult {
  shellVariant: AppShellVariant;
  toolMode: SurfaceToolModeState<ClipInteractionToolMode>;
  transientSession: TransientPointerSession<ClipTransientSessionKind>;
  mobileActionSheet: MobileBottomSheetModel;
  mobileTransientActionBadge: MobileTransientActionBadge;
}

export type UseClipInteractionAdapterArgs = UseClipInteractionsArgs;
