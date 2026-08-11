import { useCallback, useEffect, useState } from "react";
import { css } from "../../../styled-system/css";
import { DialogWrapper } from "./DialogWrapper";
import {
  Button,
  DialogButtonRow,
  FieldRow,
} from "@/design-system/index.ts";
import { useDocumentState, useProjectActions } from "@/store";
import { buildSetTimeSignatureCommand } from "@/intents/projectSettings.ts";

interface TimeSignatureDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TimeSignatureDialog({
  open,
  onClose,
}: TimeSignatureDialogProps) {
  const { document: doc } = useDocumentState();
  const actions = useProjectActions();

  const currentTimeSig = doc?.edit.tempo.points[0]?.time_sig ?? {
    num: 4,
    den: 4,
  };

  const [tsNum, setTsNum] = useState(currentTimeSig.num);
  const [tsDen, setTsDen] = useState(currentTimeSig.den);

  useEffect(() => {
    if (!open) return;
    setTsNum(currentTimeSig.num);
    setTsDen(currentTimeSig.den);
  }, [open, currentTimeSig.den, currentTimeSig.num]);

  const handleApply = useCallback(() => {
    if (doc) {
      const command = buildSetTimeSignatureCommand(doc, {
        num: tsNum,
        den: tsDen,
      });
      if (command) {
        actions.applyCommand(command);
      }
    }

    onClose();
  }, [actions, doc, onClose, tsDen, tsNum]);

  return (
    <DialogWrapper open={open} onClose={onClose} title="Time Signature">
      <FieldRow label="Signature">
        <div className={signatureControlsClass}>
          <select
            aria-label="Time signature numerator"
            className={selectClass}
            style={{ flex: "0 0 72px" }}
            value={tsNum}
            onChange={(e) => setTsNum(Number(e.target.value))}
          >
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className={separatorClass}>/</span>
          <select
            aria-label="Time signature denominator"
            className={selectClass}
            style={{ flex: "0 0 72px" }}
            value={tsDen}
            onChange={(e) => setTsDen(Number(e.target.value))}
          >
            {[2, 4, 8, 16].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </FieldRow>

      <div className={hintClass}>
        Changes affect ruler, grid, and bar display without altering the current BPM.
      </div>

      <DialogButtonRow>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Apply
        </Button>
      </DialogButtonRow>
    </DialogWrapper>
  );
}

const selectClass = css({
  flex: 1,
  minHeight: "36px",
  padding: "0 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  backgroundColor: "rgba(9, 14, 29, 0.96)",
  border: "1px solid var(--border-default)",
  borderRadius: "12px",
  outline: "none",
  cursor: "pointer",
});

const signatureControlsClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flex: 1,
});

const separatorClass = css({
  color: "var(--text-muted)",
  fontSize: "14px",
  fontWeight: 700,
});

const hintClass = css({
  fontSize: "11px",
  color: "var(--text-dim)",
  marginBottom: "4px",
  lineHeight: 1.4,
});
