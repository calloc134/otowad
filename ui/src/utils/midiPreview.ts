import type { MidiClipEdit, MidiNote } from "@/types";

export interface MidiPreviewSegment {
  startInClip: number;
  lengthInClip: number;
  key: number;
  vel: number;
}

export function buildMidiPreviewSegments(
  clipWindow: MidiClipEdit,
  notes: MidiNote[],
): MidiPreviewSegment[] {
  const segments: MidiPreviewSegment[] = [];
  const transpose = clipWindow.transpose_semitones;

  for (const note of notes) {
    const noteEnd = note.start + note.length;
    if (
      noteEnd <= clipWindow.content_in ||
      note.start >= clipWindow.content_out
    ) {
      continue;
    }

    const visibleStart = Math.max(note.start, clipWindow.content_in);
    const visibleEnd = Math.min(noteEnd, clipWindow.content_out);
    if (visibleEnd <= visibleStart) {
      continue;
    }

    segments.push({
      startInClip: visibleStart - clipWindow.content_in,
      lengthInClip: visibleEnd - visibleStart,
      key: Math.max(0, Math.min(127, note.key + transpose)),
      vel: note.vel,
    });
  }

  return segments;
}
