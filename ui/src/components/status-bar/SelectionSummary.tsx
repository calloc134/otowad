import { css } from "../../../styled-system/css";
import {
  StatusPill,
  designTokens,
} from "@/design-system/index.ts";
import { getTimePitchSelection } from "@/intents/clipCommands.ts";
import type {
  ClipEdit,
  TimePitchModeEdit,
  TimePitchSelection,
  TrackEdit,
} from "@/types";

function isAudioClip(
  clip: ClipEdit,
): clip is ClipEdit & {
  kind: { clip_type: "audio"; audio: { time_pitch: TimePitchModeEdit } };
} {
  return clip.kind.clip_type === "audio";
}

interface SelectionSummaryProps {
  timeSelection: { startTick: number; endTick: number } | null;
  loopEnabled: boolean;
  selectedClips: ClipEdit[];
  primaryClip: ClipEdit | null;
  primaryClipLabel: string | null;
  selectedTrack: TrackEdit | null;
  onTimePitchChange: (selection: TimePitchSelection) => void;
}

export function SelectionSummary({
  timeSelection,
  loopEnabled,
  selectedClips,
  primaryClip,
  primaryClipLabel,
  selectedTrack,
  onTimePitchChange,
}: SelectionSummaryProps) {
  const timeSelectionLength = timeSelection
    ? timeSelection.endTick - timeSelection.startTick
    : null;
  const primaryAudioClip = primaryClip && isAudioClip(primaryClip) ? primaryClip : null;
  const primaryTimePitch: TimePitchSelection = primaryAudioClip
    ? getTimePitchSelection(primaryAudioClip.kind.audio.time_pitch)
    : "Voice";
  const formatSigned = (value: number) => `${value >= 0 ? "+" : ""}${value}`;

  return (
    <>
      {timeSelection && timeSelectionLength !== null && (
        <StatusPill
          tone="warning"
          className={selectionPillClass}
          data-glow-state="warning"
          style={{ boxShadow: designTokens.shadow.warning }}
        >
          Range: {timeSelection.startTick} - {timeSelection.endTick} ({timeSelectionLength})
          {loopEnabled ? " | Loop" : ""}
        </StatusPill>
      )}
      {!timeSelection && selectedClips.length === 1 && primaryClip && (
        <div data-testid="clip-inspector" className={clipInspectorClass}>
          <strong className={clipNameClass}>{primaryClipLabel}</strong>
          {primaryClip.kind.clip_type === "audio" ? (
            <>
              <span>Pitch {formatSigned(primaryClip.kind.audio.pitch.manual_coarse_semitones)}</span>
              <span>Fine {formatSigned(primaryClip.kind.audio.pitch.manual_fine_cents)}c</span>
            </>
          ) : (
            <span>Transpose {formatSigned(primaryClip.kind.midi.transpose_semitones)}</span>
          )}
          <span>Gain {(primaryClip.gain_milli_db / 1000).toFixed(1)} dB</span>
          {primaryAudioClip && (
            <label className={algorithmInspectorClass}>
              <span className={algorithmLabelClass}>Time/Pitch</span>
              <select
                aria-label="Time/Pitch Mode"
                className={algorithmSelectClass}
                style={{
                  border: `1px solid ${designTokens.border.default}`,
                  background: designTokens.surface.interactive,
                  color: designTokens.text.primary,
                }}
                value={primaryTimePitch}
                onChange={(event) =>
                  onTimePitchChange(event.target.value as TimePitchSelection)}
              >
                <option value="Local">Local</option>
                <option value="Voice">Voice</option>
                <option value="Music">Music</option>
              </select>
            </label>
          )}
        </div>
      )}
      {!timeSelection && selectedClips.length > 1 && (
        <StatusPill tone="neutral" className={statusPillClass}>
          {selectedClips.length} clips selected | Audio:{" "}
          {selectedClips.filter((clip) => clip.kind.clip_type === "audio").length} | MIDI:{" "}
          {selectedClips.filter((clip) => clip.kind.clip_type === "midi").length}
        </StatusPill>
      )}
      {!timeSelection && selectedClips.length === 0 && selectedTrack && (
        <StatusPill tone="neutral" className={statusPillClass}>
          Track: {selectedTrack.name} ({selectedTrack.kind.track_type})
        </StatusPill>
      )}
    </>
  );
}

const statusPillClass = css({
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const selectionPillClass = css({
  maxWidth: "100%",
});

const clipInspectorClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "10px",
  minWidth: 0,
  flexWrap: "wrap",
  color: "var(--text-secondary)",
  fontFamily: "monospace",
  fontSize: "11px",
});

const clipNameClass = css({
  color: "var(--text-primary)",
  maxWidth: "180px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const algorithmInspectorClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  marginLeft: "2px",
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(11, 16, 31, 0.72)",
  minWidth: 0,
  flexWrap: "wrap",
});

const algorithmLabelClass = css({
  color: "var(--text-muted)",
  fontSize: "10px",
  letterSpacing: "0.4px",
  textTransform: "uppercase",
});

const algorithmSelectClass = css({
  minHeight: "24px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: "700",
  padding: "0 10px",
  outline: "none",
});
