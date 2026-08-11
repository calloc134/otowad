import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    VitePWA({
      // `public/manifest.webmanifest` is hand-written and linked from
      // index.html. Letting the plugin emit its own would leave two manifests
      // competing for the same `rel="manifest"`.
      manifest: false,
      // No auto-registration: the update prompt owns the lifecycle, because
      // this app must never reload itself (see `useServiceWorkerUpdate`).
      injectRegister: null,
      registerType: "prompt",
      workbox: {
        // The default glob has no `wasm`, and wasm is the one asset the app
        // cannot start without. Precaching everything but that would produce
        // an "offline-capable" build that dies on load with no network.
        globPatterns: ["**/*.{js,css,html,wasm,png,webmanifest}"],
        // The optional FFmpeg core expands to ~32MB. Prebuild prepares it as a
        // ~10MB self-hosted gzip asset, fetched only after native
        // decodeAudioData reports an unsupported encoding.
        globIgnores: ["**/*ffmpeg*"],
        // The core wasm is ~1.2MB today and grows with the DSP work. Workbox's
        // 2MB default drops oversized files from the precache with only a
        // build-log warning, so give it real headroom rather than discovering
        // the miss in production.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
      // A service worker in dev caches the very files being edited.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (WASM threads in future)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
