import {
  clampNoteMoveDeltas,
  type NoteSelectionRect,
  findNotesInSelectionRect,
  normalizeSelectionRect,
  resolveDraftNoteTicks,
} from "../utils/midiEditorEditing.ts";
import type { MidiNote, NoteId } from "../types/index.ts";

export interface MidiEditorDraftNoteArgs {
  id: NoteId;
  anchorTick: number;
  currentTick: number;
  key: number;
  minimumLength: number;
  snapStartTick: (tick: number) => number;
  snapEndTick: (tick: number) => number;
}

export function buildMidiDraftNote(args: MidiEditorDraftNoteArgs): MidiNote {
  const { start, length } = resolveDraftNoteTicks({
    anchorTick: args.anchorTick,
    currentTick: args.currentTick,
    minimumLength: args.minimumLength,
    snapStartTick: args.snapStartTick,
    snapEndTick: args.snapEndTick,
  });
  return {
    id: args.id,
    start,
    length,
    key: args.key,
    vel: 100,
  };
}

export function buildMidiMarqueeSelection(args: {
  notes: readonly MidiNote[];
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  pxPerTick: number;
  rowHeight: number;
}): { rect: NoteSelectionRect; selectedIndices: number[] } {
  const rect = normalizeSelectionRect(
    args.anchorX,
    args.anchorY,
    args.currentX,
    args.currentY,
  );
  return {
    rect,
    selectedIndices: findNotesInSelectionRect(
      args.notes,
      rect,
      args.pxPerTick,
      args.rowHeight,
    ),
  };
}

export function resolveMidiMovePreview(args: {
  notes: readonly MidiNote[];
  rawTickDelta: number;
  rawKeyDelta: number;
}): { tickDelta: number; keyDelta: number } {
  return clampNoteMoveDeltas(args.notes, args.rawTickDelta, args.rawKeyDelta);
}
