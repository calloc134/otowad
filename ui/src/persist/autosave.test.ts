import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  autoSave,
  clearAutoSave,
  loadAutoSave,
  quarantineAutoSave,
} from "./autosave.ts";
import {
  __resetOpenPersistenceDbForTests,
  __setOpenPersistenceDbForTests,
} from "./persistenceDb.ts";
import {
  __resetBrowserProjectStoreDbOpenerForTests,
  __setBrowserProjectStoreDbOpenerForTests,
} from "./browserProjectStore.ts";

afterEach(() => {
  __resetBrowserProjectStoreDbOpenerForTests();
  __resetOpenPersistenceDbForTests();
});

test("autosave persists JSON-only crash recovery state and does not recover media buffers", async () => {
  installFakeIndexedDb();

  const autosaveJson = JSON.stringify({
    schema_version: 4,
    meta: { name: "Autosave", created_at: "", app_version: "test", project_sample_rate: 44_100, ppq: 960 },
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
      media: [{ id: "media-1", in_zip_path: "media/media-1.wav", channels: 1, src_sample_rate: 44_100, length_src_frames: 1024, hash: null, original_name: "voice.wav" }],
      contents: [],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  });

  await autoSave(autosaveJson);
  const restored = await loadAutoSave();

  assert.equal(restored, autosaveJson);
  assert.match(restored ?? "", /media\/media-1\.wav/);
  assert.ok(
    !(restored ?? "").includes("RIFF"),
    "autosave should remain JSON-only and not embed binary media recovery payloads",
  );
});

test("clearAutoSave removes the current autosave snapshot", async () => {
  installFakeIndexedDb();

  await autoSave("{\"ok\":true}");
  await clearAutoSave();

  assert.equal(await loadAutoSave(), null);
});

test("quarantineAutoSave atomically moves the current snapshot to the quarantine key", async () => {
  const factory = installFakeIndexedDb();
  const autosaveJson = "{\"schema_version\":4}";

  await autoSave(autosaveJson);
  await quarantineAutoSave();

  assert.equal(await loadAutoSave(), null);
  assert.equal(factory.readRecord("otomad-daw", "autosave", "quarantine"), autosaveJson);
});

function installFakeIndexedDb(): FakeIndexedDBFactory {
  const factory = new FakeIndexedDBFactory();
  __setBrowserProjectStoreDbOpenerForTests(
    () => Promise.resolve(factory.open("otomad-daw", 2)),
  );
  __setOpenPersistenceDbForTests(() => Promise.resolve(factory.open("otomad-daw", 2)));
  return factory;
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

  readRecord(databaseName: string, storeName: string, key: IDBValidKey): unknown {
    return this.databases.get(databaseName)?.stores.get(storeName)?.records.get(key);
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

  put(value: unknown, key?: IDBValidKey): IDBRequest {
    const resolvedKey = key ?? deriveKey(value, this.state.keyPath);
    this.state.records.set(resolvedKey, structuredCloneOrPassthrough(value));
    return createRequest(resolvedKey);
  }

  delete(key: IDBValidKey): IDBRequest {
    this.state.records.delete(key);
    return createRequest(undefined);
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
    !Array.isArray(key)
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
