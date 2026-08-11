import { useCallback, useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export interface ServiceWorkerUpdate {
  /** A newer build is installed and waiting to take over. */
  updateReady: boolean;
  /** The first install finished; the app now starts without a network. */
  offlineReady: boolean;
  /**
   * Activate the waiting worker and reload.
   *
   * This throws away everything held in memory, which for this app includes
   * decoded media buffers that autosave cannot restore. It must stay behind an
   * explicit user action — never call it from an effect or a timer.
   */
  applyUpdate: () => void;
  dismissOfflineReady: () => void;
}

/**
 * Surface service worker lifecycle transitions to the UI.
 *
 * Registration is `prompt`-mode on purpose. The tempting alternative,
 * `skipWaiting` plus an automatic reload, would drop a new build onto a user
 * mid-edit and discard imported media that only lives in memory — the same
 * data the autosave dialog already warns is "not fully recoverable". A DAW
 * cannot reload itself out from under someone.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateRef = useRef<UpdateServiceWorker | null>(null);

  useEffect(() => {
    // StrictMode runs effects twice in development while keeping refs, so
    // without this the page registers and attaches callbacks twice.
    if (updateRef.current) {
      return;
    }
    updateRef.current = registerSW({
      onNeedRefresh: () => setUpdateReady(true),
      onOfflineReady: () => setOfflineReady(true),
    });
  }, []);

  const applyUpdate = useCallback(() => {
    void updateRef.current?.(true);
  }, []);

  const dismissOfflineReady = useCallback(() => setOfflineReady(false), []);

  return { updateReady, offlineReady, applyUpdate, dismissOfflineReady };
}
