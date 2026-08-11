import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { afterEach } from "node:test";

import {
  applyProjectCommand,
  createProjectDocument,
  loadProjectDocument,
} from "../adapters/projectDocument.ts";
import {
  buildImportedAudioCommands,
  createImportedAudioTrack,
} from "../adapters/importFactories.ts";
import { createAudioBufferData } from "../audio/audioBufferData.ts";
import type { AnalysisArtifactLookup } from "../audio/playbackPreparation.ts";
import { renderProjectToAudioBufferData } from "../render/projectMixdown.ts";
import { encodeWav } from "../render/wavEncoder.ts";
import { installFakePersistenceDb } from "../test/fakePersistenceDb.ts";
import type { ProjectDocument } from "../types/index.ts";
import { initSync } from "../wasm/otomad_core.js";
import {
  __resetBrowserProjectStoreDbOpenerForTests,
  openBrowserProject,
  saveBrowserProject,
} from "./browserProjectStore.ts";
import { autoSave, clearAutoSave, loadAutoSave } from "./autosave.ts";
import {
  buildMediaArchivePath,
  buildProjectArchive,
  buildProjectArchiveMediaFiles,
  hydrateProjectArchiveMediaData,
  parseProjectArchive,
  prepareCanonicalProjectArchivePayload,
} from "./projectArchive.ts";
import { __resetOpenPersistenceDbForTests } from "./persistenceDb.ts";

initSync({
  module: readFileSync(path.resolve(process.cwd(), "src/wasm/otomad_core_bg.wasm")),
});

const TRACK_ID = "00000000-0000-0000-0000-0000000000a1";
const MEDIA_ID = "00000000-0000-0000-0000-0000000000b1";
const CONTENT_ID = "00000000-0000-0000-0000-0000000000c1";
const CLIP_ID = "00000000-0000-0000-0000-0000000000d1";

afterEach(() => {
  __resetBrowserProjectStoreDbOpenerForTests();
  __resetOpenPersistenceDbForTests();
});

test("import, autosave recovery, browser save, reopen, and render form one deterministic round-trip", async () => {
  installFakePersistenceDb();
  const source = createAudioBufferData(1, 4_800, 48_000);
  const samples = source.channels[0];
  if (!samples) throw new Error("expected mono source channel");
  for (let index = 0; index < samples.length; index++) {
    samples[index] = index % 3 === 0 ? 1 : index % 3 === 1 ? -1 : 0;
  }

  let project = createProjectDocument("Persistence E2E", 120, 48_000);
  project = applyProjectCommand(project, {
    command: "add_track",
    track: createImportedAudioTrack(TRACK_ID, "Imported Voice"),
  }).project;
  const importCommands = buildImportedAudioCommands({
    mediaId: MEDIA_ID,
    contentId: CONTENT_ID,
    clipId: CLIP_ID,
    fileName: "voice.wav",
    trackId: TRACK_ID,
    startTick: 0,
    audioBuffer: source as unknown as AudioBuffer,
    analysisRefs: [],
    contentHash: "sha256-pcm24-v1:persistence-e2e",
    reuseMediaAsset: false,
    microBpm: 120_000_000,
    ppq: 960,
  }, buildMediaArchivePath);
  project = applyProjectCommand(project, {
    command: "batch",
    commands: importCommands,
  }).project;
  project = applyProjectCommand(project, {
    command: "set_clip_gain",
    clip_id: CLIP_ID,
    gain_milli_db: -6_000,
  }).project;

  const autosaveJson = JSON.stringify(project);
  await autoSave(autosaveJson);
  assert.equal(await loadAutoSave(), autosaveJson);

  const restoredJson = await loadAutoSave();
  assert.ok(restoredJson, "autosave must be available after simulated reload");
  let restored = loadProjectDocument(restoredJson);
  restored = applyProjectCommand(restored, {
    command: "set_clip_gain",
    clip_id: CLIP_ID,
    gain_milli_db: -3_000,
  }).project;

  const canonical = prepareCanonicalProjectArchivePayload(restored);
  const mediaLookup = new Map([[MEDIA_ID, source]]);
  const archive = buildProjectArchive(
    canonical.projectJson,
    buildProjectArchiveMediaFiles(canonical.document, mediaLookup),
  );
  const saved = await saveBrowserProject({
    name: restored.meta.name,
    archiveBytes: archive,
  });
  await clearAutoSave();
  assert.equal(await loadAutoSave(), null, "successful manual save clears crash recovery");

  const reopenedSnapshot = await openBrowserProject(saved.id);
  assert.ok(reopenedSnapshot, "saved browser project must reopen");
  const parsedArchive = parseProjectArchive(reopenedSnapshot.archiveBytes);
  const reopened = loadProjectDocument(parsedArchive.projectJson);
  const reopenedCanonical = prepareCanonicalProjectArchivePayload(reopened);
  assert.deepEqual(
    JSON.parse(reopenedCanonical.projectJson),
    JSON.parse(canonical.projectJson),
  );

  const reopenedMedia = new Map(
    hydrateProjectArchiveMediaData(reopened, parsedArchive.mediaFiles)
      .map((entry) => [entry.mediaId, entry.buffer] as const),
  );
  const originalWav = await renderWav(restored, mediaLookup);
  const reopenedWav = await renderWav(reopened, reopenedMedia);
  assert.deepEqual(reopenedWav, originalWav);

  const view = new DataView(reopenedWav.buffer, reopenedWav.byteOffset, reopenedWav.byteLength);
  assert.equal(readAscii(view, 0, 4), "RIFF");
  assert.equal(readAscii(view, 8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 4_800 * 2 * 3);
});

async function renderWav(
  project: ProjectDocument,
  mediaLookup: Map<string, ReturnType<typeof createAudioBufferData>>,
): Promise<Uint8Array> {
  const rendered = await renderProjectToAudioBufferData(
    project,
    mediaLookup,
    EMPTY_ANALYSIS_LOOKUP,
    { sampleRate: 48_000, channels: 2, startTick: 0, endTick: 192 },
  );
  return new Uint8Array(encodeWav(rendered));
}

const EMPTY_ANALYSIS_LOOKUP: AnalysisArtifactLookup = {
  ensureForProject: async () => {},
  buildCompileInput: (project) => ({ project, analysisJson: "{}" }),
  resolveForAudioContent: () => ({
    sourceF0Track: null,
    sourcePitchMarks: null,
  }),
  getF0: () => undefined,
  getPitchMarks: () => undefined,
};

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index++) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
