import { css } from "../../../styled-system/css";
import { Button } from "@/design-system/index.ts";
import type { ServiceWorkerUpdate } from "@/hooks/useServiceWorkerUpdate.ts";

interface UpdatePromptProps {
  update: ServiceWorkerUpdate;
}

/**
 * Non-blocking notice for service worker lifecycle changes.
 *
 * Deliberately a toast rather than a dialog: neither message is urgent enough
 * to interrupt an edit, and a modal that steals focus mid-drag would be worse
 * than the stale build it is warning about.
 *
 * The reload warning is not boilerplate. Reloading drops decoded media buffers
 * that only exist in memory, and autosave recovers the project JSON without
 * them, so someone who reloads without saving loses their imports.
 */
export function UpdatePrompt({ update }: UpdatePromptProps) {
  if (update.updateReady) {
    return (
      <div className={toastClass} role="status" data-testid="update-prompt">
        <div className={textClass}>
          <div className={titleClass}>A new version is available</div>
          <div className={bodyClass}>
            Reloading discards imported media that has not been saved to a
            project file.
          </div>
        </div>
        <div className={actionsClass}>
          <Button
            onClick={update.applyUpdate}
            variant="primary"
            size="sm"
            data-testid="update-prompt-reload"
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }

  if (update.offlineReady) {
    return (
      <div className={toastClass} role="status" data-testid="offline-ready-toast">
        <div className={textClass}>
          <div className={titleClass}>Ready to work offline</div>
          <div className={bodyClass}>
            The app now starts without a network connection.
          </div>
        </div>
        <div className={actionsClass}>
          <Button
            onClick={update.dismissOfflineReady}
            variant="ghost"
            size="sm"
            data-testid="offline-ready-dismiss"
          >
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

const toastClass = css({
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  zIndex: 45,
  display: "flex",
  alignItems: "center",
  gap: "16px",
  maxWidth: "min(520px, calc(100vw - 32px))",
  padding: "12px 16px",
  border: "1px solid var(--border-accent)",
  borderRadius: "14px",
  background: "linear-gradient(180deg, rgba(19, 27, 54, 0.99), rgba(10, 14, 30, 0.99))",
  boxShadow: "var(--panel-shadow)",
  color: "var(--text-primary)",
});

const textClass = css({
  minWidth: 0,
});

const titleClass = css({
  fontSize: "14px",
  fontWeight: 600,
});

const bodyClass = css({
  marginTop: "2px",
  fontSize: "12px",
  color: "var(--text-muted)",
  lineHeight: 1.45,
});

const actionsClass = css({
  display: "flex",
  gap: "8px",
  flexShrink: 0,
});
