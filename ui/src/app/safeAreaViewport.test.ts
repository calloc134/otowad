import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");
const INDEX_HTML = path.resolve(import.meta.dirname, "../../index.html");

/**
 * `env(safe-area-inset-*)` resolves to 0 on every device unless the viewport
 * meta tag opts in with `viewport-fit=cover`. Nothing warns about the mismatch:
 * the CSS parses, the padding computes, and the value is just zero — so a
 * component can ask to stay clear of the notch, appear to be handled, and be
 * drawn under it anyway. That is what happened to the clip action bar and the
 * bottom sheet, which both carried a bottom inset that had never once applied.
 *
 * The two files have no other way to check each other, so this is where the
 * coupling lives.
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

function declaresViewportFitCover(html: string): boolean {
  const meta = /<meta\s[^>]*name=["']viewport["'][^>]*>/i.exec(html);
  if (!meta) return false;
  const content = /content=["']([^"']*)["']/i.exec(meta[0]);
  if (!content) return false;
  return content[1]!
    .split(",")
    .map((part) => part.trim().replace(/\s*=\s*/, "="))
    .includes("viewport-fit=cover");
}

function findSafeAreaConsumers(): string[] {
  const consumers: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    if (readFileSync(file, "utf8").includes("env(safe-area-inset-")) {
      consumers.push(path.relative(SRC_ROOT, file));
    }
  }
  return consumers;
}

test("asking for a safe-area inset means the viewport opted into reporting one", () => {
  const consumers = findSafeAreaConsumers();
  if (consumers.length === 0) return;

  assert.ok(
    declaresViewportFitCover(readFileSync(INDEX_HTML, "utf8")),
    `these ask for a safe-area inset, but without viewport-fit=cover every one of them resolves to 0: ${consumers.join(", ")}`,
  );
});

test("the mobile shell is the surface that keeps chrome out of the unsafe area", () => {
  const shell = readFileSync(
    path.join(SRC_ROOT, "components/app-shell/MobileAppShell.tsx"),
    "utf8",
  );

  // Landscape is the orientation this shell targets, so the notch lands on a
  // side edge rather than the top one.
  assert.match(shell, /paddingLeft: "env\(safe-area-inset-left, 0px\)"/);
  assert.match(shell, /paddingRight: "env\(safe-area-inset-right, 0px\)"/);
});

test("the detector tells an opted-in viewport from a lookalike", () => {
  const optedIn =
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />';
  assert.equal(declaresViewportFitCover(optedIn), true);
  assert.equal(
    declaresViewportFitCover('<meta name="viewport" content="width=device-width, initial-scale=1.0" />'),
    false,
  );
  // A different fit mode is not cover, and neither is a bare mention elsewhere.
  assert.equal(
    declaresViewportFitCover('<meta name="viewport" content="width=device-width, viewport-fit=contain" />'),
    false,
  );
  assert.equal(declaresViewportFitCover("<!-- viewport-fit=cover -->"), false);
  assert.equal(declaresViewportFitCover(""), false);
});
