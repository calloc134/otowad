import {
  useCallback,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { ProjectDocument, ClipEdit, TrackEdit } from "@/types";
import type { ProjectActions } from "@/store";
import { useTrackHeight } from "@/hooks/useTrackHeight.ts";
import {
  canImportFileToTrack,
  isFileDragType,
  resolveDroppedImport,
  resolveTimelineFileDrop,
} from "@/utils/fileDrop.ts";
import {
  type TimelineFileDropPreview,
  type TimelineMarqueeSelection,
} from "./timelineInteractionsShared";
import { useTimelineViewportInteraction } from "./useTimelineViewportInteraction";
import { useTimelineScrubInteraction } from "./useTimelineScrubInteraction";
import { useTimelineSelectionInteraction } from "./useTimelineSelectionInteraction";

export interface UseTimelineInteractionsArgs {
  doc: ProjectDocument | null;
  tracks: TrackEdit[];
  clips: ClipEdit[];
  pixelsPerTick: number;
  selectionState: {
    scrollX: number;
    scrollY: number;
    zoom: { x: number; y: number };
    selectedClipIds: string[];
    selectedClipKind: "audio" | "midi" | null;
    primaryClipId: string | null;
  };
  interactionPolicy: TimelineInteractionPolicy;
  actions: ProjectActions;
  importFileToTrack: (
    file: File,
    trackId: string | null,
    startTick: number,
    options?: { createTrack?: boolean },
  ) => Promise<void> | void;
}

export interface TimelineInteractionsResult {
  rootRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  marquee: TimelineMarqueeSelection | null;
  fileDropPreview: TimelineFileDropPreview | null;
  getViewportContentPoint: (
    clientX: number,
    clientY: number,
    viewport: HTMLDivElement | null,
  ) => { x: number; y: number } | null;
  getTickFromViewportClientX: (clientX: number, viewport: HTMLDivElement | null) => number;
  setViewportScrollLeft: (nextScrollLeft: number) => void;
  handleRulerClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleTimelineClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleLanesScroll: () => void;
  handleRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleRulerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishRulerPointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finishTimelinePointerGesture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelineDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  handleTimelineDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  handleTimelineDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
}

export function useTimelineInteractions({
  doc,
  tracks,
  pixelsPerTick,
  selectionState,
  interactionPolicy,
  actions,
  importFileToTrack,
}: UseTimelineInteractionsArgs): TimelineInteractionsResult {
  const [fileDropPreview, setFileDropPreview] = useState<TimelineFileDropPreview | null>(null);
  // Drop targeting and marquee hit-testing have to use the height the lanes
  // are actually drawn at, not a constant, now that the row height is zoomable
  // and depends on the control size.
  const trackHeight = useTrackHeight();

  const {
    rootRef,
    scrollRef,
    rulerRef,
    timelineRef,
    getViewportContentPoint,
    getTickFromViewportClientX,
    setViewportScrollLeft,
    setViewportScrollTop,
    handleLanesScroll,
  } = useTimelineViewportInteraction({
    pixelsPerTick,
    selectionState: {
      scrollX: selectionState.scrollX,
      scrollY: selectionState.scrollY,
      zoom: selectionState.zoom,
    },
    interactionPolicy,
    actions,
  });

  const seekToClientX = useCallback(
    (clientX: number, viewport: HTMLDivElement | null) => {
      actions.setPlayhead(getTickFromViewportClientX(clientX, viewport));
    },
    [actions, getTickFromViewportClientX],
  );

  const {
    handleRulerClick,
    handleRulerPointerDown,
    handleRulerPointerMove,
    finishRulerPointerGesture,
  } = useTimelineScrubInteraction({
    interactionPolicy,
    actions,
    rulerRef,
    getTickFromViewportClientX,
    seekToClientX,
  });

  const {
    marquee,
    handleTimelineClick,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    finishTimelinePointerGesture,
  } = useTimelineSelectionInteraction({
    doc,
    pixelsPerTick,
    trackHeight,
    zoomY: selectionState.zoom.y,
    selectionState: {
      selectedClipIds: selectionState.selectedClipIds,
      selectedClipKind: selectionState.selectedClipKind,
      primaryClipId: selectionState.primaryClipId,
    },
    interactionPolicy,
    actions,
    scrollRef,
    getViewportContentPoint,
    setViewportScrollLeft,
    setViewportScrollTop,
    seekToClientX,
  });

  const handleTimelineDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const isFileDrag = isFileDragType(event.dataTransfer.types);
      if (!isFileDrag) {
        return;
      }

      event.preventDefault();

      const viewport = scrollRef.current;
      if (!viewport) {
        setFileDropPreview(null);
        event.dataTransfer.dropEffect = "none";
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const dropTarget = resolveTimelineFileDrop({
        clientX: event.clientX,
        clientY: event.clientY,
        viewportLeft: rect.left,
        viewportTop: rect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        pixelsPerTick,
        trackCount: tracks.length,
        trackHeight,
      });
      if (!dropTarget) {
        setFileDropPreview(null);
        event.dataTransfer.dropEffect = "none";
        return;
      }

      event.dataTransfer.dropEffect = "copy";
      setFileDropPreview({
        trackIndex: dropTarget.trackIndex,
        tick: dropTarget.tick,
        kind: null,
        appendNewTrack: dropTarget.appendNewTrack,
      });
    },
    [pixelsPerTick, tracks.length],
  );

  const handleTimelineDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }
      setFileDropPreview(null);
    },
    [],
  );

  const handleTimelineDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const isFileDrag = isFileDragType(event.dataTransfer.types);
      if (!isFileDrag) {
        return;
      }

      event.preventDefault();
      setFileDropPreview(null);

      const files = Array.from(event.dataTransfer.files);
      const droppedImport = resolveDroppedImport(files);
      if ("error" in droppedImport) {
        actions.setError(droppedImport.error);
        return;
      }

      const file = files[0];
      if (!file) {
        actions.setError("No file was dropped.");
        return;
      }

      const viewport = scrollRef.current;
      if (!viewport) {
        actions.setError("Drop the file onto a track lane.");
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const dropTarget = resolveTimelineFileDrop({
        clientX: event.clientX,
        clientY: event.clientY,
        viewportLeft: rect.left,
        viewportTop: rect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        pixelsPerTick,
        trackCount: tracks.length,
        trackHeight,
      });
      if (!dropTarget) {
        actions.setError("Drop the file onto a track lane.");
        return;
      }

      if (dropTarget.appendNewTrack) {
        void importFileToTrack(file, null, dropTarget.tick, { createTrack: true });
        return;
      }

      const trackIndex = dropTarget.trackIndex;
      if (trackIndex === null) {
        actions.setError("Drop target track not found.");
        return;
      }

      const track = tracks[trackIndex];
      if (!track) {
        actions.setError("Drop target track not found.");
        return;
      }
      if (!canImportFileToTrack(track.kind.track_type, droppedImport.kind)) {
        actions.setError(
          droppedImport.kind === "audio"
            ? "Audio files can only be dropped onto audio tracks."
            : "MIDI files can only be dropped onto MIDI tracks.",
        );
        return;
      }

      actions.selectTrack(track.id);
      void importFileToTrack(file, track.id, dropTarget.tick);
    },
    [actions, importFileToTrack, pixelsPerTick, tracks],
  );

  return {
    rootRef,
    scrollRef,
    rulerRef,
    timelineRef,
    marquee,
    fileDropPreview,
    getViewportContentPoint,
    getTickFromViewportClientX,
    setViewportScrollLeft,
    handleRulerClick,
    handleTimelineClick,
    handleLanesScroll,
    handleRulerPointerDown,
    handleRulerPointerMove,
    finishRulerPointerGesture,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    finishTimelinePointerGesture,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
  };
}
