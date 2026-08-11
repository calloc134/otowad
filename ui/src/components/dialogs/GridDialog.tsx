import { useCallback, useEffect, useState } from "react";
import { css } from "../../../styled-system/css";
import { DialogWrapper } from "./DialogWrapper";
import { useDocumentState, useProjectActions, useViewportState } from "@/store";
import { DEFAULT_PPQ } from "@/types";
import type { GridDivision } from "@/types";
import {
  Button,
  DialogButtonRow,
  FieldRow,
} from "@/design-system/index.ts";
import {
  DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
  DEFAULT_TIME_SIGNATURE,
  describeGridDivision,
  divisionToTicks,
} from "@/grid";
import { buildSetGridSettingsCommand } from "@/intents/projectSettings.ts";

interface GridDialogProps {
  open: boolean;
  onClose: () => void;
}

const DIVISION_OPTIONS: GridDivision[] = [
  "Beat",
  "Half",
  "Quarter",
  "Eighth",
  "Sixteenth",
  "ThirtySecond",
  { Triplet: { base: 8 } },
  { Dotted: { base: 8 } },
];

function divisionToKey(d: GridDivision): string {
  if (typeof d === "string") return d;
  if ("Triplet" in d) return `Triplet_${d.Triplet.base}`;
  if ("Dotted" in d) return `Dotted_${d.Dotted.base}`;
  return "Beat";
}

function keyToDivision(key: string): GridDivision {
  for (const opt of DIVISION_OPTIONS) {
    if (divisionToKey(opt) === key) return opt;
  }
  return "Beat";
}

export function GridDialog({ open, onClose }: GridDialogProps) {
  const { document: doc } = useDocumentState();
  const viewportState = useViewportState();
  const actions = useProjectActions();

  const currentGrid = doc?.edit.grid;
  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;

  const [snapEnabled, setSnapEnabled] = useState(
    currentGrid?.snap_enabled ?? true,
  );
  const [divisionKey, setDivisionKey] = useState(
    divisionToKey(currentGrid?.division ?? "Beat"),
  );
  const [magnetRangePermille, setMagnetRangePermille] = useState(
    currentGrid?.magnet_range_permille ?? DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
  );

  useEffect(() => {
    if (!open) return;
    setSnapEnabled(currentGrid?.snap_enabled ?? true);
    setDivisionKey(divisionToKey(currentGrid?.division ?? "Beat"));
    setMagnetRangePermille(
      currentGrid?.magnet_range_permille ?? DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
    );
  }, [open, currentGrid]);

  const selectedDivision = keyToDivision(divisionKey);
  const gridTickSize = divisionToTicks(selectedDivision, ppq, timeSig);
  const pixelsPerTick = viewportState.zoom.x;
  const previewSpacing = gridTickSize * pixelsPerTick;

  const handleApply = useCallback(() => {
    if (doc) {
      const command = buildSetGridSettingsCommand(doc, {
        snap_enabled: snapEnabled,
        division: selectedDivision,
        magnet_range_permille: magnetRangePermille,
      });
      if (command) {
        actions.applyCommand(command);
      }
    }
    onClose();
  }, [doc, snapEnabled, selectedDivision, magnetRangePermille, actions, onClose]);

  return (
    <DialogWrapper open={open} onClose={onClose} title="Grid Settings">
      <FieldRow label="Grid + Snap">
        <label className={checkboxLabelClass}>
          <input
            aria-label="Toggle grid and snap"
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            className={checkboxInputClass}
          />
          {snapEnabled ? "On" : "Off"}
        </label>
      </FieldRow>

      <FieldRow label="Division">
        <select
          aria-label="Grid division"
          className={selectClass}
          value={divisionKey}
          onChange={(e) => setDivisionKey(e.target.value)}
        >
            {DIVISION_OPTIONS.map((opt) => (
              <option key={divisionToKey(opt)} value={divisionToKey(opt)}>
                {describeGridDivision(opt, ppq, timeSig)}
              </option>
              ))}
        </select>
      </FieldRow>

      <FieldRow label="Snap Range" className={alignStartRowClass}>
        <div className={sliderSectionClass}>
          <span className={sliderValueClass}>
            ±{(magnetRangePermille / 10).toFixed(1)}%
          </span>
          <input
            aria-label="Grid snap range"
            className={sliderClass}
            type="range"
            min={0}
            max={1000}
            step={25}
            value={magnetRangePermille}
            onChange={(e) => setMagnetRangePermille(Number(e.target.value))}
          />
          <div className={sliderHintClass}>
            How close the cursor needs to be before it snaps to the grid.
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Preview" className={alignStartRowClass}>
        <div className={previewContainerClass}>
          <div className={previewInnerClass}>
            {previewSpacing >= 2 &&
              Array.from(
                { length: Math.min(40, Math.ceil(200 / previewSpacing)) },
                (_, i) => (
                  <div
                    key={i}
                    className={i === 0 ? previewMajorLineClass : previewMinorLineClass}
                    style={{ left: i * previewSpacing }}
                  />
                ),
              )}
            {previewSpacing < 2 && (
              <span className={previewFallbackTextClass}>
                Lines too dense to preview
              </span>
            )}
          </div>
        </div>
      </FieldRow>

      <div className={previewSummaryClass}>
        Grid size: {gridTickSize} ticks ({previewSpacing.toFixed(1)}px at
        current zoom)
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

const checkboxLabelClass = css({
  display: "flex",
  alignItems: "center",
  fontSize: "13px",
  color: "var(--text-secondary)",
  cursor: "pointer",
});

const checkboxInputClass = css({ marginRight: "6px" });

const previewContainerClass = css({
  flex: 1,
  height: "32px",
  backgroundColor: "rgba(9, 14, 29, 0.96)",
  border: "1px solid var(--border-default)",
  borderRadius: "10px",
  overflow: "hidden",
  position: "relative",
});

const previewInnerClass = css({
  position: "relative",
  width: "100%",
  height: "100%",
});

const previewLineBase = {
  position: "absolute" as const,
  top: 0,
  width: "1px",
  height: "100%",
};

const previewMajorLineClass = css({
  ...previewLineBase,
  backgroundColor: "rgba(255,255,255,0.15)",
});

const previewMinorLineClass = css({
  ...previewLineBase,
  backgroundColor: "rgba(255,255,255,0.06)",
});

const previewFallbackTextClass = css({
  fontSize: "10px",
  color: "#607080",
  position: "absolute",
  top: "8px",
  left: "4px",
});

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

const alignStartRowClass = css({ alignItems: "flex-start" });

const sliderSectionClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  flex: 1,
});

const sliderClass = css({
  width: "100%",
  accentColor: "var(--accent-green)",
});

const sliderValueClass = css({
  fontFamily: "var(--font-family-mono)",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--text-primary)",
});

const sliderHintClass = css({
  fontSize: "11px",
  color: "var(--text-dim)",
  lineHeight: 1.4,
});

const previewSummaryClass = css({
  fontSize: "11px",
  color: "var(--text-dim)",
  marginBottom: "4px",
});
