import type { CSSProperties } from "react";
import { css, cx } from "../../../../styled-system/css";
import { LoaderCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/design-system/index.ts";

interface ProjectManagementListHeaderProps {
  usesTouchActions: boolean;
  isBusy: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}

export function ProjectManagementListHeader({
  usesTouchActions,
  isBusy,
  isLoading,
  onRefresh,
}: ProjectManagementListHeaderProps) {
  return (
    <div className={cx(listHeaderClass, listHeaderResponsiveClass)}>
      <div>
        <div className={listTitleClass}>Recently opened browser projects</div>
        <div className={listCaptionClass}>
          Double-click a title to rename. Imported files stay out of this list until the first browser save.
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        style={usesTouchActions ? REFRESH_BUTTON_TOUCH_STYLE : REFRESH_BUTTON_STYLE}
        onClick={onRefresh}
        disabled={isBusy || isLoading}
      >
        {isLoading ? <LoaderCircle size={14} className={spinIconClass} /> : <RefreshCcw size={14} />}
        <span>Refresh</span>
      </Button>
    </div>
  );
}

const listHeaderClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
});

const listHeaderResponsiveClass = css({
  "@media (max-width: 840px)": {
    flexDirection: "column",
    alignItems: "stretch",
  },
});

const listTitleClass = css({
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--text-primary)",
});

const listCaptionClass = css({
  marginTop: "4px",
  fontSize: "12px",
  color: "var(--text-dim)",
});

const spinIconClass = css({
  animation: "toolbar-spin 1s linear infinite",
});

// Inline CSSProperties for Button overrides (recipe classes vs css() class specificity).
const REFRESH_BUTTON_STYLE: CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-button)",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
  fontWeight: 700,
};

const REFRESH_BUTTON_TOUCH_STYLE: CSSProperties = {
  ...REFRESH_BUTTON_STYLE,
  height: 40,
  padding: "0 14px",
};
