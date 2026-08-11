import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { css, cx } from "../../styled-system/css";

import type {
  ButtonVariant,
  ControlSize,
  DialogCloseActionSize,
  MetricChipTone,
  PanelVariant,
  StatusPillTone,
} from "./contracts.ts";
import { designTokens, typeStyles } from "./tokens";
import {
  button as buttonClassRecipe,
  dialogBody as dialogBodyClassRecipe,
  dialogButtonRow as dialogButtonRowClassRecipe,
  dialogHeader as dialogHeaderClassRecipe,
  dialogShell as dialogShellClassRecipe,
  fieldRow as fieldRowClassRecipe,
  iconButton as iconButtonClassRecipe,
  metricChip as metricChipClassRecipe,
  panel as panelClassRecipe,
  statusPill as statusPillClassRecipe,
} from "../../styled-system/recipes";

export type {
  ButtonVariant,
  ControlSize,
  DialogCloseActionSize,
  MetricChipTone,
  PanelVariant,
  StatusPillTone,
} from "./contracts.ts";

export interface BaseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "children"> {
  children: ReactNode;
  style?: CSSProperties;
  /**
   * Already reached the DOM node through `{...rest}`; this only makes the
   * capability declarable. Callers that move focus need it.
   */
  ref?: Ref<HTMLButtonElement>;
}

export interface ButtonProps extends BaseButtonProps {
  variant?: ButtonVariant;
  size?: ControlSize;
}

export interface IconButtonProps extends BaseButtonProps {
  variant?: ButtonVariant;
  size?: ControlSize;
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  children: ReactNode;
  variant?: PanelVariant;
  style?: CSSProperties;
  className?: string;
}

export interface DialogProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeActionSize?: DialogCloseActionSize;
  style?: CSSProperties;
  className?: string;
}

export interface ToolbarGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export interface FieldRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  label: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export interface DialogButtonRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export interface MetricChipProps
  extends Omit<HTMLAttributes<HTMLElement>, "style" | "children" | "onClick"> {
  children: ReactNode;
  tone?: MetricChipTone;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export interface StatusPillProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "style" | "children"> {
  children: ReactNode;
  tone?: StatusPillTone;
  style?: CSSProperties;
  className?: string;
}



export interface LargeTouchActionButtonProps extends ButtonProps {
  emphasis?: "default" | "primary" | "danger";
}

export interface StickyActionBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  children: ReactNode;
  label?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface TransientActionBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "style" | "children"> {
  children: ReactNode;
  tone?: StatusPillTone;
  className?: string;
  style?: CSSProperties;
}

export interface BottomSheetProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}

function buttonVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        border: `1px solid ${designTokens.border.info}`,
        background: designTokens.surface.interactiveActive,
        color: "var(--text-primary)",
      };
    case "danger":
      return {
        border: `1px solid ${designTokens.border.danger}`,
        background: designTokens.surface.interactiveDanger,
        color: designTokens.text.danger,
      };
    case "transport":
      return {
        border: `1px solid ${designTokens.border.default}`,
        background:
          "linear-gradient(180deg, rgba(27, 37, 71, 0.96), rgba(14, 20, 40, 0.96))",
        color: "var(--text-primary)",
      };
    case "ghost":
      return {
        border: `1px solid ${designTokens.border.default}`,
        background: "transparent",
        color: designTokens.text.secondary,
      };
    case "secondary":
    default:
      return {
        border: `1px solid ${designTokens.border.default}`,
        background: designTokens.surface.interactive,
        color: designTokens.text.secondary,
        boxShadow: "var(--shadow-soft)",
      };
  }
}

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  const value = classNames.filter(Boolean).join(" ");
  return value.length > 0 ? value : undefined;
}

function recipeControlSize(size: ControlSize): Exclude<ControlSize, "compact"> {
  return size === "compact" ? "sm" : size;
}

const buttonBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: designTokens.spacing.sm,
  minHeight: 36,
  padding: `0 ${designTokens.spacing.lg}px`,
  borderRadius: designTokens.radius.lg,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 700,
};

function buttonSizeStyle(size: ControlSize): CSSProperties {
  switch (size) {
    case "compact":
    case "sm":
      return {
        minHeight: 30,
        padding: `0 ${designTokens.spacing.md}px`,
        fontSize: 10,
        borderRadius: designTokens.radius.md,
      };
    case "touch":
      return {
        minHeight: 40,
        padding: `0 ${designTokens.spacing.xl}px`,
        fontSize: 12,
        borderRadius: designTokens.radius.lg,
      };
    case "md":
    default:
      return {
        minHeight: 36,
        padding: `0 ${designTokens.spacing.lg}px`,
        fontSize: 12,
        borderRadius: designTokens.radius.lg,
      };
  }
}

function iconButtonSizeStyle(size: ControlSize): CSSProperties {
  switch (size) {
    case "compact":
    case "sm":
      return {
        width: 28,
        height: 28,
        borderRadius: designTokens.radius.md,
      };
    case "touch":
      return {
        width: 40,
        height: 40,
        borderRadius: designTokens.radius.lg,
      };
    case "md":
    default:
      return {
        width: 36,
        height: 36,
        borderRadius: designTokens.radius.lg,
      };
  }
}

function panelVariantStyle(variant: PanelVariant): CSSProperties {
  switch (variant) {
    case "accent":
      return {
        background:
          "radial-gradient(circle at top right, rgba(97, 164, 255, 0.18), transparent 36%), linear-gradient(180deg, rgba(18, 28, 58, 0.98), rgba(10, 16, 31, 0.98))",
        border: `1px solid ${designTokens.border.info}`,
      };
    case "inset":
      return {
        background: designTokens.surface.panel,
        border: "1px solid rgba(255,255,255,0.04)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      };
    case "muted":
      return {
        background: designTokens.surface.panelMuted,
        border: `1px solid ${designTokens.border.default}`,
      };
    case "raised":
    default:
      return {
        background: designTokens.surface.panelRaised,
        border: `1px solid ${designTokens.border.default}`,
        boxShadow: designTokens.shadow.panel,
      };
  }
}

function metricChipToneStyle(tone: MetricChipTone): CSSProperties {
  switch (tone) {
    case "info":
      return {
        color: designTokens.text.info,
        background: designTokens.surface.chipInfo,
        border: `1px solid ${designTokens.border.info}`,
      };
    case "success":
      return {
        color: designTokens.text.success,
        background: designTokens.surface.chipSuccess,
        border: `1px solid ${designTokens.border.success}`,
      };
    case "warning":
      return {
        color: designTokens.text.warning,
        background: designTokens.surface.chipWarning,
        border: `1px solid ${designTokens.border.warning}`,
      };
    case "neutral":
    default:
      return {
        color: designTokens.text.secondary,
        background: designTokens.surface.chipNeutral,
        border: `1px solid ${designTokens.border.default}`,
      };
  }
}

function statusPillToneStyle(tone: StatusPillTone): CSSProperties {
  switch (tone) {
    case "info":
      return {
        color: designTokens.text.info,
        background: designTokens.surface.chipInfo,
        border: `1px solid ${designTokens.border.info}`,
      };
    case "success":
      return {
        color: designTokens.text.success,
        background: designTokens.surface.chipSuccess,
        border: `1px solid ${designTokens.border.success}`,
      };
    case "warning":
      return {
        color: designTokens.text.warning,
        background: designTokens.surface.chipWarning,
        border: `1px solid ${designTokens.border.warning}`,
      };
    case "danger":
      return {
        color: designTokens.text.danger,
        background: designTokens.surface.chipDanger,
        border: `1px solid ${designTokens.border.danger}`,
      };
    case "neutral":
    default:
      return {
        color: designTokens.text.muted,
        background: designTokens.surface.chipNeutral,
        border: `1px solid ${designTokens.border.default}`,
      };
  }
}

export function Button({
  children,
  style,
  size = "md",
  type = "button",
  variant = "secondary",
  className,
  ...rest
}: ButtonProps) {
  const classRecipeSize = recipeControlSize(size);
  return (
    <button
      type={type}
      {...rest}
      className={joinClassNames(buttonClassRecipe({ variant, size: classRecipeSize }), className)}
      style={{
        ...buttonBaseStyle,
        ...buttonSizeStyle(size),
        ...buttonVariantStyle(variant),
        ...(rest.disabled ? { opacity: 0.45 } : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  style,
  size = "md",
  type = "button",
  variant = "secondary",
  className,
  ...rest
}: IconButtonProps) {
  const classRecipeSize = recipeControlSize(size);
  return (
    <button
      type={type}
      {...rest}
      className={joinClassNames(iconButtonClassRecipe({ variant, size: classRecipeSize }), className)}
      style={{
        ...iconButtonSizeStyle(size),
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...buttonVariantStyle(variant),
        ...(rest.disabled ? { opacity: 0.4 } : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Panel({ children, variant = "raised", style, className, ...rest }: PanelProps) {
  return (
    <div
      {...rest}
      className={joinClassNames(panelClassRecipe({ variant }), className)}
      style={{
        borderRadius: designTokens.radius.xxl,
        ...panelVariantStyle(variant),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  closeActionSize = "compact",
  style,
  className,
}: DialogProps) {
  return (
    <div
      className={joinClassNames(dialogShellClassRecipe(), className)}
      style={{
        borderRadius: designTokens.radius.xl,
        border: "1px solid var(--border-emphasis)",
        background:
          "linear-gradient(180deg, rgba(22, 31, 60, 0.98), rgba(10, 15, 30, 0.98))",
        boxShadow: designTokens.shadow.panel,
        outline: "none",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        className={dialogHeaderClassRecipe()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `${designTokens.spacing.lg}px ${designTokens.spacing.xl}px`,
          borderBottom: `1px solid ${designTokens.border.default}`,
          background:
            "linear-gradient(180deg, rgba(38, 51, 94, 0.84), rgba(16, 23, 47, 0.84))",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: 0.2,
          }}
        >
          {title}
        </span>
        <IconButton
          onClick={onClose}
          title="Close"
          aria-label="Close"
          size={closeActionSize === "touch" ? "touch" : "sm"}
          variant="secondary"
          style={closeActionSize === "touch" ? { width: 38, height: 38, fontSize: 14 } : { width: 30, height: 30, fontSize: 12, borderRadius: designTokens.radius.md }}
        >
          {"\u2715"}
        </IconButton>
      </div>
      <div className={dialogBodyClassRecipe()} data-testid="dialog-body">{children}</div>
    </div>
  );
}


export function LargeTouchActionButton({
  emphasis = "default",
  className,
  style,
  variant,
  size,
  ...rest
}: LargeTouchActionButtonProps) {
  const resolvedVariant =
    variant ?? (emphasis === "primary" ? "primary" : emphasis === "danger" ? "danger" : "secondary");
  return (
    <Button
      {...rest}
      variant={resolvedVariant}
      size={size ?? "touch"}
      data-glow-state={emphasis === "danger" ? "warning" : undefined}
      className={cx(
        touchActionButtonClass,
        emphasis === "danger" ? touchActionButtonDangerClass : undefined,
        className,
      )}
      style={style}
    />
  );
}

export function StickyActionBar({
  children,
  label,
  className,
  style,
  ...rest
}: StickyActionBarProps) {
  return (
    <div
      {...rest}
      className={cx(stickyActionBarClass, className)}
      style={style}
    >
      {label ? <span className={stickyActionBarLabelClass}>{label}</span> : null}
      <div className={stickyActionBarBodyClass}>{children}</div>
    </div>
  );
}

export function TransientActionBadge({
  children,
  tone = "info",
  className,
  style,
  ...rest
}: TransientActionBadgeProps) {
  return (
    <StatusPill
      {...rest}
      tone={tone}
      className={cx(transientBadgeClass, className)}
      style={style}
    >
      {children}
    </StatusPill>
  );
}

export function BottomSheet({
  open,
  title,
  children,
  onClose,
  className,
  style,
}: BottomSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className={bottomSheetBackdropClass} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Bottom sheet"}
        className={cx(bottomSheetClass, className)}
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={bottomSheetHandleClass} aria-hidden="true" />
        <div className={bottomSheetHeaderClass}>
          <span className={bottomSheetTitleClass}>{title}</span>
          <IconButton
            aria-label="Close bottom sheet"
            title="Close"
            size="compact"
            variant="ghost"
            onClick={onClose}
          >
            x
          </IconButton>
        </div>
        <div className={bottomSheetBodyClass}>{children}</div>
      </div>
    </div>
  );
}

export function ToolbarGroup({ children, style, className, ...rest }: ToolbarGroupProps) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: designTokens.spacing.sm,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FieldRow({ label, children, style, className, ...rest }: FieldRowProps) {
  return (
    <div
      {...rest}
      className={joinClassNames(fieldRowClassRecipe(), className)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: designTokens.spacing.lg,
        marginBottom: designTokens.spacing.lg,
        ...style,
      }}
    >
      <span
        style={{
          ...typeStyles.label,
          color: designTokens.text.muted,
          minWidth: 90,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function DialogButtonRow({ children, style, className, ...rest }: DialogButtonRowProps) {
  return (
    <div
      {...rest}
      className={joinClassNames(dialogButtonRowClassRecipe(), className)}
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: designTokens.spacing.sm,
        marginTop: designTokens.spacing.xl,
        paddingTop: designTokens.spacing.lg,
        borderTop: `1px solid ${designTokens.border.default}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function MetricChip({
  children,
  tone = "neutral",
  active = false,
  onClick,
  style,
  className,
  ...rest
}: MetricChipProps) {
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      {...rest}
      {...(onClick ? { onClick, type: "button" as const } : {})}
      data-glow-state={active ? "selected" : undefined}
      className={joinClassNames(metricChipClassRecipe({ tone, active }), className)}
      style={{
        ...typeStyles.mono,
        display: "inline-flex",
        alignItems: "center",
        gap: designTokens.spacing.sm,
        padding: `8px ${designTokens.spacing.lg}px`,
        borderRadius: designTokens.radius.lg,
        cursor: onClick ? "pointer" : "default",
        boxShadow: active ? designTokens.shadow.info : designTokens.shadow.soft,
        ...metricChipToneStyle(tone),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export function StatusPill({ children, tone = "neutral", style, className, ...rest }: StatusPillProps) {
  return (
    <span
      {...rest}
      className={joinClassNames(statusPillClassRecipe({ tone }), className)}
      style={{
        ...typeStyles.monoSmall,
        display: "inline-flex",
        alignItems: "center",
        gap: designTokens.spacing.xs,
        padding: `4px ${designTokens.spacing.sm}px`,
        borderRadius: designTokens.radius.pill,
        ...statusPillToneStyle(tone),
        ...style,
      }}
    >
      {children}
    </span>
  );
}






const touchActionButtonClass = css({
  minHeight: "44px",
  borderRadius: "14px",
  fontWeight: "800",
});

const touchActionButtonDangerClass = css({
  boxShadow: "0 0 0 1px rgba(255, 117, 135, 0.2), 0 0 16px rgba(255, 117, 135, 0.12)",
});

const stickyActionBarClass = css({
  position: "sticky",
  bottom: "0",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "12px 14px 14px",
  borderTop: "1px solid var(--border-default)",
  background:
    "linear-gradient(180deg, rgba(16, 23, 45, 0.92), rgba(8, 12, 26, 0.98))",
  boxShadow: "0 -18px 28px rgba(0,0,0,0.22)",
  backdropFilter: "blur(10px)",
  zIndex: 12,
});

const stickyActionBarLabelClass = css({
  // `typeStyles.label`, written out: Panda cannot spread an imported object.
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.4px",
  textTransform: "uppercase",
  color: "var(--text-muted)",
});

const stickyActionBarBodyClass = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  minWidth: 0,
});

const transientBadgeClass = css({
  alignSelf: "flex-start",
  boxShadow: "var(--shadow-soft)",
});

const bottomSheetBackdropClass = css({
  position: "fixed",
  inset: "0",
  zIndex: 1300,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "stretch",
  background: "rgba(4, 7, 15, 0.7)",
  backdropFilter: "blur(8px)",
  padding: "16px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)",
});

const bottomSheetClass = css({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  borderRadius: "22px 22px 18px 18px",
  border: "1px solid var(--border-emphasis)",
  background:
    "linear-gradient(180deg, rgba(19, 27, 54, 0.98), rgba(9, 13, 27, 0.98))",
  boxShadow: "var(--shadow-panel)",
  overflow: "hidden",
});

const bottomSheetHandleClass = css({
  width: "48px",
  height: "4px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.22)",
  alignSelf: "center",
  marginTop: "10px",
});

const bottomSheetHeaderClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "0 16px",
});

const bottomSheetTitleClass = css({
  fontSize: "14px",
  fontWeight: "800",
  color: "var(--text-primary)",
});

const bottomSheetBodyClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "0 16px 16px",
});
