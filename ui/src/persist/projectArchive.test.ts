import test from "node:test";
import assert from "node:assert/strict";
import { ensureTestWasmReady } from "../test/ensureTestWasm.ts";
import type { AudioBufferSource } from "../audio/audioBufferData.ts";
import {
  encodeWav,
} from "../render/wavEncoder.ts";
import type { ProjectDocument } from "../types/index.ts";
import {
  buildAnalysisArchivePath,
  buildMediaArchivePath,
  buildProjectArchive,
  buildProjectArchiveAnalysisFiles,
  buildProjectArchiveMediaFiles,
  collectReferencedAudioMedia,
  collectReferencedAnalysisIds,
  decodePcmWavToAudioBufferData,
  hydrateProjectArchiveMediaData,
  hydrateProjectArchiveMediaDataSafely,
  makeProjectArchiveFileName,
  parseProjectArchive,
  parseProjectArchiveAnalysisFiles,
  prepareCanonicalProjectArchivePayload,
  prepareProjectDocumentForArchive,
  PROJECT_ARCHIVE_WAV_BITS_PER_SAMPLE,
  shouldReuseProjectArchiveHandle,
} from "./projectArchive.ts";
import type { AnalysisArtifact } from "../types/index.ts";
import { parseProjectDocumentJsonForTests } from "../adapters/projectDocument.ts";

ensureTestWasmReady();

class FakeAudioBuffer {
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(channels: Float32Array[], sampleRate: number) {
    this.channels = channels;
    this.sampleRate = sampleRate;
  }

  get numberOfChannels(): number {
    return this.channels.length;
  }

  get length(): number {
    return this.channels[0]?.length ?? 0;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) {
      throw new RangeError(`Missing channel ${channel}`);
    }
    return data;
  }
}

test("prepareProjectDocumentForArchive normalizes media paths without mutating the source document", () => {
  const source = createProjectDocument();
  const prepared = prepareProjectDocumentForArchive(source);

  assert.equal(source.edit.media[0]?.in_zip_path, "lead.wav");
  assert.equal(
    prepared.edit.media[0]?.in_zip_path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"),
  );
  assert.equal(
    prepared.edit.media[1]?.in_zip_path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a2"),
  );
});

test("prepareCanonicalProjectArchivePayload reuses the archive normalization path for canonical project.json", () => {
  const source = createProjectDocument();

  const payload = prepareCanonicalProjectArchivePayload(source);
  const parsed = parseProjectDocumentJsonForTests(payload.projectJson) as ProjectDocument;

  assert.equal(source.edit.media[0]?.in_zip_path, "lead.wav");
  assert.equal(parsed.meta.name, source.meta.name);
  assert.equal(
    parsed.edit.media[0]?.in_zip_path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"),
  );
  assert.equal(
    parsed.edit.media[1]?.in_zip_path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a2"),
  );
  assert.equal(
    payload.document.edit.media[0]?.in_zip_path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"),
  );
});

test("collectReferencedAudioMedia follows audio clip reachability and ignores unused media", () => {
  const prepared = prepareProjectDocumentForArchive(createProjectDocument());

  const referenced = collectReferencedAudioMedia(prepared);

  assert.deepEqual(
    referenced.map((asset) => asset.id),
    ["00000000-0000-0000-0000-0000000000a1"],
  );
});

test("buildProjectArchiveMediaFiles encodes referenced media once and preserves multichannel WAV headers", () => {
  const prepared = prepareProjectDocumentForArchive(createProjectDocument());
  const buffer = new FakeAudioBuffer(
    [
      new Float32Array([0, 0.5, -0.5, 0]),
      new Float32Array([0.1, 0.2, -0.2, -0.1]),
      new Float32Array([0.25, -0.25, 0.25, -0.25]),
    ],
    48_000,
  );

  const files = buildProjectArchiveMediaFiles(prepared, {
    get(mediaId) {
      return mediaId === "00000000-0000-0000-0000-0000000000a1" ? buffer : undefined;
    },
  });

  assert.equal(files.length, 1);
  assert.equal(
    files[0]?.path,
    buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"),
  );

  const wavBytes = files[0]?.bytes;
  assert.ok(wavBytes);
  const view = new DataView(
    wavBytes.buffer,
    wavBytes.byteOffset,
    wavBytes.byteLength,
  );
  assert.equal(readAscii(view, 0, 4), "RIFF");
  assert.equal(readAscii(view, 8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 3);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(34, true), PROJECT_ARCHIVE_WAV_BITS_PER_SAMPLE);
});

test("decodePcmWavToAudioBufferData hydrates worker-friendly PCM buffers", () => {
  const buffer = new FakeAudioBuffer([
    new Float32Array([0, 0.5, -0.5, 0.25]),
  ], 48_000);
  const wavBytes = new Uint8Array(encodeTestWav(buffer));

  const hydrated = decodePcmWavToAudioBufferData(wavBytes);

  assert.equal(hydrated.numberOfChannels, 1);
  assert.equal(hydrated.sampleRate, 48_000);
  assert.deepEqual(
    Array.from(hydrated.channels[0] ?? []).map((value) => Number(value.toFixed(4))),
    [0, 0.5, -0.5, 0.25],
  );
});

test("decodePcmWavToAudioBufferData can read legacy 16-bit PCM when explicitly allowed", () => {
  const buffer = new FakeAudioBuffer([
    new Float32Array([0, 0.5, -0.5, 0.25]),
  ], 48_000);
  const wavBytes = new Uint8Array(encodeWav(buffer, { bitsPerSample: 16 }));

  const hydrated = decodePcmWavToAudioBufferData(wavBytes, {
    allowedBitsPerSample: [16, PROJECT_ARCHIVE_WAV_BITS_PER_SAMPLE],
  });

  assert.equal(hydrated.numberOfChannels, 1);
  assert.equal(hydrated.sampleRate, 48_000);
  assert.deepEqual(
    Array.from(hydrated.channels[0] ?? []).map((value) => Number(value.toFixed(4))),
    [0, 0.5, -0.5, 0.25],
  );
});

test("decodePcmWavToAudioBufferData rejects legacy 16-bit PCM by default", () => {
  const buffer = new FakeAudioBuffer([
    new Float32Array([0, 0.5, -0.5, 0.25]),
  ], 48_000);
  const wavBytes = new Uint8Array(encodeWav(buffer, { bitsPerSample: 16 }));

  assert.throws(
    () => decodePcmWavToAudioBufferData(wavBytes),
    /Only 24-bit PCM WAV archive media is supported\./,
  );
});

test("hydrateProjectArchiveMediaData decodes referenced archive media without main-thread decodeAudioData", () => {
  const prepared = prepareProjectDocumentForArchive(createProjectDocument());
  const wavBytes = new Uint8Array(encodeTestWav(new FakeAudioBuffer([
    new Float32Array([0, 1, 0, -1]),
  ], 44_100)));

  const hydrated = hydrateProjectArchiveMediaData(prepared, new Map([
    [buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"), wavBytes],
  ]));

  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0]?.mediaId, "00000000-0000-0000-0000-0000000000a1");
  assert.equal(hydrated[0]?.buffer.sampleRate, 44_100);
});

test("safe archive hydration reports missing media while preserving the project for relink", () => {
  const prepared = prepareProjectDocumentForArchive(createProjectDocument());

  const result = hydrateProjectArchiveMediaDataSafely(prepared, new Map());

  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.issues.map(({ mediaId, status }) => ({ mediaId, status })), [{
    mediaId: "00000000-0000-0000-0000-0000000000a1",
    status: "missing",
  }]);
});

test("buildProjectArchiveMediaFiles throws when a referenced media buffer is missing", () => {
  const prepared = prepareProjectDocumentForArchive(createProjectDocument());

  assert.throws(
    () => buildProjectArchiveMediaFiles(prepared, { get: () => undefined }),
    /Missing media buffer for referenced media asset 00000000-0000-0000-0000-0000000000a1/,
  );
});

test("buildProjectArchive and parseProjectArchive round-trip project JSON and media bytes", () => {
  const projectJson = JSON.stringify(prepareProjectDocumentForArchive(createProjectDocument()), null, 2);
  const mediaBytes = new Uint8Array([1, 2, 3, 4]);

  const archive = buildProjectArchive(projectJson, [
    {
      mediaId: "00000000-0000-0000-0000-0000000000a1",
      path: buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1"),
      bytes: mediaBytes,
    },
  ]);
  const parsed = parseProjectArchive(archive);

  assert.equal(parsed.projectJson, projectJson);
  assert.deepEqual(
    Array.from(parsed.mediaFiles.keys()),
    [buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1")],
  );
  assert.deepEqual(
    Array.from(parsed.mediaFiles.get(buildMediaArchivePath("00000000-0000-0000-0000-0000000000a1")) ?? []),
    Array.from(mediaBytes),
  );
  assert.deepEqual(Array.from(parsed.analysisFiles.keys()), []);
});

test("parseProjectArchive rejects central entries that alias one local file range", () => {
  const sharedBytes = Uint8Array.from([1, 2, 3, 4]);
  const archive = buildProjectArchive("{}", [
    { mediaId: "media-a", path: "media/a.wav", bytes: sharedBytes },
    { mediaId: "media-b", path: "media/b.wav", bytes: sharedBytes },
  ]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const centralEntries = findCentralDirectoryEntries(archive);
  assert.equal(centralEntries.length, 3);
  const firstMediaEntry = centralEntries[1];
  const secondMediaEntry = centralEntries[2];
  if (firstMediaEntry === undefined || secondMediaEntry === undefined) {
    throw new Error("expected two media central-directory entries");
  }
  view.setUint32(
    secondMediaEntry + 42,
    view.getUint32(firstMediaEntry + 42, true),
    true,
  );

  assert.throws(
    () => parseProjectArchive(archive),
    /overlapping local file ranges/,
  );
});

test("parseProjectArchive rejects traversal paths from external ZIP entries", () => {
  const archive = buildProjectArchive("{}", [
    {
      mediaId: "media-a",
      path: "media/a.wav",
      bytes: Uint8Array.from([1, 2, 3, 4]),
    },
  ]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const [, mediaEntry] = findCentralDirectoryEntries(archive);
  if (mediaEntry === undefined) throw new Error("expected media entry");
  const localHeaderOffset = view.getUint32(mediaEntry + 42, true);
  const traversalPath = new TextEncoder().encode("../evil.wav");
  assert.equal(traversalPath.byteLength, view.getUint16(mediaEntry + 28, true));
  archive.set(traversalPath, mediaEntry + 46);
  archive.set(traversalPath, localHeaderOffset + 30);

  assert.throws(
    () => parseProjectArchive(archive),
    /must not contain traversal segments/,
  );
});

test("parseProjectArchive rejects an entry count above the project limit", () => {
  const archive = buildProjectArchive("{}", []);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocdOffset = findEocdOffset(archive);
  view.setUint16(eocdOffset + 8, 4_097, true);
  view.setUint16(eocdOffset + 10, 4_097, true);

  assert.throws(
    () => parseProjectArchive(archive),
    /at most 4096 entries/,
  );
});

test("parseProjectArchive rejects an entry larger than the project limit before reading data", () => {
  const archive = buildProjectArchive("{}", []);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const [projectEntry] = findCentralDirectoryEntries(archive);
  if (projectEntry === undefined) throw new Error("expected project.json entry");
  const oversizedEntry = 1_073_741_825;
  view.setUint32(projectEntry + 20, oversizedEntry, true);
  view.setUint32(projectEntry + 24, oversizedEntry, true);

  assert.throws(
    () => parseProjectArchive(archive),
    /entry size exceeds 1 GiB/,
  );
});

test("parseProjectArchive rejects central and local flag disagreement", () => {
  const archive = buildProjectArchive("{}", []);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const [projectEntry] = findCentralDirectoryEntries(archive);
  if (projectEntry === undefined) throw new Error("expected project.json entry");
  view.setUint16(projectEntry + 8, 0, true);

  assert.throws(
    () => parseProjectArchive(archive),
    /local header disagrees with project\.json/,
  );
});

test("analysis artifacts round-trip through optional analysis/ archive entries", () => {
  const project = createProjectDocument();
  const firstContent = project.edit.contents[0];
  if (!firstContent || firstContent.type !== "audio") {
    throw new Error("expected first content to be audio");
  }
  project.edit.contents[0] = {
    ...firstContent,
    analysis_refs: [
      "00000000-0000-0000-0000-0000000000d1",
      "00000000-0000-0000-0000-0000000000d2",
    ],
  };
  const analysisArtifacts = new Map<string, AnalysisArtifact>([
    [
      "00000000-0000-0000-0000-0000000000d1",
      {
        kind: "f0_track",
        schema_version: 1,
        media_id: "00000000-0000-0000-0000-0000000000a1",
        src_sample_rate: 48_000,
        created_by: { app_version: "test", algo_version: "1", params_hash: "f0" },
        hop_src_frames: 240,
        f0_hz_x100: [44_000],
        voiced_prob_permille: [900],
        method: "test",
        params: "{}",
      },
    ],
    [
      "00000000-0000-0000-0000-0000000000d2",
      {
        kind: "pitch_marks",
        schema_version: 1,
        media_id: "00000000-0000-0000-0000-0000000000a1",
        src_sample_rate: 48_000,
        created_by: { app_version: "test", algo_version: "1", params_hash: "pm" },
        marks_src_frames: [120],
        mark_features: [{
          transient_value: 0.1,
          onset_value: 0.2,
          cycle_energy: 0.3,
          tonality: 0.4,
          confidence: 0.5,
          epoch_strength: 0.6,
          gci_quality: 0.7,
          left_period_samples: 100,
          right_period_samples: 101,
          excitation_balance: 0.8,
          expression_baseline_hz_x100: 22_000,
          expression_deviation_cents: 12,
          local_pitch_hz_x100: 22_100,
        }],
        mark_policy: "test",
        params: "{}",
      },
    ],
  ]);

  const payload = prepareCanonicalProjectArchivePayload(project, analysisArtifacts);
  assert.deepEqual(collectReferencedAnalysisIds(payload.document), [
    "00000000-0000-0000-0000-0000000000d1",
    "00000000-0000-0000-0000-0000000000d2",
  ]);

  const archive = buildProjectArchive(
    payload.projectJson,
    [],
    buildProjectArchiveAnalysisFiles(payload.document, analysisArtifacts),
  );
  const parsed = parseProjectArchive(archive);
  const parsedArtifacts = parseProjectArchiveAnalysisFiles(parsed.analysisFiles);

  assert.deepEqual(Array.from(parsed.analysisFiles.keys()), [
    buildAnalysisArchivePath("00000000-0000-0000-0000-0000000000d1"),
    buildAnalysisArchivePath("00000000-0000-0000-0000-0000000000d2"),
  ]);
  assert.equal(parsedArtifacts.get("00000000-0000-0000-0000-0000000000d1")?.kind, "f0_track");
  const parsedPitchMarks = parsedArtifacts.get("00000000-0000-0000-0000-0000000000d2");
  assert.equal(parsedPitchMarks?.kind, "pitch_marks");
  assert.equal(
    parsedPitchMarks?.kind === "pitch_marks"
      ? parsedPitchMarks.mark_features?.[0]?.expression_deviation_cents
      : undefined,
    12,
  );
});

test("parseProjectArchiveAnalysisFiles infers kind for legacy bare analysis payloads", () => {
  const analysisFiles = new Map<string, Uint8Array>([
    [
      buildAnalysisArchivePath("00000000-0000-0000-0000-0000000000d1"),
      new TextEncoder().encode(JSON.stringify({
        schema_version: 1,
        media_id: "00000000-0000-0000-0000-0000000000a1",
        src_sample_rate: 48_000,
        created_by: { app_version: "test", algo_version: "1", params_hash: "f0" },
        hop_src_frames: 240,
        f0_hz_x100: [44_000],
        voiced_prob_permille: [900],
        method: "test",
        params: "{}",
      })),
    ],
  ]);

  const parsed = parseProjectArchiveAnalysisFiles(analysisFiles);

  assert.equal(parsed.get("00000000-0000-0000-0000-0000000000d1")?.kind, "f0_track");
});

test("parseProjectArchiveAnalysisFiles rejects non-UUID analysis entry IDs", () => {
  const artifactBytes = new TextEncoder().encode(JSON.stringify({
    schema_version: 1,
    media_id: "00000000-0000-0000-0000-0000000000a1",
    src_sample_rate: 48_000,
    created_by: { app_version: "test", algo_version: "1", params_hash: "f0" },
    hop_src_frames: 240,
    f0_hz_x100: [44_000],
    voiced_prob_permille: [900],
    method: "test",
    params: "{}",
  }));

  for (const path of [
    "analysis/not-a-uuid.json",
    "analysis/../../evil.json",
  ]) {
    assert.throws(
      () => parseProjectArchiveAnalysisFiles(new Map([[path, artifactBytes]])),
      /Invalid analysis archive entry ID/,
      path,
    );
  }
});

test("prepareCanonicalProjectArchivePayload rejects previous v3 projects", () => {
  const previousProject = {
    ...createProjectDocument(),
    schema_version: 3,
  } as unknown as ProjectDocument;

  assert.throws(
    () => prepareCanonicalProjectArchivePayload(previousProject),
    /unsupported schema_version: 3/,
  );
});

test("makeProjectArchiveFileName produces a safe zip file name", () => {
  assert.equal(makeProjectArchiveFileName("My Project"), "My_Project.zip");
  assert.equal(makeProjectArchiveFileName("R\u00e9sum\u00e9 2026"), "Resume.zip");
  assert.equal(makeProjectArchiveFileName("\u30c6\u30b9\u30c8"), "project.zip");
  assert.equal(makeProjectArchiveFileName(""), "project.zip");
  assert.equal(makeProjectArchiveFileName("demo.zip"), "demo.zip");
});

test("shouldReuseProjectArchiveHandle only keeps handles whose file name still matches the title-derived archive name", () => {
  assert.equal(
    shouldReuseProjectArchiveHandle("My_Project.zip", "My_Project.zip"),
    true,
  );
  assert.equal(
    shouldReuseProjectArchiveHandle("Old_Name.zip", "My_Project.zip"),
    false,
  );
  assert.equal(
    shouldReuseProjectArchiveHandle("project.json", "My_Project.zip"),
    false,
  );
});

function createProjectDocument(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "Archive Demo",
      created_at: "",
      app_version: "test",
      project_sample_rate: 48_000,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [
          {
            at: 0,
            micro_bpm: 120_000_000,
            time_sig: { num: 4, den: 4 },
          },
        ],
      },
      grid: {
        snap_enabled: true,
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [
        {
          id: "00000000-0000-0000-0000-0000000000b1",
          name: "Audio Track",
          kind: { track_type: "audio" },
          mute: false,
          solo: false,
          gain_milli_db: 0,
          pan_permille: 0,
          fx_chain: [],
          routing: { output: { bus: "master" }, sends: [] },
        },
      ],
      media: [
        {
          id: "00000000-0000-0000-0000-0000000000a1",
          in_zip_path: "lead.wav",
          channels: 3,
          src_sample_rate: 48_000,
          length_src_frames: 4,
          hash: null,
          original_name: "lead.wav",
        },
        {
          id: "00000000-0000-0000-0000-0000000000a2",
          in_zip_path: "unused.wav",
          channels: 1,
          src_sample_rate: 48_000,
          length_src_frames: 4,
          hash: null,
          original_name: "unused.wav",
        },
      ],
      contents: [
        {
          type: "audio",
          id: "00000000-0000-0000-0000-0000000000c1",
          media_id: "00000000-0000-0000-0000-0000000000a1",
          analysis_refs: [],
        },
        {
          type: "audio",
          id: "00000000-0000-0000-0000-0000000000c2",
          media_id: "00000000-0000-0000-0000-0000000000a2",
          analysis_refs: [],
        },
      ],
      clips: [
        {
          id: "00000000-0000-0000-0000-0000000000d1",
          track_id: "00000000-0000-0000-0000-0000000000b1",
          start: 0,
          length: 960,
          lane: 0,
          muted: false,
          gain_milli_db: 0,
            kind: {
              clip_type: "audio",
              content_id: "00000000-0000-0000-0000-0000000000c1",
              audio: {
              src_in: 0,
              src_out: 4,
              warp: { warp_type: "none" },
              pitch: {
                mode: "ManualOnly",
                manual_coarse_semitones: 0,
                manual_fine_cents: 0,
              },
              fades: { fade_in: 0, fade_out: 0 },
              time_pitch: { mode: "Voice", analysis: "Local", preserve_formant: false },
            },
          },
        },
      ],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

function findCentralDirectoryEntries(archive: Uint8Array): number[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocdOffset = findEocdOffset(archive);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const entries: number[] = [];
  let offset = view.getUint32(eocdOffset + 16, true);
  for (let index = 0; index < totalEntries; index++) {
    entries.push(offset);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEocdOffset(archive: Uint8Array): number {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = archive.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("expected EOCD in test archive");
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function encodeTestWav(buffer: AudioBufferSource): ArrayBuffer {
  return encodeWav(buffer);
}
