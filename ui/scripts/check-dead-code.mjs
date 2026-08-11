#!/usr/bin/env node
/**
 * Fails when dead code appears that is not already in the baseline.
 *
 * The audit found the same shape in more than ten subsystems: a type, error
 * code, capability flag or helper that is exported, tested for its shape, and
 * reached by nothing. Read from the outside it looks like a working feature.
 *
 * Clearing the whole backlog at once is not practical — the baseline records
 * what exists today so the count can only go down. Anything new fails here.
 *
 * Usage:
 *   node scripts/check-dead-code.mjs            check against the baseline
 *   node scripts/check-dead-code.mjs --update   rewrite the baseline
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const UI_ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_PATH = path.join(UI_ROOT, "knip-baseline.json");

/** Issue keys worth gating on. `files` and `duplicates` are included; the
 *  dependency keys are noisier and are reported by knip directly. */
const GATED_KEYS = ["files", "exports", "types", "duplicates", "enumMembers"];

function collectFindings() {
  const raw = execFileSync(
    "npx",
    ["knip", "--no-progress", "--reporter", "json", "--no-exit-code"],
    { cwd: UI_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const findings = new Set();
  for (const issue of JSON.parse(raw).issues ?? []) {
    for (const key of GATED_KEYS) {
      for (const entry of issue[key] ?? []) {
        const name = typeof entry === "string" ? entry : entry.name;
        findings.add(`${key}\t${issue.file}\t${name}`);
      }
    }
  }
  return [...findings].sort();
}

function formatFinding(finding) {
  const [kind, file, name] = finding.split("\t");
  return `  ${kind.padEnd(9)} ${file}:${name}`;
}

const findings = collectFindings();

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(findings, null, 2)}\n`);
  console.log(`Baseline updated: ${findings.length} findings.`);
  process.exit(0);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
const added = findings.filter((finding) => !baseline.has(finding));
const removed = [...baseline].filter((finding) => !findings.includes(finding));

if (removed.length > 0) {
  console.log(`${removed.length} baseline finding(s) resolved:`);
  for (const finding of removed.sort()) console.log(formatFinding(finding));
  console.log("\nRun `npm run lint:deadcode -- --update` to shrink the baseline.\n");
}

if (added.length > 0) {
  console.error(`${added.length} new unreferenced export(s) or file(s):`);
  for (const finding of added) console.error(formatFinding(finding));
  console.error(
    "\nWire it to a consumer or delete it. If it is genuinely staged work,\n" +
      "run `npm run lint:deadcode -- --update` and say why in the commit.",
  );
  process.exit(1);
}

console.log(`No new dead code. Baseline holds ${baseline.size} known finding(s).`);
