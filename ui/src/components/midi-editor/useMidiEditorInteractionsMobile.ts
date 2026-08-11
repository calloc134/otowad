import {
  IDLE_TRANSIENT_SESSION,
  createImplicitToolModeState,
} from "@/app/interaction-contracts/tool-mode.ts";
import type {
  MidiEditorInteractionContract,
  UseMidiEditorInteractionAdapterArgs,
} from "./contracts";
import { useMidiEditorGridInteractions } from "./useMidiEditorGridInteractions";
import type { MidiEditorGridInteractionsResult } from "./useMidiEditorGridInteractions";

export function buildMidiEditorMobileContract(
  result: MidiEditorGridInteractionsResult,
): MidiEditorInteractionContract {
  const toolMode = createImplicitToolModeState(
    true,
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
    shellVariant: "mobile",
    toolMode,
    transientSession,
    mobileTransientActionBadge: {
      visible: transientSession.kind !== "idle",
      label:
        transientSession.kind === "note-create"
          ? "Creating note"
          : transientSession.kind === "note-move"
            ? "Moving notes"
            : transientSession.kind === "note-resize"
              ? "Resizing note"
              : "Selecting notes",
      tone: transientSession.kind === "note-create" ? "success" : "info",
    },
    supportsTouchNoteCreateFlow: true,
    mobileTouchNoteCreateFlow: {
      enabled: true,
      phase:
        transientSession.kind === "note-create"
          ? "drafting"
          : toolMode.current === "note-create"
            ? "armed"
            : "idle",
      trigger: "toolbar",
    },
  };
}

export function useMidiEditorInteractionsMobile(
  args: UseMidiEditorInteractionAdapterArgs,
): MidiEditorInteractionContract {
  return buildMidiEditorMobileContract(useMidiEditorGridInteractions(args));
}
