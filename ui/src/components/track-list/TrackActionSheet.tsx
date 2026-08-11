import { ArrowDown, ArrowUp, Download, Pencil, Trash2, Upload } from "lucide-react";
import { css } from "../../../styled-system/css";
import { BottomSheet, LargeTouchActionButton } from "@/design-system/index.ts";
import type { TrackEdit } from "@/types";

interface TrackActionSheetProps {
  /** Null while no track's overflow actions are open. */
  track: TrackEdit | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onImport: () => void;
  onExport: (() => void) | undefined;
  onDelete: () => void;
}

/**
 * The actions a phone's track row cannot hold.
 *
 * The row keeps the name, mute and solo; a 132px panel has no room for the
 * rest beside them, and shrinking the buttons further would put them below a
 * usable touch size.
 */
export function TrackActionSheet({
  track,
  canMoveUp,
  canMoveDown,
  onClose,
  onRename,
  onMoveUp,
  onMoveDown,
  onImport,
  onExport,
  onDelete,
}: TrackActionSheetProps) {
  if (!track) {
    return null;
  }

  const isAudio = track.kind.track_type === "audio";

  return (
    <BottomSheet open title={track.name} onClose={onClose}>
      <div data-testid="track-action-sheet" className={actionsClass}>
        <LargeTouchActionButton
          onClick={() => {
            onClose();
            onRename();
          }}
        >
          <Pencil size={16} />
          <span>Rename</span>
        </LargeTouchActionButton>
        <LargeTouchActionButton
          disabled={!canMoveUp}
          onClick={() => {
            onClose();
            onMoveUp();
          }}
        >
          <ArrowUp size={16} />
          <span>Move up</span>
        </LargeTouchActionButton>
        <LargeTouchActionButton
          disabled={!canMoveDown}
          onClick={() => {
            onClose();
            onMoveDown();
          }}
        >
          <ArrowDown size={16} />
          <span>Move down</span>
        </LargeTouchActionButton>
        <LargeTouchActionButton
          onClick={() => {
            onClose();
            onImport();
          }}
        >
          <Upload size={16} />
          <span>{isAudio ? "Import audio" : "Import MIDI"}</span>
        </LargeTouchActionButton>
        {onExport && (
          <LargeTouchActionButton
            onClick={() => {
              onClose();
              onExport();
            }}
          >
            <Download size={16} />
            <span>{isAudio ? "Export WAV" : "Export MIDI"}</span>
          </LargeTouchActionButton>
        )}
        <LargeTouchActionButton
          emphasis="danger"
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          <Trash2 size={16} />
          <span>Delete track</span>
        </LargeTouchActionButton>
      </div>
    </BottomSheet>
  );
}

const actionsClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  minWidth: 0,
});
