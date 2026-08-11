import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const DESIGN_SYSTEM_ROOT = path.resolve(process.cwd(), "src/design-system");
const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const BANNED_IMPORT_PATTERNS = [
  /design-system\/primitives\.tsx/g,
  /design-system\/tokens\.ts/g,
  /design-system\/contracts\.ts/g,
];

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath === DESIGN_SYSTEM_ROOT) {
        continue;
      }
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }
  return files;
}

test("design-system barrel re-exports the public modules", () => {
  const barrel = readFileSync(path.join(DESIGN_SYSTEM_ROOT, "index.ts"), "utf8");

  assert.match(barrel, /export \* from "\.\/contracts\.ts";/);
  assert.match(barrel, /export \* from "\.\/primitives\.tsx";/);
  assert.match(barrel, /export \* from "\.\/tokens\.ts";/);
});

test("source files consume design-system through the barrel", () => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(SOURCE_ROOT)) {
    const content = readFileSync(filePath, "utf8");
    if (BANNED_IMPORT_PATTERNS.some((pattern) => pattern.test(content))) {
      violations.push(path.relative(SOURCE_ROOT, filePath));
    }
    for (const pattern of BANNED_IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
    }
  }

  assert.deepEqual(violations, []);
});
