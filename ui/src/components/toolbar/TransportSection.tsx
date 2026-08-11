import { Pause, Play, Square } from "lucide-react";
import { css } from "../../../styled-system/css";
import {
  IconButton,
  MetricChip,
  StatusPill,
  ToolbarGroup,
} from "@/design-system/index.ts";
import { usePlayheadReadout } from "@/hooks/usePlayheadMarker.ts";
import type { TimeSignature } from "@/types";
import { LoopControl } from "./LoopControl";

interface TransportSectionProps {
  bpm: number;
  timeSignature: TimeSignature;
  isPlaying: boolean;
  isBusy: boolean;
  isPlaybackPreparing: boolean;
  hasTimeSelection: boolean;
  loopEnabled: boolean;
  showLoop: boolean;
  /** Must be referentially stable; it is a dependency of the readout. */
  formatPlayheadLabel: (tick: number) => string;
  onOpenBpmDialog: () => void;
  onOpenTimeSignatureDialog: () => void;
  onStop: () => void;
  onPlayPause: () => void;
  onToggleLoop: () => void;
}

export function TransportSection({
  bpm,
  timeSignature,
  isPlaying,
  isBusy,
  isPlaybackPreparing,
  hasTimeSelection,
  loopEnabled,
  showLoop,
  formatPlayheadLabel,
  onOpenBpmDialog,
  onOpenTimeSignatureDialog,
  onStop,
  onPlayPause,
  onToggleLoop,
}: TransportSectionProps) {
  const playheadReadoutRef = usePlayheadReadout(formatPlayheadLabel);

  return (
    <ToolbarGroup className={sectionClass}>
      <MetricChip
        tone="warning"
        onClick={onOpenBpmDialog}
        title="Click to edit BPM"
        className={metricChipClass}
      >
        {bpm.toFixed(1)} BPM
      </MetricChip>
      <MetricChip
        tone="info"
        onClick={onOpenTimeSignatureDialog}
        title="Click to edit time signature"
        className={metricChipClass}
      >
        {timeSignature.num}/{timeSignature.den}
      </MetricChip>

      <div className={dividerClass} />

      <IconButton
        onClick={onStop}
        className={transportButtonClass}
        title="Stop"
        aria-label="Stop"
        variant="transport"
      >
        <Square size={14} />
      </IconButton>
      <IconButton
        onClick={onPlayPause}
        data-glow-state={isPlaying ? "playing" : undefined}
        className={transportButtonClass}
        style={{
          color: isPlaying ? "var(--accent-blue)" : "var(--text-primary)",
          boxShadow: isPlaying ? "var(--glow-blue)" : "var(--panel-shadow-soft)",
        }}
        title={isPlaying ? "Pause" : "Play"}
        aria-label={isPlaying ? "Pause playback" : "Start playback"}
        disabled={(isBusy || isPlaybackPreparing) && !isPlaying}
        variant="transport"
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
      </IconButton>
      {showLoop && (
        <LoopControl
          hasTimeSelection={hasTimeSelection}
          loopEnabled={loopEnabled}
          onToggleLoop={onToggleLoop}
        />
      )}

      <div className={dividerClass} />

      <StatusPill
        tone="success"
        className={positionDisplayClass}
        data-glow-state={isPlaying ? "playing" : undefined}
        style={{ boxShadow: isPlaying ? "var(--glow-green)" : "none" }}
      >
        {/* Rendered without children so React leaves the text the readout
            writes on every playback frame alone. */}
        <span data-testid="playhead-readout" ref={playheadReadoutRef} />
      </StatusPill>
    </ToolbarGroup>
  );
}

const sectionClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
  justifyContent: "center",
});

const metricChipClass = css({
  minHeight: "36px",
});

const dividerClass = css({
  width: "1px",
  height: "28px",
  background:
    "linear-gradient(180deg, transparent, rgba(137, 154, 212, 0.28), transparent)",
  margin: "0 4px",
  flexShrink: 0,
});

const transportButtonClass = css({
  width: "38px",
  height: "38px",
  borderRadius: "14px",
});

const positionDisplayClass = css({
  minWidth: "112px",
  textAlign: "center",
  marginRight: "8px",
});
