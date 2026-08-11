import type { CSSProperties } from "react";
import { AudioWaveform, Piano } from "lucide-react";
import { css } from "../../../styled-system/css";
import { DialogWrapper } from "./DialogWrapper";
import {
  Button,
  DialogButtonRow,
  FieldRow,
} from "@/design-system/index.ts";

interface TrackCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (type: "audio" | "midi") => void;
}

export function TrackCreateDialog({
  open,
  onClose,
  onCreate,
}: TrackCreateDialogProps) {
  return (
    <DialogWrapper open={open} onClose={onClose} title="Create Track" width={320}>
      <div className={copyClass}>
        Choose which kind of track to add.
      </div>

      <FieldRow label="Track type" className={optionRowClass}>
        <div className={optionsClass}>
          <Button
            aria-label="Create audio track"
            style={AUDIO_BUTTON_STYLE}
            onClick={() => onCreate("audio")}
          >
            <AudioWaveform size={16} />
            <span>Audio Track</span>
          </Button>
          <Button
            aria-label="Create MIDI track"
            style={MIDI_BUTTON_STYLE}
            onClick={() => onCreate("midi")}
          >
            <Piano size={16} />
            <span>MIDI Track</span>
          </Button>
        </div>
      </FieldRow>

      <DialogButtonRow>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogButtonRow>
    </DialogWrapper>
  );
}

const copyClass = css({
  fontSize: "12px",
  color: "var(--text-muted)",
  marginBottom: "14px",
  lineHeight: 1.5,
});

const optionRowClass = css({
  alignItems: "flex-start",
});

const optionsClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  flex: 1,
});

// Overrides Button primitive's recipe styles, so kept as inline CSSProperties
// (Panda `css()` classes can lose to recipe classes depending on load order).
const OPTION_BUTTON_STYLE: CSSProperties = {
  minHeight: 52,
  padding: "0 16px",
  borderRadius: 14,
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "left",
  justifyContent: "flex-start",
  gap: 10,
  boxShadow: "var(--shadow-soft)",
};
const AUDIO_BUTTON_STYLE: CSSProperties = {
  ...OPTION_BUTTON_STYLE,
  borderColor: "var(--border-info)",
  background:
    "linear-gradient(180deg, rgba(19, 40, 64, 0.98), rgba(10, 19, 35, 0.98))",
};
const MIDI_BUTTON_STYLE: CSSProperties = {
  ...OPTION_BUTTON_STYLE,
  borderColor: "var(--border-success)",
  background:
    "linear-gradient(180deg, rgba(19, 39, 35, 0.98), rgba(10, 19, 18, 0.98))",
};
