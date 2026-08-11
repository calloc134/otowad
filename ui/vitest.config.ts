import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `virtual:pwa-register` only exists while VitePWA is in the pipeline,
      // and the test config leaves it out on purpose. The stub keeps the
      // import resolvable and lets tests drive the update lifecycle by hand.
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/pwaRegisterStub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.tsx"],
    css: false,
  },
});
