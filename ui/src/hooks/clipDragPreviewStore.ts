import { useSyncExternalStore } from "react";

export interface DragPreviewSnapshot {
  mode: "move" | "copy" | null;
  activeClipIds: string[];
  previewStarts: Record<string, number>;
  previewTrackIds: Record<string, string>;
}

const EMPTY_DRAG_PREVIEW: DragPreviewSnapshot = {
  mode: null,
  activeClipIds: [],
  previewStarts: {},
  previewTrackIds: {},
};

let dragPreviewSnapshot: DragPreviewSnapshot = EMPTY_DRAG_PREVIEW;
const dragPreviewListeners = new Set<() => void>();

function emitDragPreview() {
  dragPreviewListeners.forEach((listener) => listener());
}

function subscribeDragPreview(listener: () => void) {
  dragPreviewListeners.add(listener);
  return () => {
    dragPreviewListeners.delete(listener);
  };
}

function getDragPreviewSnapshot() {
  return dragPreviewSnapshot;
}

export function useClipDragPreview() {
  return useSyncExternalStore(
    subscribeDragPreview,
    getDragPreviewSnapshot,
    getDragPreviewSnapshot,
  );
}

export function setDragPreview(
  mode: "move" | "copy",
  activeClipIds: string[],
  previewStarts: Record<string, number>,
  previewTrackIds: Record<string, string>,
) {
  dragPreviewSnapshot = {
    mode,
    activeClipIds: [...activeClipIds],
    previewStarts,
    previewTrackIds,
  };
  emitDragPreview();
}

export function clearDragPreview() {
  if (dragPreviewSnapshot.activeClipIds.length === 0) {
    return;
  }
  dragPreviewSnapshot = EMPTY_DRAG_PREVIEW;
  emitDragPreview();
}
