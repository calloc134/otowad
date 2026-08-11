import type { GridDivision, TimeSignature } from "../types/index.ts";
import { divisionToTicks, effectiveBeatTicks } from "../grid.ts";

export const CLIP_HANDLE_WIDTH = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSelectionTick(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.round(value));
}

export interface ViewportContentPointInput {
  clientX: number;
  clientY: number;
  viewportLeft: number;
  viewportTop: number;
  scrollLeft: number;
  scrollTop: number;
}

export function resolveViewportContentPoint(
  input: ViewportContentPointInput,
): { x: number; y: number } {
  return {
    x: input.clientX - input.viewportLeft + input.scrollLeft,
    y: input.clientY - input.viewportTop + input.scrollTop,
  };
}

export interface ViewportTickInput {
  clientX: number;
  viewportLeft: number;
  scrollLeft: number;
  pixelsPerTick: number;
}

export function tickFromViewportClientX(input: ViewportTickInput): number {
  if (input.pixelsPerTick <= 0) {
    return 0;
  }
  const x = input.clientX - input.viewportLeft + input.scrollLeft;
  return Math.max(0, Math.round(x / input.pixelsPerTick));
}

export interface PlayheadStepTicksInput {
  snapEnabled: boolean;
  division: GridDivision;
  ppq: number;
  timeSig: TimeSignature;
}

export function getPlayheadStepTicks(input: PlayheadStepTicksInput): number {
  return input.snapEnabled
    ? divisionToTicks(input.division, input.ppq, input.timeSig)
    : effectiveBeatTicks(input.ppq, input.timeSig);
}

export interface ResolvePlayheadKeyTickInput {
  key: string;
  currentTick: number;
  playheadStepTicks: number;
  pageStepTicks: number;
}

export function resolvePlayheadKeyTick(
  input: ResolvePlayheadKeyTickInput,
): number | null {
  const currentTick = Math.max(0, Math.round(input.currentTick));
  const playheadStepTicks = Math.max(1, Math.round(input.playheadStepTicks));
  const pageStepTicks = Math.max(1, Math.round(input.pageStepTicks));

  switch (input.key) {
    case "ArrowLeft":
      return Math.max(0, currentTick - playheadStepTicks);
    case "ArrowRight":
      return currentTick + playheadStepTicks;
    case "Home":
      return 0;
    case "PageUp":
      return Math.max(0, currentTick - pageStepTicks);
    case "PageDown":
      return currentTick + pageStepTicks;
    default:
      return null;
  }
}

export interface TimeSelectionRange {
  startTick: number;
  endTick: number;
}

export function normalizeTimeSelectionRange(
  startTick: number | null,
  endTick: number | null,
): TimeSelectionRange | null {
  const normalizedStart = normalizeSelectionTick(startTick);
  const normalizedEnd = normalizeSelectionTick(endTick);
  if (normalizedStart === null || normalizedEnd === null) {
    return null;
  }

  const rangeStart = Math.min(normalizedStart, normalizedEnd);
  const rangeEnd = Math.max(normalizedStart, normalizedEnd);
  if (rangeEnd <= rangeStart) {
    return null;
  }

  return {
    startTick: rangeStart,
    endTick: rangeEnd,
  };
}

export interface TimelineGestureInput {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  threshold?: number;
}

export type TimelineGesture = "click" | "drag";

export function resolveTimelineGesture(
  input: TimelineGestureInput,
): TimelineGesture {
  const threshold = Math.max(0, input.threshold ?? 4);
  const deltaX = Math.abs(input.currentX - input.startX);
  const deltaY = Math.abs(input.currentY - input.startY);
  return deltaX >= threshold || deltaY >= threshold ? "drag" : "click";
}

export interface ClipSelectionClickInput {
  clipId: string;
  selectedClipIds: string[];
  primaryClipId: string | null;
  isToggle: boolean;
  clickedClipKind?: "audio" | "midi";
  currentSelectionKind?: "audio" | "midi" | null;
}

export interface ClipSelectionClickResult {
  clipIds: string[];
  primaryClipId: string | null;
}

export type ClipSelectionMode = "default" | "preserve_clicked";

export function resolveClipSelectionOnClick(
  input: ClipSelectionClickInput,
): ClipSelectionClickResult {
  const {
    clipId,
    selectedClipIds,
    primaryClipId,
    isToggle,
    clickedClipKind,
    currentSelectionKind,
  } = input;
  const isSelected = selectedClipIds.includes(clipId);
  const selectionKindMismatch =
    isToggle &&
    clickedClipKind !== undefined &&
    currentSelectionKind !== null &&
    currentSelectionKind !== undefined &&
    clickedClipKind !== currentSelectionKind;

  if (isToggle) {
    if (selectionKindMismatch) {
      return {
        clipIds: [clipId],
        primaryClipId: clipId,
      };
    }

    if (isSelected) {
      return {
        clipIds: selectedClipIds.filter((selectedId) => selectedId !== clipId),
        primaryClipId: primaryClipId === clipId ? null : primaryClipId,
      };
    }

    return {
      clipIds: [...selectedClipIds, clipId],
      primaryClipId: clipId,
    };
  }

  if (isSelected) {
    if (selectedClipIds.length === 1) {
      return { clipIds: [clipId], primaryClipId: clipId };
    }

    return {
      clipIds: selectedClipIds.filter((selectedId) => selectedId !== clipId),
      primaryClipId: primaryClipId === clipId ? null : primaryClipId,
    };
  }

  return {
    clipIds: [clipId],
    primaryClipId: clipId,
  };
}

export interface ResolveClipSelectionInput extends ClipSelectionClickInput {
  mode?: ClipSelectionMode;
}

export function resolveClipSelection(
  input: ResolveClipSelectionInput,
): ClipSelectionClickResult {
  const { clipId, selectedClipIds, isToggle, mode = "default" } = input;

  if (mode === "preserve_clicked" && !isToggle) {
    if (selectedClipIds.includes(clipId)) {
      return {
        clipIds: selectedClipIds,
        primaryClipId: clipId,
      };
    }

    return {
      clipIds: [clipId],
      primaryClipId: clipId,
    };
  }

  return resolveClipSelectionOnClick(input);
}

export interface ClipBodyClickInput {
  relativeX: number;
  renderedWidth: number;
  disableGroupEdit: boolean;
  handleWidth?: number;
}

export type ClipResizeClickOutcome =
  | { type: "select_only" }
  | { type: "seek_edge"; edge: "start" | "end" };

export interface ResolveClipResizeClickOutcomeInput {
  edge: "start-blue" | "end-blue" | "start-red" | "end-red";
  originalStart: number;
  originalLength: number;
  originalSourceIn?: number | null;
  originalSourceOut?: number | null;
  nextStart: number;
  nextLength: number;
  nextSourceIn?: number | null;
  nextSourceOut?: number | null;
}

export function resolveClipResizeClickOutcome(
  input: ResolveClipResizeClickOutcomeInput,
): ClipResizeClickOutcome {
  const startChanged = input.originalStart !== input.nextStart;
  const lengthChanged = input.originalLength !== input.nextLength;
  const sourceInChanged =
    (input.originalSourceIn ?? null) !== (input.nextSourceIn ?? null);
  const sourceOutChanged =
    (input.originalSourceOut ?? null) !== (input.nextSourceOut ?? null);

  if (startChanged || lengthChanged || sourceInChanged || sourceOutChanged) {
    return { type: "select_only" };
  }

  return {
    type: "seek_edge",
    edge: input.edge.startsWith("start") ? "start" : "end",
  };
}

export function isClipBodyClick(input: ClipBodyClickInput): boolean {
  const {
    relativeX,
    renderedWidth,
    disableGroupEdit,
    handleWidth = CLIP_HANDLE_WIDTH,
  } = input;

  if (disableGroupEdit || renderedWidth <= handleWidth * 2) {
    return true;
  }

  return relativeX > handleWidth && relativeX < renderedWidth - handleWidth;
}

export interface ClipClickTickInput {
  relativeX: number;
  renderedWidth: number;
  clipStart: number;
  clipLength: number;
}

export function tickFromClipBodyClick(input: ClipClickTickInput): number {
  const { relativeX, renderedWidth, clipStart, clipLength } = input;
  const safeWidth = Math.max(1, renderedWidth);
  const clampedRelativeX = clamp(relativeX, 0, safeWidth);
  const ratio = clampedRelativeX / safeWidth;
  const tickInClip = Math.round(ratio * clipLength);

  return clipStart + clamp(tickInClip, 0, clipLength);
}

export function getPageStepTicks(
  playheadStepTicks: number,
  timeSigNumerator: number,
): number {
  return Math.max(1, Math.round(playheadStepTicks))
    * Math.max(1, Math.round(timeSigNumerator));
}
