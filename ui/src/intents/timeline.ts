import type { ClipId, Command, ProjectDocument } from "../types/index.ts";
import { toCommandBatch } from "../utils/clipPlacement.ts";
import { buildDeleteClipsCommand } from "./clipCommands.ts";

export interface CreateEmptyMidiClipIntent {
  command: Command;
  clipId: ClipId;
}

interface BuildCreateEmptyMidiClipArgs {
  document: ProjectDocument;
  trackId: string;
  startTick: number;
  clipLength: number;
  snapTick: (tick: number) => number;
  createId?: () => string;
}

function intervalsOverlap(
  startA: number,
  lengthA: number,
  startB: number,
  lengthB: number,
): boolean {
  return startA < startB + lengthB && startB < startA + lengthA;
}

export function buildCreateEmptyMidiClipIntent({
  document,
  trackId,
  startTick,
  clipLength,
  snapTick,
  createId = () => crypto.randomUUID(),
}: BuildCreateEmptyMidiClipArgs): CreateEmptyMidiClipIntent | null {
  const track = document.edit.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.kind.track_type !== "midi") {
    return null;
  }

  const snappedStart = Math.max(0, snapTick(startTick));
  const overlapsExistingClip = document.edit.clips.some((clip) =>
    clip.track_id === trackId &&
    intervalsOverlap(snappedStart, clipLength, clip.start, clip.length)
  );
  if (overlapsExistingClip) {
    return null;
  }

  const contentId = createId();
  const clipId = createId();
  const command = toCommandBatch([
    {
      command: "add_content" as const,
      content: {
        type: "midi" as const,
        id: contentId,
        notes: [],
        ccs: [],
      },
    },
    {
      command: "add_clip" as const,
      clip: {
        id: clipId,
        track_id: trackId,
        start: snappedStart,
        length: clipLength,
        lane: 0,
        muted: false,
        gain_milli_db: 0,
        kind: {
          clip_type: "midi" as const,
          content_id: contentId,
          midi: {
            content_in: 0,
            content_out: clipLength,
            transpose_semitones: 0,
          },
        },
      },
    },
  ]);

  if (!command) {
    return null;
  }

  return { command, clipId };
}

export function buildDeleteClipIntent(
  clipId: ClipId,
  selectedClipIds: ClipId[],
  isClickedClipSelected: boolean,
): Command | null {
  return buildDeleteClipsCommand(
    isClickedClipSelected ? selectedClipIds : [clipId],
  );
}
