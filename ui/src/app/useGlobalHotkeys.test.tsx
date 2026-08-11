import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGlobalHotkeys } from "./useGlobalHotkeys.ts";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import type { ProjectActions } from "@/store";
import type { ProjectDocument } from "@/types";

/**
 * This hook had no tests, which is why `Ctrl+Shift+Z` (redo) and
 * `Ctrl+Shift+E` (export) could sit unreachable indefinitely: both compared
 * `event.key` against a lowercase literal, and a real Shift-modified event
 * reports the uppercase character. The cases below dispatch the key values a
 * browser actually produces rather than the ones the old code assumed.
 */

function makeActions() {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    applyCommand: vi.fn(),
    setClipSelection: vi.fn(),
    clearSelection: vi.fn(),
    setPlayhead: vi.fn(),
  } as unknown as ProjectActions & {
    undo: ReturnType<typeof vi.fn>;
    redo: ReturnType<typeof vi.fn>;
  };
}

function mountHotkeys(overrides: Record<string, unknown> = {}) {
  const actions = makeActions();
  const exportWav = vi.fn(async () => {});
  const saveProjectToBrowser = vi.fn(async () => true);
  const play = vi.fn(async () => {});
  const stop = vi.fn();

  const view = renderHook(() =>
    useGlobalHotkeys({
      document: null as ProjectDocument | null,
      selectedClipIds: [],
      primaryClipId: null,
      playheadTick: 0,
      midiEditorOpen: false,
      busy: false,
      anyDialogOpen: false,
      projectDialogOpen: false,
      setProjectDialogOpen: vi.fn(),
      isPlaying: false,
      actions,
      saveProjectToBrowser,
      refreshBrowserProjects: vi.fn(async () => {}),
      exportWav,
      play,
      stop,
      interactionPolicy: { allowsModifierShortcuts: true },
      ...overrides,
    }),
  );

  return { view, actions, exportWav, saveProjectToBrowser, play, stop };
}

function pressKey(init: KeyboardEventInit, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("modifier shortcuts survive Shift and CapsLock", () => {
  it("redoes on Ctrl+Shift+Z, which reports key as an uppercase Z", () => {
    const { actions } = mountHotkeys();

    pressKey({ key: "Z", ctrlKey: true, shiftKey: true });

    expect(actions.redo).toHaveBeenCalledTimes(1);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("still undoes on Ctrl+Z without Shift", () => {
    const { actions } = mountHotkeys();

    pressKey({ key: "z", ctrlKey: true });

    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect(actions.redo).not.toHaveBeenCalled();
  });

  it("exports on Ctrl+Shift+E, which reports key as an uppercase E", () => {
    const { exportWav } = mountHotkeys();

    pressKey({ key: "E", ctrlKey: true, shiftKey: true });

    expect(exportWav).toHaveBeenCalledTimes(1);
  });

  it("saves on Ctrl+S with CapsLock on", () => {
    const { saveProjectToBrowser } = mountHotkeys();

    pressKey({ key: "S", ctrlKey: true });

    expect(saveProjectToBrowser).toHaveBeenCalledTimes(1);
  });

  it("treats Meta as equivalent to Ctrl for redo", () => {
    const { actions } = mountHotkeys();

    pressKey({ key: "Z", metaKey: true, shiftKey: true });

    expect(actions.redo).toHaveBeenCalledTimes(1);
  });
});

describe("keystrokes owned by text entry never reach the timeline", () => {
  it("ignores Space while a select has focus", () => {
    const select = document.createElement("select");
    document.body.append(select);
    const { play } = mountHotkeys();

    pressKey({ key: " " }, select);

    expect(play).not.toHaveBeenCalled();
  });

  it("ignores Space inside a contentEditable region", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    const { play } = mountHotkeys();

    pressKey({ key: " " }, editable);

    expect(play).not.toHaveBeenCalled();
  });

  it("ignores keystrokes emitted mid-IME-composition", () => {
    const { play } = mountHotkeys();

    pressKey({ key: " ", isComposing: true });

    expect(play).not.toHaveBeenCalled();
  });

  it("still starts playback on a bare Space", () => {
    const { play } = mountHotkeys();

    pressKey({ key: " " });

    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("an open dialog withholds clip editing but not transport or history", () => {
  /**
   * A real project with a real selection, because every clip-editing branch
   * bails out early on a null document — asserting against the default mount
   * would pass whether or not the dialog guard exists.
   */
  function mountWithSelection(anyDialogOpen: boolean) {
    const project = createBaseTimelineProject();
    const clip = project.edit.clips.find((c) => c.kind.clip_type === "audio");
    expect(clip).toBeDefined();

    return {
      ...mountHotkeys({
        anyDialogOpen,
        document: project,
        selectedClipIds: [clip!.id],
        primaryClipId: clip!.id,
        playheadTick: clip!.start + 10,
      }),
      clipId: clip!.id,
    };
  }

  it("suppresses Delete so a dialog field cannot delete the selection", () => {
    const { actions } = mountWithSelection(true);

    pressKey({ key: "Delete" });

    expect(actions.applyCommand).not.toHaveBeenCalled();
  });

  it("deletes the selection when no dialog is open", () => {
    const { actions } = mountWithSelection(false);

    pressKey({ key: "Delete" });

    expect(actions.applyCommand).toHaveBeenCalledTimes(1);
  });

  it("suppresses the bare split key", () => {
    const { actions } = mountWithSelection(true);

    pressKey({ key: "s" });

    expect(actions.applyCommand).not.toHaveBeenCalled();
  });

  it("splits when no dialog is open", () => {
    const { actions } = mountWithSelection(false);

    pressKey({ key: "s" });

    expect(actions.applyCommand).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate on Ctrl+D", () => {
    const { actions } = mountWithSelection(true);

    pressKey({ key: "d", ctrlKey: true });

    expect(actions.applyCommand).not.toHaveBeenCalled();
  });

  it("duplicates when no dialog is open", () => {
    const { actions } = mountWithSelection(false);

    pressKey({ key: "d", ctrlKey: true });

    expect(actions.applyCommand).toHaveBeenCalledTimes(1);
  });

  it("suppresses pitch nudges, which share Shift plus the number row with numeric fields", () => {
    const { actions } = mountWithSelection(true);

    pressKey({ key: ")", shiftKey: true });
    pressKey({ key: "(", shiftKey: true });
    pressKey({ key: "*", shiftKey: true });
    pressKey({ key: "&", shiftKey: true });

    expect(actions.applyCommand).not.toHaveBeenCalled();
  });

  it("nudges pitch when no dialog is open", () => {
    const { actions } = mountWithSelection(false);

    pressKey({ key: ")", shiftKey: true });

    expect(actions.applyCommand).toHaveBeenCalledTimes(1);
  });

  it("keeps Space on transport so values can be auditioned against playback", () => {
    const { play } = mountHotkeys({ anyDialogOpen: true });

    pressKey({ key: " " });

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("keeps undo available while a dialog is open", () => {
    const { actions } = mountHotkeys({ anyDialogOpen: true });

    pressKey({ key: "z", ctrlKey: true });

    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it("keeps Ctrl+S on save, which shares a letter with split", () => {
    const { saveProjectToBrowser } = mountHotkeys({ anyDialogOpen: true });

    pressKey({ key: "s", ctrlKey: true });

    expect(saveProjectToBrowser).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to the dialog instead of clearing the clip selection", () => {
    const { actions } = mountHotkeys({ anyDialogOpen: true });

    pressKey({ key: "Escape" });

    expect(actions.clearSelection).not.toHaveBeenCalled();
  });

  it("still clears the selection on Escape with no dialog open", () => {
    const { actions } = mountHotkeys();

    pressKey({ key: "Escape" });

    expect(actions.clearSelection).toHaveBeenCalledTimes(1);
  });
});

describe("guards that must keep working", () => {
  it("suppresses shortcuts while a task is busy", () => {
    const { actions } = mountHotkeys({ busy: true });

    pressKey({ key: "Z", ctrlKey: true, shiftKey: true });

    expect(actions.redo).not.toHaveBeenCalled();
  });

  it("keeps Space bound to transport while the MIDI editor is open", () => {
    const { play } = mountHotkeys({ midiEditorOpen: true });

    pressKey({ key: " " });

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("withholds modifier shortcuts when the policy disallows them", () => {
    const { actions } = mountHotkeys({
      interactionPolicy: { allowsModifierShortcuts: false },
    });

    pressKey({ key: "Z", ctrlKey: true, shiftKey: true });

    expect(actions.redo).not.toHaveBeenCalled();
  });
});
