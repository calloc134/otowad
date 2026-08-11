import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mediaCache } from "@/audio";
import { desktopTimelinePolicy, touchTimelinePolicy } from "@/app/deviceInteraction.ts";
import { createAudioBufferStub, createBaseTimelineProject } from "@/test/projectTestUtils";
import { renderClipViewHarness } from "@/test/clipViewHarness";
import { buildClipMobileContract } from "./clip-view/useClipInteractionsMobile";

function attachPointerCaptureMocks(element: Element) {
  const pointerElement = element as Element & {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
  pointerElement.setPointerCapture = vi.fn();
  pointerElement.releasePointerCapture = vi.fn();
  return pointerElement;
}

describe("ClipView integration", () => {
  afterEach(() => {
    mediaCache.clear();
    vi.restoreAllMocks();
  });

  it("shows float actions for the primary selection and deletes through the floating button", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    const onDeleteClip = vi.fn();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      onDeleteClip,
      interactionPolicy: desktopTimelinePolicy,
    });

    expect(screen.getByTestId(`clip-action-strip-${clip!.id}`)).toHaveAttribute(
      "data-clip-action-strip-variant",
      "desktop",
    );
    fireEvent.pointerDown(screen.getByTestId(`clip-delete-${clip!.id}`), {
      pointerId: 1,
      button: 0,
    });
    expect(onDeleteClip).toHaveBeenCalledWith(clip!.id);
  });

  it("renders only the media preview when a clip is too short for readable details", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();
    if (!clip || clip.kind.clip_type !== "audio") {
      throw new Error("expected audio clip");
    }
    clip.length = 40;
    clip.gain_milli_db = -2_100;
    clip.kind.audio.pitch.manual_coarse_semitones = 7;
    clip.kind.audio.pitch.manual_fine_cents = -23;

    renderClipViewHarness({
      project,
      clip,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      onDeleteClip: vi.fn(),
      interactionPolicy: desktopTimelinePolicy,
    });

    expect(screen.queryByTestId(`clip-header-${clip.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`clip-action-strip-${clip.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`clip-preview-${clip.id}`)).toBeInTheDocument();
  });

  it("splits on long press and delegates clip edge clicks through the body selection handler", () => {
    vi.useFakeTimers();
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    const onSelect = vi.fn();
    const onSplitClip = vi.fn();

    renderClipViewHarness({
      project,
      clip: clip!,
      onSelect,
      onSplitClip,
      interactionPolicy: desktopTimelinePolicy,
    });

    const clipElement = screen.getByTestId(`clip-${clip!.id}`);
    Object.defineProperty(clipElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 960, height: 76, right: 960, bottom: 76 }),
    });

    fireEvent.pointerDown(clipElement, {
      pointerId: 1,
      clientX: 120,
      clientY: 30,
      button: 0,
    });
    vi.advanceTimersByTime(520);
    expect(onSplitClip).toHaveBeenCalledWith(clip!.id, 120);

    fireEvent.pointerUp(clipElement, {
      pointerId: 1,
      clientX: 120,
      clientY: 30,
      button: 0,
    });
    fireEvent.click(clipElement, { clientX: 6, clientY: 68, button: 0, detail: 1 });
    expect(onSelect).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("uses explicit warp action instead of body long-press on touch-like policy", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      interactionPolicy: touchTimelinePolicy,
    });

    const clipElement = screen.getByTestId(`clip-${clip!.id}`);
    Object.defineProperty(clipElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 960, height: 76, right: 960, bottom: 76 }),
    });

    fireEvent.pointerDown(clipElement, {
      pointerId: 1,
      clientX: 120,
      clientY: 30,
      button: 0,
    });
    const warpButton = screen.getByTestId(`clip-warp-${clip!.id}`);
    fireEvent.pointerDown(warpButton, { pointerId: 2, button: 0 });
    fireEvent.pointerDown(clipElement, {
      pointerId: 3,
      clientX: 240,
      clientY: 30,
      button: 0,
    });

    expect(screen.getAllByTitle(/Warp @ tick/)).toHaveLength(1);
  });

  it("exposes duplicate as an explicit touch action", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    const onDuplicateClip = vi.fn();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      interactionPolicy: touchTimelinePolicy,
      onDuplicateClip,
    });

    expect(screen.getByTestId(`clip-action-strip-${clip!.id}`)).toHaveAttribute(
      "data-clip-action-strip-variant",
      "mobile",
    );
    fireEvent.pointerDown(screen.getByTestId(`clip-duplicate-${clip!.id}`), {
      pointerId: 1,
      button: 0,
    });
    expect(onDuplicateClip).toHaveBeenCalledWith(clip!.id);
  });

  it("exposes a touch-sized MIDI editor open action under touch policy", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "midi");
    expect(clip).toBeDefined();

    const onDoubleClick = vi.fn();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      interactionPolicy: touchTimelinePolicy,
      onDoubleClick,
    });

    fireEvent.pointerDown(screen.getByTestId(`clip-open-midi-${clip!.id}`), {
      pointerId: 1,
      button: 0,
    });
    expect(onDoubleClick).toHaveBeenCalledWith(clip!.id);
  });

  it("keeps mobile action-sheet bridge inert until bottom-sheet UX is finalized", () => {
    const contract = buildClipMobileContract(
      {
        isSplitLongPressing: false,
        warpPlacementArmed: false,
        toggleWarpPlacementArmed: () => {},
        handlePointerDown: () => {},
        handlePointerMove: () => {},
        handlePointerUp: () => {},
        handlePointerCancel: () => {},
        handleClick: () => {},
        handleDoubleClick: () => {},
      },
      { isDragging: false, isResizing: false },
    );

    expect(contract.mobileActionSheet.open).toBe(false);
    expect(contract.mobileActionSheet.actions).toHaveLength(0);
    expect(contract.mobileTransientActionBadge.visible).toBe(false);
  });

  it("exposes MIDI transpose buttons for selected MIDI clips", () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "midi");
    expect(clip).toBeDefined();

    const onPitchChange = vi.fn();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      interactionPolicy: touchTimelinePolicy,
      onPitchChange,
    });

    fireEvent.pointerDown(screen.getByTestId(`clip-transpose-up-${clip!.id}`), {
      pointerId: 1,
      button: 0,
    });
    fireEvent.pointerDown(screen.getByTestId(`clip-transpose-down-${clip!.id}`), {
      pointerId: 2,
      button: 0,
    });

    expect(onPitchChange).toHaveBeenNthCalledWith(1, clip!.id, 1);
    expect(onPitchChange).toHaveBeenNthCalledWith(2, clip!.id, -1);
  });

  it("cancels clip drag and resize previews without committing either gesture", async () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    renderClipViewHarness({
      project,
      clip: clip!,
      isSelected: true,
      isPrimarySelection: true,
      selectionSize: 1,
      interactionPolicy: desktopTimelinePolicy,
    });

    const clipElement = screen.getByTestId(`clip-${clip!.id}`);
    Object.defineProperty(clipElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 960, height: 76, right: 960, bottom: 76 }),
    });
    const pointerElement = attachPointerCaptureMocks(clipElement);

    fireEvent.pointerDown(clipElement, {
      pointerId: 11,
      pointerType: "mouse",
      clientX: 120,
      clientY: 30,
      button: 0,
    });
    fireEvent.pointerMove(clipElement, {
      pointerId: 11,
      pointerType: "mouse",
      clientX: 420,
      clientY: 30,
      buttons: 1,
    });
    await waitFor(() => {
      expect(clipElement).toHaveStyle({ left: "300px", cursor: "grabbing" });
    });

    fireEvent.pointerCancel(clipElement, {
      pointerId: 11,
      pointerType: "mouse",
      clientX: 420,
      clientY: 30,
    });
    await waitFor(() => {
      expect(clipElement).toHaveStyle({ left: "0px", cursor: "grab" });
    });
    expect(pointerElement.releasePointerCapture).toHaveBeenCalledWith(11);

    // A late pointerup from the interrupted gesture must not commit a move.
    fireEvent.pointerUp(clipElement, {
      pointerId: 11,
      pointerType: "mouse",
      clientX: 420,
      clientY: 30,
      button: 0,
    });
    expect(clipElement).toHaveStyle({ left: "0px" });

    fireEvent.pointerDown(clipElement, {
      pointerId: 12,
      pointerType: "mouse",
      clientX: 959,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerMove(clipElement, {
      pointerId: 12,
      pointerType: "mouse",
      clientX: 1_759,
      clientY: 10,
      buttons: 1,
    });
    await waitFor(() => {
      expect(clipElement).toHaveStyle({ width: "1920px", cursor: "grabbing" });
    });

    fireEvent.pointerCancel(clipElement, {
      pointerId: 12,
      pointerType: "mouse",
      clientX: 1_759,
      clientY: 10,
    });
    await waitFor(() => {
      expect(clipElement).toHaveStyle({ width: "960px", cursor: "grab" });
    });
    expect(pointerElement.releasePointerCapture).toHaveBeenCalledWith(12);

    fireEvent.pointerUp(clipElement, {
      pointerId: 12,
      pointerType: "mouse",
      clientX: 1_759,
      clientY: 10,
      button: 0,
    });
    expect(clipElement).toHaveStyle({ width: "960px" });
  });

  it("tiles waveform canvases for long audio clips so rendering stays within canvas limits", async () => {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((candidate) => candidate.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    clip!.length = 5_000;

    const buffer = createAudioBufferStub(44_100, 44_100);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = Math.sin(i / 32);
    }
    mediaCache.replaceAll([["media-1", buffer]]);

    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: vi.fn(),
          fillRect,
        }) as unknown as CanvasRenderingContext2D,
    );

    renderClipViewHarness({
      project,
      clip: clip!,
      interactionPolicy: desktopTimelinePolicy,
    });

    await waitFor(() => {
      const waveformTiles = screen.getAllByTestId((value) =>
        value.startsWith(`clip-waveform-${clip!.id}-`),
      );
      expect(waveformTiles.length).toBeGreaterThan(1);
      expect(
        waveformTiles.every((tile) => Number(tile.getAttribute("width")) <= 2048),
      ).toBe(true);
      expect(fillRect).toHaveBeenCalled();
    });
  });
});
