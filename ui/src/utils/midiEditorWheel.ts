export interface ResolveMidiEditorWheelIntentInput {
  deltaY: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  verticalScrollEnabled: boolean;
  wheelMode: "mixed" | "scroll";
}

export type MidiEditorWheelIntent =
  | { type: "zoom"; factor: number }
  | { type: "scroll-horizontal"; delta: number }
  | { type: "scroll-vertical"; delta: number }
  | { type: "ignore" };

const ZOOM_OUT_FACTOR = 0.85;
const ZOOM_IN_FACTOR = 1.18;

export function resolveMidiEditorWheelIntent(
  input: ResolveMidiEditorWheelIntentInput,
): MidiEditorWheelIntent {
  if (input.ctrlKey || input.metaKey) {
    return {
      type: "zoom",
      factor: input.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
    };
  }
  if (input.altKey) {
    return { type: "scroll-horizontal", delta: input.deltaY };
  }
  if (input.shiftKey) {
    return input.verticalScrollEnabled
      ? { type: "scroll-vertical", delta: input.deltaY }
      : { type: "ignore" };
  }
  if (input.wheelMode === "scroll") {
    return input.verticalScrollEnabled
      ? { type: "scroll-vertical", delta: input.deltaY }
      : { type: "ignore" };
  }
  return {
    type: "zoom",
    factor: input.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
  };
}
