import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectManagementDialog } from "./ProjectManagementDialog";

function setTouchLikeMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)" || query === "(hover: hover)" ? query === "(pointer: coarse)" : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 3,
  });
}

describe("ProjectManagementDialog integration", () => {
  it("exposes explicit rename action on touch-like devices", async () => {
    setTouchLikeMatchMedia();
    const onRenameProject = vi.fn().mockResolvedValue(true);

    render(
      <ProjectManagementDialog
        open
        onClose={() => {}}
        browserProjects={[{
          id: "project-a",
          name: "Session A",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastOpenedAt: new Date(0).toISOString(),
          archiveByteLength: 2048,
        }]}
        currentProjectId={null}
        hasUnsavedChanges={false}
        isBusy={false}
        isLoading={false}
        onNewProject={() => {}}
        onSave={async () => true}
        onOpenProject={async () => {}}
        onImportProject={async () => {}}
        onDownloadProject={async () => {}}
        onRefresh={async () => {}}
        onRenameProject={onRenameProject}
        onDeleteProject={async () => true}
      />,
    );

    fireEvent.click(await screen.findByTestId("project-rename-project-a"));
    const input = screen.getByDisplayValue("Session A");
    fireEvent.change(input, { target: { value: "Renamed Session" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onRenameProject).toHaveBeenCalledWith("project-a", "Renamed Session");
    });
  });
});
