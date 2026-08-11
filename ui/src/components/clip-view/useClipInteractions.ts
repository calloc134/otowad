import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import type { ClipDragResult } from "@/hooks/useClipDrag";
import type { ClipResizeResult } from "@/hooks/useClipResize";
import type { WarpAnchorResult } from "@/hooks/useWarpAnchor";
import {
  isClipBodyClick,
  tickFromClipBodyClick,
  type ClipSelectionMode,
} from "@/utils/timelineInteractions";
import {
  resolveClipBodyIntent,
  resolveClipSplitLongPressSettings,
} from "@/components/clipViewGesture";

export interface ClipSelectIntent {
  clickTick?: number;
  selectionMode?: ClipSelectionMode;
}

export interface ClipSelectionTriggerEvent {
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface UseClipInteractionsArgs {
  clipId: string;
  clipStart: number;
  clipLength: number;
  isAudio: boolean;
  isSelected: boolean;
  isPrimarySelection: boolean;
  disableGroupEdit: boolean;
  canUseModifierShortcuts: boolean;
  usesTouchSizedActions: boolean;
  pixelsPerTick: number;
  interactionPolicy: TimelineInteractionPolicy;
  onSelect: (clipId: string, event: ClipSelectionTriggerEvent, intent?: ClipSelectIntent) => void;
  onDoubleClick?: (clipId: string) => void;
  onSplitClip?: (clipId: string, tickInClip: number) => void;
  drag: ClipDragResult;
  resize: ClipResizeResult;
  warp: WarpAnchorResult;
}

export interface ClipInteractionsResult {
  isSplitLongPressing: boolean;
  warpPlacementArmed: boolean;
  toggleWarpPlacementArmed: () => void;
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handlePointerCancel: () => void;
  handleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function useClipInteractions({
  clipId,
  clipStart,
  clipLength,
  isAudio,
  isSelected,
  isPrimarySelection,
  disableGroupEdit,
  canUseModifierShortcuts,
  usesTouchSizedActions,
  pixelsPerTick,
  interactionPolicy,
  onSelect,
  onDoubleClick,
  onSplitClip,
  drag,
  resize,
  warp,
}: UseClipInteractionsArgs): ClipInteractionsResult {
  const splitLongPress = resolveClipSplitLongPressSettings(interactionPolicy);
  const splitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitPressRef = useRef({ startX: 0, startY: 0, relX: 0, cancelled: false });
  const splitPointerIdRef = useRef<number | null>(null);
  const suppressSplitClickRef = useRef(false);
  const [isSplitLongPressing, setIsSplitLongPressing] = useState(false);
  const [warpPlacementArmed, setWarpPlacementArmed] = useState(false);

  useEffect(() => {
    if (!isSelected) {
      setWarpPlacementArmed(false);
    }
  }, [isSelected]);

  const cancelSplitLongPress = useCallback(() => {
    if (splitTimerRef.current !== null) {
      clearTimeout(splitTimerRef.current);
      splitTimerRef.current = null;
    }
    setIsSplitLongPressing(false);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.stopPropagation();

      if (event.ctrlKey || event.metaKey) {
        drag.onPointerDown(event);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const clipWidth = rect.width;
      const clipHeight = rect.height;
      const bodyIntent = resolveClipBodyIntent({
        event,
        clipWidth,
        clipHeight,
        disableGroupEdit,
        isAudio,
      });
      if (!bodyIntent) {
        return;
      }

      if (usesTouchSizedActions && !isPrimarySelection) {
        onSelect(clipId, event);
        return;
      }

      if (bodyIntent.type === "resize") {
        resize.onResizeStart(bodyIntent.edge, event);
        return;
      }

      if (
        !disableGroupEdit &&
        isAudio &&
        ((canUseModifierShortcuts && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) ||
          warpPlacementArmed)
      ) {
        const didAddAnchor = warp.addAnchorAtClientX(event.currentTarget, event.clientX);
        setWarpPlacementArmed(false);
        if (didAddAnchor) {
          suppressSplitClickRef.current = true;
          window.setTimeout(() => {
            suppressSplitClickRef.current = false;
          }, 0);
        }
        return;
      }

      drag.onPointerDown(event);

      if (disableGroupEdit) {
        return;
      }

      splitPressRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        relX: bodyIntent.relativeX,
        cancelled: false,
      };
      splitPointerIdRef.current = event.pointerId;
      setIsSplitLongPressing(true);

      splitTimerRef.current = setTimeout(() => {
        splitTimerRef.current = null;

        if (splitPressRef.current.cancelled) {
          setIsSplitLongPressing(false);
          splitPointerIdRef.current = null;
          return;
        }

        if (onSplitClip) {
          const tickInClip = Math.max(0, Math.round(splitPressRef.current.relX / pixelsPerTick));
          suppressSplitClickRef.current = true;
          window.setTimeout(() => {
            suppressSplitClickRef.current = false;
          }, 0);
          onSplitClip(clipId, tickInClip);
        }

        setIsSplitLongPressing(false);
        splitPointerIdRef.current = null;
      }, splitLongPress.longPressMs);
    },
    [
      canUseModifierShortcuts,
      cancelSplitLongPress,
      clipId,
      disableGroupEdit,
      drag,
      isAudio,
      isPrimarySelection,
      onSelect,
      onSplitClip,
      pixelsPerTick,
      resize,
      splitLongPress.longPressMs,
      splitLongPress.moveThresholdPx,
      usesTouchSizedActions,
      warp,
      warpPlacementArmed,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (splitPointerIdRef.current !== event.pointerId) {
        return;
      }

      const dx = event.clientX - splitPressRef.current.startX;
      const dy = event.clientY - splitPressRef.current.startY;
      if (
        Math.abs(dx) > splitLongPress.moveThresholdPx ||
        Math.abs(dy) > splitLongPress.moveThresholdPx
      ) {
        splitPressRef.current.cancelled = true;
        splitPointerIdRef.current = null;
        cancelSplitLongPress();
      }
    },
    [cancelSplitLongPress, splitLongPress.moveThresholdPx],
  );

  const handlePointerUp = useCallback(() => {
    splitPointerIdRef.current = null;
    cancelSplitLongPress();
  }, [cancelSplitLongPress]);

  const handlePointerCancel = useCallback(() => {
    splitPointerIdRef.current = null;
    cancelSplitLongPress();
  }, [cancelSplitLongPress]);

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onDoubleClick?.(clipId);
    },
    [clipId, onDoubleClick],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      if (drag.consumeClickSuppression()) {
        return;
      }
      if (suppressSplitClickRef.current) {
        suppressSplitClickRef.current = false;
        return;
      }
      if (event.detail > 1) {
        return;
      }

      const resizeOutcome = resize.consumeClickOutcome();
      if (resizeOutcome) {
        const clickTick = resizeOutcome.type === "seek_edge"
          ? resizeOutcome.edge === "start"
            ? clipStart
            : clipStart + clipLength
          : undefined;
        onSelect(clipId, event, {
          clickTick,
          selectionMode: "preserve_clicked",
        });
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = event.clientX - rect.left;
      const clickTick = isClipBodyClick({
        relativeX,
        renderedWidth: rect.width,
        disableGroupEdit,
      })
        ? tickFromClipBodyClick({
            relativeX,
            renderedWidth: rect.width,
            clipStart,
            clipLength,
          })
        : undefined;
      onSelect(clipId, event, { clickTick });
    },
    [clipId, clipLength, clipStart, disableGroupEdit, drag, onSelect, resize],
  );

  return {
    isSplitLongPressing,
    warpPlacementArmed,
    toggleWarpPlacementArmed: () => setWarpPlacementArmed((armed) => !armed),
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
    handleDoubleClick,
  };
}
