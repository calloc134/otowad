import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import { Toolbar } from "@/components/Toolbar";
import { StatusBar } from "@/components/StatusBar";

interface DesktopAppShellProps {
  persistence: PersistenceAPI;
  projectDialogOpen: boolean;
  onProjectDialogOpen: () => void;
  onProjectDialogClose: () => void;
  children: ReactNode;
}

export function DesktopAppShell({
  persistence,
  projectDialogOpen,
  onProjectDialogOpen,
  onProjectDialogClose,
  children,
}: DesktopAppShellProps) {
  return (
    <div
      data-testid="desktop-app-shell"
      data-shell-variant="desktop"
      className={desktopRootClass}
    >
      <header data-testid="desktop-shell-header" className={desktopHeaderClass}>
        <Toolbar
          persistence={persistence}
          projectDialogOpen={projectDialogOpen}
          onProjectDialogOpen={onProjectDialogOpen}
          onProjectDialogClose={onProjectDialogClose}
        />
      </header>
      <main data-testid="desktop-shell-main" className={desktopMainClass}>{children}</main>
      <footer data-testid="desktop-shell-footer" className={desktopFooterClass}>
        <StatusBar />
      </footer>
    </div>
  );
}

const desktopRootClass = css({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background:
    "linear-gradient(180deg, rgba(15, 21, 42, 0.62), rgba(7, 11, 24, 0.78))",
});

const desktopHeaderClass = css({
  flexShrink: 0,
  borderBottom: "1px solid var(--border-default)",
});

const desktopMainClass = css({
  display: "flex",
  flex: 1,
  overflow: "hidden",
  minWidth: 0,
  minHeight: 0,
});

const desktopFooterClass = css({
  flexShrink: 0,
  borderTop: "1px solid var(--border-default)",
});
