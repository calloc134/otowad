import assert from "node:assert/strict";
import test from "node:test";

import { ProjectWorkerRecovery } from "./projectWorkerRecovery.ts";

test("replacement worker rehydrates analysis without eagerly cloning all source PCM", async () => {
  const calls: string[] = [];
  const recovery = new ProjectWorkerRecovery(
    {
      replaceAnalysisArtifacts: async (entries, revision, mode) => {
        calls.push(`analysis:${revision}:${mode}:${entries.length}`);
      },
    },
    () => ({
      analysisEntries: [],
    }),
  );

  await recovery.ensureWorkerCaches(3);
  assert.deepEqual(calls, []);

  recovery.markWorkerReset(1);
  await Promise.all([
    recovery.ensureWorkerCaches(4),
    recovery.ensureWorkerCaches(4),
  ]);
  await recovery.ensureWorkerCaches(4);

  assert.deepEqual(calls, [
    "analysis:4:replace_all:0",
  ]);
});
