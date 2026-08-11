import type { Command, ContentId, MidiNote } from "../types/index.ts";
import { toCommandBatch } from "./clipPlacement.ts";

const MIN_RENDERED_NOTE_WIDTH = 2;

function uniqueNotesById(notes: readonly MidiNote[]): MidiNote[] {
  return [...new Map(notes.map((note) => [note.id, note] as const)).values()];
}

export interface NoteBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface NoteHit {
  index: number;
  onResizeHandle: boolean;
}

export interface NoteSelectionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ClampedNoteMoveDelta {
  tickDelta: number;
  keyDelta: number;
}

export interface ResolveDraftNoteTicksInput {
  anchorTick: number;
  currentTick: number;
  minimumLength: number;
  snapStartTick: (tick: number) => number;
  snapEndTick: (tick: number) => number;
}

export function getRenderedNoteBounds(
  note: MidiNote,
  pxPerTick: number,
  rowHeight: number,
): NoteBounds {
  const left = note.start * pxPerTick;
  const width = Math.max(note.length * pxPerTick, MIN_RENDERED_NOTE_WIDTH);
  const top = (127 - note.key) * rowHeight;

  return {
    left,
    right: left + width,
    top,
    bottom: top + rowHeight,
  };
}

export function findNoteHit(
  notes: readonly MidiNote[],
  x: number,
  y: number,
  pxPerTick: number,
  rowHeight: number,
  resizeHandleWidth: number,
): NoteHit | null {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index];
    if (!note) {
      continue;
    }
    const bounds = getRenderedNoteBounds(note, pxPerTick, rowHeight);
    if (
      x >= bounds.left &&
      x <= bounds.right &&
      y >= bounds.top &&
      y < bounds.bottom
    ) {
      return {
        index,
        onResizeHandle: x >= bounds.right - resizeHandleWidth,
      };
    }
  }
  return null;
}

export function normalizeSelectionRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): NoteSelectionRect {
  return {
    left: Math.min(startX, endX),
    right: Math.max(startX, endX),
    top: Math.min(startY, endY),
    bottom: Math.max(startY, endY),
  };
}

export function findNotesInSelectionRect(
  notes: readonly MidiNote[],
  rect: NoteSelectionRect,
  pxPerTick: number,
  rowHeight: number,
): number[] {
  return notes.flatMap((note, index) => {
    const bounds = getRenderedNoteBounds(note, pxPerTick, rowHeight);
    const intersects =
      bounds.right > rect.left &&
      bounds.left < rect.right &&
      bounds.bottom > rect.top &&
      bounds.top < rect.bottom;
    return intersects ? [index] : [];
  });
}

export function clampNoteMoveDeltas(
  notes: readonly MidiNote[],
  tickDelta: number,
  keyDelta: number,
): ClampedNoteMoveDelta {
  if (notes.length === 0) {
    return { tickDelta: 0, keyDelta: 0 };
  }

  const normalizedTickDelta = Math.round(tickDelta);
  const normalizedKeyDelta = Math.round(keyDelta);
  const minStart = Math.min(...notes.map((note) => note.start));
  const minKey = Math.min(...notes.map((note) => note.key));
  const maxKey = Math.max(...notes.map((note) => note.key));

  return {
    tickDelta: Math.max(normalizedTickDelta, -minStart),
    keyDelta: Math.min(127 - maxKey, Math.max(-minKey, normalizedKeyDelta)),
  };
}

export function shiftNotesByDelta(
  notes: readonly MidiNote[],
  tickDelta: number,
  keyDelta: number,
): MidiNote[] {
  const clamped = clampNoteMoveDeltas(notes, tickDelta, keyDelta);
  return notes.map((note) => ({
    ...note,
    start: note.start + clamped.tickDelta,
    key: note.key + clamped.keyDelta,
  }));
}

export function findMatchingNoteIndices(
  notes: readonly MidiNote[],
  targets: readonly MidiNote[],
): number[] {
  const targetIds = new Set(targets.map((note) => note.id));
  return notes.flatMap((note, index) =>
    targetIds.has(note.id) ? [index] : []
  );
}

export function getDuplicateNoteDelta(
  notes: readonly MidiNote[],
  minimumDelta: number,
): number {
  const normalizedMinimum = Math.max(1, Math.round(minimumDelta));
  if (notes.length === 0) {
    return normalizedMinimum;
  }

  const minStart = Math.min(...notes.map((note) => note.start));
  const maxEnd = Math.max(...notes.map((note) => note.start + note.length));
  return Math.max(normalizedMinimum, maxEnd - minStart);
}

export function resolveDraftNoteTicks(
  input: ResolveDraftNoteTicksInput,
): { start: number; length: number } {
  const minimumLength = Math.max(1, Math.round(input.minimumLength));
  const rawStart = Math.max(0, Math.min(input.anchorTick, input.currentTick));
  const rawEnd = Math.max(input.anchorTick, input.currentTick);
  const start = Math.max(0, Math.round(input.snapStartTick(rawStart)));
  const end = Math.max(
    start + minimumLength,
    Math.round(input.snapEndTick(rawEnd)),
  );

  return {
    start,
    length: end - start,
  };
}

export function buildAddNotesCommand(
  contentId: ContentId,
  notes: readonly MidiNote[],
): Command | null {
  return toCommandBatch(
    notes.map((note) => ({
      command: "add_midi_note" as const,
      content_id: contentId,
      note,
    })),
  );
}

export function buildRemoveNotesCommand(
  contentId: ContentId,
  notes: readonly MidiNote[],
): Command | null {
  const commands = uniqueNotesById(notes).map((note) => ({
    command: "remove_midi_note" as const,
    content_id: contentId,
    note_id: note.id,
  }));

  return toCommandBatch(commands);
}

export function buildReplaceNotesCommand(
  contentId: ContentId,
  previousNotes: readonly MidiNote[],
  nextNotes: readonly MidiNote[],
): Command | null {
  const commands = [
    ...uniqueNotesById(previousNotes).map((note) => ({
      command: "remove_midi_note" as const,
      content_id: contentId,
      note_id: note.id,
    })),
    ...nextNotes.map((note) => ({
      command: "add_midi_note" as const,
      content_id: contentId,
      note,
    })),
  ];

  return toCommandBatch(commands);
}
