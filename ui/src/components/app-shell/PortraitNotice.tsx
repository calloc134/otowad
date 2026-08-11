import { useEffect, useRef } from "react";
import { css } from "../../../styled-system/css";
import { Button } from "@/design-system/index.ts";

interface PortraitNoticeProps {
  onDismiss: () => void;
}

/**
 * Advice, not a gate.
 *
 * This used to be an overlay with no way out. A phone in portrait got the
 * whole app blurred to 18% behind a card that could not be dismissed, so a
 * user with rotation lock on — which is most of them — had no route to
 * playback, to the track list, or to their own project files, all of which
 * work in portrait. Only the timeline lane is genuinely cramped, and being
 * cramped is the user's call to make.
 *
 * The dismissal is remembered for the session rather than re-armed on the
 * next rotation: someone who has said they want portrait does not need to say
 * it again every time they turn the phone over.
 */
export function PortraitNotice({ onDismiss }: PortraitNoticeProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  // The app behind this is `inert`, so without moving focus here a keyboard or
  // switch user would have nothing focusable left on the page at all.
  useEffect(() => {
    dismissRef.current?.focus();
  }, []);

  return (
    <div
      data-testid="portrait-notice"
      className={overlayClass}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="portrait-notice-title"
      aria-describedby="portrait-notice-body"
    >
      <div className={cardClass}>
        <div className={iconClass} aria-hidden="true">
          ↻
        </div>
        <h1 id="portrait-notice-title" className={titleClass}>
          Rotate to landscape
        </h1>
        <p id="portrait-notice-body" className={bodyClass}>
          The timeline lane is narrow in portrait. Playback, tracks, and project
          files all work either way.
        </p>
        <Button
          ref={dismissRef}
          onClick={onDismiss}
          variant="primary"
          size="touch"
          className={dismissClass}
        >
          Continue in portrait
        </Button>
      </div>
    </div>
  );
}

const overlayClass = css({
  position: "absolute",
  inset: 0,
  zIndex: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "var(--overlay-portrait-backdrop)",
});

const cardClass = css({
  maxWidth: "320px",
  padding: "24px 20px",
  border: "1px solid var(--border-accent)",
  borderRadius: "20px",
  background: "var(--surface-portrait-card)",
  boxShadow: "var(--panel-shadow)",
  textAlign: "center",
  color: "var(--text-primary)",
});

const iconClass = css({
  marginBottom: "12px",
  fontSize: "36px",
  color: "var(--accent-green)",
});

const titleClass = css({
  margin: "0 0 12px",
  fontSize: "22px",
});

const bodyClass = css({
  margin: 0,
  color: "var(--text-muted)",
  lineHeight: 1.5,
});

const dismissClass = css({
  marginTop: "20px",
  width: "100%",
  justifyContent: "center",
});
