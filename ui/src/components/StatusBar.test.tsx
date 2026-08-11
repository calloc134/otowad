import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "./StatusBar";

const relinkMocks = vi.hoisted(() => ({
  unavailableMedia: [] as Array<{ mediaId: string; status: "missing" | "invalid"; message: string | null }>,
  relinkNextUnavailableMedia: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/hooks/useMediaRelink.ts", () => ({
  useMediaRelink: () => relinkMocks,
}));
import { renderWithProject } from "@/test/renderWithProject";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { setPhoneViewport } from "@/test/viewportSize";
import { ProjectProvider, useProjectActions } from "@/store";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

const statusMocks = vi.hoisted(() => ({
  usePlaybackPrepareUiState: vi.fn(),
}));

vi.mock("@/hooks/useAudioEngine.ts", () => ({
  usePlaybackPrepareUiState: () => statusMocks.usePlaybackPrepareUiState(),
}));

describe("StatusBar integration", () => {
  beforeEach(() => {
    relinkMocks.unavailableMedia = [];
    relinkMocks.relinkNextUnavailableMedia.mockReset();
    relinkMocks.relinkNextUnavailableMedia.mockResolvedValue(false);
  });

  it("keeps the status bar contextual instead of repeating toolbar metrics", () => {
    const project = createBaseTimelineProject();
    project.edit.pitch_links.push({
      id: crypto.randomUUID(),
      midi_track: project.edit.tracks[1]!.id,
      audio_track: project.edit.tracks[0]!.id,
      no_note_behavior: "KeepOriginal",
      no_pitch_behavior: "Bypass",
      priority: "Highest",
    });
    statusMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });

    renderWithProject(<StatusBar />, { project });

    expect(screen.getByTestId("status-bar-root")).toHaveAttribute(
      "data-status-bar-variant",
      "desktop",
    );
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText(/120\.0 BPM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grid:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Zoom:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PL:/)).not.toBeInTheDocument();
  });

  it("shows the Time/Pitch mode editor for the primary audio clip and applies changes", () => {
    const project = createBaseTimelineProject();
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    if (!audioClip) {
      throw new Error("expected audio clip");
    }
    if (audioClip.kind.clip_type !== "audio") {
      throw new Error("expected audio clip kind");
    }
    audioClip.kind.audio.pitch.manual_coarse_semitones = 7;
    audioClip.kind.audio.pitch.manual_fine_cents = -23;
    audioClip.gain_milli_db = -2_100;
    const audioClipId = audioClip.id;
    statusMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });

    function Harness() {
      const actions = useProjectActions();
      useEffect(() => {
        actions.initWasm();
        actions.setProject(project);
        actions.setClipSelection([audioClipId], audioClipId);
      }, [actions, project]);
      return <StatusBar />;
    }

    render(
      <ProjectProvider>
        <Harness />
      </ProjectProvider>,
    );

    const select = screen.getByLabelText("Time/Pitch Mode") as HTMLSelectElement;
    expect(select.value).toBe("Local");
    expect(screen.getByText("voice.wav")).toBeInTheDocument();
    expect(screen.getByText("Pitch +7")).toBeInTheDocument();
    expect(screen.getByText("Fine -23c")).toBeInTheDocument();
    expect(screen.getByText("Gain -2.1 dB")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "Music" } });

    return waitFor(() => {
      expect((screen.getByLabelText("Time/Pitch Mode") as HTMLSelectElement).value).toBe(
        "Music",
      );
    });
  });

  it("uses the mobile status presenter on a phone", () => {
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

    const project = createBaseTimelineProject();
    statusMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });

    const { unmount } = renderWithProject(<StatusBar />, { project });

    // Nothing to act on: the bar takes none of the phone's height.
    expect(screen.queryByTestId("status-bar-root")).not.toBeInTheDocument();
    unmount();

    const media = project.edit.media[0];
    if (!media) {
      throw new Error("expected audio media");
    }
    relinkMocks.unavailableMedia = [{ mediaId: media.id, status: "missing", message: null }];

    renderWithProject(<StatusBar />, { project });

    expect(screen.getByTestId("status-bar-root")).toHaveAttribute(
      "data-status-bar-variant",
      "mobile",
    );
    expect(screen.getByText(new RegExp(`Missing media: ${media.original_name}`))).toBeInTheDocument();
  });

  it("exposes an explicit relink action for referenced missing media", () => {
    const project = createBaseTimelineProject();
    const media = project.edit.media[0];
    if (!media) {
      throw new Error("expected audio media");
    }
    relinkMocks.unavailableMedia = [{ mediaId: media.id, status: "missing", message: null }];
    statusMocks.usePlaybackPrepareUiState.mockReturnValue({
      active: false,
      overlayVisible: false,
      title: "Preparing playback",
      detail: "",
      progress: null,
    });

    renderWithProject(<StatusBar />, { project });

    expect(screen.getByText(new RegExp(`Missing media: ${media.original_name}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relink" }));
    expect(relinkMocks.relinkNextUnavailableMedia).toHaveBeenCalledTimes(1);
  });
});
