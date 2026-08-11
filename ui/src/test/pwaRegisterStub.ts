/**
 * Stand-in for `virtual:pwa-register`, aliased in by `vitest.config.ts`.
 *
 * The virtual module only exists while `VitePWA` is in the build pipeline, and
 * the test config deliberately leaves it out — generating a service worker per
 * test run would be pure cost. Without this alias every component test that
 * reaches `App` would fail to resolve the import.
 *
 * It also doubles as the control surface for the update-prompt tests: callers
 * drive the lifecycle by invoking the recorded callbacks.
 */

export interface RegisterSWOptions {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
  onRegisterError?: (error: unknown) => void;
}

export const pwaRegisterStub = {
  /** Options from the most recent `registerSW` call. */
  options: null as RegisterSWOptions | null,
  /** How many times `registerSW` ran; guards against duplicate registration. */
  registerCount: 0,
  /** One entry per returned-updater call, recording the `reloadPage` argument. */
  updateCalls: [] as Array<boolean | undefined>,
  reset() {
    this.options = null;
    this.registerCount = 0;
    this.updateCalls = [];
  },
};

export function registerSW(options: RegisterSWOptions = {}) {
  pwaRegisterStub.options = options;
  pwaRegisterStub.registerCount += 1;
  return async (reloadPage?: boolean) => {
    pwaRegisterStub.updateCalls.push(reloadPage);
  };
}
