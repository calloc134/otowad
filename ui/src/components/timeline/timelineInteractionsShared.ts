import type { ImportableFileKind } from "@/utils/fileDrop.ts";
import type { ProjectDocument } from "@/types";

export interface TimelineMarqueeSelection {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  union: boolean;
  baseSelection: string[];
  basePrimaryClipId: string | null;
}

export interface TimelineFileDropPreview {
  trackIndex: number | null;
  tick: number;
  kind: ImportableFileKind | null;
  appendNewTrack: boolean;
}

function rectsIntersect(
  left: number,
  top: number,
  width: number,
  height: number,
  selection: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    left < selection.right &&
    selection.left < left + width &&
    top < selection.bottom &&
    selection.top < top + height
  );
}

export function hasTimelineMarqueeMoved(
  marquee: TimelineMarqueeSelection,
  thresholdPx = 4,
): boolean {
  return (
    Math.abs(marquee.currentX - marquee.startX) >= thresholdPx ||
    Math.abs(marquee.currentY - marquee.startY) >= thresholdPx
  );
}

interface ResolveTimelineMarqueeSelectionArgs {
  document: ProjectDocument | null;
  marquee: TimelineMarqueeSelection;
  pixelsPerTick: number;
  selectedClipKind: "audio" | "midi" | null;
  trackHeight: number;
}

export function resolveTimelineMarqueeSelection({
  document,
  marquee,
  pixelsPerTick,
  selectedClipKind,
  trackHeight,
}: ResolveTimelineMarqueeSelectionArgs): string[] {
  if (!document) {
    return [];
  }

  const selectionRect = {
    left: Math.min(marquee.startX, marquee.currentX),
    top: Math.min(marquee.startY, marquee.currentY),
    right: Math.max(marquee.startX, marquee.currentX),
    bottom: Math.max(marquee.startY, marquee.currentY),
  };
  const trackIndexById = new Map(
    document.edit.tracks.map((track, index) => [track.id, index]),
  );
  const hitClipIds = document.edit.clips
    .filter((clip) => {
      const trackIndex = trackIndexById.get(clip.track_id);
      if (trackIndex === undefined) {
        return false;
      }
      return rectsIntersect(
        clip.start * pixelsPerTick,
        trackIndex * trackHeight,
        clip.length * pixelsPerTick,
        trackHeight,
        selectionRect,
      );
    })
    .map((clip) => clip.id);

  if (!marquee.union) {
    return hitClipIds;
  }

  const allowedHitClipIds = selectedClipKind
    ? hitClipIds.filter((clipId) => {
        const hitClip = document.edit.clips.find((clip) => clip.id === clipId);
        return hitClip?.kind.clip_type === selectedClipKind;
      })
    : hitClipIds;
  return Array.from(new Set([...marquee.baseSelection, ...allowedHitClipIds]));
}
