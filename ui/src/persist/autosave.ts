// =============================================================================
// IndexedDB autosave — raw API, no library dependency
// =============================================================================

import { AUTOSAVE_STORE_NAME, openPersistenceDb } from "./persistenceDb.ts";

const AUTOSAVE_KEY = "current";
const AUTOSAVE_QUARANTINE_KEY = "quarantine";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a project JSON string to IndexedDB for crash recovery.
 */
export async function autoSave(projectJson: string): Promise<void> {
  const db = await openPersistenceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, "readwrite");
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    store.put(projectJson, AUTOSAVE_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Load the autosaved project JSON, if any.
 * Returns `null` if no autosave entry exists.
 */
export async function loadAutoSave(): Promise<string | null> {
  const db = await openPersistenceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, "readonly");
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    const request = store.get(AUTOSAVE_KEY);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as string | undefined) ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Preserve the current crash-recovery snapshot without offering it again on
 * the next startup. The move is performed in one transaction so a failed
 * quarantine cannot delete the only copy.
 */
export async function quarantineAutoSave(): Promise<void> {
  const db = await openPersistenceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, "readwrite");
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    const request = store.get(AUTOSAVE_KEY);
    request.onsuccess = () => {
      if (typeof request.result === "string") {
        store.put(request.result, AUTOSAVE_QUARANTINE_KEY);
        store.delete(AUTOSAVE_KEY);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Autosave quarantine transaction was aborted."));
    };
  });
}

/**
 * Clear the autosave entry (e.g. after a successful manual save).
 */
export async function clearAutoSave(): Promise<void> {
  const db = await openPersistenceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, "readwrite");
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    store.delete(AUTOSAVE_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
