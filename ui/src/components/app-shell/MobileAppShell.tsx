import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import { Toolbar } from "@/components/Toolbar";
import { StatusBar } from "@/components/StatusBar";

interface MobileAppShellProps {
  persistence: PersistenceAPI;
  projectDialogOpen: boolean;
  onProjectDialogOpen: () => void;
  onProjectDialogClose: () => void;
  children: ReactNode;
}

export function MobileAppShell({
  persistence,
  projectDialogOpen,
  onProjectDialogOpen,
  onProjectDialogClose,
  children,
}: MobileAppShellProps) {
  return (
    <div
      data-testid="mobile-app-shell"
      data-shell-variant="mobile"
      className={mobileRootClass}
    >
      <header data-testid="mobile-shell-header" className={mobileHeaderClass}>
        <Toolbar
          persistence={persistence}
          projectDialogOpen={projectDialogOpen}
          onProjectDialogOpen={onProjectDialogOpen}
          onProjectDialogClose={onProjectDialogClose}
        />
      </header>
      <div data-testid="mobile-shell-chrome" className={mobileChromeStackClass}>
        {/* Renders nothing unless there is something to act on, so an idle
            phone spends none of its height here. */}
        <StatusBar />
        <main data-testid="mobile-shell-workspace" className={mobileWorkspaceClass}>
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The insets keep the chrome out from under the notch and the rounded corners.
 * A landscape phone — the orientation this shell is built for — puts the notch
 * on one short edge, which is exactly where the toolbar's leftmost buttons and
 * the track panel sit, so left/right are the ones that matter here.
 *
 * A background paints underneath padding, so the gradient still reaches the
 * physical edge; only the controls move inward.
 *
 * Bottom is deliberately absent. The shell's bottom edge is the scrolling
 * timeline, which is allowed to run under the home indicator, and the two
 * things that do sit down there — the clip action bar and BottomSheet — are
 * `position: fixed`, so they escape this padding and carry their own inset.
 */
const mobileRootClass = css({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingLeft: "env(safe-area-inset-left, 0px)",
  paddingRight: "env(safe-area-inset-right, 0px)",
  background:
    "linear-gradient(180deg, rgba(15, 21, 42, 0.72), rgba(7, 11, 24, 0.82))",
});

const mobileHeaderClass = css({
  flexShrink: 0,
  borderBottom: "1px solid var(--border-default)",
});

const mobileChromeStackClass = css({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
});


const mobileWorkspaceClass = css({
  display: "flex",
  flex: 1,
  overflow: "hidden",
  minWidth: 0,
  minHeight: 0,
});
