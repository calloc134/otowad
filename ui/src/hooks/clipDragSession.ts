import { findClosestSnapCandidate } from "../grid.ts";
import type { ClipId, ProjectDocument } from "../types/index.ts";

export const DRAG_START_THRESHOLD_PX = 4;

export interface TrackPreviewResult {
  previewTrackIds: Record<string, string>;
  primaryTargetTrackId: string | null;
}

export interface ClipDragContext {
  document: ProjectDocument | null;
  selectedClipIds: ClipId[];
  primaryClipId: ClipId | null;
  pixelsPerTick: number;
}

export interface DragSession {
  pointerId: number;
  startMouseX: number;
  startMouseY: number;
  sourceOrigStartTick: number;
  sourceTrackId: string;
  pixelsPerTick: number;
  trackHeight: number;
  draggedClipIds: string[];
  originalStarts: Record<string, number>;
  originalTrackIds: Record<string, string>;
  originalTrackIndices: Record<string, number>;
  lengths: Record<string, number>;
  clipKinds: Record<string, "audio" | "midi">;
  trackKinds: Record<string, "audio" | "midi">;
  trackIds: string[];
  hasMixedKinds: boolean;
  primaryClipId: string | null;
  minStartTick: number;
  isSnapEnabled: boolean;
  magnetRangeTicks: number;
  otherClipStarts: number[];
  otherClipEnds: number[];
}

interface BuildClipDragSessionArgs {
  clipId: ClipId;
  trackHeight: number;
  context: ClipDragContext;
  pointerId: number;
  clientX: number;
  clientY: number;
  isSnapEnabled: boolean;
  magnetRangeTicks: number;
}

export function buildClipDragSession({
  clipId,
  trackHeight,
  context,
  pointerId,
  clientX,
  clientY,
  isSnapEnabled,
  magnetRangeTicks,
}: BuildClipDragSessionArgs): DragSession | null {
  const document = context.document;
  const sourceClip = document?.edit.clips.find((clip) => clip.id === clipId);
  if (!document || !sourceClip) {
    return null;
  }

  const draggedClipIds = context.selectedClipIds.includes(clipId)
    ? context.selectedClipIds
    : [clipId];
  const draggedClips = document.edit.clips.filter((clip) => draggedClipIds.includes(clip.id));
  const otherClips = document.edit.clips.filter((clip) => !draggedClipIds.includes(clip.id));
  const trackIndexById = new Map(
    document.edit.tracks.map((track, index) => [track.id, index]),
  );
  const draggedClipKinds = new Set(draggedClips.map((clip) => clip.kind.clip_type));

  return {
    pointerId,
    startMouseX: clientX,
    startMouseY: clientY,
    sourceOrigStartTick: sourceClip.start,
    sourceTrackId: sourceClip.track_id,
    pixelsPerTick: context.pixelsPerTick,
    trackHeight,
    draggedClipIds,
    originalStarts: Object.fromEntries(draggedClips.map((clip) => [clip.id, clip.start])),
    originalTrackIds: Object.fromEntries(draggedClips.map((clip) => [clip.id, clip.track_id])),
    originalTrackIndices: Object.fromEntries(
      draggedClips.map((clip) => [clip.id, trackIndexById.get(clip.track_id) ?? -1]),
    ),
    lengths: Object.fromEntries(draggedClips.map((clip) => [clip.id, clip.length])),
    clipKinds: Object.fromEntries(
      draggedClips.map((clip) => [clip.id, clip.kind.clip_type]),
    ) as Record<string, "audio" | "midi">,
    trackKinds: Object.fromEntries(
      document.edit.tracks.map((track) => [track.id, track.kind.track_type]),
    ) as Record<string, "audio" | "midi">,
    trackIds: document.edit.tracks.map((track) => track.id),
    hasMixedKinds: draggedClipKinds.size > 1,
    primaryClipId:
      context.primaryClipId && draggedClipIds.includes(context.primaryClipId)
        ? context.primaryClipId
        : clipId,
    minStartTick:
      draggedClips.reduce(
        (minStart, clip) => Math.min(minStart, clip.start),
        Number.POSITIVE_INFINITY,
      ) || 0,
    isSnapEnabled,
    magnetRangeTicks,
    otherClipStarts: otherClips.map((clip) => clip.start),
    otherClipEnds: otherClips.map((clip) => clip.start + clip.length),
  };
}

export function hasDragCrossedThreshold(
  session: DragSession,
  clientX: number,
  clientY: number,
  thresholdPx = DRAG_START_THRESHOLD_PX,
): boolean {
  return !(
    Math.abs(clientX - session.startMouseX) < thresholdPx &&
    Math.abs(clientY - session.startMouseY) < thresholdPx
  );
}

export function resolveClipDragDelta(
  session: DragSession,
  clientX: number,
  snapTick: (tick: number) => number,
): number {
  const dx = clientX - session.startMouseX;
  const rawDelta = Math.max(dx / session.pixelsPerTick, -session.minStartTick);

  const baseStart = session.sourceOrigStartTick + rawDelta;
  let bestDelta = snapTick(Math.max(0, baseStart)) - session.sourceOrigStartTick;
  let bestAdjustment = Math.abs(bestDelta - rawDelta);

  if (session.isSnapEnabled && session.magnetRangeTicks > 0) {
    for (const draggedClipId of session.draggedClipIds) {
      const originalStart = session.originalStarts[draggedClipId] ?? 0;
      const clipLength = session.lengths[draggedClipId] ?? 0;
      const movedStart = originalStart + rawDelta;
      const movedEnd = movedStart + clipLength;

      const snappedStart = findClosestSnapCandidate(
        movedStart,
        session.magnetRangeTicks,
        session.otherClipEnds,
      );
      if (snappedStart !== null) {
        const candidateDelta = snappedStart - originalStart;
        const adjustment = Math.abs(candidateDelta - rawDelta);
        if (adjustment < bestAdjustment) {
          bestDelta = candidateDelta;
          bestAdjustment = adjustment;
        }
      }

      const snappedEnd = findClosestSnapCandidate(
        movedEnd,
        session.magnetRangeTicks,
        session.otherClipStarts,
      );
      if (snappedEnd !== null) {
        const candidateDelta = snappedEnd - (originalStart + clipLength);
        const adjustment = Math.abs(candidateDelta - rawDelta);
        if (adjustment < bestAdjustment) {
          bestDelta = candidateDelta;
          bestAdjustment = adjustment;
        }
      }
    }
  }

  return Math.max(bestDelta, -session.minStartTick);
}

export function resolveClipTrackPreview(
  session: DragSession,
  clientY: number,
  allowTrackMove: boolean,
): TrackPreviewResult {
  if (!allowTrackMove || session.trackHeight <= 0 || session.hasMixedKinds) {
    return { previewTrackIds: {}, primaryTargetTrackId: null };
  }

  const trackDelta = Math.round((clientY - session.startMouseY) / session.trackHeight);
  if (trackDelta === 0) {
    return { previewTrackIds: {}, primaryTargetTrackId: null };
  }

  const previewTrackIds: Record<string, string> = {};
  for (const draggedClipId of session.draggedClipIds) {
    const sourceTrackIndex = session.originalTrackIndices[draggedClipId];
    if (sourceTrackIndex === undefined || sourceTrackIndex < 0) {
      return { previewTrackIds: {}, primaryTargetTrackId: null };
    }

    const targetTrackIndex = sourceTrackIndex + trackDelta;
    if (targetTrackIndex < 0 || targetTrackIndex >= session.trackIds.length) {
      return { previewTrackIds: {}, primaryTargetTrackId: null };
    }

    const targetTrackId = session.trackIds[targetTrackIndex];
    if (!targetTrackId) {
      return { previewTrackIds: {}, primaryTargetTrackId: null };
    }

    const targetTrackKind = session.trackKinds[targetTrackId];
    if (targetTrackKind !== session.clipKinds[draggedClipId]) {
      return { previewTrackIds: {}, primaryTargetTrackId: null };
    }

    previewTrackIds[draggedClipId] = targetTrackId;
  }

  return {
    previewTrackIds,
    primaryTargetTrackId: session.primaryClipId
      ? previewTrackIds[session.primaryClipId] ?? null
      : null,
  };
}

export function buildClipPreviewStarts(session: DragSession, delta: number) {
  return Object.fromEntries(
    session.draggedClipIds.map((draggedClipId) => [
      draggedClipId,
      Math.round((session.originalStarts[draggedClipId] ?? 0) + delta),
    ]),
  );
}
