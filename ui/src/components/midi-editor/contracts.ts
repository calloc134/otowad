import type { AppShellVariant } from "@/app/deviceInteraction.ts";
import type {
  MobileTouchNoteCreateFlow,
  MobileTransientActionBadge,
} from "@/app/interaction-contracts/mobile.ts";
import type {
  SurfaceToolModeState,
  TransientPointerSession,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  MidiEditorGridInteractionsResult,
  UseMidiEditorGridInteractionsArgs,
} from "./useMidiEditorGridInteractions";

export type MidiEditorInteractionToolMode =
  | "implicit"
  | "select"
  | "note-create"
  | "note-edit"
  | "pan";

export type MidiEditorTransientSessionKind =
  | "idle"
  | "note-create"
  | "note-move"
  | "note-resize"
  | "note-marquee";

export interface MidiEditorInteractionContract
  extends MidiEditorGridInteractionsResult {
  shellVariant: AppShellVariant;
  toolMode: SurfaceToolModeState<MidiEditorInteractionToolMode>;
  transientSession: TransientPointerSession<MidiEditorTransientSessionKind>;
  mobileTransientActionBadge: MobileTransientActionBadge;
  supportsTouchNoteCreateFlow: boolean;
  mobileTouchNoteCreateFlow: MobileTouchNoteCreateFlow;
}

export type UseMidiEditorInteractionAdapterArgs = UseMidiEditorGridInteractionsArgs;
