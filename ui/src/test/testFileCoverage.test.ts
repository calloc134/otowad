import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Guards the two test runners against silently skipping files.
 *
 * `src/app/interaction-contracts/tool-mode.test.ts` sat unexecuted for its
 * entire lifetime because `test:unit` enumerated directories by hand and the
 * list was never updated. A test that never runs asserts nothing, so the gap
 * has to be structural rather than a convention people remember.
 *
 * Two invariants keep every test reachable:
 *   - node --test owns `src/**\/*.test.ts`
 *   - vitest owns `src/**\/*.test.tsx`
 * Any test file outside those two extensions belongs to no runner.
 */

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC_ROOT = path.join(UI_ROOT, "src");

const NODE_TEST_GLOB = "src/**/*.test.ts";
const VITEST_GLOB = "src/**/*.test.tsx";

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

function collectTestFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(absolute));
    } else if (TEST_FILE_PATTERN.test(entry.name)) {
      found.push(path.relative(UI_ROOT, absolute));
    }
  }
  return found;
}

test("every test file under src/ is claimed by node --test or vitest", () => {
  const orphaned = collectTestFiles(SRC_ROOT).filter(
    (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
  );

  assert.deepEqual(
    orphaned,
    [],
    `these files look like tests but no runner collects them; rename to .test.ts or .test.tsx: ${orphaned.join(", ")}`,
  );
});

test("test:unit collects unit tests recursively", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(UI_ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  assert.ok(
    packageJson.scripts["test:unit"]?.includes(NODE_TEST_GLOB),
    `test:unit must collect ${NODE_TEST_GLOB} so nested directories cannot be missed`,
  );
});

test("vitest collects component tests recursively", () => {
  const vitestConfig = readFileSync(path.join(UI_ROOT, "vitest.config.ts"), "utf8");

  assert.ok(
    vitestConfig.includes(VITEST_GLOB),
    `vitest include must be ${VITEST_GLOB} so nested directories cannot be missed`,
  );
});
