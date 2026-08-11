import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  MidiEditorInteractionContract,
  UseMidiEditorInteractionAdapterArgs,
} from "./contracts";
import {
  useMidiEditorGridInteractions,
  type MidiEditorGridInteractionsResult,
} from "./useMidiEditorGridInteractions";

export function buildMidiEditorDesktopContract(
  result: MidiEditorGridInteractionsResult,
): MidiEditorInteractionContract {
  const toolMode = createImplicitToolModeState(
    false,
    result.dragState || result.marqueeRect
      ? "note-edit"
      : result.draftNote
        ? "note-create"
        : "implicit",
  );
  const transientSession: MidiEditorInteractionContract["transientSession"] = result.dragState?.type === "move"
    ? { kind: "note-move", phase: "update" }
    : result.dragState?.type === "resize"
      ? { kind: "note-resize", phase: "update" }
      : result.marqueeRect
        ? { kind: "note-marquee", phase: "update" }
        : result.draftNote
          ? { kind: "note-create", phase: "update" }
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
    supportsTouchNoteCreateFlow: false,
    mobileTouchNoteCreateFlow: {
      enabled: false,
      phase: "idle",
      trigger: "toolbar",
    },
  };
}

export function useMidiEditorInteractionsDesktop(
  args: UseMidiEditorInteractionAdapterArgs,
): MidiEditorInteractionContract {
  return buildMidiEditorDesktopContract(useMidiEditorGridInteractions(args));
}
