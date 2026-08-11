import type { ReactNode } from "react";
import { css, cx } from "../../../styled-system/css";

interface ToolbarMobilePresenterProps {
  leftSection: ReactNode;
  centerSection: ReactNode | null;
  toolsToggleSection: ReactNode | null;
  rightSection: ReactNode | null;
  secondaryRow: ReactNode | null;
  toolsOpen: boolean;
}

/**
 * A phone in landscape has ~390px of height, and stacking every section cost
 * 209px of it before the ruler was even drawn. Only the transport earns
 * permanent space here.
 *
 * The tools panel floats over the workspace rather than pushing it down, so
 * opening it never changes the size of the timeline underneath.
 */
export function ToolbarMobilePresenter({
  leftSection,
  centerSection,
  toolsToggleSection,
  rightSection,
  secondaryRow,
  toolsOpen,
}: ToolbarMobilePresenterProps) {
  return (
    <div
      data-testid="toolbar-root"
      data-toolbar-variant="mobile"
      className={cx(toolbarMobileClass, toolbarMobileSurfaceClass)}
    >
      <div className={topRowClass}>
        <div className={transportSlotClass}>{centerSection}</div>
        <div className={toolsToggleSlotClass}>{toolsToggleSection}</div>
      </div>
      {toolsOpen && (
        <div data-testid="mobile-tools-disclosure" className={disclosureClass}>
          {/* Each section is a wrapping row of its own. Dropping the sections
              straight into a column put every control on its own full-width
              line, which is what filled the screen. */}
          <div className={disclosureRowClass}>{leftSection}</div>
          <div className={disclosureRowClass}>{rightSection}</div>
          {secondaryRow && <div className={disclosureRowClass}>{secondaryRow}</div>}
        </div>
      )}
    </div>
  );
}

const toolbarMobileClass = css({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "8px 10px",
  flexShrink: "0",
  minWidth: 0,
  zIndex: "20",
});

const toolbarMobileSurfaceClass = css({
  background: "var(--surface-shell)",
  borderBottom: "1px solid var(--border-default)",
  boxShadow:
    "0 18px 36px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
});

const topRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
});

/**
 * The transport scrolls rather than wrapping. Wrapping is what turned one row
 * into three, and a second row here costs more than a rare sideways scroll.
 *
 * `overflow-x: auto` alone never achieved that: `TransportSection` carries its
 * own `flex-wrap: wrap`, so at 390px it broke onto a second line instead of
 * growing past the slot, and a scroller whose content fits has nothing to
 * scroll. The row has to be told not to wrap for the overflow to reach here.
 *
 * Its `justify-content: center` has to go with it. Centering a row that is
 * wider than its scroller pushes the excess out of *both* ends, and overflow
 * past the start edge is not reachable by scrolling — at 390px that put the
 * BPM chip at x=-72 with `scrollLeft` already 0, on screen in neither
 * direction. Centering only reads as centering while the content fits.
 */
const transportSlotClass = css({
  display: "flex",
  flex: "1 1 auto",
  minWidth: 0,
  overflowX: "auto",
  overscrollBehaviorX: "contain",
  "& > *": {
    flexWrap: "nowrap",
    justifyContent: "flex-start",
  },
});

/**
 * This button is the only route to every control that is not the transport, so
 * it is the one thing in the row that must never be shrunk. It was: the row
 * needed 414px inside 370px, and flexbox took all 44px out of the toggle,
 * leaving the label cut off at the screen edge with nothing to scroll it into
 * view. The transport beside it is a scroller and can give up the space
 * instead.
 */
const toolsToggleSlotClass = css({
  display: "flex",
  flexShrink: 0,
});

const disclosureClass = css({
  position: "absolute",
  top: "100%",
  left: "0",
  right: "0",
  zIndex: "20",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "10px",
  minWidth: 0,
  maxHeight: "min(60vh, 320px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  // Written out rather than taken from `designTokens.surface.shell`: Panda
  // emits no rule for a `background` whose value is a bare `var()`, which is
  // why the toolbar surface has never actually painted one. A floating panel
  // has to be opaque, so this one cannot rely on that.
  background: "linear-gradient(180deg, rgba(19, 27, 54, 0.99), rgba(10, 14, 30, 0.99))",
  borderBottom: "1px solid var(--border-default)",
  boxShadow: "0 24px 48px rgba(0, 0, 0, 0.5)",
});

const disclosureRowClass = css({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "8px",
  minWidth: 0,
});
