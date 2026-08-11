export interface ResolveTimelineWheelIntentInput {
  deltaX: number;
  deltaY: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  wheelMode: "mixed" | "scroll";
}

export type TimelineWheelIntent =
  | { type: "zoom"; factor: number }
  | { type: "scroll-horizontal"; delta: number }
  | { type: "scroll-vertical"; delta: number }
  | { type: "native-scroll" };

const ZOOM_OUT_FACTOR = 0.85;
const ZOOM_IN_FACTOR = 1.18;

function resolveScrollDelta(input: Pick<ResolveTimelineWheelIntentInput, "deltaX" | "deltaY">): number {
  if (Math.abs(input.deltaY) >= 0.5) {
    return input.deltaY;
  }
  if (Math.abs(input.deltaX) >= 0.5) {
    return input.deltaX;
  }
  return 0;
}

export function resolveTimelineWheelIntent(
  input: ResolveTimelineWheelIntentInput,
): TimelineWheelIntent {
  const scrollDelta = resolveScrollDelta(input);

  if (input.ctrlKey || input.metaKey) {
    return {
      type: "zoom",
      factor: scrollDelta > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
    };
  }

  if (input.altKey) {
    return { type: "scroll-horizontal", delta: scrollDelta };
  }

  if (input.shiftKey) {
    return { type: "scroll-vertical", delta: scrollDelta };
  }

  if (input.wheelMode === "mixed") {
    if (Math.abs(input.deltaY) < 0.5 && Math.abs(input.deltaX) >= 0.5) {
      return { type: "scroll-horizontal", delta: input.deltaX };
    }
    return {
      type: "zoom",
      factor: scrollDelta > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
    };
  }

  return { type: "native-scroll" };
}
