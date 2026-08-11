import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useProjectActions } from "@/store";
import type { ProjectDocument, TrackEdit } from "@/types";
import type { TrackListInteractionPolicy } from "@/app/deviceInteraction.ts";
import { buildMoveTrackCommand, buildRemoveTrackCommand } from "@/intents/trackList.ts";
import { resolveTimelineWheelIntent } from "@/utils/timelineWheel.ts";
import { useTrackHeight } from "@/hooks/useTrackHeight.ts";
const TRACK_REORDER_DRAG_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.005;
const MAX_ZOOM = 0.5;

export interface TrackReorderState {
  trackId: string;
  dropSlot: number;
}

export interface UseTrackListInteractionsArgs {
  doc: ProjectDocument | null;
  tracks: TrackEdit[];
  interactionPolicy: TrackListInteractionPolicy;
  scrollX: number;
  scrollY: number;
  zoomX: number;
  zoomY: number;
  trackClipCountById: Map<string, number>;
  onRequestCreateDialog: () => void;
}

export interface TrackListInteractionsResult {
  listRef: React.RefObject<HTMLDivElement | null>;
  wheelSurfaceRef: React.RefObject<HTMLDivElement | null>;
  reorderState: TrackReorderState | null;
  activeReorderTrackId: string | null;
  pendingTrackDeleteId: string | null;
  pendingTrackDeleteTrack: TrackEdit | null;
  pendingTrackDeleteClipCount: number;
  /** The track whose overflow actions are open, on shells that have a sheet. */
  actionSheetTrack: TrackEdit | null;
  openTrackActionSheet: (trackId: string) => void;
  closeTrackActionSheet: () => void;
  handleListScroll: () => void;
  handleListDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleTrackReorderStart: (
    trackId: string,
    sourceIndex: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  moveTrackToIndex: (trackId: string, nextIndex: number) => void;
  requestTrackDelete: (track: TrackEdit) => void;
  confirmTrackDelete: () => void;
  closePendingTrackDelete: () => void;
  dropIndicatorTop: number;
}

export function useTrackListInteractions({
  doc,
  tracks,
  interactionPolicy,
  scrollX,
  scrollY,
  zoomX,
  zoomY,
  trackClipCountById,
  onRequestCreateDialog,
}: UseTrackListInteractionsArgs): TrackListInteractionsResult {
  const actions = useProjectActions();
  // Reorder slots have to land on the height the rows are drawn at, which
  // depends on the control size as well as the zoom.
  const trackHeight = useTrackHeight();
  const listRef = useRef<HTMLDivElement>(null);
  const wheelSurfaceRef = useRef<HTMLDivElement>(null);
  const [reorderState, setReorderState] = useState<TrackReorderState | null>(null);
  const [pendingTrackDeleteId, setPendingTrackDeleteId] = useState<string | null>(null);
  const [actionSheetTrackId, setActionSheetTrackId] = useState<string | null>(null);
  const timelineWheelMode = interactionPolicy.controlSize === "touch" ? "scroll" : "mixed";
  const pendingTrackDeleteTrack = pendingTrackDeleteId
    ? tracks.find((track) => track.id === pendingTrackDeleteId) ?? null
    : null;
  const pendingTrackDeleteClipCount = pendingTrackDeleteId
    ? trackClipCountById.get(pendingTrackDeleteId) ?? 0
    : 0;

  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    actions.setScroll(scrollX, list.scrollTop);
  }, [actions, scrollX]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    if (Math.abs(list.scrollTop - scrollY) >= 0.5) {
      list.scrollTop = scrollY;
    }
  }, [scrollY]);

  useEffect(() => {
    if (!pendingTrackDeleteId) {
      return;
    }
    if (!pendingTrackDeleteTrack || pendingTrackDeleteClipCount === 0) {
      setPendingTrackDeleteId(null);
    }
  }, [pendingTrackDeleteClipCount, pendingTrackDeleteId, pendingTrackDeleteTrack]);

  const handleWheelIntent = useCallback(
    (event: WheelEvent) => {
      const list = listRef.current;
      if (!list) {
        return;
      }

      const intent = resolveTimelineWheelIntent({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        wheelMode: timelineWheelMode,
      });

      if (intent.type === "native-scroll") {
        list.scrollTop += event.deltaY;
        actions.setScroll(scrollX, list.scrollTop);
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (intent.type === "zoom") {
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, zoomX * intent.factor),
        );
        actions.setZoom(nextZoom, zoomY);
        return;
      }

      if (intent.type === "scroll-horizontal") {
        actions.setScroll(Math.max(0, scrollX + intent.delta), list.scrollTop);
        return;
      }

      list.scrollTop += intent.delta;
      actions.setScroll(scrollX, list.scrollTop);
    },
    [actions, scrollX, timelineWheelMode, zoomX, zoomY],
  );

  useEffect(() => {
    const surface = wheelSurfaceRef.current;
    if (!surface) {
      return;
    }

    surface.addEventListener("wheel", handleWheelIntent, { passive: false });
    return () => {
      surface.removeEventListener("wheel", handleWheelIntent);
    };
  }, [handleWheelIntent]);

  const requestTrackDelete = useCallback(
    (track: TrackEdit) => {
      const clipCount = trackClipCountById.get(track.id) ?? 0;
      actions.selectTrack(track.id);
      if (clipCount > 0) {
        setPendingTrackDeleteId(track.id);
        return;
      }
      actions.applyCommand(buildRemoveTrackCommand(track.id));
    },
    [actions, trackClipCountById],
  );

  const confirmTrackDelete = useCallback(() => {
    if (!pendingTrackDeleteId) {
      return;
    }
    actions.applyCommand(buildRemoveTrackCommand(pendingTrackDeleteId));
    setPendingTrackDeleteId(null);
  }, [actions, pendingTrackDeleteId]);

  const closePendingTrackDelete = useCallback(() => {
    setPendingTrackDeleteId(null);
  }, []);

  const actionSheetTrack = actionSheetTrackId
    ? tracks.find((track) => track.id === actionSheetTrackId) ?? null
    : null;

  const openTrackActionSheet = useCallback(
    (trackId: string) => {
      actions.selectTrack(trackId);
      setActionSheetTrackId(trackId);
    },
    [actions],
  );

  const closeTrackActionSheet = useCallback(() => {
    setActionSheetTrackId(null);
  }, []);

  useEffect(() => {
    // A track can disappear while its sheet is open — deleted from the sheet
    // itself, or by an undo.
    if (actionSheetTrackId && !actionSheetTrack) {
      setActionSheetTrackId(null);
    }
  }, [actionSheetTrack, actionSheetTrackId]);

  const resolveDropSlot = useCallback(
    (clientY: number) => {
      const list = listRef.current;
      if (!list || tracks.length === 0) {
        return 0;
      }

      const rect = list.getBoundingClientRect();
      const relativeY = clientY - rect.top + list.scrollTop;
      const clampedY = Math.max(0, Math.min(relativeY, tracks.length * trackHeight));

      return Math.max(
        0,
        Math.min(
          tracks.length,
          Math.floor((clampedY + trackHeight / 2) / trackHeight),
        ),
      );
    },
    [trackHeight, tracks.length],
  );

  const handleListDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-track-header-root='true']")
      ) {
        return;
      }
      onRequestCreateDialog();
    },
    [onRequestCreateDialog],
  );

  const handleTrackReorderStart = useCallback(
    (
      trackId: string,
      sourceIndex: number,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (!doc) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      actions.selectTrack(trackId);

      const startY = event.clientY;
      let started = false;
      let dropSlot = sourceIndex;
      const eventTarget = event.currentTarget;
      eventTarget.setPointerCapture?.(event.pointerId);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        if (!started && Math.abs(moveEvent.clientY - startY) < TRACK_REORDER_DRAG_THRESHOLD_PX) {
          return;
        }

        started = true;
        dropSlot = resolveDropSlot(moveEvent.clientY);
        setReorderState({ trackId, dropSlot });
      };

      const cleanupPointerListeners = () => {
        eventTarget.removeEventListener("pointermove", handlePointerMove);
        eventTarget.removeEventListener("pointerup", handlePointerUp);
        eventTarget.removeEventListener("pointercancel", handlePointerCancel);
        eventTarget.releasePointerCapture?.(event.pointerId);
      };

      const handlePointerUp = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        cleanupPointerListeners();
        setReorderState(null);

        if (!started || tracks.length <= 1) {
          return;
        }

        let targetIndex = dropSlot;
        if (sourceIndex < dropSlot) {
          targetIndex -= 1;
        }
        targetIndex = Math.max(0, Math.min(tracks.length - 1, targetIndex));

        if (targetIndex === sourceIndex) {
          return;
        }

        const command = buildMoveTrackCommand(tracks, trackId, targetIndex);
        if (command) {
          actions.applyCommand(command);
        }
      };

      const handlePointerCancel = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        cleanupPointerListeners();
        setReorderState(null);
      };

      eventTarget.addEventListener("pointermove", handlePointerMove);
      eventTarget.addEventListener("pointerup", handlePointerUp);
      eventTarget.addEventListener("pointercancel", handlePointerCancel);
    },
    [actions, doc, resolveDropSlot, tracks],
  );

  const moveTrackToIndex = useCallback(
    (trackId: string, nextIndex: number) => {
      if (!doc) {
        return;
      }
      const command = buildMoveTrackCommand(tracks, trackId, nextIndex);
      if (!command) {
        return;
      }
      actions.selectTrack(trackId);
      actions.applyCommand(command);
    },
    [actions, doc, tracks],
  );

  const dropIndicatorTop = reorderState && tracks.length > 0
    ? Math.max(
        0,
        Math.min(
          tracks.length * trackHeight - 2,
          reorderState.dropSlot * trackHeight - 1,
        ),
      )
    : 0;

  return {
    listRef,
    wheelSurfaceRef,
    reorderState,
    activeReorderTrackId: reorderState?.trackId ?? null,
    pendingTrackDeleteId,
    pendingTrackDeleteTrack,
    pendingTrackDeleteClipCount,
    actionSheetTrack,
    openTrackActionSheet,
    closeTrackActionSheet,
    handleListScroll,
    handleListDoubleClick,
    handleTrackReorderStart,
    moveTrackToIndex,
    requestTrackDelete,
    confirmTrackDelete,
    closePendingTrackDelete,
    dropIndicatorTop,
  };
}
