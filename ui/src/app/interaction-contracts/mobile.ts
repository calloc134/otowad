import type { ResolvedInteractionAction } from "./actions.ts";



export interface MobileTransientActionBadge {
  visible: boolean;
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}


export interface MobileTouchNoteCreateFlow {
  enabled: boolean;
  phase: "idle" | "armed" | "drafting";
  trigger: "toolbar" | "touch-drag";
}


export interface MobileBottomSheetModel {
  open: boolean;
  title: string;
  actions: ResolvedInteractionAction[];
  onRequestClose?: () => void;
}
