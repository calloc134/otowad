import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpdatePrompt } from "./UpdatePrompt";
import { useServiceWorkerUpdate } from "@/hooks/useServiceWorkerUpdate.ts";
import { pwaRegisterStub } from "@/test/pwaRegisterStub.ts";

function Harness() {
  const update = useServiceWorkerUpdate();
  return <UpdatePrompt update={update} />;
}

beforeEach(() => {
  pwaRegisterStub.reset();
});

afterEach(() => {
  pwaRegisterStub.reset();
});

/** Fire a lifecycle callback the way the real service worker would. */
function emit(event: "onNeedRefresh" | "onOfflineReady") {
  const handler = pwaRegisterStub.options?.[event];
  if (!handler) {
    throw new Error(`registerSW was called without ${event}`);
  }
  act(() => handler());
}

describe("UpdatePrompt", () => {
  it("shows nothing until the service worker reports something", () => {
    render(<Harness />);

    expect(pwaRegisterStub.registerCount).toBe(1);
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    expect(screen.queryByTestId("offline-ready-toast")).toBeNull();
  });

  it("announces offline readiness and can be dismissed", () => {
    render(<Harness />);

    emit("onOfflineReady");
    expect(screen.getByTestId("offline-ready-toast")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("offline-ready-dismiss"));
    expect(screen.queryByTestId("offline-ready-toast")).toBeNull();
  });

  it("never reloads on its own when a new build arrives", () => {
    render(<Harness />);

    emit("onNeedRefresh");

    // The prompt is visible, but nothing has been activated: reloading here
    // would discard in-memory media the user has not saved.
    expect(screen.getByTestId("update-prompt")).toBeInTheDocument();
    expect(pwaRegisterStub.updateCalls).toEqual([]);
  });

  it("activates the waiting worker and reloads only when asked", () => {
    render(<Harness />);

    emit("onNeedRefresh");
    fireEvent.click(screen.getByTestId("update-prompt-reload"));

    // `true` is what tells the plugin to swap the worker and reload the page.
    expect(pwaRegisterStub.updateCalls).toEqual([true]);
  });

  it("warns that reloading costs unsaved media", () => {
    render(<Harness />);

    emit("onNeedRefresh");

    expect(screen.getByTestId("update-prompt")).toHaveTextContent(
      /discards imported media/i,
    );
  });

  it("prefers the update notice over the offline notice", () => {
    render(<Harness />);

    emit("onOfflineReady");
    emit("onNeedRefresh");

    // A pending update is the more consequential of the two.
    expect(screen.getByTestId("update-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("offline-ready-toast")).toBeNull();
  });
});
