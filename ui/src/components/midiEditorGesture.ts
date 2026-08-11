import type { MidiEditorInteractionPolicy } from "../app/deviceInteraction.ts";
import {
  buildMidiDraftNote,
  buildMidiMarqueeSelection,
  resolveMidiMovePreview,
} from "../intents/midiEditor.ts";
import type { MidiNote, NoteId } from "../types/index.ts";

export function shouldStartMidiNoteCreation(args: {
  policy: MidiEditorInteractionPolicy;
  anchorClientX: number;
  currentClientX: number;
}): boolean {
  return Math.abs(args.currentClientX - args.anchorClientX) >= args.policy.noteCreateDragThresholdPx;
}

export function shouldStartMidiNoteMove(args: {
  policy: MidiEditorInteractionPolicy;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
}): boolean {
  const dx = Math.abs(args.currentClientX - args.startClientX);
  const dy = Math.abs(args.currentClientY - args.startClientY);
  return dx >= args.policy.noteMoveDragThresholdPx || dy >= args.policy.noteMoveDragThresholdPx;
}

export function resolveMidiCreationDraft(args: {
  id: NoteId;
  anchorTick: number;
  currentTick: number;
  key: number;
  minimumLength: number;
  snapStartTick: (tick: number) => number;
  snapEndTick: (tick: number) => number;
}): MidiNote {
  return buildMidiDraftNote(args);
}

export function resolveMidiMarqueePreview(args: {
  notes: readonly MidiNote[];
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  pxPerTick: number;
  rowHeight: number;
}) {
  return buildMidiMarqueeSelection(args);
}

export function resolveMidiMoveDragPreview(args: {
  notes: readonly MidiNote[];
  rawTickDelta: number;
  rawKeyDelta: number;
}) {
  return resolveMidiMovePreview(args);
}
