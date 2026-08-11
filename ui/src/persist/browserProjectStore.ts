import type { ProjectDocument } from "../types/index.ts";
import { loadProjectDocument } from "../adapters/projectDocument.ts";
import {
  rebuildProjectArchive,
  parseProjectArchive,
  prepareCanonicalProjectArchivePayload,
} from "./projectArchive.ts";
import {
  BROWSER_PROJECT_ARCHIVE_STORE_NAME,
  BROWSER_PROJECT_METADATA_STORE_NAME,
  openPersistenceDb,
} from "./persistenceDb.ts";

export interface BrowserProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  archiveByteLength: number;
}

export interface BrowserProjectSnapshot {
  metadata: BrowserProjectSummary;
  archiveBytes: Uint8Array;
}

interface BrowserProjectArchiveRecord {
  id: string;
  archiveBytes: ArrayBuffer;
}

type BrowserProjectMetadataRecord = BrowserProjectSummary;

let openDbImpl: () => Promise<IDBDatabase> = openPersistenceDb;

export function __setBrowserProjectStoreDbOpenerForTests(opener: () => Promise<IDBDatabase>): void {
  openDbImpl = opener;
}

export function __resetBrowserProjectStoreDbOpenerForTests(): void {
  openDbImpl = openPersistenceDb;
}

export async function listBrowserProjects(): Promise<BrowserProjectSummary[]> {
  return withDb(async (db) => {
    const tx = db.transaction(BROWSER_PROJECT_METADATA_STORE_NAME, "readonly");
    const records = await awaitRequest<BrowserProjectMetadataRecord[]>(
      tx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME).getAll(),
    );
    await awaitTransaction(tx);
    return [...records].sort(compareBrowserProjects);
  });
}

export async function saveBrowserProject(input: {
  projectId?: string | null;
  name: string;
  archiveBytes: ArrayBuffer | Uint8Array;
}): Promise<BrowserProjectSummary> {
  const projectId = input.projectId?.trim() || crypto.randomUUID();
  const name = input.name.trim() || "Untitled Project";
  const archiveBytes = toStoredArrayBuffer(input.archiveBytes);

  return withDb(async (db) => {
    const existing = await getBrowserProjectMetadataRecord(db, projectId);
    const now = new Date().toISOString();
    const metadata: BrowserProjectMetadataRecord = existing
      ? {
          ...existing,
          name,
          updatedAt: now,
          lastOpenedAt: now,
          archiveByteLength: archiveBytes.byteLength,
        }
      : {
          id: projectId,
          name,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
          archiveByteLength: archiveBytes.byteLength,
        };

    await putBrowserProjectRecords(db, metadata, archiveBytes);
    return metadata;
  });
}

export async function renameBrowserProject(
  projectId: string,
  nextName: string,
): Promise<BrowserProjectSummary | null> {
  const resolvedName = nextName.trim();
  if (!resolvedName) {
    throw new Error("Project name must not be empty.");
  }

  return withDb(async (db) => {
    const metadata = await getBrowserProjectMetadataRecord(db, projectId);
    if (!metadata) {
      return null;
    }
    const archiveRecord = await getBrowserProjectArchiveRecord(db, projectId);
    if (!archiveRecord) {
      return null;
    }

    const parsedArchive = parseProjectArchive(archiveRecord.archiveBytes);
    const project = loadProjectDocument(parsedArchive.projectJson) as ProjectDocument;
    const renamedProject: ProjectDocument = {
      ...project,
      meta: {
        ...project.meta,
        name: resolvedName,
      },
    };
    const rebuiltPayload = prepareCanonicalProjectArchivePayload(renamedProject);
    const rebuiltArchive = rebuildProjectArchive(
      rebuiltPayload.projectJson,
      parsedArchive.mediaFiles,
      parsedArchive.analysisFiles,
    );

    const now = new Date().toISOString();
    const updatedMetadata: BrowserProjectMetadataRecord = {
      ...metadata,
      name: resolvedName,
      updatedAt: now,
      archiveByteLength: rebuiltArchive.byteLength,
    };
    await putBrowserProjectRecords(db, updatedMetadata, toStoredArrayBuffer(rebuiltArchive));
    return updatedMetadata;
  });
}

export async function deleteBrowserProject(projectId: string): Promise<boolean> {
  return withDb(async (db) => {
    const tx = db.transaction(
      [BROWSER_PROJECT_METADATA_STORE_NAME, BROWSER_PROJECT_ARCHIVE_STORE_NAME],
      "readwrite",
    );
    tx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME).delete(projectId);
    tx.objectStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME).delete(projectId);
    await awaitTransaction(tx);
    return true;
  });
}

export async function openBrowserProject(projectId: string): Promise<BrowserProjectSnapshot | null> {
  return withDb(async (db) => {
    const metadata = await getBrowserProjectMetadataRecord(db, projectId);
    if (!metadata) {
      return null;
    }

    const archiveRecord = await getBrowserProjectArchiveRecord(db, projectId);
    if (!archiveRecord) {
      return null;
    }

    const openedMetadata = await touchBrowserProjectOpenedAt(db, metadata);
    return {
      metadata: openedMetadata,
      archiveBytes: new Uint8Array(copyArrayBuffer(archiveRecord.archiveBytes)),
    };
  });
}

async function touchBrowserProjectOpenedAt(
  db: IDBDatabase,
  metadata: BrowserProjectMetadataRecord,
): Promise<BrowserProjectMetadataRecord> {
  const updated: BrowserProjectMetadataRecord = {
    ...metadata,
    lastOpenedAt: new Date().toISOString(),
  };
  const tx = db.transaction(BROWSER_PROJECT_METADATA_STORE_NAME, "readwrite");
  tx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME).put(updated);
  await awaitTransaction(tx);
  return updated;
}

async function putBrowserProjectRecords(
  db: IDBDatabase,
  metadata: BrowserProjectMetadataRecord,
  archiveBytes: ArrayBuffer,
): Promise<void> {
  const tx = db.transaction(
    [BROWSER_PROJECT_METADATA_STORE_NAME, BROWSER_PROJECT_ARCHIVE_STORE_NAME],
    "readwrite",
  );
  tx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME).put(metadata);
  tx.objectStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME).put({
    id: metadata.id,
    archiveBytes,
  } satisfies BrowserProjectArchiveRecord);
  await awaitTransaction(tx);
}

async function getBrowserProjectMetadataRecord(
  db: IDBDatabase,
  projectId: string,
): Promise<BrowserProjectMetadataRecord | null> {
  const tx = db.transaction(BROWSER_PROJECT_METADATA_STORE_NAME, "readonly");
  const record = await awaitRequest<BrowserProjectMetadataRecord | undefined>(
    tx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME).get(projectId),
  );
  await awaitTransaction(tx);
  return record ?? null;
}

async function getBrowserProjectArchiveRecord(
  db: IDBDatabase,
  projectId: string,
): Promise<BrowserProjectArchiveRecord | null> {
  const tx = db.transaction(BROWSER_PROJECT_ARCHIVE_STORE_NAME, "readonly");
  const record = await awaitRequest<BrowserProjectArchiveRecord | undefined>(
    tx.objectStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME).get(projectId),
  );
  await awaitTransaction(tx);
  return record ?? null;
}

async function withDb<T>(callback: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDbImpl();
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function compareBrowserProjects(left: BrowserProjectSummary, right: BrowserProjectSummary): number {
  const lastOpenedDelta = compareIsoDesc(left.lastOpenedAt, right.lastOpenedAt);
  if (lastOpenedDelta !== 0) {
    return lastOpenedDelta;
  }
  const updatedDelta = compareIsoDesc(left.updatedAt, right.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  return left.name.localeCompare(right.name);
}

function compareIsoDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function toStoredArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
  return bytes.slice(0);
}

function copyArrayBuffer(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}
