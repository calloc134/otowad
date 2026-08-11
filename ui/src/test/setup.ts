import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { initSync } from "@/wasm/otomad_core.js";

initSync({
  module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
});

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
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

if (typeof window.requestAnimationFrame !== "function") {
  Object.defineProperty(window, "requestAnimationFrame", {
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16),
  });
}

if (typeof window.cancelAnimationFrame !== "function") {
  Object.defineProperty(window, "cancelAnimationFrame", {
    writable: true,
    value: (handle: number) => window.clearTimeout(handle),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
