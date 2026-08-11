import type { ReactNode } from "react";
import type { MobileTransientActionBadge } from "@/app/interaction-contracts/mobile.ts";
import { TransientActionBadge } from "@/design-system/index.ts";
import { midiEditorPresenterStyles } from "./surfaceStyles";

interface MidiEditorMobilePresenterProps {
  clipTitle: string;
  headerInfo: string;
  onBack: () => void;
  editorBody: ReactNode;
  mobileTransientActionBadge?: MobileTransientActionBadge;
}

export function MidiEditorMobilePresenter({
  clipTitle,
  headerInfo,
  onBack,
  editorBody,
  mobileTransientActionBadge,
}: MidiEditorMobilePresenterProps) {
  return (
    <div
      data-testid="midi-editor-root"
      data-midi-editor-variant="mobile"
      className={midiEditorPresenterStyles.mobileRoot}
    >
      <div className={midiEditorPresenterStyles.mobileHeader}>
        <div className={midiEditorPresenterStyles.headerTopRow}>
          <button
            aria-label="Back to timeline"
            className={midiEditorPresenterStyles.mobileBackButton}
            onClick={onBack}
            title="Back to timeline"
          >
            &#x2190; Back
          </button>
          <span className={midiEditorPresenterStyles.modeLabel}>MIDI</span>
        </div>
        <div className={midiEditorPresenterStyles.headerBottomRow}>
          <span className={midiEditorPresenterStyles.clipTitle}>{clipTitle}</span>
          <span className={midiEditorPresenterStyles.headerInfo}>{headerInfo}</span>
        </div>
        {/* Gestures are implicit, so there is no mode to pick. Only the
            badge reporting the current gesture takes space. */}
        {mobileTransientActionBadge?.visible ? (
          <div className={midiEditorPresenterStyles.mobileToolRail}>
            <TransientActionBadge tone={mobileTransientActionBadge.tone}>
              {mobileTransientActionBadge.label}
            </TransientActionBadge>
          </div>
        ) : null}
      </div>
      {editorBody}
    </div>
  );
}
