import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DesktopAppShell } from "./DesktopAppShell";
import { MobileAppShell } from "./MobileAppShell";
import { renderWithProject } from "@/test/renderWithProject";
import { setPhoneViewport } from "@/test/viewportSize";
import { createBaseTimelineProject } from "@/test/projectTestUtils";

function createPersistenceMock() {
  return {
    createNewProject: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    importProjectFile: vi.fn().mockResolvedValue(true),
    openBrowserProject: vi.fn().mockResolvedValue(true),
    renameBrowserProject: vi.fn().mockResolvedValue(true),
    deleteBrowserProject: vi.fn().mockResolvedValue(true),
    downloadProjectArchive: vi.fn().mockResolvedValue(true),
    refreshBrowserProjects: vi.fn().mockResolvedValue(undefined),
    browserProjects: [],
    currentBrowserProject: null,
    isLoadingBrowserProjects: false,
    hasUnsavedChanges: false,
  };
}

describe("App shell composition", () => {
  it("keeps desktop status at the footer outside the workspace", () => {
    renderWithProject(
      <DesktopAppShell
        persistence={createPersistenceMock()}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      >
        <div data-testid="desktop-child">desktop child</div>
      </DesktopAppShell>,
      { project: createBaseTimelineProject() },
    );

    expect(screen.getByTestId("desktop-shell-main")).toContainElement(
      screen.getByTestId("desktop-child"),
    );
    expect(screen.getByTestId("desktop-shell-footer")).toContainElement(
      screen.getByTestId("status-bar-root"),
    );
  });

  it("puts the mobile status alert above the workspace", () => {
    setPhoneViewport();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)",
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
      value: 2,
    });

    renderWithProject(
      <MobileAppShell
        persistence={createPersistenceMock()}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      >
        <div data-testid="mobile-child">mobile child</div>
      </MobileAppShell>,
      { project: createBaseTimelineProject() },
    );

    expect(screen.getByTestId("mobile-shell-workspace")).toContainElement(
      screen.getByTestId("mobile-child"),
    );
    // This fixture references media the test environment cannot resolve, so
    // the alert strip is showing; it sits in the chrome, not the workspace.
    const alert = screen.getByTestId("status-bar-root");
    expect(alert).toHaveAttribute("data-status-bar-variant", "mobile");
    expect(screen.getByTestId("mobile-shell-workspace")).not.toContainElement(alert);
  });
});
