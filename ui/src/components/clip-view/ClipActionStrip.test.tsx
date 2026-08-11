import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mediaCache } from "@/audio";
import { desktopTimelinePolicy } from "@/app/deviceInteraction.ts";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { renderClipViewHarness } from "@/test/clipViewHarness";

/**
 * The action buttons carried an aria-label but ran `action.execute()` only
 * from onPointerDown, so a keyboard user could focus one and never activate
 * it. Adding onClick would have double-fired for mouse users, since
 * pointerdown is followed by click; instead the key handler calls
 * preventDefault so no click is synthesised at all.
 */

function renderStrip() {
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

  return { clipId: clip!.id, onDeleteClip };
}

describe("clip action buttons are reachable from the keyboard", () => {
  afterEach(() => {
    mediaCache.clear();
    vi.restoreAllMocks();
  });

  it("runs the action exactly once on Enter", async () => {
    const user = userEvent.setup();
    const { clipId, onDeleteClip } = renderStrip();

    const button = screen.getByTestId(`clip-delete-${clipId}`);
    button.focus();
    await user.keyboard("{Enter}");

    expect(onDeleteClip).toHaveBeenCalledTimes(1);
    expect(onDeleteClip).toHaveBeenCalledWith(clipId);
  });

  it("runs the action exactly once on Space", async () => {
    const user = userEvent.setup();
    const { clipId, onDeleteClip } = renderStrip();

    const button = screen.getByTestId(`clip-delete-${clipId}`);
    button.focus();
    await user.keyboard(" ");

    expect(onDeleteClip).toHaveBeenCalledTimes(1);
  });

  it("suppresses the synthesised click so pointer and keyboard cannot both fire", () => {
    const { clipId } = renderStrip();

    const button = screen.getByTestId(`clip-delete-${clipId}`);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores auto-repeat while a key is held", () => {
    const { clipId, onDeleteClip } = renderStrip();

    const button = screen.getByTestId(`clip-delete-${clipId}`);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    fireEvent.keyDown(button, { key: "Enter", repeat: true });

    expect(onDeleteClip).toHaveBeenCalledTimes(1);
  });

  it("leaves pointer activation working", () => {
    const { clipId, onDeleteClip } = renderStrip();

    fireEvent.pointerDown(screen.getByTestId(`clip-delete-${clipId}`), {
      pointerId: 1,
      button: 0,
    });

    expect(onDeleteClip).toHaveBeenCalledTimes(1);
  });
});
