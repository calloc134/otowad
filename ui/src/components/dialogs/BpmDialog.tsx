import { useCallback, useEffect, useState } from "react";
import { css } from "../../../styled-system/css";
import { DialogWrapper } from "./DialogWrapper";
import {
  Button,
  DialogButtonRow,
  FieldRow,
} from "@/design-system/index.ts";
import { useDocumentState, useProjectActions } from "@/store";
import { buildSetBpmCommand } from "@/intents/projectSettings.ts";

interface BpmDialogProps {
  open: boolean;
  onClose: () => void;
}

type BpmChangeMode = "follow_tempo" | "preserve_seconds";

const DEFAULT_MODE: BpmChangeMode = "preserve_seconds";

export function BpmDialog({ open, onClose }: BpmDialogProps) {
  const { document: doc } = useDocumentState();
  const actions = useProjectActions();

  const currentBpm = (doc?.edit.tempo.points[0]?.micro_bpm ?? 120_000_000) / 1_000_000;
  const [bpm, setBpm] = useState(String(currentBpm));
  const [mode, setMode] = useState<BpmChangeMode>(DEFAULT_MODE);

  useEffect(() => {
    if (!open) return;
    setBpm(String(currentBpm));
    setMode(DEFAULT_MODE);
  }, [open, currentBpm]);

  const handleApply = useCallback(() => {
    const newBpm = parseFloat(bpm);
    if (!Number.isFinite(newBpm) || newBpm < 20 || newBpm > 300) {
      onClose();
      return;
    }

    const microBpm = Math.round(newBpm * 1_000_000);
    if (doc) {
      const command = buildSetBpmCommand(doc, microBpm, {
        preserveSeconds: mode === "preserve_seconds",
      });
      if (command) {
        actions.applyCommand(command);
      }
    }

    onClose();
  }, [actions, bpm, doc, mode, onClose]);

  return (
    <DialogWrapper open={open} onClose={onClose} title="BPM">
      <FieldRow label="BPM">
        <input
          aria-label="BPM value"
          className={numberInputClass}
          type="number"
          value={bpm}
          onChange={(e) => setBpm(e.target.value)}
          min={20}
          max={300}
          step={0.1}
        />
      </FieldRow>

      <FieldRow label="Change mode" className={modeRowClass}>
        <div className={modeOptionsClass}>
          <label className={modeOptionClass}>
            <input
              type="radio"
              name="bpm-change-mode"
              value="follow_tempo"
              checked={mode === "follow_tempo"}
              onChange={() => setMode("follow_tempo")}
            />
            <div className={modeTextClass}>
              <span className={modeTitleClass}>Follow new tempo</span>
              <span className={modeDescriptionClass}>
                Current behavior. Items stay at the same tick positions and follow the new BPM.
              </span>
            </div>
          </label>

          <label className={modeOptionClass}>
            <input
              type="radio"
              name="bpm-change-mode"
              value="preserve_seconds"
              checked={mode === "preserve_seconds"}
              onChange={() => setMode("preserve_seconds")}
            />
            <div className={modeTextClass}>
              <span className={modeTitleClass}>Preserve real time</span>
              <span className={modeDescriptionClass}>
                Rescale tick-domain edit data so clip timing and durations stay aligned in seconds.
              </span>
            </div>
          </label>
        </div>
      </FieldRow>

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

const numberInputClass = css({
  flex: 1,
  minHeight: "36px",
  padding: "0 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  backgroundColor: "rgba(9, 14, 29, 0.96)",
  border: "1px solid var(--border-default)",
  borderRadius: "12px",
  outline: "none",
  fontFamily: "var(--font-family-mono)",
});

const modeRowClass = css({
  alignItems: "flex-start",
});

const modeOptionsClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  flex: 1,
});

const modeOptionClass = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "8px",
  padding: "8px 10px",
  border: "1px solid var(--border-default)",
  borderRadius: "10px",
  backgroundColor: "var(--surface-panel-raised)",
  color: "var(--text-secondary)",
  cursor: "pointer",
});

const modeTextClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

const modeTitleClass = css({
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--text-primary)",
});

const modeDescriptionClass = css({
  fontSize: "11px",
  color: "var(--text-muted)",
  lineHeight: 1.4,
});
