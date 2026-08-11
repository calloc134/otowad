import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App, AUTOSAVE_RESTORE_CONFIRM_MESSAGE } from "./App";
import { setPhoneViewport } from "@/test/viewportSize";

function setMatchMedia(matchesByQuery: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: matchesByQuery[query] ?? false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const appMocks = vi.hoisted(() => ({
  loadAutoSave: vi.fn<() => Promise<string | null>>(),
  clearAutoSave: vi.fn<() => Promise<void>>(),
  quarantineAutoSave: vi.fn<() => Promise<void>>(),
  clearAudioEngineRuntimeCaches: vi.fn<() => void>(),
  usePlaybackPrepareUiState: vi.fn(),
  useAudioEngine: vi.fn(),
  usePersistence: vi.fn(),
  useExport: vi.fn(),
  init: vi.fn<() => Promise<void>>(),
  loadProject: vi.fn((json: string) => json),
}));

vi.mock("./wasm/otomad_core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wasm/otomad_core")>();
  return {
    ...actual,
    default: appMocks.init,
    load_project: appMocks.loadProject,
    create_project: vi.fn(() => JSON.stringify({
      schema_version: 4,
      meta: {
        name: "Untitled Project",
        created_at: "",
        app_version: "test",
        project_sample_rate: 44_100,
        ppq: 960,
      },
      edit: {
        tempo: {
          ppq: 960,
          points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
        },
        grid: {
          snap_enabled: true,
          division: "Beat",
          swing_permille: 0,
          magnet_range_permille: 250,
          snap_strength_permille: 1000,
        },
        tracks: [],
        media: [],
        contents: [],
        clips: [],
        routing: { schema_hint: null },
        automation: [],
        pitch_links: [],
      },
    })),
  };
});

vi.mock("@/persist/index.ts", () => ({
  loadAutoSave: () => appMocks.loadAutoSave(),
  clearAutoSave: () => appMocks.clearAutoSave(),
  quarantineAutoSave: () => appMocks.quarantineAutoSave(),
}));

vi.mock("@/hooks/useAudioEngine.ts", () => ({
  useAudioEngine: () => appMocks.useAudioEngine(),
  usePlaybackPrepareUiState: () => appMocks.usePlaybackPrepareUiState(),
  clearAudioEngineRuntimeCaches: () => appMocks.clearAudioEngineRuntimeCaches(),
}));

vi.mock("@/hooks/usePersistence.ts", () => ({
  usePersistence: () => appMocks.usePersistence(),
}));

vi.mock("@/hooks/useExport.ts", () => ({
  useExport: () => appMocks.useExport(),
}));

describe("App integration", () => {
  beforeEach(() => {
    setMatchMedia({ "(pointer: coarse)": false, "(hover: hover)": true });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 720 });
    appMocks.init.mockResolvedValue(undefined);
    appMocks.loadAutoSave.mockResolvedValue(null);
    appMocks.clearAutoSave.mockResolvedValue(undefined);
    appMocks.quarantineAutoSave.mockResolvedValue(undefined);
    appMocks.clearAudioEngineRuntimeCaches.mockReset();
    appMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });
    appMocks.useAudioEngine.mockReturnValue({
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isPlaying: false,
      loadMediaFile: vi.fn(),
      audioContext: null,
      engine: { init: vi.fn() },
    });
    appMocks.usePersistence.mockReturnValue({
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
    });
    appMocks.useExport.mockReturnValue({
      exportWav: vi.fn().mockResolvedValue(undefined),
      exportAudioTrack: vi.fn().mockResolvedValue(undefined),
      exportMidiTrack: vi.fn().mockResolvedValue(undefined),
      isRendering: false,
      renderProgress: null,
    });
    appMocks.loadProject.mockClear();
    appMocks.loadProject.mockImplementation((json: string) => json);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("restores autosaved projects when the user confirms recovery", async () => {
    appMocks.loadAutoSave.mockResolvedValueOnce(JSON.stringify({
      schema_version: 4,
      meta: {
        name: "Recovered Session",
        created_at: "",
        app_version: "test",
        project_sample_rate: 44_100,
        ppq: 960,
      },
      edit: {
        tempo: {
          ppq: 960,
          points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
        },
        grid: {
          snap_enabled: true,
          division: "Beat",
          swing_permille: 0,
          magnet_range_permille: 250,
          snap_strength_permille: 1000,
        },
        tracks: [],
        media: [],
        contents: [],
        clips: [],
        routing: { schema_hint: null },
        automation: [],
        pitch_links: [],
      },
    }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Recovered Session")).toBeInTheDocument();
    });
    expect(window.confirm).toHaveBeenCalledWith(AUTOSAVE_RESTORE_CONFIRM_MESSAGE);
    expect(appMocks.clearAudioEngineRuntimeCaches).toHaveBeenCalledTimes(1);
  });

  it("quarantines schema v3 autosave snapshots instead of deleting them", async () => {
    const previousProject = {
      schema_version: 3,
      meta: {
        name: "Recovered Legacy Audio",
        created_at: "",
        app_version: "test",
        project_sample_rate: 44_100,
        ppq: 960,
      },
      edit: {
        tempo: {
          ppq: 960,
          points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
        },
        grid: {
          snap_enabled: true,
          division: "Beat",
          swing_permille: 0,
          magnet_range_permille: 250,
          snap_strength_permille: 1000,
        },
        tracks: [{
          id: "track-a",
          name: "Audio",
          kind: { track_type: "audio" },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        }],
        media: [{
          id: "media-a",
          in_zip_path: "media/media-a.wav",
          channels: 1,
          src_sample_rate: 44_100,
          length_src_frames: 44_100,
          hash: null,
          original_name: "voice.wav",
        }],
        contents: [{
          type: "audio",
          id: "content-a",
          media_id: "media-a",
          analysis_refs: [],
        }],
        clips: [{
          id: "clip-a",
          track_id: "track-a",
          start: 0,
          length: 960,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "audio",
            content_id: "content-a",
            audio: {
              src_in: 0,
              src_out: 44_100,
              warp: { warp_type: "none" },
              pitch: {
                mode: "ManualOnly",
                manual_coarse_semitones: 0,
                manual_fine_cents: 0,
              },
              fades: { fade_in: 0, fade_out: 0 },
              time_pitch_algorithm: {
                algorithm: "LegacyTdPsola",
                preserve_formant: false,
              },
            },
          },
        }],
        routing: { schema_hint: null },
        automation: [],
        pitch_links: [],
      },
    };

    appMocks.loadProject.mockImplementationOnce(() => {
      throw new Error("unsupported schema_version: 3");
    });
    appMocks.loadAutoSave.mockResolvedValueOnce(JSON.stringify(previousProject));

    render(<App />);

    await waitFor(() => {
      expect(appMocks.quarantineAutoSave).toHaveBeenCalledTimes(1);
    });
    expect(appMocks.clearAutoSave).not.toHaveBeenCalled();
    expect(appMocks.loadProject).toHaveBeenCalledWith(JSON.stringify(previousProject));
    expect(screen.queryByText("Recovered Legacy Audio")).not.toBeInTheDocument();
    expect(screen.getByText("Untitled Project")).toBeInTheDocument();
  });

  it("quarantines a valid autosave snapshot when recovery is declined", async () => {
    appMocks.loadAutoSave.mockResolvedValueOnce("{\"schema_version\":4}");
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    render(<App />);

    await waitFor(() => {
      expect(appMocks.quarantineAutoSave).toHaveBeenCalledTimes(1);
    });
    expect(appMocks.clearAutoSave).not.toHaveBeenCalled();
    expect(appMocks.loadProject).not.toHaveBeenCalled();
    expect(screen.getByText("Untitled Project")).toBeInTheDocument();
  });

  it("opens the project manager with Ctrl+O and respects busy playback guards for Space", async () => {
    const refreshBrowserProjects = vi.fn().mockResolvedValue(undefined);
    const persistence = {
      createNewProject: vi.fn(),
      save: vi.fn().mockResolvedValue(true),
      importProjectFile: vi.fn().mockResolvedValue(true),
      openBrowserProject: vi.fn().mockResolvedValue(true),
      renameBrowserProject: vi.fn().mockResolvedValue(true),
      deleteBrowserProject: vi.fn().mockResolvedValue(true),
      downloadProjectArchive: vi.fn().mockResolvedValue(true),
      refreshBrowserProjects,
      browserProjects: [],
      currentBrowserProject: null,
      isLoadingBrowserProjects: false,
      hasUnsavedChanges: false,
    };
    appMocks.usePersistence.mockReturnValue({
      ...persistence,
    });
    appMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "Compiling pitch plan",
      progress: 0.5,
    });
    appMocks.useAudioEngine.mockReturnValue({
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isPlaying: false,
      loadMediaFile: vi.fn(),
      audioContext: null,
      engine: { init: vi.fn() },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });
    refreshBrowserProjects.mockClear();

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => {
      expect(refreshBrowserProjects).toHaveBeenCalled();
    });
    expect(await screen.findByText("Project Management")).toBeInTheDocument();
  });

  it("suppresses Space playback while playback preparation is active", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    appMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: true,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "Compiling pitch plan",
      progress: 0.5,
    });
    appMocks.useAudioEngine.mockReturnValue({
      play,
      stop: vi.fn(),
      isPlaying: false,
      loadMediaFile: vi.fn(),
      audioContext: null,
      engine: { init: vi.fn() },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: " " });
    expect(play).not.toHaveBeenCalled();
  });

  it("prevents bare Alt from propagating to browser menu handling", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });

    const altDown = new KeyboardEvent("keydown", {
      key: "Alt",
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(altDown);
    expect(altDown.defaultPrevented).toBe(true);

    const altUp = new KeyboardEvent("keyup", {
      key: "Alt",
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(altUp);
    expect(altUp.defaultPrevented).toBe(true);
  });

  it("renders the busy overlay while playback preparation is visible", async () => {
    appMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: true,
      overlayVisible: true,
      title: "Preparing playback",
      detail: "Compiling pitch plan",
      progress: 0.5,
    });

    render(<App />);

    expect(await screen.findByText("Preparing playback")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  function renderPhoneInPortrait() {
    setMatchMedia({ "(pointer: coarse)": true, "(hover: hover)": false });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 3,
    });
    // 820x1180 is a tablet in portrait, which has room to edit and is no
    // longer sent to the rotate overlay.
    setPhoneViewport("portrait");
    return render(<App />);
  }

  it("shows portrait guidance on a phone held upright, over an inert app", async () => {
    renderPhoneInPortrait();

    expect(await screen.findByText("Rotate to landscape")).toBeInTheDocument();
    const shell = screen.getByTestId("mobile-app-shell");
    expect(shell).toBeInTheDocument();
    // Dimming the shell is not enough on its own: without `inert` every
    // control behind the notice stays reachable by keyboard.
    expect(shell.closest("[inert]")).not.toBeNull();
  });

  it("lets a phone kept in portrait past the notice and back to the app", async () => {
    renderPhoneInPortrait();

    const dismiss = await screen.findByRole("button", {
      name: "Continue in portrait",
    });
    // Rotation lock is common, so rotating is not always a choice the user
    // has; without this the whole app is unreachable.
    fireEvent.click(dismiss);

    await waitFor(() => {
      expect(screen.queryByTestId("portrait-notice")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("mobile-app-shell").closest("[inert]")).toBeNull();
  });

  it("renders the desktop shell on desktop-like devices", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });

    expect(screen.getByTestId("desktop-app-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-app-shell")).not.toBeInTheDocument();
  });

  it("renders the mobile shell on a phone", async () => {
    setMatchMedia({ "(pointer: coarse)": true, "(hover: hover)": false });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 2,
    });
    setPhoneViewport();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("mobile-app-shell")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("desktop-app-shell")).not.toBeInTheDocument();

    // The transport is the only thing that keeps permanent height; the project
    // name and its actions are one tap away behind the tools disclosure.
    expect(screen.queryByText("Untitled Project")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More Tools"));
    expect(await screen.findByText("Untitled Project")).toBeInTheDocument();
  });

  it("does not trigger desktop modifier hotkeys on touch-like devices", async () => {
    const refreshBrowserProjects = vi.fn().mockResolvedValue(undefined);
    const persistence = {
      createNewProject: vi.fn(),
      save: vi.fn().mockResolvedValue(true),
      importProjectFile: vi.fn().mockResolvedValue(true),
      openBrowserProject: vi.fn().mockResolvedValue(true),
      renameBrowserProject: vi.fn().mockResolvedValue(true),
      deleteBrowserProject: vi.fn().mockResolvedValue(true),
      downloadProjectArchive: vi.fn().mockResolvedValue(true),
      refreshBrowserProjects,
      browserProjects: [],
      currentBrowserProject: null,
      isLoadingBrowserProjects: false,
      hasUnsavedChanges: false,
    };
    setMatchMedia({ "(pointer: coarse)": true, "(hover: hover)": false });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 2,
    });
    appMocks.usePersistence.mockReturnValue(persistence);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });
    refreshBrowserProjects.mockClear();

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(refreshBrowserProjects).not.toHaveBeenCalled();
  });

  it("restores autosaved projects with existing clips before duplicate hotkeys run", async () => {
    const project = {
      schema_version: 4,
      meta: {
        name: "Hotkey Project",
        created_at: "",
        app_version: "test",
        project_sample_rate: 44_100,
        ppq: 960,
      },
      edit: {
        tempo: {
          ppq: 960,
          points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
        },
        grid: {
          snap_enabled: true,
          division: "Beat",
          swing_permille: 0,
          magnet_range_permille: 250,
          snap_strength_permille: 1000,
        },
        tracks: [{
          id: "00000000-0000-0000-0000-000000000001",
          name: "Audio Track",
          kind: { track_type: "audio" },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        }],
        media: [{
          id: "00000000-0000-0000-0000-000000000002",
          in_zip_path: "media/00000000-0000-0000-0000-000000000002.wav",
          channels: 1,
          src_sample_rate: 44_100,
          length_src_frames: 44_100,
          hash: null,
          original_name: "voice.wav",
        }],
        contents: [{
          type: "audio",
          id: "00000000-0000-0000-0000-000000000003",
          media_id: "00000000-0000-0000-0000-000000000002",
          analysis_refs: [],
        }],
        clips: [{
          id: "00000000-0000-0000-0000-000000000004",
          track_id: "00000000-0000-0000-0000-000000000001",
          start: 960,
          length: 960,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
          kind: {
            clip_type: "audio",
            content_id: "00000000-0000-0000-0000-000000000003",
            audio: {
              src_in: 0,
              src_out: 44_100,
              warp: { warp_type: "none" },
              pitch: {
                mode: "ManualOnly",
                manual_coarse_semitones: 0,
                manual_fine_cents: 0,
              },
              fades: { fade_in: 0, fade_out: 0 },
              time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
            },
          },
        }],
        routing: { schema_hint: null },
        automation: [],
        pitch_links: [],
      },
    };

    appMocks.loadAutoSave.mockResolvedValueOnce(JSON.stringify(project));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Hotkey Project")).toBeInTheDocument();
    });

    const audioClipElement = await screen.findByTestId("clip-00000000-0000-0000-0000-000000000004");
    fireEvent.click(audioClipElement, { clientX: 20, clientY: 20 });

    await waitFor(() => {
      expect(audioClipElement).toHaveAttribute("data-selected", "true");
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });

    expect(document.querySelectorAll("[data-clip-root='true']")).toHaveLength(2);
  });
});
