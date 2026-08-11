import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Panda extracts styles statically, so it cannot follow an imported object.
 * `css({ background: designTokens.surface.shell })` still produces a class
 * name, but no rule is ever emitted for it — the style silently does nothing.
 * That is how the toolbar surface went without a background.
 *
 * Inline `style={{ ... }}` is evaluated at runtime and is unaffected, so this
 * only looks inside `css({ ... })` and recipe definitions.
 */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "wasm" || entry === "node_modules") continue;
      yield* walk(full);
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      yield full;
    }
  }
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Spans of `css({ ... })` and `defineRecipe({ ... })`, brace-matched. */
function extractStaticStyleBlocks(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const blocks: string[] = [];
  const opener = /\b(?:css|defineRecipe)\(\{/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(match.index, index));
  }

  return blocks;
}

test("no static style block reads a value Panda cannot resolve", () => {
  const offenders: string[] = [];

  for (const file of walk(SRC_ROOT)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes("designTokens.") && !source.includes("typeStyles.")) continue;

    for (const block of extractStaticStyleBlocks(source)) {
      if (block.includes("designTokens.") || block.includes("typeStyles.")) {
        offenders.push(path.relative(SRC_ROOT, file));
        break;
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files style through an imported object, so Panda emits no rule: ${offenders.join(", ")}`,
  );
});

test("the extractor finds the pattern it is meant to catch", () => {
  const sample = [
    "const a = css({ background: designTokens.surface.shell });",
    'const b = css({ background: "var(--surface-shell)" });',
    "const c = css({",
    "  // mentions designTokens.surface.shell only to explain itself",
    '  background: "var(--surface-shell)",',
    "});",
  ].join("\n");
  const blocks = extractStaticStyleBlocks(sample);

  assert.equal(blocks.length, 3);
  assert.ok(blocks[0]!.includes("designTokens."));
  assert.ok(!blocks[1]!.includes("designTokens."));
  // A comment is not a style value.
  assert.ok(!blocks[2]!.includes("designTokens."));
});
