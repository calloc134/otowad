import type { TrackKind } from "@/types";
import { resolveViewportContentPoint } from "./timelineInteractions.ts";

export type ImportableFileKind = "audio" | "midi";

export interface ImportableFileDescriptor {
  name: string;
  type?: string | null;
}

export interface TimelineFileDropTarget {
  trackIndex: number | null;
  tick: number;
  appendNewTrack: boolean;
}

export interface ResolveTimelineFileDropInput {
  clientX: number;
  clientY: number;
  viewportLeft: number;
  viewportTop: number;
  scrollLeft: number;
  scrollTop: number;
  pixelsPerTick: number;
  trackCount: number;
  trackHeight: number;
}

const AUDIO_FILE_EXTENSION_PATTERN = /\.(wav|wave|aif|aiff|flac|ogg|mp3|m4a|aac)$/i;

export function isFileDragType(
  types: Iterable<string> | ArrayLike<string>,
): boolean {
  return Array.from(types).includes("Files");
}

export function classifyImportableFile(
  file: ImportableFileDescriptor,
): ImportableFileKind | null {
  const name = file.name.toLowerCase();
  const mimeType = (file.type ?? "").toLowerCase();

  if (
    name.endsWith(".mid") ||
    name.endsWith(".midi") ||
    mimeType === "audio/midi" ||
    mimeType === "audio/x-midi" ||
    mimeType === "application/midi" ||
    mimeType === "application/x-midi"
  ) {
    return "midi";
  }

  if (mimeType.startsWith("audio/") || AUDIO_FILE_EXTENSION_PATTERN.test(name)) {
    return "audio";
  }

  return null;
}

export function resolveDroppedImport(
  files: readonly ImportableFileDescriptor[],
): { kind: ImportableFileKind } | { error: string } {
  if (files.length === 0) {
    return { error: "No file was dropped." };
  }
  if (files.length !== 1) {
    return { error: "Drop one file at a time." };
  }

  const file = files[0];
  if (!file) {
    return { error: "No file was dropped." };
  }

  const kind = classifyImportableFile(file);
  if (!kind) {
    return { error: `Unsupported file type: ${file.name}.` };
  }

  return { kind };
}

export function canImportFileToTrack(
  trackType: TrackKind["track_type"],
  fileKind: ImportableFileKind,
): boolean {
  return trackType === fileKind;
}

export function resolveTimelineFileDrop(
  input: ResolveTimelineFileDropInput,
): TimelineFileDropTarget | null {
  if (
    input.trackHeight <= 0 ||
    input.pixelsPerTick <= 0
  ) {
    return null;
  }

  const point = resolveViewportContentPoint({
    clientX: input.clientX,
    clientY: input.clientY,
    viewportLeft: input.viewportLeft,
    viewportTop: input.viewportTop,
    scrollLeft: input.scrollLeft,
    scrollTop: input.scrollTop,
  });
  const relativeY = point.y;
  if (!Number.isFinite(point.x) || !Number.isFinite(relativeY) || relativeY < 0) {
    return null;
  }

  const trackIndex = Math.floor(relativeY / input.trackHeight);
  if (trackIndex < 0) {
    return null;
  }

  if (input.trackCount === 0) {
    return {
      trackIndex: null,
      tick: Math.max(0, Math.round(point.x / input.pixelsPerTick)),
      appendNewTrack: true,
    };
  }

  if (trackIndex >= input.trackCount) {
    return {
      trackIndex: null,
        tick: Math.max(0, Math.round(point.x / input.pixelsPerTick)),
      appendNewTrack: true,
    };
  }

  return {
    trackIndex,
    tick: Math.max(0, Math.round(point.x / input.pixelsPerTick)),
    appendNewTrack: false,
  };
}
