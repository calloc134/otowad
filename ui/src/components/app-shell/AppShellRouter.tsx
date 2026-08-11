import type { ReactNode } from "react";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import { useShellVariantValue } from "@/app/interactionMode.tsx";
import { DesktopAppShell } from "./DesktopAppShell";
import { MobileAppShell } from "./MobileAppShell";

interface AppShellRouterProps {
  persistence: PersistenceAPI;
  projectDialogOpen: boolean;
  onProjectDialogOpen: () => void;
  onProjectDialogClose: () => void;
  children: ReactNode;
}

export function AppShellRouter(props: AppShellRouterProps) {
  const Shell = useShellVariantValue({
    desktop: DesktopAppShell,
    mobile: MobileAppShell,
  });

  return <Shell {...props} />;
}
