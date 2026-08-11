import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FullscreenToggle } from "./FullscreenToggle";

/**
 * jsdom implements none of the Fullscreen API, so every property under test
 * has to be installed as an own property that shadows the prototype and is
 * deleted again afterwards.
 */
const patched: Array<{ target: object; key: string }> = [];

function patch(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  patched.push({ target, key });
}

afterEach(() => {
  for (const { target, key } of patched) {
    delete (target as Record<string, unknown>)[key];
  }
  patched.length = 0;
  vi.restoreAllMocks();
});

function stubFullscreen(options: { enabled: boolean; element?: Element | null }) {
  patch(document, "fullscreenEnabled", options.enabled);
  patch(document, "fullscreenElement", options.element ?? null);
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  patch(document.documentElement, "requestFullscreen", requestFullscreen);
  patch(document, "exitFullscreen", exitFullscreen);
  return { requestFullscreen, exitFullscreen };
}

describe("FullscreenToggle", () => {
  it("renders nothing where element fullscreen is unavailable", () => {
    // iPhone Safari: the prefixed method exists but fullscreen is not allowed.
    stubFullscreen({ enabled: false });
    patch(document, "webkitFullscreenEnabled", false);

    render(<FullscreenToggle />);

    expect(screen.queryByTestId("fullscreen-toggle")).toBeNull();
  });

  it("enters fullscreen when pressed from a windowed document", () => {
    const { requestFullscreen, exitFullscreen } = stubFullscreen({ enabled: true });

    render(<FullscreenToggle />);
    const button = screen.getByTestId("fullscreen-toggle");
    expect(button).toHaveAttribute("aria-label", "Enter fullscreen");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("leaves fullscreen when pressed while fullscreen", () => {
    const { requestFullscreen, exitFullscreen } = stubFullscreen({
      enabled: true,
      element: document.documentElement,
    });

    render(<FullscreenToggle />);
    const button = screen.getByTestId("fullscreen-toggle");
    expect(button).toHaveAttribute("aria-label", "Exit fullscreen");
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("follows the browser when fullscreen ends without the button", () => {
    // Escape and the system gesture both leave fullscreen without going
    // through `toggle`. A mirrored boolean would keep claiming "Exit".
    stubFullscreen({ enabled: true, element: document.documentElement });

    render(<FullscreenToggle />);
    expect(screen.getByTestId("fullscreen-toggle")).toHaveAttribute(
      "aria-label",
      "Exit fullscreen",
    );

    patch(document, "fullscreenElement", null);
    fireEvent(document, new Event("fullscreenchange"));

    expect(screen.getByTestId("fullscreen-toggle")).toHaveAttribute(
      "aria-label",
      "Enter fullscreen",
    );
  });

  it("falls back to the prefixed API Safari still ships", () => {
    patch(document, "fullscreenEnabled", undefined);
    patch(document, "webkitFullscreenEnabled", true);
    patch(document, "webkitFullscreenElement", null);
    const webkitRequestFullscreen = vi.fn();
    patch(document.documentElement, "webkitRequestFullscreen", webkitRequestFullscreen);

    render(<FullscreenToggle />);
    fireEvent.click(screen.getByTestId("fullscreen-toggle"));

    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });
});
