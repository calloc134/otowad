import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MidiEditor } from "./MidiEditor";
import { useProject, useProjectActions } from "@/store";
import { renderWithProject } from "@/test/renderWithProject";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { setPhoneViewport } from "@/test/viewportSize";
import { buildMidiEditorMobileContract } from "./midi-editor/useMidiEditorInteractionsMobile";

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

function headerHasStatus(fragment: string): boolean {
  return Array.from(document.querySelectorAll("span")).some((element) =>
    (element.textContent ?? "").includes(fragment)
  );
}

function MidiEditorHost({ contentId, clipId }: { contentId: string; clipId: string }) {
  const { state } = useProject();
  const actions = useProjectActions();
  if (state.midiEditorTarget === null) {
    return (
      <button type="button" onClick={() => actions.openMidiEditor(contentId, clipId)}>
        Reopen MIDI Editor
      </button>
    );
  }
  return <MidiEditor contentId={contentId} clipId={clipId} />;
}

describe("MidiEditor integration", () => {
  afterEach(() => {
    setDesktopLikeMatchMedia();
  });

  it("selects notes, deletes them with Delete, and returns to the timeline with Escape/back", async () => {
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    const midiContentId = midiClip!.kind.clip_type === "midi" ? midiClip!.kind.content_id : null;
    expect(midiContentId).toBeTruthy();

    renderWithProject(
      <MidiEditorHost contentId={midiContentId!} clipId={midiClip!.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContentId!, clipId: midiClip!.id },
      },
    );

    const gridScroll = await screen.findByTestId("midi-editor-grid-scroll");
    Object.defineProperty(gridScroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 2000, height: 2048, right: 2000, bottom: 2048 }),
    });
    Object.defineProperty(gridScroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(gridScroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const grid = screen.getByTestId("midi-editor-grid");
    attachPointerCaptureMocks(grid);

    fireEvent.pointerDown(grid, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: (127 - 60) * 16 + 4,
      button: 0,
    });
    fireEvent.pointerUp(grid, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: (127 - 60) * 16 + 4,
      button: 0,
    });

    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      expect(headerHasStatus("Notes: 1")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to timeline" }));
    await waitFor(() => {
      expect(screen.queryByTestId("midi-editor-root")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reopen MIDI Editor" })).toBeInTheDocument();
    });
  });

  it("creates notes by drag and supports marquee selection across multiple notes", async () => {
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    const midiContentId = midiClip!.kind.clip_type === "midi" ? midiClip!.kind.content_id : null;
    expect(midiContentId).toBeTruthy();

    renderWithProject(
      <MidiEditorHost contentId={midiContentId!} clipId={midiClip!.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContentId!, clipId: midiClip!.id },
      },
    );

    const gridScroll = await screen.findByTestId("midi-editor-grid-scroll");
    Object.defineProperty(gridScroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 2000, height: 2048, right: 2000, bottom: 2048 }),
    });
    Object.defineProperty(gridScroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(gridScroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const grid = screen.getByTestId("midi-editor-grid");
    attachPointerCaptureMocks(grid);

    fireEvent.pointerDown(grid, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 60,
      clientY: (127 - 67) * 16 + 4,
      button: 0,
    });
    fireEvent.pointerMove(grid, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 90,
      clientY: (127 - 67) * 16 + 4,
      buttons: 1,
    });
    fireEvent.pointerUp(grid, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 90,
      clientY: (127 - 67) * 16 + 4,
      button: 0,
    });

    await waitFor(() => {
      expect(screen.getByText(/Notes: 3/)).toBeInTheDocument();
    });

    fireEvent.pointerDown(grid, {
      pointerId: 2,
      pointerType: "mouse",
      clientX: 0,
      clientY: (127 - 68) * 16,
      button: 2,
      buttons: 2,
    });
    fireEvent.pointerMove(grid, {
      pointerId: 2,
      pointerType: "mouse",
      clientX: 600,
      clientY: (127 - 59) * 16 + 16,
      buttons: 2,
    });
    fireEvent.pointerUp(grid, {
      pointerId: 2,
      pointerType: "mouse",
      clientX: 600,
      clientY: (127 - 59) * 16 + 16,
      button: 2,
    });

    await waitFor(() => {
      expect(headerHasStatus("Selected: 3")).toBe(true);
    });
  });

  it("cancels note drag without moving the note or leaving drag state", async () => {
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    const midiContentId = midiClip!.kind.clip_type === "midi" ? midiClip!.kind.content_id : null;
    expect(midiContentId).toBeTruthy();

    renderWithProject(
      <MidiEditorHost contentId={midiContentId!} clipId={midiClip!.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContentId!, clipId: midiClip!.id },
      },
    );

    const gridScroll = await screen.findByTestId("midi-editor-grid-scroll");
    Object.defineProperty(gridScroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 2000, height: 2048, right: 2000, bottom: 2048 }),
    });
    Object.defineProperty(gridScroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(gridScroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const grid = screen.getByTestId("midi-editor-grid");
    attachPointerCaptureMocks(grid);
    const firstNote = screen.getByTestId("midi-editor-note-0");
    expect(firstNote).toHaveStyle({ left: "0px", cursor: "grab" });

    const noteY = (127 - 60) * 16 + 4;
    fireEvent.pointerDown(grid, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 10,
      clientY: noteY,
      button: 0,
    });
    fireEvent.pointerMove(grid, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 100,
      clientY: noteY,
      buttons: 1,
    });
    await waitFor(() => {
      expect(firstNote).toHaveStyle({ cursor: "grabbing" });
      expect(firstNote.style.left).not.toBe("0px");
    });

    fireEvent.pointerCancel(grid, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 100,
      clientY: noteY,
    });
    await waitFor(() => {
      expect(firstNote).toHaveStyle({ left: "0px", cursor: "grab" });
      expect(headerHasStatus("Notes: 2")).toBe(true);
    });
    expect(grid.releasePointerCapture).toHaveBeenCalledWith(41);

    fireEvent.pointerUp(grid, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 100,
      clientY: noteY,
      button: 0,
    });
    expect(firstNote).toHaveStyle({ left: "0px" });
    expect(headerHasStatus("Notes: 2")).toBe(true);
  });

  it("selects all MIDI notes with Ctrl+A", async () => {
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    const midiContentId = midiClip!.kind.clip_type === "midi" ? midiClip!.kind.content_id : null;
    expect(midiContentId).toBeTruthy();

    renderWithProject(
      <MidiEditorHost contentId={midiContentId!} clipId={midiClip!.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContentId!, clipId: midiClip!.id },
      },
    );

    await screen.findByTestId("midi-editor-root");
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    await waitFor(() => {
      expect(headerHasStatus("Selected: 2")).toBe(true);
    });
  });

  it("renders only notes contained by the opened clip content window", async () => {
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    if (!midiClip || midiClip.kind.clip_type !== "midi") {
      throw new Error("expected MIDI clip");
    }
    const midiContent = project.edit.contents.find(
      (content) => content.type === "midi" && content.id === midiClip.kind.content_id,
    );
    if (!midiContent || midiContent.type !== "midi") {
      throw new Error("expected MIDI content");
    }
    midiClip.length = 500;
    midiClip.kind.midi.content_in = 400;
    midiClip.kind.midi.content_out = 900;
    midiContent.notes = [
      { id: crypto.randomUUID(), start: 0, length: 240, key: 60, vel: 100 },
      { id: crypto.randomUUID(), start: 480, length: 240, key: 64, vel: 100 },
      { id: crypto.randomUUID(), start: 960, length: 120, key: 67, vel: 100 },
    ];

    renderWithProject(
      <MidiEditor contentId={midiContent.id} clipId={midiClip.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContent.id, clipId: midiClip.id },
      },
    );

    const windowOverlay = await screen.findByTestId("midi-editor-content-window");
    expect(windowOverlay).toHaveAttribute("data-content-in", "400");
    expect(windowOverlay).toHaveAttribute("data-content-out", "900");
    expect(screen.queryByTestId("midi-editor-note-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("midi-editor-note-1")).toBeInTheDocument();
    expect(screen.queryByTestId("midi-editor-note-2")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await waitFor(() => {
      expect(headerHasStatus("Selected: 1")).toBe(true);
    });

    const gridScroll = screen.getByTestId("midi-editor-grid-scroll");
    Object.defineProperty(gridScroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 2_000, height: 2_048, right: 2_000, bottom: 2_048 }),
    });
    Object.defineProperty(gridScroll, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(gridScroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const grid = screen.getByTestId("midi-editor-grid");
    attachPointerCaptureMocks(grid);
    fireEvent.pointerDown(grid, {
      pointerId: 72,
      pointerType: "mouse",
      clientX: 30,
      clientY: (127 - 69) * 16 + 4,
      button: 0,
    });
    fireEvent.pointerMove(grid, {
      pointerId: 72,
      pointerType: "mouse",
      clientX: 45,
      clientY: (127 - 69) * 16 + 4,
      buttons: 1,
    });
    fireEvent.pointerUp(grid, {
      pointerId: 72,
      pointerType: "mouse",
      clientX: 45,
      clientY: (127 - 69) * 16 + 4,
      button: 0,
    });
    expect(headerHasStatus("Notes: 1/3")).toBe(true);
  });

  it("uses the mobile MIDI editor presenter on a phone", async () => {
    setTouchLikeMatchMedia();
    setPhoneViewport();
    const project = createBaseTimelineProject();
    const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi");
    expect(midiClip).toBeDefined();
    const midiContentId = midiClip!.kind.clip_type === "midi" ? midiClip!.kind.content_id : null;
    expect(midiContentId).toBeTruthy();

    renderWithProject(
      <MidiEditor contentId={midiContentId!} clipId={midiClip!.id} />,
      {
        project,
        midiEditorTarget: { contentId: midiContentId!, clipId: midiClip!.id },
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId("midi-editor-root")).toHaveAttribute(
        "data-midi-editor-variant",
        "mobile",
      );
    });
  });

  it("keeps mobile note-create slots defined without forcing a final touch flow", () => {
    const contract = buildMidiEditorMobileContract({
      gridScrollRef: { current: null },
      pianoScrollRef: { current: null },
      rulerScrollRef: { current: null },
      handleGridScroll: () => {},
      handleGridPointerDown: () => {},
      handleGridPointerMove: () => {},
      finishGridPointerGesture: () => {},
      handleContextMenu: () => {},
      handleRulerClick: () => {},
      handleEditorBodyPointerDown: () => {},
      handleEditorBodyPointerMove: () => {},
      finishEditorBodyPointerGesture: () => {},
      handleAuxClick: () => {},
      draftNote: null,
      marqueeRect: null,
      dragState: null,
      movingNoteIndexSet: null,
      copyGhostNotes: [],
    });

    expect(contract.supportsTouchNoteCreateFlow).toBe(true);
    expect(contract.mobileTouchNoteCreateFlow.phase).toBe("idle");
  });
});
