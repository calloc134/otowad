import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrackList } from "./TrackList";
import { DEFAULT_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from "./editorGeometry.ts";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { renderWithProject } from "@/test/renderWithProject";
import { setPhoneViewport } from "@/test/viewportSize";
import { useSelectionState, useViewportState } from "@/store";
import { DEFAULT_ZOOM_X } from "@/state/zoomLimits.ts";

const importAudioFile = vi.fn();
const importMidiFile = vi.fn();
const exportAudioTrack = vi.fn();
const exportMidiTrack = vi.fn();

vi.mock("@/hooks/useFileImport.ts", () => ({
  useFileImport: () => ({
    importAudioFile,
    importMidiFile,
  }),
}));

vi.mock("@/hooks/useExport.ts", () => ({
  useExport: () => ({
    exportAudioTrack,
    exportMidiTrack,
  }),
}));

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

function setDesktopLikeMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(hover: hover)",
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
    value: 0,
  });
}

function TrackListSelectionProbe() {
  const selectionState = useSelectionState();
  const viewportState = useViewportState();
  return (
    <div
      data-testid="track-list-selection-probe"
      data-selected-track={selectionState.selectedTrackId ?? ""}
      data-scroll-x={viewportState.scrollX}
      data-scroll-y={viewportState.scrollY}
      data-zoom-x={viewportState.zoom.x}
    />
  );
}

describe("TrackList integration", () => {
  it("adds audio and MIDI tracks through the shared header primitives", async () => {
    const project = createBaseTimelineProject();
    const { container } = renderWithProject(<TrackList />, { project });

    expect(container.querySelectorAll("[data-track-header-root='true']")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("track-add-audio"));
    fireEvent.click(screen.getByTestId("track-add-midi"));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-track-header-root='true']")).toHaveLength(4);
    });
  });

  it("opens the track create dialog when the empty list area is double-clicked", async () => {
    const project = createBaseTimelineProject();
    renderWithProject(<TrackList />, { project });

    const list = await screen.findByTestId("track-list-scroll");
    fireEvent.doubleClick(list);

    expect(await screen.findByText("Create Track")).toBeInTheDocument();
    expect(screen.getByLabelText("Create audio track")).toBeInTheDocument();
    expect(screen.getByLabelText("Create MIDI track")).toBeInTheDocument();
  });

  it("shows explicit touch rename and reorder affordances on touch-like devices", async () => {
    setTouchLikeMatchMedia();
    const project = createBaseTimelineProject();
    const firstTrack = project.edit.tracks[0];
    const secondTrack = project.edit.tracks[1];
    expect(firstTrack).toBeDefined();
    expect(secondTrack).toBeDefined();

    renderWithProject(<TrackList />, {
      project,
      selectedTrackId: firstTrack!.id,
    });

    const renameButton = await screen.findByTestId(`track-rename-${firstTrack!.id}`);
    fireEvent.click(renameButton);
    expect(screen.getByLabelText("Track name")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`track-move-down-${firstTrack!.id}`));

    await waitFor(() => {
      expect(screen.getByText(secondTrack!.name)).toBeInTheDocument();
    });
  });


  it("moves the actions a phone row cannot hold into a sheet", async () => {
    setTouchLikeMatchMedia();
    setPhoneViewport();
    const project = createBaseTimelineProject();
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    expect(audioTrack).toBeDefined();

    renderWithProject(<TrackList />, { project, selectedTrackId: audioTrack!.id });

    // Mute and solo stay in the row; import, export and delete do not fit.
    const row = await screen.findByTestId(`track-header-${audioTrack!.id}`);
    expect(within(row).getByLabelText("Mute")).toBeInTheDocument();
    expect(within(row).getByLabelText("Solo")).toBeInTheDocument();
    expect(within(row).queryByLabelText("Delete track")).not.toBeInTheDocument();
    expect(screen.queryByTestId("track-action-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`track-actions-${audioTrack!.id}`));

    const sheet = await screen.findByTestId("track-action-sheet");
    expect(within(sheet).getByText("Delete track")).toBeInTheDocument();
    expect(within(sheet).getByText("Rename")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByText("Export WAV"));

    await waitFor(() => {
      expect(exportAudioTrack).toHaveBeenCalledWith(audioTrack!.id);
    });
    expect(screen.queryByTestId("track-action-sheet")).not.toBeInTheDocument();
  });

  it("syncs scroll state through the track list pane", async () => {
    const project = createBaseTimelineProject();
    renderWithProject(
      <>
        <TrackList />
        <TrackListSelectionProbe />
      </>,
      {
      project,
      },
    );

    const list = await screen.findByTestId("track-list-scroll");
    const probe = screen.getByTestId("track-list-selection-probe");
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    list.scrollTop = 48;
    fireEvent.scroll(list);

    await waitFor(() => {
      expect((list as HTMLDivElement).scrollTop).toBe(48);
      expect(probe).toHaveAttribute("data-scroll-y", "48");
    });
  });

  it("contains overscroll on the shared track-list wheel surface", async () => {
    const project = createBaseTimelineProject();
    renderWithProject(
      <>
        <TrackList />
        <TrackListSelectionProbe />
      </>,
      { project },
    );
    const surface = await screen.findByTestId("track-list-surface");
    const list = screen.getByTestId("track-list-scroll");

    expect(surface).toHaveStyle({ overscrollBehavior: "none" });
    expect(list).toHaveStyle({ overscrollBehavior: "none" });
  });

  it("updates track gain and pan through the inline mixer controls", async () => {
    // The dense default hides mix controls; vertical zoom restores them.
    setDesktopLikeMatchMedia();
    const project = createBaseTimelineProject();
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    expect(audioTrack).toBeDefined();

    renderWithProject(<TrackList />, {
      project,
      selectedTrackId: audioTrack!.id,
      zoom: { x: DEFAULT_ZOOM_X, y: MAX_TRACK_HEIGHT },
    });

    const gain = await screen.findByTestId(`track-gain-${audioTrack!.id}`);
    const pan = await screen.findByTestId(`track-pan-${audioTrack!.id}`);

    fireEvent.change(gain, { target: { value: "-6000" } });
    fireEvent.change(pan, { target: { value: "500" } });

    await waitFor(() => {
      expect((gain as HTMLInputElement).value).toBe("-6000");
      expect((pan as HTMLInputElement).value).toBe("500");
    });
  });

  it("warns before deleting a track that still contains items", async () => {
    const project = createBaseTimelineProject();
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    expect(audioTrack).toBeDefined();

    renderWithProject(<TrackList />, { project, selectedTrackId: audioTrack!.id });

    const trackHeader = screen.getByTestId(`track-header-${audioTrack!.id}`);
    fireEvent.click(trackHeader);
    fireEvent.click(within(trackHeader).getByLabelText("Delete track"));

    expect(await screen.findByText(/still contains 1 item/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Track" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText(/still contains 1 item/i)).not.toBeInTheDocument();
      expect(screen.getByTestId(`track-header-${audioTrack!.id}`)).toBeInTheDocument();
    });
  });

  it("reorders tracks through the pointer-based drag handle", async () => {
    setDesktopLikeMatchMedia();
    const project = createBaseTimelineProject();
    const firstTrack = project.edit.tracks[0];
    const secondTrack = project.edit.tracks[1];
    expect(firstTrack).toBeDefined();
    expect(secondTrack).toBeDefined();

    const { container } = renderWithProject(<TrackList />, { project });

    const list = await screen.findByTestId("track-list-scroll");
    Object.defineProperty(list, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 196, height: 400, right: 196, bottom: 400 }),
    });

    const dragHandle = within(screen.getByTestId(`track-header-${firstTrack!.id}`)).getByLabelText(
      "Drag to reorder track",
    ) as HTMLButtonElement & {
      setPointerCapture?: (pointerId: number) => void;
      releasePointerCapture?: (pointerId: number) => void;
    };
    dragHandle.setPointerCapture = vi.fn();
    dragHandle.releasePointerCapture = vi.fn();

    // Expressed in rows rather than raw pixels: the drop slot is derived from
    // the current track height, which the vertical zoom can change.
    const dropY = DEFAULT_TRACK_HEIGHT * 2;
    fireEvent.pointerDown(dragHandle, { pointerId: 1, clientY: 20, button: 0 });
    fireEvent.pointerMove(dragHandle, { pointerId: 1, clientY: dropY, button: 0 });
    fireEvent.pointerUp(dragHandle, { pointerId: 1, clientY: dropY, button: 0 });

    await waitFor(() => {
      const trackHeaders = container.querySelectorAll("[data-track-header-root='true']");
      expect(within(trackHeaders[0] as HTMLElement).getByText(secondTrack!.name)).toBeInTheDocument();
      expect(within(trackHeaders[1] as HTMLElement).getByText(firstTrack!.name)).toBeInTheDocument();
    });
  });

  it("cancels track reorder without moving tracks or leaving the drop indicator", async () => {
    setDesktopLikeMatchMedia();
    const project = createBaseTimelineProject();
    const firstTrack = project.edit.tracks[0];
    const secondTrack = project.edit.tracks[1];
    expect(firstTrack).toBeDefined();
    expect(secondTrack).toBeDefined();

    const { container } = renderWithProject(<TrackList />, { project });
    const list = await screen.findByTestId("track-list-scroll");
    Object.defineProperty(list, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 196, height: 400, right: 196, bottom: 400 }),
    });

    const dragHandle = within(screen.getByTestId(`track-header-${firstTrack!.id}`)).getByLabelText(
      "Drag to reorder track",
    ) as HTMLButtonElement & {
      setPointerCapture?: (pointerId: number) => void;
      releasePointerCapture?: (pointerId: number) => void;
    };
    dragHandle.setPointerCapture = vi.fn();
    dragHandle.releasePointerCapture = vi.fn();

    const dropY = DEFAULT_TRACK_HEIGHT * 2;
    fireEvent.pointerDown(dragHandle, { pointerId: 31, clientY: 20, button: 0 });
    fireEvent.pointerMove(dragHandle, { pointerId: 31, clientY: dropY, button: 0 });
    expect(screen.getByTestId("track-reorder-drop-indicator")).toBeInTheDocument();

    fireEvent.pointerCancel(dragHandle, { pointerId: 31, clientY: dropY, button: 0 });
    await waitFor(() => {
      expect(screen.queryByTestId("track-reorder-drop-indicator")).not.toBeInTheDocument();
    });
    expect(dragHandle.releasePointerCapture).toHaveBeenCalledWith(31);

    fireEvent.pointerUp(dragHandle, { pointerId: 31, clientY: dropY, button: 0 });
    const trackHeaders = container.querySelectorAll("[data-track-header-root='true']");
    expect(within(trackHeaders[0] as HTMLElement).getByText(firstTrack!.name)).toBeInTheDocument();
    expect(within(trackHeaders[1] as HTMLElement).getByText(secondTrack!.name)).toBeInTheDocument();
  });
});
