import type { CSSProperties } from "react";

export type InteractionActionTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

export interface InteractionActionPresentation {
  style?: CSSProperties;
}

type ActionText<Context> = string | ((context: Context) => string);

export interface InteractionActionDefinition<Context> {
  id: string;
  label: ActionText<Context>;
  title: ActionText<Context>;
  iconKey: string;
  tone?: InteractionActionTone;
  isVisible?: (context: Context) => boolean;
  isEnabled?: (context: Context) => boolean;
  isActive?: (context: Context) => boolean;
  present?: (context: Context) => InteractionActionPresentation;
  execute: (context: Context) => void;
}

export interface ResolvedInteractionAction {
  id: string;
  label: string;
  title: string;
  iconKey: string;
  tone: InteractionActionTone;
  disabled: boolean;
  active: boolean;
  presentation?: InteractionActionPresentation;
  execute: () => void;
}

function resolveActionText<Context>(value: ActionText<Context>, context: Context): string {
  return typeof value === "function" ? value(context) : value;
}

export function countVisibleActions<Context>(
  registry: readonly InteractionActionDefinition<Context>[],
  context: Context,
): number {
  return registry.filter((action) => action.isVisible?.(context) ?? true).length;
}

export function resolveActionRegistry<Context>(
  registry: readonly InteractionActionDefinition<Context>[],
  context: Context,
): ResolvedInteractionAction[] {
  return registry
    .filter((action) => action.isVisible?.(context) ?? true)
    .map((action) => {
      const disabled = !(action.isEnabled?.(context) ?? true);
      return {
        id: action.id,
        label: resolveActionText(action.label, context),
        title: resolveActionText(action.title, context),
        iconKey: action.iconKey,
        tone: action.tone ?? "neutral",
        disabled,
        active: action.isActive?.(context) ?? false,
        presentation: action.present?.(context),
        execute: () => {
          if (disabled) {
            return;
          }
          action.execute(context);
        },
      };
    });
}
