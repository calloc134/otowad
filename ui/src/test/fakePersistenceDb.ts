import {
  __setBrowserProjectStoreDbOpenerForTests,
} from "../persist/browserProjectStore.ts";
import {
  AUTOSAVE_STORE_NAME,
  BROWSER_PROJECT_ARCHIVE_STORE_NAME,
  BROWSER_PROJECT_METADATA_STORE_NAME,
  __setOpenPersistenceDbForTests,
} from "../persist/persistenceDb.ts";

const TEST_DATABASE_NAME = "otomad-daw";
const TEST_DATABASE_VERSION = 2;

export function installFakePersistenceDb(): void {
  const factory = new FakeIndexedDBFactory();
  const open = () => Promise.resolve(
    factory.open(TEST_DATABASE_NAME, TEST_DATABASE_VERSION),
  );
  __setBrowserProjectStoreDbOpenerForTests(open);
  __setOpenPersistenceDbForTests(open);
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
    state.ensureStore(AUTOSAVE_STORE_NAME);
    state.ensureStore(BROWSER_PROJECT_METADATA_STORE_NAME, "id");
    state.ensureStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME, "id");
    return state;
  }

  upgrade(version: number): FakeDatabaseState {
    const upgraded = new FakeDatabaseState(version, this.stores);
    upgraded.ensureStore(AUTOSAVE_STORE_NAME);
    upgraded.ensureStore(BROWSER_PROJECT_METADATA_STORE_NAME, "id");
    upgraded.ensureStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME, "id");
    return upgraded;
  }

  private ensureStore(name: string, keyPath?: string): FakeObjectStoreState {
    const existing = this.stores.get(name);
    if (existing) return existing;
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

  constructor(
    state: FakeDatabaseState,
    storeNames: string[],
    mode: IDBTransactionMode,
  ) {
    this.state = state;
    this.storeNames = storeNames;
    this.mode = mode;
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.storeNames.includes(name)) {
      throw new Error(`Store ${name} not in transaction scope.`);
    }
    const store = this.state.stores.get(name);
    if (!store) throw new Error(`Unknown object store ${name}.`);
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
    return createRequest(
      [...this.state.records.values()].map((value) => structuredCloneOrPassthrough(value)),
    );
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
  const key = (value as Record<string, unknown>)[keyPath];
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
  return typeof structuredClone === "function" ? structuredClone(value) : value;
}
