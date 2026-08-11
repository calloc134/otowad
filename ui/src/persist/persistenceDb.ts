const DB_NAME = "otomad-daw";
const DB_VERSION = 2;

let testOpenPersistenceDbImpl: (() => Promise<IDBDatabase>) | null = null;

export const AUTOSAVE_STORE_NAME = "autosave";
export const BROWSER_PROJECT_METADATA_STORE_NAME = "browser-project-metadata";
export const BROWSER_PROJECT_ARCHIVE_STORE_NAME = "browser-project-archive";
export const BROWSER_PROJECT_LAST_OPENED_INDEX = "by-last-opened-at";

export function __setOpenPersistenceDbForTests(opener: () => Promise<IDBDatabase>): void {
  testOpenPersistenceDbImpl = opener;
}

export function __resetOpenPersistenceDbForTests(): void {
  testOpenPersistenceDbImpl = null;
}

export function openPersistenceDb(): Promise<IDBDatabase> {
  if (testOpenPersistenceDbImpl) {
    return testOpenPersistenceDbImpl();
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_STORE_NAME);
      }

      let metadataStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(BROWSER_PROJECT_METADATA_STORE_NAME)) {
        metadataStore = db.createObjectStore(BROWSER_PROJECT_METADATA_STORE_NAME, {
          keyPath: "id",
        });
      } else {
        const upgradeTx = request.transaction;
        if (!upgradeTx) {
          throw new Error("Missing upgrade transaction for browser project metadata store.");
        }
        metadataStore = upgradeTx.objectStore(BROWSER_PROJECT_METADATA_STORE_NAME);
      }

      if (!metadataStore.indexNames.contains(BROWSER_PROJECT_LAST_OPENED_INDEX)) {
        metadataStore.createIndex(
          BROWSER_PROJECT_LAST_OPENED_INDEX,
          "lastOpenedAt",
        );
      }

      if (!db.objectStoreNames.contains(BROWSER_PROJECT_ARCHIVE_STORE_NAME)) {
        db.createObjectStore(BROWSER_PROJECT_ARCHIVE_STORE_NAME, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
