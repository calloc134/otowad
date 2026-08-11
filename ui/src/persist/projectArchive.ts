import { buildProjectWithResolvedAnalysisRefs } from "../audio/analysisResolution.ts";
import { MediaCache } from "../audio/mediaCache.ts";
import {
  type AudioBufferData,
  type AudioBufferSource,
} from "../audio/audioBufferData.ts";
import {
  decodePcmWavToAudioBufferData,
} from "../audio/pcmWav.ts";
import {
  DEFAULT_WAV_BITS_PER_SAMPLE,
  encodeWav,
} from "../render/wavEncoder.ts";
import { normalizeAnalysisArtifact } from "../utils/analysisArtifact.ts";
import type {
  AnalysisArtifact,
  AnalysisId,
  MediaAsset,
  MediaId,
  ProjectDocument,
} from "../types/index.ts";
import { serialize_project_for_save } from "../wasm/otomad_core.js";

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_STORE_METHOD = 0;
const ZIP_UTF8_FLAG = 1 << 11;
const ZIP_VERSION = 20;
const ZIP_EOCD_MIN_SIZE = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const PROJECT_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PROJECT_ARCHIVE_MAX_ENTRIES = 4_096;
const PROJECT_ARCHIVE_MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const crc32Table = buildCrc32Table();

export const PROJECT_ARCHIVE_JSON_PATH = "project.json";
export const PROJECT_ARCHIVE_EXTENSION = ".zip";
export const PROJECT_ARCHIVE_MIME = "application/zip";
export const PROJECT_ARCHIVE_ANALYSIS_DIRECTORY = "analysis/";
export const PROJECT_ARCHIVE_WAV_BITS_PER_SAMPLE = DEFAULT_WAV_BITS_PER_SAMPLE;

export interface ProjectArchiveMediaFile {
  mediaId: MediaId;
  path: string;
  bytes: Uint8Array;
}

export interface ProjectArchiveAnalysisFile {
  analysisId: AnalysisId;
  path: string;
  bytes: Uint8Array;
}

export interface ParsedProjectArchive {
  projectJson: string;
  mediaFiles: Map<string, Uint8Array>;
  analysisFiles: Map<string, Uint8Array>;
}

export interface CanonicalProjectArchivePayload {
  document: ProjectDocument;
  projectJson: string;
}

export interface AudioBufferLookup {
  get(mediaId: MediaId): AudioBufferSource | undefined;
}

export interface ProjectArchiveHydratedMediaEntry {
  mediaId: MediaId;
  buffer: AudioBufferData;
}

interface ProjectArchiveMediaIssue {
  mediaId: MediaId;
  status: "missing" | "invalid";
  message: string;
}

export interface ProjectArchiveMediaHydrationResult {
  entries: ProjectArchiveHydratedMediaEntry[];
  issues: ProjectArchiveMediaIssue[];
}

export { decodePcmWavToAudioBufferData };

interface ZipEntryInput {
  path: string;
  data: Uint8Array;
}

interface ZipEntryMetadata {
  path: string;
  pathBytes: Uint8Array;
  data: Uint8Array;
  crc32: number;
  localHeaderOffset: number;
}

interface CentralDirectoryEntryMetadata {
  path: string;
  flags: number;
  crc32: number;
  dataSize: number;
  localHeaderOffset: number;
}

interface LocalFileLayout extends CentralDirectoryEntryMetadata {
  rangeStart: number;
  rangeEnd: number;
  dataStart: number;
  dataEnd: number;
  localPath: string;
}

export function buildMediaArchivePath(mediaId: MediaId): string {
  return `media/${mediaId}.wav`;
}

export function prepareProjectDocumentForArchive(
  document: ProjectDocument,
): ProjectDocument {
  return {
    ...document,
    edit: {
      ...document.edit,
      media: document.edit.media.map((asset) => ({
        ...asset,
        in_zip_path: buildMediaArchivePath(asset.id),
      })),
    },
  };
}

export function prepareCanonicalProjectArchivePayload(
  document: ProjectDocument,
  analysisArtifacts?: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): CanonicalProjectArchivePayload {
  const normalizedDocument = analysisArtifacts
    ? buildProjectWithResolvedAnalysisRefs(document, analysisArtifacts)
    : document;
  const preparedDocument = prepareProjectDocumentForArchive(normalizedDocument);
  return {
    document: preparedDocument,
    projectJson: serialize_project_for_save(JSON.stringify(preparedDocument)),
  };
}

export function buildAnalysisArchivePath(analysisId: AnalysisId): string {
  return `${PROJECT_ARCHIVE_ANALYSIS_DIRECTORY}${analysisId}.json`;
}

export function collectReferencedAnalysisIds(
  document: ProjectDocument,
): AnalysisId[] {
  const refs = new Set<AnalysisId>();
  for (const content of document.edit.contents) {
    if (content.type !== "audio") {
      continue;
    }
    for (const analysisId of content.analysis_refs) {
      refs.add(analysisId);
    }
  }
  return [...refs].sort((left, right) => left.localeCompare(right));
}

export function buildProjectArchiveAnalysisFiles(
  document: ProjectDocument,
  analysisArtifacts: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): ProjectArchiveAnalysisFile[] {
  const files: ProjectArchiveAnalysisFile[] = [];
  for (const analysisId of collectReferencedAnalysisIds(document)) {
    const artifact = analysisArtifacts.get(analysisId);
    if (!artifact) {
      continue;
    }
    files.push({
      analysisId,
      path: buildAnalysisArchivePath(analysisId),
      bytes: textEncoder.encode(JSON.stringify(artifact)),
    });
  }
  return files;
}

export function parseProjectArchiveAnalysisFiles(
  analysisFiles: ReadonlyMap<string, Uint8Array>,
): Map<AnalysisId, AnalysisArtifact> {
  const artifacts = new Map<AnalysisId, AnalysisArtifact>();
  for (const [path, bytes] of analysisFiles.entries()) {
    if (!path.startsWith(PROJECT_ARCHIVE_ANALYSIS_DIRECTORY) || !path.endsWith(".json")) {
      continue;
    }
    const analysisId = path.slice(
      PROJECT_ARCHIVE_ANALYSIS_DIRECTORY.length,
      -".json".length,
    );
    if (!analysisId) {
      throw new Error(`Invalid analysis archive entry path ${path}.`);
    }
    if (!UUID_PATTERN.test(analysisId)) {
      throw new Error(`Invalid analysis archive entry ID ${analysisId} in ${path}.`);
    }
    artifacts.set(
      analysisId,
      normalizeAnalysisArtifact(JSON.parse(textDecoder.decode(bytes))),
    );
  }
  return artifacts;
}

export function collectReferencedAudioMedia(
  document: ProjectDocument,
): MediaAsset[] {
  const contentById = new Map(
    document.edit.contents.map((content) => [content.id, content] as const),
  );
  const referencedMediaIds = new Set<MediaId>();

  for (const clip of document.edit.clips) {
    if (clip.kind.clip_type !== "audio") continue;

    const content = contentById.get(clip.kind.content_id);
    if (!content) {
      throw new Error(
        `Audio clip ${clip.id} references missing content ${clip.kind.content_id}.`,
      );
    }
    if (content.type !== "audio") {
      throw new Error(
        `Audio clip ${clip.id} references non-audio content ${clip.kind.content_id}.`,
      );
    }
    referencedMediaIds.add(content.media_id);
  }

  const mediaById = new Map(
    document.edit.media.map((asset) => [asset.id, asset] as const),
  );
  for (const mediaId of referencedMediaIds) {
    if (!mediaById.has(mediaId)) {
      throw new Error(
        `Audio content references missing media asset ${mediaId}.`,
      );
    }
  }

  return document.edit.media.filter((asset) => referencedMediaIds.has(asset.id));
}

export function buildProjectArchiveMediaFiles(
  document: ProjectDocument,
  mediaBuffers: AudioBufferLookup,
): ProjectArchiveMediaFile[] {
  return collectReferencedAudioMedia(document).map((asset) => {
    const audioBuffer = mediaBuffers.get(asset.id);
    if (!audioBuffer) {
      throw new Error(
        `Missing media buffer for referenced media asset ${asset.id}.`,
      );
    }

    return {
      mediaId: asset.id,
      path: asset.in_zip_path,
      bytes: new Uint8Array(
        encodeWav(audioBuffer, { bitsPerSample: PROJECT_ARCHIVE_WAV_BITS_PER_SAMPLE }),
      ),
    };
  });
}

export function buildProjectArchive(
  projectJson: string,
  mediaFiles: readonly ProjectArchiveMediaFile[],
  analysisFiles: readonly ProjectArchiveAnalysisFile[] = [],
): Uint8Array {
  return writeStoreOnlyZip([
    {
      path: PROJECT_ARCHIVE_JSON_PATH,
      data: textEncoder.encode(projectJson),
    },
    ...mediaFiles.map((mediaFile) => ({
      path: mediaFile.path,
      data: mediaFile.bytes,
    })),
    ...analysisFiles.map((analysisFile) => ({
      path: analysisFile.path,
      data: analysisFile.bytes,
    })),
  ]);
}

export function rebuildProjectArchive(
  projectJson: string,
  mediaFiles: ReadonlyMap<string, Uint8Array>,
  analysisFiles: ReadonlyMap<string, Uint8Array> = new Map(),
): Uint8Array {
  return writeStoreOnlyZip([
    {
      path: PROJECT_ARCHIVE_JSON_PATH,
      data: textEncoder.encode(projectJson),
    },
    ...Array.from(mediaFiles.entries(), ([path, bytes]) => ({
      path,
      data: bytes,
    })),
    ...Array.from(analysisFiles.entries(), ([path, bytes]) => ({
      path,
      data: bytes,
    })),
  ]);
}

export function parseProjectArchive(
  archiveBytes: ArrayBuffer | Uint8Array,
): ParsedProjectArchive {
  const entries = readStoreOnlyZip(archiveBytes);
  const projectJsonBytes = entries.get(PROJECT_ARCHIVE_JSON_PATH);
  if (!projectJsonBytes) {
    throw new Error("Project archive is missing project.json.");
  }

  const mediaFiles = new Map<string, Uint8Array>();
  const analysisFiles = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries.entries()) {
    if (path === PROJECT_ARCHIVE_JSON_PATH || path.endsWith("/")) {
      continue;
    }
    if (path.startsWith(PROJECT_ARCHIVE_ANALYSIS_DIRECTORY)) {
      analysisFiles.set(path, bytes);
      continue;
    }
    mediaFiles.set(path, bytes);
  }

  return {
    projectJson: textDecoder.decode(projectJsonBytes),
    mediaFiles,
    analysisFiles,
  };
}

export function hydrateProjectArchiveMediaData(
  document: ProjectDocument,
  mediaFiles: ReadonlyMap<string, Uint8Array>,
): ProjectArchiveHydratedMediaEntry[] {
  const result = hydrateProjectArchiveMediaDataSafely(document, mediaFiles);
  const issue = result.issues[0];
  if (issue) {
    throw new Error(issue.message);
  }
  return result.entries;
}

export function hydrateProjectArchiveMediaDataSafely(
  document: ProjectDocument,
  mediaFiles: ReadonlyMap<string, Uint8Array>,
): ProjectArchiveMediaHydrationResult {
  const entries: ProjectArchiveHydratedMediaEntry[] = [];
  const issues: ProjectArchiveMediaIssue[] = [];
  for (const asset of collectReferencedAudioMedia(document)) {
    const archivedBytes = mediaFiles.get(asset.in_zip_path);
    if (!archivedBytes) {
      issues.push({
        mediaId: asset.id,
        status: "missing",
        message: `Project archive is missing ${asset.in_zip_path} for media asset ${asset.id}.`,
      });
      continue;
    }

    try {
      entries.push({
        mediaId: asset.id,
        buffer: decodePcmWavToAudioBufferData(archivedBytes),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        mediaId: asset.id,
        status: "invalid",
        message: `Project archive media ${asset.in_zip_path} is invalid: ${message}`,
      });
    }
  }
  return { entries, issues };
}

export async function stageProjectArchiveMedia(
  document: ProjectDocument,
  mediaFiles: ReadonlyMap<string, Uint8Array>,
  ctx: BaseAudioContext,
): Promise<MediaCache> {
  const stagedCache = new MediaCache();

  for (const asset of collectReferencedAudioMedia(document)) {
    const archivedBytes = mediaFiles.get(asset.in_zip_path);
    if (!archivedBytes) {
      throw new Error(
        `Project archive is missing ${asset.in_zip_path} for media asset ${asset.id}.`,
      );
    }

    await stagedCache.loadFromArrayBuffer(
      asset.id,
      copyArrayBuffer(archivedBytes),
      ctx,
    );
  }

  return stagedCache;
}

export function isZipArchiveBytes(
  archiveBytes: ArrayBuffer | Uint8Array,
): boolean {
  const bytes = asUint8Array(archiveBytes);
  if (bytes.length < 4) {
    return false;
  }

  return bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
}

export function makeProjectArchiveFileName(
  projectName: string | null | undefined,
): string {
  const baseName = (projectName ?? "").trim() || "project";
  const withoutExtension = baseName.toLowerCase().endsWith(
      PROJECT_ARCHIVE_EXTENSION,
    )
    ? baseName.slice(0, -PROJECT_ARCHIVE_EXTENSION.length)
    : baseName;
  const sanitized = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${sanitized || "project"}${PROJECT_ARCHIVE_EXTENSION}`;
}

export function shouldReuseProjectArchiveHandle(
  currentFileName: string | null | undefined,
  desiredFileName: string,
): boolean {
  if (!currentFileName) {
    return false;
  }
  if (!currentFileName.toLowerCase().endsWith(PROJECT_ARCHIVE_EXTENSION)) {
    return false;
  }
  return currentFileName === desiredFileName;
}

function writeStoreOnlyZip(entries: readonly ZipEntryInput[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error("Project archive must contain at least one entry.");
  }
  if (entries.length > PROJECT_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`Project archives support at most ${PROJECT_ARCHIVE_MAX_ENTRIES} entries.`);
  }

  const seenPaths = new Set<string>();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    validateArchivePath(entry.path);
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate archive entry path ${entry.path}.`);
    }
    seenPaths.add(entry.path);

    const pathBytes = textEncoder.encode(entry.path);
    if (pathBytes.byteLength > 0xffff) {
      throw new Error("Project archive entry path is too long.");
    }
    const data = new Uint8Array(entry.data);
    if (data.byteLength > PROJECT_ARCHIVE_MAX_ENTRY_BYTES) {
      throw new Error("Project archive entry size exceeds 1 GiB.");
    }
    const localEntrySize = 30 + pathBytes.byteLength + data.byteLength;
    centralDirectorySize += 46 + pathBytes.byteLength;
    if (
      localOffset + localEntrySize + centralDirectorySize + ZIP_EOCD_MIN_SIZE >
        PROJECT_ARCHIVE_MAX_BYTES
    ) {
      throw new Error("Project archive exceeds 2 GiB.");
    }
    const metadata: ZipEntryMetadata = {
      path: entry.path,
      pathBytes,
      data,
      crc32: computeCrc32(data),
      localHeaderOffset: localOffset,
    };

    const localHeader = buildLocalFileHeader(metadata);
    localParts.push(localHeader);
    localOffset += localHeader.length;

    const centralDirectoryEntry = buildCentralDirectoryEntry(metadata);
    centralParts.push(centralDirectoryEntry);
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const endOfCentralDirectory = buildEndOfCentralDirectory(
    entries.length,
    centralDirectory.length,
    localOffset,
  );

  return concatUint8Arrays([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

function readStoreOnlyZip(
  archiveBytes: ArrayBuffer | Uint8Array,
): Map<string, Uint8Array> {
  const bytes = asUint8Array(archiveBytes);
  if (bytes.byteLength > PROJECT_ARCHIVE_MAX_BYTES) {
    throw new Error("Project archive exceeds 2 GiB.");
  }
  const eocdOffset = findEndOfCentralDirectoryOffset(bytes);
  const archiveView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );

  const entriesOnDisk = archiveView.getUint16(eocdOffset + 8, true);
  const totalEntries = archiveView.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = archiveView.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = archiveView.getUint32(eocdOffset + 16, true);

  if (
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("Zip64 project archives are not supported.");
  }
  if (
    archiveView.getUint16(eocdOffset + 4, true) !== 0 ||
    archiveView.getUint16(eocdOffset + 6, true) !== 0
  ) {
    throw new Error("Multi-disk project archives are not supported.");
  }
  if (entriesOnDisk !== totalEntries) {
    throw new Error("Multi-disk project archives are not supported.");
  }
  if (totalEntries > PROJECT_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`Project archives support at most ${PROJECT_ARCHIVE_MAX_ENTRIES} entries.`);
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd > eocdOffset) {
    throw new Error("Project archive central directory is truncated.");
  }
  if (centralDirectoryEnd !== eocdOffset) {
    throw new Error("Project archive central directory size is inconsistent.");
  }

  const centralEntries: CentralDirectoryEntryMetadata[] = [];
  const seenPaths = new Set<string>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > centralDirectoryEnd) {
      throw new Error("Project archive central directory is truncated.");
    }
    if (
      archiveView.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error("Invalid project archive central directory entry.");
    }

    const flags = archiveView.getUint16(offset + 8, true);
    validateZipFlags(flags);

    const method = archiveView.getUint16(offset + 10, true);
    if (method !== ZIP_STORE_METHOD) {
      throw new Error(
        "Project archives must use store-only ZIP entries.",
      );
    }

    const crc32 = archiveView.getUint32(offset + 16, true);
    const compressedSize = archiveView.getUint32(offset + 20, true);
    const uncompressedSize = archiveView.getUint32(offset + 24, true);
    const fileNameLength = archiveView.getUint16(offset + 28, true);
    const extraLength = archiveView.getUint16(offset + 30, true);
    const commentLength = archiveView.getUint16(offset + 32, true);
    const diskNumberStart = archiveView.getUint16(offset + 34, true);
    const localHeaderOffset = archiveView.getUint32(offset + 42, true);

    if (diskNumberStart !== 0) {
      throw new Error("Multi-disk project archives are not supported.");
    }

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("Zip64 project archives are not supported.");
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error(
        "Project archives must use uncompressed ZIP entries.",
      );
    }
    if (uncompressedSize > PROJECT_ARCHIVE_MAX_ENTRY_BYTES) {
      throw new Error("Project archive entry size exceeds 1 GiB.");
    }

    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryEnd = fileNameEnd + extraLength + commentLength;
    if (entryEnd > centralDirectoryEnd) {
      throw new Error("Project archive central directory entry is truncated.");
    }
    const path = textDecoder.decode(bytes.slice(fileNameStart, fileNameEnd));
    validateArchivePath(path);
    if (seenPaths.has(path)) {
      throw new Error(`Duplicate archive entry path ${path}.`);
    }
    seenPaths.add(path);
    centralEntries.push({
      path,
      flags,
      crc32,
      dataSize: compressedSize,
      localHeaderOffset,
    });

    offset = entryEnd;
  }

  if (offset !== centralDirectoryEnd) {
    throw new Error("Project archive central directory entry count is inconsistent.");
  }

  const localLayouts = centralEntries.map((entry) =>
    readLocalFileLayout(bytes, archiveView, entry, centralDirectoryOffset)
  );
  const sortedLayouts = [...localLayouts].sort((left, right) =>
    left.rangeStart - right.rangeStart
  );
  for (let index = 1; index < sortedLayouts.length; index++) {
    const previous = sortedLayouts[index - 1];
    const current = sortedLayouts[index];
    if (previous && current && current.rangeStart < previous.rangeEnd) {
      throw new Error("Project archive contains overlapping local file ranges.");
    }
  }

  const entries = new Map<string, Uint8Array>();
  for (const layout of localLayouts) {
    if (layout.localPath !== layout.path) {
      throw new Error(`Project archive local path disagrees with ${layout.path}.`);
    }
    const data = bytes.slice(layout.dataStart, layout.dataEnd);
    if (!layout.path.endsWith("/") && computeCrc32(data) !== layout.crc32) {
      throw new Error(`CRC mismatch for archive entry ${layout.path}.`);
    }
    entries.set(layout.path, data);
  }

  return entries;
}

function buildLocalFileHeader(entry: ZipEntryMetadata): Uint8Array {
  const header = new Uint8Array(
    30 + entry.pathBytes.length + entry.data.length,
  );
  const view = new DataView(header.buffer);

  view.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.pathBytes.length, true);

  header.set(entry.pathBytes, 30);
  header.set(entry.data, 30 + entry.pathBytes.length);
  return header;
}

function buildCentralDirectoryEntry(entry: ZipEntryMetadata): Uint8Array {
  const header = new Uint8Array(46 + entry.pathBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.pathBytes.length, true);
  view.setUint32(42, entry.localHeaderOffset, true);

  header.set(entry.pathBytes, 46);
  return header;
}

function buildEndOfCentralDirectory(
  totalEntries: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const footer = new Uint8Array(ZIP_EOCD_MIN_SIZE);
  const view = new DataView(footer.buffer);

  view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(8, totalEntries, true);
  view.setUint16(10, totalEntries, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  return footer;
}

function readLocalFileLayout(
  bytes: Uint8Array,
  archiveView: DataView,
  entry: CentralDirectoryEntryMetadata,
  centralDirectoryOffset: number,
): LocalFileLayout {
  const { localHeaderOffset } = entry;
  if (localHeaderOffset + 30 > centralDirectoryOffset) {
    throw new Error("Project archive local file header is truncated.");
  }
  if (
    archiveView.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error("Invalid project archive local file header.");
  }

  const localFlags = archiveView.getUint16(localHeaderOffset + 6, true);
  validateZipFlags(localFlags);
  if (localFlags !== entry.flags) {
    throw new Error(`Project archive local header disagrees with ${entry.path}.`);
  }
  if (archiveView.getUint16(localHeaderOffset + 8, true) !== ZIP_STORE_METHOD) {
    throw new Error("Project archives must use store-only ZIP entries.");
  }

  const localCrc32 = archiveView.getUint32(localHeaderOffset + 14, true);
  const localCompressedSize = archiveView.getUint32(localHeaderOffset + 18, true);
  const localUncompressedSize = archiveView.getUint32(localHeaderOffset + 22, true);
  if (
    localCrc32 !== entry.crc32 ||
    localCompressedSize !== entry.dataSize ||
    localUncompressedSize !== entry.dataSize
  ) {
    throw new Error(`Project archive local header disagrees with ${entry.path}.`);
  }

  const fileNameLength = archiveView.getUint16(localHeaderOffset + 26, true);
  const extraLength = archiveView.getUint16(localHeaderOffset + 28, true);
  const fileNameStart = localHeaderOffset + 30;
  const fileNameEnd = fileNameStart + fileNameLength;
  const dataStart = fileNameEnd + extraLength;
  const dataEnd = dataStart + entry.dataSize;

  if (dataEnd > centralDirectoryOffset) {
    throw new Error("Project archive entry data is truncated.");
  }
  const localPath = textDecoder.decode(bytes.slice(fileNameStart, fileNameEnd));

  return {
    ...entry,
    rangeStart: localHeaderOffset,
    rangeEnd: dataEnd,
    dataStart,
    dataEnd,
    localPath,
  };
}

function findEndOfCentralDirectoryOffset(bytes: Uint8Array): number {
  const searchStart = Math.max(
    0,
    bytes.byteLength - ZIP_EOCD_MIN_SIZE - ZIP_MAX_COMMENT_LENGTH,
  );
  for (let offset = bytes.byteLength - ZIP_EOCD_MIN_SIZE; offset >= searchStart; offset--) {
    if (
      readUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset + ZIP_EOCD_MIN_SIZE + readUint16(bytes, offset + 20) === bytes.byteLength
    ) {
      return offset;
    }
  }
  throw new Error("Project archive is missing the end-of-central-directory record.");
}

function validateZipFlags(flags: number): void {
  const unsupportedFlags = flags & ~ZIP_UTF8_FLAG;
  if ((unsupportedFlags & 0x0008) !== 0) {
    throw new Error("Project archives with ZIP data descriptors are not supported.");
  }
  if (unsupportedFlags !== 0) {
    throw new Error("Project archives must use plain store-only ZIP entries.");
  }
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function validateArchivePath(path: string): void {
  if (!path) {
    throw new Error("Archive entry paths must not be empty.");
  }
  if (path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Archive entry path ${path} must be relative.`);
  }
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Archive entry path ${path} must not contain traversal segments.`);
  }
}

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const tableValue = crc32Table[(crc ^ byte) & 0xff] ?? 0;
    crc = tableValue ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4,
  ).getUint32(0, true);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    2,
  ).getUint16(0, true);
}

function asUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
