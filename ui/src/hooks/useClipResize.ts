import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useProjectActions } from "@/store";
import { getAudioClipMediaInfo } from "@/audio/clipMath";
import {
  type ClipResizeClickOutcome,
} from "@/utils/timelineInteractions";
import type { ClipId, ProjectDocument } from "@/types";
import { useGridSnap } from "./useGridSnap";
import { resolveClipResizeCommit } from "./clipResizeCommit";
import {
  resolveResizePreviewState,
  type ResizeEdge,
  type ResizeSession,
} from "./clipResizeGeometry";

export type { ResizeEdge } from "./clipResizeGeometry";

export interface ClipResizeResult {
  onResizeStart: (edge: ResizeEdge, e: ReactPointerEvent<HTMLElement>) => void;
  consumeClickOutcome: () => ClipResizeClickOutcome | null;
  isResizing: boolean;
  previewLength: number | null;
  previewStart: number | null;
  previewSourceIn: number | null;
  previewSourceOut: number | null;
  previewContentIn: number | null;
  previewContentOut: number | null;
}

export function useClipResize(args: {
  clipId: ClipId;
  document: ProjectDocument | null;
  pixelsPerTick: number;
}): ClipResizeResult {
  const { clipId, document, pixelsPerTick } = args;
  const actions = useProjectActions();
  const { snapTick, isSnapEnabled, magnetRangeTicks } = useGridSnap();

  const [isResizing, setIsResizing] = useState(false);
  const [previewLength, setPreviewLength] = useState<number | null>(null);
  const [previewStart, setPreviewStart] = useState<number | null>(null);
  const [previewSourceIn, setPreviewSourceIn] = useState<number | null>(null);
  const [previewSourceOut, setPreviewSourceOut] = useState<number | null>(null);
  const [previewContentIn, setPreviewContentIn] = useState<number | null>(null);
  const [previewContentOut, setPreviewContentOut] = useState<number | null>(null);
  const clickOutcomeRef = useRef<ClipResizeClickOutcome | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);

  const applyPreview = useCallback((preview: {
    length: number;
    start: number;
    sourceIn: number | null;
    sourceOut: number | null;
    contentIn: number | null;
    contentOut: number | null;
  }) => {
    setPreviewLength(preview.length);
    setPreviewStart(preview.start);
    setPreviewSourceIn(preview.sourceIn);
    setPreviewSourceOut(preview.sourceOut);
    setPreviewContentIn(preview.contentIn);
    setPreviewContentOut(preview.contentOut);
  }, []);

  const clearResizePreview = useCallback(() => {
    setIsResizing(false);
    setPreviewLength(null);
    setPreviewStart(null);
    setPreviewSourceIn(null);
    setPreviewSourceOut(null);
    setPreviewContentIn(null);
    setPreviewContentOut(null);
  }, []);

  const createResizeSession = useCallback(
    (
      edge: ResizeEdge,
      clip: NonNullable<ProjectDocument>["edit"]["clips"][number],
      pointerId: number,
      clientX: number,
    ): ResizeSession => {
      const isAudio = clip.kind.clip_type === "audio";
      let maxSourceFrame = Number.POSITIVE_INFINITY;
      if (isAudio && clip.kind.clip_type === "audio") {
        const mediaInfo = document
          ? getAudioClipMediaInfo(document, clip.kind.content_id)
          : { sampleRate: 44100, lengthFrames: null };
        maxSourceFrame = mediaInfo.lengthFrames ?? Number.POSITIVE_INFINITY;
      }
      const otherClips = document?.edit.clips.filter((candidate) => candidate.id !== clipId) ?? [];

      return {
        pointerId,
        edge,
        startMouseX: clientX,
        origStart: clip.start,
        origLength: clip.length,
        origSrcIn: isAudio && clip.kind.clip_type === "audio" ? clip.kind.audio.src_in : 0,
        origSrcOut: isAudio && clip.kind.clip_type === "audio" ? clip.kind.audio.src_out : 0,
        origContentIn: !isAudio && clip.kind.clip_type === "midi" ? clip.kind.midi.content_in : 0,
        origContentOut: !isAudio && clip.kind.clip_type === "midi" ? clip.kind.midi.content_out : 0,
        pixelsPerTick,
        maxSourceFrame,
        isAudio,
        isSnapEnabled,
        magnetRangeTicks,
        otherClipStarts: otherClips.map((candidate) => candidate.start),
        otherClipEnds: otherClips.map((candidate) => candidate.start + candidate.length),
      };
    },
    [clipId, document, isSnapEnabled, magnetRangeTicks, pixelsPerTick],
  );

  const onResizeStart = useCallback(
    (edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const clip = document?.edit.clips.find((candidate) => candidate.id === clipId);
      if (!clip) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const session = createResizeSession(edge, clip, event.pointerId, event.clientX);
      resizeRef.current = session;
      clickOutcomeRef.current = null;

      const eventTarget = event.currentTarget;
      eventTarget.setPointerCapture?.(event.pointerId);

      setIsResizing(true);
      applyPreview(resolveResizePreviewState(session, event.clientX, snapTick));

      const cleanupPointerListeners = () => {
        eventTarget.removeEventListener("pointermove", handlePointerMove);
        eventTarget.removeEventListener("pointerup", handlePointerUp);
        eventTarget.removeEventListener("pointercancel", handlePointerCancel);
        if (resizeRef.current) {
          eventTarget.releasePointerCapture?.(resizeRef.current.pointerId);
        }
        resizeRef.current = null;
      };

      const handlePointerMove = (ev: PointerEvent) => {
        const activeSession = resizeRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }
        applyPreview(resolveResizePreviewState(activeSession, ev.clientX, snapTick));
      };

      const handlePointerUp = (ev: PointerEvent) => {
        const activeSession = resizeRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }

        cleanupPointerListeners();

        const { clickOutcome, command } = resolveClipResizeCommit(
          activeSession,
          ev.clientX,
          clipId,
          snapTick,
        );
        if (command) {
          actions.applyCommand(command);
        }

        clickOutcomeRef.current = clickOutcome;
        if (clickOutcome) {
          window.setTimeout(() => {
            if (clickOutcomeRef.current === clickOutcome) {
              clickOutcomeRef.current = null;
            }
          }, 0);
        }

        clearResizePreview();
      };

      const handlePointerCancel = (ev: PointerEvent) => {
        const activeSession = resizeRef.current;
        if (!activeSession || ev.pointerId !== activeSession.pointerId) {
          return;
        }
        cleanupPointerListeners();
        clearResizePreview();
      };

      eventTarget.addEventListener("pointermove", handlePointerMove);
      eventTarget.addEventListener("pointerup", handlePointerUp);
      eventTarget.addEventListener("pointercancel", handlePointerCancel);
    },
    [actions, applyPreview, clearResizePreview, clipId, createResizeSession, document, snapTick],
  );

  const consumeClickOutcome = useCallback(() => {
    const outcome = clickOutcomeRef.current;
    clickOutcomeRef.current = null;
    return outcome;
  }, []);

  return {
    onResizeStart,
    consumeClickOutcome,
    isResizing,
    previewLength,
    previewStart,
    previewSourceIn,
    previewSourceOut,
    previewContentIn,
    previewContentOut,
  };
}
