interface BuildClipGeometryInput {
  displayStart: number;
  displayLength: number;
  pixelsPerTick: number;
  trackHeight: number;
  isInteracting: boolean;
  isSelected: boolean;
  isPrimarySelection: boolean;
  selectionSize: number;
  usesTouchSizedActions: boolean;
  visibleActionCount: number;
}

export function resolveClipHeaderPaddingRight(args: {
  isPrimarySelection: boolean;
  isInteracting: boolean;
  usesTouchSizedActions: boolean;
  visibleActionCount: number;
}): number {
  // On touch the actions live in a bar at the bottom of the viewport, so the
  // clip header has nothing to make room for.
  if (!args.isPrimarySelection || args.isInteracting || args.usesTouchSizedActions) {
    return 4;
  }

  return Math.min(140, 12 + args.visibleActionCount * 18);
}

export interface ClipGeometry {
  left: number;
  width: number;
  clipHeight: number;
  shouldShowClipDetails: boolean;
  shouldShowActionStrip: boolean;
  headerPaddingRight: number;
}

const MIN_CLIP_DETAIL_WIDTH_PX = 52;

export function buildClipGeometry({
  displayStart,
  displayLength,
  pixelsPerTick,
  trackHeight,
  isInteracting,
  isSelected,
  isPrimarySelection,
  selectionSize,
  usesTouchSizedActions,
  visibleActionCount,
}: BuildClipGeometryInput): ClipGeometry {
  const left = displayStart * pixelsPerTick;
  const width = Math.max(displayLength * pixelsPerTick, 4);
  const clipHeight = Math.max(1, trackHeight - 4);
  const shouldShowClipDetails = width >= MIN_CLIP_DETAIL_WIDTH_PX;
  const shouldShowActionStrip =
    shouldShowClipDetails &&
    !isInteracting &&
    (isPrimarySelection || (usesTouchSizedActions && isSelected && selectionSize === 1));
  const headerPaddingRight = resolveClipHeaderPaddingRight({
    isPrimarySelection,
    isInteracting,
    usesTouchSizedActions,
    visibleActionCount,
  });

  return {
    left,
    width,
    clipHeight,
    shouldShowClipDetails,
    shouldShowActionStrip,
    headerPaddingRight,
  };
}
