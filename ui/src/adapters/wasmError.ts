/**
 * Structured error thrown across the WASM boundary.
 *
 * The Rust bridge (`core/src/wasm_bridge.rs`) throws a JsValue that is a JSON
 * string like `{"code":"UNSUPPORTED_SCHEMA","message":"..."}`. This helper
 * parses that shape and falls back to plain string conversion when the caught
 * value is not structured (e.g. a raw string, an Error, or an unknown value).
 */
export interface WasmError {
  code: string;
  message: string;
}

export function parseWasmError(caught: unknown): WasmError {
  const asString = extractErrorText(caught);
  if (asString.startsWith("{") && asString.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(asString);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "code" in parsed &&
        "message" in parsed &&
        typeof (parsed as WasmError).code === "string" &&
        typeof (parsed as WasmError).message === "string"
      ) {
        return { code: (parsed as WasmError).code, message: (parsed as WasmError).message };
      }
    } catch {
      // fall through
    }
  }
  return { code: "UNKNOWN_ERROR", message: asString };
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

/** Convenience: extract just the human-readable message from a caught error. */
export function wasmErrorMessage(caught: unknown): string {
  return parseWasmError(caught).message;
}
