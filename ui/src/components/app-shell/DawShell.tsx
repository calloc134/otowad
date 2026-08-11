import { css, cx } from "../../../styled-system/css";
import type { PlaybackPrepareUiState } from "@/hooks/useAudioEngine.ts";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import type { BusyTask, MidiEditorTarget } from "@/state/projectStoreTypes.ts";
import type { AppGlobalInteraction } from "@/app/useAppGlobalInteraction.ts";
import { TrackList } from "@/components/TrackList";
import { Timeline } from "@/components/Timeline";
import { MidiEditor } from "@/components/MidiEditor";
import { AppShellRouter } from "./AppShellRouter";
import { PortraitNotice } from "./PortraitNotice";
import { UpdatePrompt } from "./UpdatePrompt";

interface DawShellProps {
  wasmReady: boolean;
  midiEditorTarget: MidiEditorTarget | null;
  busyTask: BusyTask | null;
  playbackPrepareUi: PlaybackPrepareUiState;
  persistence: PersistenceAPI;
  interaction: AppGlobalInteraction;
}

export function DawShell({
  wasmReady,
  midiEditorTarget,
  busyTask,
  playbackPrepareUi,
  persistence,
  interaction,
}: DawShellProps) {
  if (!wasmReady) {
    return (
      <div className={loadingClass}>
        <div className={loadingTextClass}>Loading WASM core...</div>
      </div>
    );
  }

  const busyOverlay = playbackPrepareUi.overlayVisible
    ? {
        title: playbackPrepareUi.title,
        detail: playbackPrepareUi.detail,
        progress: playbackPrepareUi.progress,
      }
    : busyTask;
  const shellContent = midiEditorTarget ? (
    <MidiEditor contentId={midiEditorTarget.contentId} clipId={midiEditorTarget.clipId} />
  ) : (
    <>
      <TrackList />
      <Timeline />
    </>
  );

  return (
    <div className={rootClass}>
      <div
        className={cx(
          mainUiClass,
          interaction.showPortraitNotice ? mainUiPortraitBlockedClass : undefined,
        )}
        // Dimming alone leaves controls behind the notice tabbable.
        inert={interaction.showPortraitNotice}
      >
        <AppShellRouter
          persistence={persistence}
          projectDialogOpen={interaction.projectDialogOpen}
          onProjectDialogOpen={interaction.openProjectDialog}
          onProjectDialogClose={interaction.closeProjectDialog}
        >
          {shellContent}
        </AppShellRouter>
      </div>
      {interaction.showPortraitNotice && (
        <PortraitNotice onDismiss={interaction.dismissPortraitNotice} />
      )}
      {busyOverlay && (
        <div className={busyOverlayClass} role="alertdialog" aria-live="polite" aria-busy="true">
          <div className={busyCardClass}>
            <div className={busySpinnerClass} aria-hidden="true">
              <div className={busyDotsClass}>
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className={busyLabelClass}>{busyOverlay.title}</div>
            {busyOverlay.detail && <div className={busyDetailClass}>{busyOverlay.detail}</div>}
            {busyOverlay.progress !== null && (
              <div className={busyProgressShellClass} aria-hidden="true">
                <div
                  className={busyProgressBarClass}
                  style={{ width: `${Math.max(4, Math.min(100, busyOverlay.progress * 100))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {/* Keep the update action reachable while the main UI is inert. */}
      <UpdatePrompt update={interaction.serviceWorkerUpdate} />
    </div>
  );
}

const rootClass = css({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  width: "100%",
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(14,18,35,0.88), rgba(7,10,24,0.96))",
  color: "var(--text-primary)",
  fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
  position: "relative",
  overscrollBehavior: "none",
});

const mainUiClass = css({ display: "flex", flex: 1, minWidth: 0, minHeight: 0 });

const mainUiPortraitBlockedClass = css({ opacity: 0.18, filter: "blur(2px)" });

const loadingClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  width: "100%",
  background:
    "radial-gradient(circle at top, rgba(42,58,112,0.4), transparent 40%), linear-gradient(180deg, rgba(14,18,35,0.92), rgba(7,10,24,0.98))",
  color: "var(--text-primary)",
  fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
});

const loadingTextClass = css({
  fontSize: "16px",
  color: "var(--text-muted)",
  fontWeight: 600,
  letterSpacing: "0.3px",
});

const busyOverlayClass = css({
  position: "absolute",
  inset: 0,
  zIndex: 1200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "var(--overlay-busy)",
  backdropFilter: "blur(10px)",
});

const busyCardClass = css({
  width: "min(420px, 100%)",
  padding: "28px 24px",
  borderRadius: "24px",
  border: "1px solid rgba(105, 184, 255, 0.24)",
  background: "var(--surface-busy-card)",
  boxShadow: "var(--shadow-busy-card)",
  textAlign: "center",
});

const busySpinnerClass = css({ display: "flex", justifyContent: "center", marginBottom: "16px" });

const busyDotsClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  "& span": {
    width: "12px",
    height: "12px",
    borderRadius: "999px",
    background: "var(--accent-blue)",
    animation: "busy-pulse 0.9s ease-in-out infinite",
  },
  "& span:nth-child(2)": { animationDelay: "0.12s" },
  "& span:nth-child(3)": { animationDelay: "0.24s" },
});

const busyLabelClass = css({
  color: "var(--text-primary)",
  fontSize: "20px",
  fontWeight: 700,
  letterSpacing: "0.02em",
});

const busyDetailClass = css({ marginTop: "8px", color: "var(--text-muted)", lineHeight: 1.5 });

const busyProgressShellClass = css({
  marginTop: "18px",
  width: "100%",
  height: "8px",
  borderRadius: "999px",
  overflow: "hidden",
  background: "var(--surface-busy-progress-track)",
});

const busyProgressBarClass = css({
  height: "100%",
  borderRadius: "inherit",
  background: "var(--surface-busy-progress-fill)",
  transition: "width 140ms ease",
});
