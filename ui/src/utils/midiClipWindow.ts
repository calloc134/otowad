import type { MidiNote } from "../types/index.ts";

export interface MidiContentWindow {
  contentIn: number;
  contentOut: number;
}

export function isContentTickInMidiWindow(
  tick: number,
  window: MidiContentWindow,
): boolean {
  return tick >= window.contentIn && tick < window.contentOut;
}

export function isMidiNoteInsideWindow(
  note: Pick<MidiNote, "start" | "length">,
  window: MidiContentWindow,
): boolean {
  return (
    note.length > 0 &&
    note.start >= window.contentIn &&
    note.start + note.length <= window.contentOut
  );
}

export function getMidiNoteIndicesInsideWindow(
  notes: readonly MidiNote[],
  window: MidiContentWindow,
): number[] {
  return notes.flatMap((note, index) =>
    isMidiNoteInsideWindow(note, window) ? [index] : [],
  );
}

export function clampMidiNoteMoveDeltaToWindow(
  notes: readonly Pick<MidiNote, "start" | "length">[],
  rawTickDelta: number,
  window: MidiContentWindow,
): number {
  if (notes.length === 0) {
    return 0;
  }
  const minimumStart = Math.min(...notes.map((note) => note.start));
  const maximumEnd = Math.max(...notes.map((note) => note.start + note.length));
  const minimumDelta = window.contentIn - minimumStart;
  const maximumDelta = window.contentOut - maximumEnd;
  return Math.min(maximumDelta, Math.max(minimumDelta, Math.round(rawTickDelta)));
}

export function clampMidiNoteLengthToWindow(
  noteStart: number,
  rawLength: number,
  minimumLength: number,
  window: MidiContentWindow,
): number {
  const availableLength = Math.max(1, window.contentOut - noteStart);
  return Math.min(
    availableLength,
    Math.max(Math.min(minimumLength, availableLength), Math.round(rawLength)),
  );
}

export function clampMidiDraftToWindow(
  note: MidiNote,
  minimumLength: number,
  window: MidiContentWindow,
): MidiNote {
  const maximumStart = Math.max(window.contentIn, window.contentOut - 1);
  const start = Math.min(maximumStart, Math.max(window.contentIn, note.start));
  return {
    ...note,
    start,
    length: clampMidiNoteLengthToWindow(start, note.length, minimumLength, window),
  };
}
