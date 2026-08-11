import { readFileSync } from "node:fs";
import path from "node:path";

import { initSync } from "../wasm/otomad_core.js";

let wasmInitialized = false;

export function ensureTestWasmReady(): void {
  if (wasmInitialized) {
    return;
  }

  initSync({
    module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
  });
  wasmInitialized = true;
}
