import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toolbar } from "./Toolbar";
import { renderWithProject } from "@/test/renderWithProject";
import { setViewportSize } from "@/test/viewportSize";
import { createBaseTimelineProject } from "@/test/projectTestUtils";

const toolbarMocks = vi.hoisted(() => ({
  usePlaybackPrepareUiState: vi.fn(),
  useAudioEngine: vi.fn(),
  clearAudioEngineRuntimeCaches: vi.fn(),
  useExport: vi.fn(),
}));

vi.mock("@/hooks/useAudioEngine.ts", () => ({
  useAudioEngine: () => toolbarMocks.useAudioEngine(),
  usePlaybackPrepareUiState: () => toolbarMocks.usePlaybackPrepareUiState(),
  clearAudioEngineRuntimeCaches: () => toolbarMocks.clearAudioEngineRuntimeCaches(),
}));

vi.mock("@/hooks/useExport.ts", () => ({
  useExport: () => toolbarMocks.useExport(),
}));

describe("Toolbar integration", () => {
  beforeEach(() => {
    toolbarMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });
    toolbarMocks.useAudioEngine.mockReturnValue({
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isPlaying: false,
      loadMediaFile: vi.fn(),
      audioContext: null,
      engine: { init: vi.fn() },
    });
    toolbarMocks.useExport.mockReturnValue({
      exportWav: vi.fn().mockResolvedValue(undefined),
      exportAudioTrack: vi.fn().mockResolvedValue(undefined),
      exportMidiTrack: vi.fn().mockResolvedValue(undefined),
      isRendering: false,
      renderProgress: null,
    });
  });

  it("opens BPM and time signature dialogs through metric chips", async () => {
    const project = createBaseTimelineProject();
    const persistence = {
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

    renderWithProject(
      <Toolbar
        persistence={persistence}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      />,
      { project },
    );

    expect(screen.getByTestId("toolbar-root")).toHaveAttribute("data-toolbar-variant", "desktop");
    fireEvent.click(screen.getByText(/120\.0 BPM/));
    expect(await screen.findByText("Change mode")).toBeInTheDocument();

    fireEvent.click(screen.getByText("4/4"));
    expect(await screen.findByText("Signature")).toBeInTheDocument();
  });

  it("separates primary production controls from secondary tools and folds project actions into a menu", () => {
    setViewportSize(1280, 800);
    const project = createBaseTimelineProject();
    const persistence = {
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

    renderWithProject(
      <Toolbar
        persistence={persistence}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      />,
      { project },
    );

    const primary = screen.getByTestId("toolbar-primary-row");
    const secondary = screen.getByTestId("toolbar-secondary-row");

    expect(within(primary).getByRole("button", { name: "Project menu" })).toBeInTheDocument();
    expect(within(primary).getByText(project.meta.name)).toBeInTheDocument();
    expect(within(primary).getByRole("button", { name: "Start playback" })).toBeInTheDocument();
    expect(within(primary).getByTitle("Export project as WAV")).toBeInTheDocument();
    expect(within(primary).queryByText("Undo")).not.toBeInTheDocument();

    expect(within(secondary).getByTitle("Undo")).toBeInTheDocument();
    expect(within(secondary).getByText("Grid On")).toBeInTheDocument();
    expect(within(secondary).getByLabelText("Snap range")).toBeInTheDocument();
    expect(within(secondary).getByText("Pitch")).toBeInTheDocument();

    expect(screen.queryByText("New Project")).not.toBeInTheDocument();
    fireEvent.click(within(primary).getByRole("button", { name: "Project menu" }));
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("Save Project")).toBeInTheDocument();
    expect(screen.getByText("Project Manager")).toBeInTheDocument();
  });

  it("keeps Loop out of the narrow Touch transport row and exposes it through More Tools", async () => {
    setViewportSize(375, 812);
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

    const project = createBaseTimelineProject();
    const persistence = {
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

    renderWithProject(
      <Toolbar
        persistence={persistence}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      />,
      { project },
    );

    expect(screen.getByTestId("toolbar-root")).toHaveAttribute("data-toolbar-variant", "mobile");
    expect(screen.queryByText("Loop")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("More Tools"));
    expect(screen.getByText("Hide Tools")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("mobile-tools-disclosure")).getByText("Loop"),
    ).toBeInTheDocument();
  });

  it("marks glow-bearing toolbar controls with their active state", () => {
    setViewportSize(1280, 800);
    const project = createBaseTimelineProject();
    const persistence = {
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

    const { unmount } = renderWithProject(
      <Toolbar
        persistence={persistence}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      />,
      { project },
    );

    expect(screen.getByText("Grid On").closest("button")).toHaveAttribute(
      "data-glow-state",
      "selected",
    );
    expect(screen.getByRole("button", { name: "Start playback" })).not.toHaveAttribute(
      "data-glow-state",
    );
    expect(screen.getByTitle("Export project as WAV").style.boxShadow).not.toContain("glow");
    expect(screen.getByTestId("playhead-readout").parentElement).not.toHaveAttribute(
      "data-glow-state",
    );

    unmount();
    toolbarMocks.useAudioEngine.mockReturnValue({
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isPlaying: true,
      loadMediaFile: vi.fn(),
      audioContext: null,
      engine: { init: vi.fn() },
    });

    renderWithProject(
      <Toolbar
        persistence={persistence}
        projectDialogOpen={false}
        onProjectDialogOpen={vi.fn()}
        onProjectDialogClose={vi.fn()}
      />,
      { project },
    );

    expect(screen.getByRole("button", { name: "Pause playback" })).toHaveAttribute(
      "data-glow-state",
      "playing",
    );
    expect(screen.getByTestId("playhead-readout").parentElement).toHaveAttribute(
      "data-glow-state",
      "playing",
    );
  });
});
