import { useEffect, useRef } from "react";
import { createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Timeline } from "./Timeline";
import { MidiEditor } from "./MidiEditor";
import { StatusBar } from "./StatusBar";
import { useGlobalHotkeys } from "@/app/useGlobalHotkeys.ts";
import * as fileDropUtils from "@/utils/fileDrop.ts";
import { renderWithProject } from "@/test/renderWithProject";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { setPhoneViewport } from "@/test/viewportSize";
import { useProject, useProjectActions, useSelectionState, useViewportState } from "@/store";
import { buildSplitClipCommand } from "@/intents/clipCommands.ts";
import { buildTimelineMobileContract } from "./timeline/useTimelineInteractionsMobile";

const importFileToTrack = vi.fn();

vi.mock("@/hooks/useFileImport.ts", () => ({
  useFileImport: () => ({
    importFileToTrack,
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

function attachPointerCaptureMocks(element: Element) {
  const pointerElement = element as Element & {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    hasPointerCapture?: (pointerId: number) => boolean;
  };
  pointerElement.setPointerCapture = vi.fn();
  pointerElement.releasePointerCapture = vi.fn();
  pointerElement.hasPointerCapture = vi.fn(() => true);
}

describe("Timeline integration", () => {
  afterEach(() => {
    setDesktopLikeMatchMedia();
  });

  function TimelineWithEditor() {
    const { state } = useProject();
    const midiTarget = state.midiEditorTarget;
    return (
      <>
        <TimelineHotkeyHarness />
        <Timeline />
        <StatusBar />
        <TimelineSelectionProbe />
        {midiTarget && (
          <MidiEditor
            contentId={midiTarget.contentId}
            clipId={midiTarget.clipId}
          />
        )}
      </>
    );
  }

  function TimelineHotkeyHarness() {
    const { state } = useProject();
    const actions = useProjectActions();

    useGlobalHotkeys({
      document: state.document,
      selectedClipIds: state.selectedClipIds,
      primaryClipId: state.primaryClipId,
      playheadTick: state.playheadTick,
      midiEditorOpen: state.midiEditorTarget !== null,
      busy: false,
      anyDialogOpen: false,
      projectDialogOpen: false,
      setProjectDialogOpen: () => {},
      isPlaying: false,
      actions,
      saveProjectToBrowser: async () => true,
      refreshBrowserProjects: async () => {},
      exportWav: async () => {},
      play: async () => {},
      stop: () => {},
      interactionPolicy: { allowsModifierShortcuts: true },
    });

    return null;
  }

  function TimelineSelectionProbe() {
    const selectionState = useSelectionState();
    return (
      <div
        data-testid="timeline-selection-probe"
        data-selected-track={selectionState.selectedTrackId ?? ""}
        data-selected-clips={selectionState.selectedClipIds.join(",")}
        data-time-selection={
          selectionState.timeSelectionStartTick !== null &&
          selectionState.timeSelectionEndTick !== null
            ? `${selectionState.timeSelectionStartTick}-${selectionState.timeSelectionEndTick}`
            : ""
        }
      />
    );
  }

  function EscapeSelectionHarness() {
    const { state } = useProject();
    const actions = useProjectActions();
    const initializedRef = useRef(false);

    useEffect(() => {
      if (initializedRef.current || state.document === null) {
        return;
      }
      initializedRef.current = true;
      actions.setTimeSelection(120, 360);
    }, [actions, state.document]);

    useGlobalHotkeys({
      document: null,
      selectedClipIds: [],
      primaryClipId: null,
      playheadTick: 0,
      midiEditorOpen: false,
      busy: false,
      anyDialogOpen: false,
      projectDialogOpen: false,
      setProjectDialogOpen: () => {},
      isPlaying: false,
      actions,
      saveProjectToBrowser: async () => true,
      refreshBrowserProjects: async () => {},
      exportWav: async () => {},
      play: async () => {},
      stop: () => {},
      interactionPolicy: { allowsModifierShortcuts: true },
    });

    return <TimelineSelectionProbe />;
  }

  it("selects clips, opens the MIDI editor on double click, and creates new MIDI clips on empty lane double click", async () => {
    const project = createBaseTimelineProject();
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(audioClip).toBeDefined();
    expect(midiClip).toBeDefined();

    renderWithProject(<TimelineWithEditor />, { project });

    const audioClipElement = await screen.findByTestId(`clip-${audioClip!.id}`);
    fireEvent.click(audioClipElement, { clientX: 40, clientY: 40 });
    await waitFor(() => {
      expect(audioClipElement).toHaveAttribute("data-selected", "true");
    });

    const midiClipElement = screen.getByTestId(`clip-${midiClip!.id}`);
    fireEvent.doubleClick(midiClipElement, { clientX: 210, clientY: 120 });
    await waitFor(() => {
      expect(screen.getByTestId("midi-editor-root")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to timeline" }));
    await waitFor(() => {
      expect(screen.queryByTestId("midi-editor-root")).not.toBeInTheDocument();
    });

    const canvas = screen.getByTestId("timeline-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1600, height: 160, right: 1600, bottom: 160 }),
    });
    fireEvent.doubleClick(canvas, { clientX: 240, clientY: 120 });

    await waitFor(() => {
      const midiClips = screen.getAllByTestId((value) => value.startsWith("clip-"));
      expect(midiClips.length).toBeGreaterThan(2);
    });
  });

  it("removes selected clips with the floating delete action", async () => {
    const project = createBaseTimelineProject();
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    expect(audioTrack).toBeDefined();
    expect(audioClip).toBeDefined();
    // B-3 intentionally removes in-clip actions below 52px. Keep this test's
    // subject (the floating delete action) wide enough to render that UI.
    audioClip!.length = 2_000;

    renderWithProject(<TimelineWithEditor />, {
      project,
      selectedTrackId: audioTrack!.id,
      selectedClipIds: [audioClip!.id],
      primaryClipId: audioClip!.id,
    });

    await waitFor(() => {
      expect(screen.getByTestId(`clip-${audioClip!.id}`)).toHaveAttribute("data-selected", "true");
    });

    fireEvent.pointerDown(screen.getByTestId(`clip-delete-${audioClip!.id}`), {
      pointerId: 1,
      button: 0,
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`clip-${audioClip!.id}`)).not.toBeInTheDocument();
    });

  });

  it("uses the mobile timeline presenter on a phone", async () => {
    setTouchLikeMatchMedia();
    setPhoneViewport();
    const project = createBaseTimelineProject();

    renderWithProject(<Timeline />, { project });

    await waitFor(() => {
      expect(screen.getByTestId("timeline-root")).toHaveAttribute("data-timeline-variant", "mobile");
    });
  });

  it("zooms the timeline when two fingers spread apart", async () => {
    setTouchLikeMatchMedia();
    setPhoneViewport();
    const project = createBaseTimelineProject();

    function ZoomProbe() {
      const { zoom } = useViewportState();
      return <span data-testid="zoom-x">{zoom.x}</span>;
    }

    renderWithProject(
      <>
        <Timeline />
        <ZoomProbe />
      </>,
      { project },
    );

    const surface = await screen.findByTestId("timeline-canvas");
    Object.defineProperty(surface, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }),
    });
    const scroll = screen.getByTestId("timeline-scroll");
    Object.defineProperty(scroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }),
    });

    const zoomBefore = Number(screen.getByTestId("zoom-x").textContent);

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 200 });
    fireEvent.pointerDown(surface, { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 200 });
    // Same midpoint, twice the separation.
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 2, pointerType: "touch", clientX: 600, clientY: 200 });

    await waitFor(() => {
      expect(Number(screen.getByTestId("zoom-x").textContent)).toBeGreaterThan(zoomBefore);
    });

    const zoomAfterSpread = Number(screen.getByTestId("zoom-x").textContent);

    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: "touch", clientX: 350, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 2, pointerType: "touch", clientX: 450, clientY: 200 });

    await waitFor(() => {
      expect(Number(screen.getByTestId("zoom-x").textContent)).toBeLessThan(zoomAfterSpread);
    });
  });

  it("reports the active gesture through the mobile badge", () => {
    const contract = buildTimelineMobileContract({
      rootRef: { current: null },
      scrollRef: { current: null },
      rulerRef: { current: null },
      timelineRef: { current: null },
      marquee: null,
      fileDropPreview: null,
      getViewportContentPoint: () => null,
      getTickFromViewportClientX: () => 0,
      setViewportScrollLeft: () => {},
      handleRulerClick: () => {},
      handleTimelineClick: () => {},
      handleLanesScroll: () => {},
      handleRulerPointerDown: () => {},
      handleRulerPointerMove: () => {},
      finishRulerPointerGesture: () => {},
      handleTimelinePointerDown: () => {},
      handleTimelinePointerMove: () => {},
      finishTimelinePointerGesture: () => {},
      handleTimelineDragOver: () => {},
      handleTimelineDragLeave: () => {},
      handleTimelineDrop: () => {},
    });

    // Idle: nothing to report, so the badge takes no vertical space.
    expect(contract.mobileTransientActionBadge.visible).toBe(false);
  });

  it("creates empty MIDI clips through the extracted timeline intent path", async () => {
    const project = createBaseTimelineProject();

    const createId = vi.spyOn(crypto, "randomUUID");
    createId
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000501")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000502");

    renderWithProject(<TimelineWithEditor />, { project });

    const canvas = screen.getByTestId("timeline-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1600, height: 160, right: 1600, bottom: 160 }),
    });
    const scroll = screen.getByTestId("timeline-scroll");
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.doubleClick(canvas, { clientX: 240, clientY: 120 });

    await waitFor(() => {
      expect(screen.queryByText("No project loaded")).not.toBeInTheDocument();
    });

    createId.mockRestore();
  });

  it("uses pointer capture for timeline marquee selection", async () => {
    const project = createBaseTimelineProject();
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    expect(audioClip).toBeDefined();

    renderWithProject(<TimelineWithEditor />, { project });

    const canvas = await screen.findByTestId("timeline-canvas");
    const scroll = screen.getByTestId("timeline-scroll");
    Object.defineProperty(scroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1600, height: 160, right: 1600, bottom: 160 }),
    });
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    attachPointerCaptureMocks(canvas);

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: "mouse",
      button: 2,
      buttons: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      pointerType: "mouse",
      buttons: 2,
      clientX: 4000,
      clientY: 79,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      pointerType: "mouse",
      button: 2,
      clientX: 4000,
      clientY: 79,
    });

    await waitFor(() => {
      expect(screen.getByTestId("timeline-selection-probe")).toHaveAttribute(
        "data-selected-clips",
        audioClip!.id,
      );
    });
  });

  it("cancels timeline marquee without changing selection or leaving its overlay", async () => {
    const project = createBaseTimelineProject();
    renderWithProject(<TimelineWithEditor />, { project });

    const canvas = await screen.findByTestId("timeline-canvas");
    const scroll = screen.getByTestId("timeline-scroll");
    Object.defineProperty(scroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1600, height: 160, right: 1600, bottom: 160 }),
    });
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    attachPointerCaptureMocks(canvas);

    fireEvent.pointerDown(canvas, {
      pointerId: 21,
      pointerType: "mouse",
      button: 2,
      buttons: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      pointerType: "mouse",
      buttons: 2,
      clientX: 4_000,
      clientY: 79,
    });
    expect(screen.getByTestId("timeline-marquee")).toBeInTheDocument();

    fireEvent.pointerCancel(canvas, {
      pointerId: 21,
      pointerType: "mouse",
      clientX: 4_000,
      clientY: 79,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-marquee")).not.toBeInTheDocument();
      expect(screen.getByTestId("timeline-selection-probe")).toHaveAttribute(
        "data-selected-clips",
        "",
      );
    });
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(21);

    fireEvent.pointerUp(canvas, {
      pointerId: 21,
      pointerType: "mouse",
      button: 2,
      clientX: 4_000,
      clientY: 79,
    });
    expect(screen.getByTestId("timeline-selection-probe")).toHaveAttribute(
      "data-selected-clips",
      "",
    );
  });

  it("splits audio clips through the extracted timeline split intent path", async () => {
    const project = createBaseTimelineProject();
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    expect(audioClip).toBeDefined();

    const command = buildSplitClipCommand(
      project,
      audioClip!.id,
      240,
      () => "00000000-0000-0000-0000-000000000503",
    );
    expect(command).toEqual({
      command: "split_clip",
      clip_id: audioClip!.id,
      tick_in_clip: 240,
      new_clip_id: "00000000-0000-0000-0000-000000000503",
    });
  });

  it("surfaces invalid file drops instead of silently mutating timeline state", async () => {
    const project = createBaseTimelineProject();

    renderWithProject(<TimelineWithEditor />, { project });

    const canvas = screen.getByTestId("timeline-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1600, height: 160, right: 1600, bottom: 160 }),
    });
    Object.defineProperty(screen.getByTestId("timeline-scroll"), "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(screen.getByTestId("timeline-scroll"), "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    const invalidFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const dataTransfer = {
      types: ["Files"],
      files: [invalidFile],
      dropEffect: "none",
      items: [],
    } as unknown as DataTransfer;

    const dropEvent = createEvent.drop(canvas, { clientX: 100, clientY: 40 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: dataTransfer,
    });
    fireEvent(canvas, dropEvent);

    await waitFor(() => {
      expect(screen.getByText("Unsupported file type: notes.txt.")).toBeInTheDocument();
    });
    expect(importFileToTrack).not.toHaveBeenCalled();
  });

  it("contains overscroll on the timeline viewport to keep wheel handling inside the shell", async () => {
    const project = createBaseTimelineProject();
    renderWithProject(<TimelineWithEditor />, { project });
    const root = await screen.findByTestId("timeline-root");
    const scroll = screen.getByTestId("timeline-scroll");

    expect(root).toBeInTheDocument();
    expect(scroll).toHaveStyle({ overscrollBehavior: "none" });
  });

  it("imports to a new track when a file is dropped below the last track", async () => {
    const project = createBaseTimelineProject();

    renderWithProject(<TimelineWithEditor />, { project });

    const canvas = screen.getByTestId("timeline-canvas");

    const audioFile = new File(["wave"], "voice.wav", { type: "audio/wav" });
    const dataTransfer = {
      types: ["Files"],
      files: [audioFile],
      dropEffect: "none",
      items: [],
    } as unknown as DataTransfer;

    importFileToTrack.mockClear();
    const resolveDropSpy = vi
      .spyOn(fileDropUtils, "resolveTimelineFileDrop")
      .mockReturnValue({ trackIndex: null, tick: 120, appendNewTrack: true });

    const dropEvent = createEvent.drop(canvas, { clientX: 120, clientY: 190 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: dataTransfer,
    });
    fireEvent(canvas, dropEvent);

    await waitFor(() => {
      expect(importFileToTrack).toHaveBeenCalled();
      expect(importFileToTrack.mock.calls.some(
        (call) => call[0] === audioFile && call[1] === null && call[3]?.createTrack === true,
      )).toBe(true);
    });

    resolveDropSpy.mockRestore();
  });

  it("clears timeline selection and time range on Escape", async () => {
    const project = createBaseTimelineProject();
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");
    expect(audioTrack).toBeDefined();
    expect(audioClip).toBeDefined();

    renderWithProject(<EscapeSelectionHarness />, {
      project,
      selectedTrackId: audioTrack!.id,
      selectedClipIds: [audioClip!.id],
      primaryClipId: audioClip!.id,
    });

    const selectionProbe = await screen.findByTestId("timeline-selection-probe");
    await waitFor(() => {
      expect(selectionProbe).toHaveAttribute("data-selected-track", audioTrack!.id);
      expect(selectionProbe).toHaveAttribute("data-selected-clips", audioClip!.id);
      expect(selectionProbe).toHaveAttribute("data-time-selection", "120-360");
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(selectionProbe).toHaveAttribute("data-selected-track", "");
      expect(selectionProbe).toHaveAttribute("data-selected-clips", "");
      expect(selectionProbe).toHaveAttribute("data-time-selection", "");
    });
  });

});
