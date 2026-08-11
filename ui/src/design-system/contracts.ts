export const buttonVariants = [
  "primary",
  "secondary",
  "ghost",
  "danger",
  "transport",
] as const;

export type ButtonVariant = (typeof buttonVariants)[number];

export const controlSizes = ["compact", "sm", "md", "touch"] as const;

export type ControlSize = (typeof controlSizes)[number];

export const panelVariants = ["raised", "inset", "muted", "accent"] as const;

export type PanelVariant = (typeof panelVariants)[number];

export const dialogCloseActionSizes = ["compact", "touch"] as const;

export type DialogCloseActionSize = (typeof dialogCloseActionSizes)[number];

export const metricChipTones = ["neutral", "info", "success", "warning"] as const;

export type MetricChipTone = (typeof metricChipTones)[number];

export const statusPillTones = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
] as const;

export type StatusPillTone = (typeof statusPillTones)[number];
