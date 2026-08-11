export const MOBILE_AFFORDANCE_PRINCIPLES = [
  {
    id: "destructive-via-confirm-rail",
    summary: "Destructive actions route through an explicit bottom sheet or confirm rail.",
    preferredSurface: "bottom-sheet",
  },
  {
    id: "explicit-non-hover-actions",
    summary: "Rename, reorder, split, and warp stay available through explicit non-hover actions.",
    preferredSurface: "tool-rail",
  },
  {
    id: "no-modifier-dependency",
    summary: "Touch editing does not depend on modifier shortcuts for primary flows.",
    preferredSurface: "sticky-action-bar",
  },
  {
    id: "prefer-tool-and-action-rails",
    summary: "Touch surfaces prefer tool rails and action rails over implicit work-surface gestures.",
    preferredSurface: "tool-rail",
  },
] as const;

export type MobileAffordancePrinciple =
  (typeof MOBILE_AFFORDANCE_PRINCIPLES)[number];

export type MobileAffordancePrincipleId = MobileAffordancePrinciple["id"];
