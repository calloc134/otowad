import { css } from "../../../styled-system/css";
import { Button, DialogButtonRow } from "@/design-system/index.ts";
import { DialogWrapper } from "./DialogWrapper";

interface TrackDeleteDialogProps {
  open: boolean;
  trackName: string;
  itemCount: number;
  onClose: () => void;
  onConfirm: () => void;
}

export function TrackDeleteDialog({
  open,
  trackName,
  itemCount,
  onClose,
  onConfirm,
}: TrackDeleteDialogProps) {
  const itemLabel = itemCount === 1 ? "item" : "items";

  return (
    <DialogWrapper open={open} onClose={onClose} title="Delete Track" width={360}>
      <div className={copyClass}>
        <strong>{trackName}</strong> still contains {itemCount} {itemLabel}. Deleting the
        track will also remove those items.
      </div>

      <DialogButtonRow>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete Track
        </Button>
      </DialogButtonRow>
    </DialogWrapper>
  );
}

const copyClass = css({
  fontSize: "13px",
  lineHeight: 1.55,
  color: "var(--text-secondary)",
});
