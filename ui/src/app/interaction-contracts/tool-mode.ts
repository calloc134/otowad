export type InteractionPhase = "idle" | "begin" | "update" | "commit" | "cancel";

export type EditorToolMode =
  | "implicit"
  | "select"
  | "trim"
  | "stretch"
  | "warp"
  | "note-create"
  | "note-edit"
  | "pan"
  | "reorder";

export interface SurfaceToolModeState<TMode extends string = EditorToolMode> {
  current: TMode;
  allowsExplicitMode: boolean;
}

export interface TransientPointerSession<TKind extends string = string> {
  kind: TKind;
  phase: InteractionPhase;
}

export const IDLE_TRANSIENT_SESSION: TransientPointerSession<"idle"> = {
  kind: "idle",
  phase: "idle",
};

export function createImplicitToolModeState<TMode extends string = "implicit">(
  allowsExplicitMode: boolean,
  current = "implicit" as TMode,
): SurfaceToolModeState<TMode> {
  return {
    current,
    allowsExplicitMode,
  };
}
