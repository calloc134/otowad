import type { ReactNode } from "react";
import type {
  MobileTransientActionBadge,
} from "@/app/interaction-contracts/mobile.ts";
import { midiEditorPresenterStyles } from "./surfaceStyles";

interface MidiEditorDesktopPresenterProps {
  clipTitle: string;
  headerInfo: string;
  onBack: () => void;
  editorBody: ReactNode;
  mobileTransientActionBadge?: MobileTransientActionBadge;
}

export function MidiEditorDesktopPresenter({
  clipTitle,
  headerInfo,
  onBack,
  editorBody,
  mobileTransientActionBadge: _mobileTransientActionBadge,
}: MidiEditorDesktopPresenterProps) {
  return (
    <div
      data-testid="midi-editor-root"
      data-midi-editor-variant="desktop"
      className={midiEditorPresenterStyles.desktopRoot}
    >
      <div className={midiEditorPresenterStyles.desktopHeader}>
        <button
          aria-label="Back to timeline"
          className={midiEditorPresenterStyles.backButton}
          onClick={onBack}
          title="Back to timeline"
        >
          &#x2190; Back
        </button>
        <span className={midiEditorPresenterStyles.clipTitle}>{clipTitle}</span>
        <span className={midiEditorPresenterStyles.desktopHeaderInfo}>
          {headerInfo}
        </span>
      </div>
      {editorBody}
    </div>
  );
}
