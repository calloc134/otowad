import type {
  ClipEdit,
  ClipId,
  Command,
  MidiContentEdit,
  ProjectDocument,
  WarpMapEdit,
} from "../types/index.ts";
import { normalizeClipTick } from "../adapters/projectDocument.ts";

export interface DuplicatePlan {
  commands: Command[];
  duplicatedClipIds: ClipId[];
  primaryDuplicateId: ClipId | null;
}

type DuplicatePlacementMode =
  | { type: "adjacent" }
  | { type: "offset"; deltaTicks: number };

function intervalsOverlap(
  startA: number,
  lengthA: number,
  startB: number,
  lengthB: number,
): boolean {
  return startA < startB + lengthB && startB < startA + lengthA;
}

function cloneWarpMap(warp: WarpMapEdit): WarpMapEdit {
  if (warp.warp_type === "none") {
    return warp;
  }
  return {
    warp_type: "anchors",
    anchors: warp.anchors.map((anchor) => ({ ...anchor })),
  };
}

function cloneClipForDuplicate(
  clip: ClipEdit,
  newClipId: ClipId,
  newStart: number,
  newContentId?: string,
): ClipEdit {
  if (clip.kind.clip_type === "audio") {
    return normalizeClipTick({
      ...clip,
      id: newClipId,
      start: newStart,
      kind: {
        clip_type: "audio",
        content_id: clip.kind.content_id,
        audio: {
          ...clip.kind.audio,
          warp: cloneWarpMap(clip.kind.audio.warp),
          pitch: { ...clip.kind.audio.pitch },
          fades: { ...clip.kind.audio.fades },
        },
      },
    });
  }

  return {
    ...clip,
    id: newClipId,
    start: newStart,
    kind: {
      clip_type: "midi",
      content_id: newContentId ?? clip.kind.content_id,
      midi: {
        ...clip.kind.midi,
      },
    },
  };
}

function resolveSelectedClips(
  document: ProjectDocument,
  clipIds: ClipId[],
): ClipEdit[] {
  const selectedIds = new Set(clipIds);
  return document.edit.clips.filter((clip) => selectedIds.has(clip.id));
}

function resolveAdjacentDelta(
  document: ProjectDocument,
  clips: ClipEdit[],
  initialDelta: number,
): number {
  const ignoredClipIds = new Set(clips.map((clip) => clip.id));
  let delta = initialDelta;

  while (true) {
    let nextDelta = delta;

    for (const clip of clips) {
      const candidateStart = clip.start + delta;

      for (const otherClip of document.edit.clips) {
        if (ignoredClipIds.has(otherClip.id)) continue;
        if (otherClip.track_id !== clip.track_id) continue;
        if (
          intervalsOverlap(
            candidateStart,
            clip.length,
            otherClip.start,
            otherClip.length,
          )
        ) {
          nextDelta = Math.max(
            nextDelta,
            otherClip.start + otherClip.length - clip.start,
          );
        }
      }
    }

    if (nextDelta === delta) {
      return delta;
    }
    delta = nextDelta;
  }
}

export function buildDuplicatePlan(
  document: ProjectDocument,
  clipIds: ClipId[],
  primaryClipId: ClipId | null,
  placement: DuplicatePlacementMode,
  createId: () => string = () => crypto.randomUUID(),
): DuplicatePlan | null {
  const clips = resolveSelectedClips(document, clipIds);
  if (clips.length === 0) {
    return null;
  }

  const primaryClip =
    clips.find((clip) => clip.id === primaryClipId) ?? clips[0] ?? null;
  if (!primaryClip) {
    return null;
  }

  const deltaTicks = placement.type === "adjacent"
    ? resolveAdjacentDelta(document, clips, primaryClip.length)
    : placement.deltaTicks;

  const commands: Command[] = [];
  const duplicatedClipIds: ClipId[] = [];
  let primaryDuplicateId: ClipId | null = null;

  for (const clip of clips) {
    const newClipId = createId();
    duplicatedClipIds.push(newClipId);
    if (clip.id === primaryClip.id) {
      primaryDuplicateId = newClipId;
    }

    if (clip.kind.clip_type === "audio") {
      commands.push({
        command: "add_clip",
        clip: cloneClipForDuplicate(
          clip,
          newClipId,
          clip.start + deltaTicks,
        ),
      });
      continue;
    }

    const sourceContent = document.edit.contents.find(
      (content) => content.id === clip.kind.content_id,
    );
    if (!sourceContent || sourceContent.type !== "midi") {
      return null;
    }

    const newContentId = createId();
    const duplicatedContent: MidiContentEdit = {
      type: "midi",
      id: newContentId,
      notes: sourceContent.notes.map((note) => ({ ...note })),
      ccs: sourceContent.ccs.map((cc) => ({ ...cc })),
    };

    commands.push({
      command: "add_content",
      content: duplicatedContent,
    });
    commands.push({
      command: "add_clip",
      clip: cloneClipForDuplicate(
        clip,
        newClipId,
        clip.start + deltaTicks,
        newContentId,
      ),
    });
  }

  return {
    commands,
    duplicatedClipIds,
    primaryDuplicateId,
  };
}

export function toCommandBatch(commands: Command[]): Command | null {
  if (commands.length === 0) {
    return null;
  }
  if (commands.length === 1) {
    return commands[0] ?? null;
  }
  return {
    command: "batch",
    commands,
  };
}
