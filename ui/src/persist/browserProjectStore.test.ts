import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  __resetBrowserProjectStoreDbOpenerForTests,
  __setBrowserProjectStoreDbOpenerForTests,
  deleteBrowserProject,
  listBrowserProjects,
  openBrowserProject,
  renameBrowserProject,
  saveBrowserProject,
} from "./browserProjectStore.ts";
import { ensureTestWasmReady } from "../test/ensureTestWasm.ts";
import type { ProjectDocument } from "../types/index.ts";
import { parseProjectArchive } from "./projectArchive.ts";
import { parseProjectDocumentJsonForTests } from "../adapters/projectDocument.ts";

ensureTestWasmReady();

afterEach(() => {
  __resetBrowserProjectStoreDbOpenerForTests();
});

test("listBrowserProjects returns empty array when no browser save exists", async () => {
  installFakeIndexedDb();

  const projects = await listBrowserProjects();

  assert.deepEqual(projects, []);
});

test("saveBrowserProject creates a new browser project and lists it", async () => {
  installFakeIndexedDb();

  const saved = await saveBrowserProject({
    name: "Session A",
    archiveBytes: buildFakeArchive("Session A", [1, 2, 3, 4]),
  });
  const listed = await listBrowserProjects();

  assert.equal(saved.name, "Session A");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, saved.id);
});

test("saveBrowserProject overwrites an existing browser project record", async () => {
  installFakeIndexedDb();

  const first = await saveBrowserProject({
    name: "Draft",
    archiveBytes: buildFakeArchive("Draft", [1, 2, 3]),
  });
  const second = await saveBrowserProject({
    projectId: first.id,
    name: "Draft v2",
    archiveBytes: buildFakeArchive("Draft v2", [9, 8, 7, 6]),
  });
  const reopened = await openBrowserProject(first.id);

  assert.equal(second.id, first.id);
  assert.equal(second.name, "Draft v2");
  assert.ok(reopened);
  assert.equal(reopened?.metadata.name, "Draft v2");
});

test("renameBrowserProject updates recent metadata and archived project json", async () => {
  installFakeIndexedDb();

  const saved = await saveBrowserProject({
    name: "Original",
    archiveBytes: buildFakeArchive("Original", [1, 2, 3, 4]),
  });
  const renamed = await renameBrowserProject(saved.id, "Renamed Title");
  const reopened = await openBrowserProject(saved.id);
  const parsedArchive = reopened
    ? parseProjectArchive(reopened.archiveBytes)
    : null;
  const reopenedProject = parsedArchive
    ? parseProjectDocumentJsonForTests(parsedArchive.projectJson) as ProjectDocument
    : null;

  assert.ok(renamed);
  assert.equal(renamed?.name, "Renamed Title");
  assert.equal(reopened?.metadata.name, "Renamed Title");
  assert.equal(reopenedProject?.meta.name, "Renamed Title");
  assert.equal(
    reopenedProject?.edit.media[0]?.in_zip_path,
    "media/00000000-0000-0000-0000-0000000000a1.wav",
  );
});

test("renameBrowserProject keeps media entries byte-identical while rewriting project metadata", async () => {
  installFakeIndexedDb();

  const archiveBytes = buildFakeArchive("Original", [9, 8, 7, 6]);
  const saved = await saveBrowserProject({
    name: "Original",
    archiveBytes,
  });

  await renameBrowserProject(saved.id, "Renamed Title");
  const reopened = await openBrowserProject(saved.id);
  const parsedArchive = reopened ? parseProjectArchive(reopened.archiveBytes) : null;

  assert.ok(parsedArchive);
  assert.deepEqual(
    Array.from(parsedArchive?.mediaFiles.get("media/media-1.wav") ?? []),
    [9, 8, 7, 6],
  );
  assert.deepEqual(
    Array.from(parsedArchive?.analysisFiles.get("analysis/analysis-1.json") ?? []),
    Array.from(new TextEncoder().encode('{"kind":"f0_track"}')),
  );
  assert.equal(parsedArchive?.mediaFiles.has("analysis/analysis-1.json"), false);
});

test("deleteBrowserProject removes both metadata and archive records", async () => {
  installFakeIndexedDb();

  const saved = await saveBrowserProject({
    name: "Delete Me",
    archiveBytes: buildFakeArchive("Delete Me", [5, 6, 7]),
  });
  await deleteBrowserProject(saved.id);

  const listed = await listBrowserProjects();
  const reopened = await openBrowserProject(saved.id);

  assert.deepEqual(listed, []);
  assert.equal(reopened, null);
});

test("openBrowserProject returns null for unknown ids", async () => {
  installFakeIndexedDb();

  const reopened = await openBrowserProject("missing-project");

  assert.equal(reopened, null);
});

function installFakeIndexedDb(): void {
  const factory = new FakeIndexedDBFactory();
  __setBrowserProjectStoreDbOpenerForTests(() => Promise.resolve(factory.open("otomad-daw", 2)));
}

function buildFakeArchive(projectName: string, mediaBytes: number[]): Uint8Array {
  const projectJson = JSON.stringify({
    schema_version: 4,
    meta: {
      name: projectName,
      created_at: "",
      app_version: "test",
      project_sample_rate: 44100,
      ppq: 960,
    },
    edit: {
      tempo: { ppq: 960, points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }] },
      grid: {
        snap_enabled: true,
        division: "Beat",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1000,
      },
      tracks: [],
      media: [{
        id: "00000000-0000-0000-0000-0000000000a1",
        in_zip_path: "lead.wav",
        channels: 1,
        src_sample_rate: 44100,
        length_src_frames: 4,
        hash: null,
        original_name: "lead.wav",
      }],
      contents: [],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  });
  const encoder = new TextEncoder();
  return buildStoreZip([
    { path: "project.json", data: encoder.encode(projectJson) },
    { path: "media/media-1.wav", data: Uint8Array.from(mediaBytes) },
    { path: "analysis/analysis-1.json", data: encoder.encode('{"kind":"f0_track"}') },
  ]);
}

class FakeIndexedDBFactory {
  private readonly databases = new Map<string, FakeDatabaseState>();

  open(name: string, version: number): IDBDatabase {
    const existing = this.databases.get(name);
    if (!existing || existing.version < version) {
      const nextState = existing
        ? existing.upgrade(version)
        : FakeDatabaseState.create(version);
      this.databases.set(name, nextState);
      return new FakeIDBDatabase(nextState) as unknown as IDBDatabase;
    }
    return new FakeIDBDatabase(existing) as unknown as IDBDatabase;
  }
}

class FakeDatabaseState {
  readonly version: number;
  readonly stores: Map<string, FakeObjectStoreState>;

  private constructor(version: number, stores?: Map<string, FakeObjectStoreState>) {
    this.version = version;
    this.stores = stores ? new Map(stores) : new Map();
  }

  static create(version: number): FakeDatabaseState {
    const state = new FakeDatabaseState(version);
    state.ensureStore("autosave");
    state.ensureStore("browser-project-metadata", "id");
    state.ensureStore("browser-project-archive", "id");
    return state;
  }

  upgrade(version: number): FakeDatabaseState {
    const upgraded = new FakeDatabaseState(version, this.stores);
    upgraded.ensureStore("autosave");
    upgraded.ensureStore("browser-project-metadata", "id");
    upgraded.ensureStore("browser-project-archive", "id");
    return upgraded;
  }

  ensureStore(name: string, keyPath?: string): FakeObjectStoreState {
    const existing = this.stores.get(name);
    if (existing) {
      return existing;
    }
    const created = new FakeObjectStoreState(keyPath);
    this.stores.set(name, created);
    return created;
  }
}

class FakeObjectStoreState {
  readonly keyPath: string | null;
  readonly records = new Map<IDBValidKey, unknown>();

  constructor(keyPath?: string) {
    this.keyPath = keyPath ?? null;
  }
}

class FakeIDBDatabase {
  readonly objectStoreNames: DOMStringList;
  private readonly state: FakeDatabaseState;

  constructor(state: FakeDatabaseState) {
    this.state = state;
    this.objectStoreNames = createDomStringList([...state.stores.keys()]);
  }

  close(): void {}

  transaction(storeNames: string | string[], mode?: IDBTransactionMode): IDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = new FakeIDBTransaction(this.state, names, mode ?? "readonly");
    setTimeout(() => tx.finish(), 0);
    return tx as unknown as IDBTransaction;
  }
}

class FakeIDBTransaction {
  oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  error: DOMException | null = null;
  readonly mode: IDBTransactionMode;
  private readonly state: FakeDatabaseState;
  private readonly storeNames: string[];

  constructor(state: FakeDatabaseState, storeNames: string[], mode: IDBTransactionMode) {
    this.state = state;
    this.storeNames = storeNames;
    this.mode = mode;
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.storeNames.includes(name)) {
      throw new Error(`Store ${name} not in transaction scope.`);
    }
    const store = this.state.stores.get(name);
    if (!store) {
      throw new Error(`Unknown object store ${name}.`);
    }
    return new FakeIDBObjectStore(store) as unknown as IDBObjectStore;
  }

  finish(): void {
    this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
  }
}

class FakeIDBObjectStore {
  readonly indexNames: DOMStringList = createDomStringList([]);
  private readonly state: FakeObjectStoreState;

  constructor(state: FakeObjectStoreState) {
    this.state = state;
  }

  get(key: IDBValidKey): IDBRequest {
    return createRequest(structuredCloneOrPassthrough(this.state.records.get(key)));
  }

  getAll(): IDBRequest {
    return createRequest([...this.state.records.values()].map((value) => structuredCloneOrPassthrough(value)));
  }

  put(value: unknown, key?: IDBValidKey): IDBRequest {
    const resolvedKey = key ?? deriveKey(value, this.state.keyPath);
    this.state.records.set(resolvedKey, structuredCloneOrPassthrough(value));
    return createRequest(resolvedKey);
  }

  delete(key: IDBValidKey): IDBRequest {
    this.state.records.delete(key);
    return createRequest(undefined);
  }

  createIndex(): IDBIndex {
    return {} as IDBIndex;
  }
}

function createRequest<T>(result: T): IDBRequest<T> {
  const request = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<T> & {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null;
  };
  queueMicrotask(() => {
    request.onsuccess?.call(request, new Event("success"));
  });
  return request;
}

function deriveKey(value: unknown, keyPath: string | null): IDBValidKey {
  if (!keyPath || typeof value !== "object" || value === null) {
    throw new Error("Cannot derive IndexedDB key.");
  }
  const record = value as Record<string, unknown>;
  const key = record[keyPath];
  if (
    typeof key !== "string" &&
    typeof key !== "number" &&
    !(key instanceof Date) &&
    !(Array.isArray(key))
  ) {
    throw new Error("Invalid IndexedDB key.");
  }
  return key as IDBValidKey;
}

function createDomStringList(values: string[]): DOMStringList {
  const list = {
    length: values.length,
    contains(value: string) {
      return values.includes(value);
    },
    item(index: number) {
      return values[index] ?? null;
    },
  } as DOMStringList & Record<number, string>;

  values.forEach((value, index) => {
    list[index] = value;
  });
  return list;
}

function structuredCloneOrPassthrough<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return value;
}

function buildStoreZip(entries: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const localSignature = 0x04034b50;
  const centralSignature = 0x02014b50;
  const endSignature = 0x06054b50;
  const utf8Flag = 1 << 11;
  const version = 20;
  const textEncoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const pathBytes = textEncoder.encode(entry.path);
    const crc32 = computeCrc32(entry.data);
    const localHeader = new Uint8Array(30 + pathBytes.length + entry.data.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, localSignature, true);
    localView.setUint16(4, version, true);
    localView.setUint16(6, utf8Flag, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, pathBytes.length, true);
    localHeader.set(pathBytes, 30);
    localHeader.set(entry.data, 30 + pathBytes.length);
    localParts.push(localHeader);

    const centralHeader = new Uint8Array(46 + pathBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, centralSignature, true);
    centralView.setUint16(4, version, true);
    centralView.setUint16(6, version, true);
    centralView.setUint16(8, utf8Flag, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, pathBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(pathBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length;
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, endSignature, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);

  return concatUint8Arrays([...localParts, centralDirectory, end]);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
