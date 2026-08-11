import { useCallback, useEffect, useState } from "react";

import { css } from "../../../styled-system/css";
import { useDocumentState, useProjectActions } from "@/store";
import {
  Button,
  DialogButtonRow,
  FieldRow,
  Panel,
  StatusPill,
} from "@/design-system/index.ts";
import type { NoNoteBehavior, NotePriority } from "@/types";
import {
  buildAddPitchLinkIntent,
  buildRemovePitchLinkIntent,
} from "@/intents/pitchLink.ts";
import { DialogWrapper } from "./DialogWrapper";

interface PitchLinkDialogProps {
  open: boolean;
  onClose: () => void;
}

const NO_NOTE_OPTIONS: Array<{
  value: NoNoteBehavior;
  title: string;
  description: string;
}> = [
  {
    value: "KeepOriginal",
    title: "Keep original",
    description: "No note means the clip keeps its unlinked pitch.",
  },
  {
    value: "HoldLast",
    title: "Hold last",
    description: "Keep the previous note target after the MIDI note ends.",
  },
];

const NOTE_PRIORITY_OPTIONS: Array<{
  value: NotePriority;
  title: string;
  description: string;
}> = [
  {
    value: "Highest",
    title: "Highest",
    description: "Prefer the highest active note.",
  },
  {
    value: "Lowest",
    title: "Lowest",
    description: "Prefer the lowest active note.",
  },
  {
    value: "Latest",
    title: "Latest",
    description: "Prefer the overlapping note that started most recently.",
  },
];

export function PitchLinkDialog({ open, onClose }: PitchLinkDialogProps) {
  const { document: doc } = useDocumentState();
  const actions = useProjectActions();

  const [selectedMidiTrack, setSelectedMidiTrack] = useState("");
  const [selectedAudioTrack, setSelectedAudioTrack] = useState("");
  const [noNote, setNoNote] = useState<NoNoteBehavior>("KeepOriginal");
  const [notePriority, setNotePriority] = useState<NotePriority>("Highest");

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedMidiTrack("");
    setSelectedAudioTrack("");
    setNoNote("KeepOriginal");
    setNotePriority("Highest");
  }, [open]);

  const handleAdd = useCallback(() => {
    if (!doc) return;
    const command = buildAddPitchLinkIntent({
      document: doc,
      midiTrackId: selectedMidiTrack,
      audioTrackId: selectedAudioTrack,
      noNoteBehavior: noNote,
      notePriority,
    });
    if (!command) {
      return;
    }

    actions.applyCommand(command);

    setSelectedMidiTrack("");
    setSelectedAudioTrack("");
  }, [actions, doc, noNote, notePriority, selectedAudioTrack, selectedMidiTrack]);

  const handleRemove = useCallback(
    (id: string) => {
      if (!doc) return;
      const command = buildRemovePitchLinkIntent(doc, id);
      if (!command) {
        return;
      }

      actions.applyCommand(command);
    },
    [actions, doc],
  );

  if (!doc) return null;

  const tracks = doc.edit.tracks;
  const midiTracks = tracks.filter((track) => track.kind.track_type === "midi");
  const audioTracks = tracks.filter((track) => track.kind.track_type === "audio");
  const pitchLinks = doc.edit.pitch_links;
  const linkedAudioTrackIds = new Set(pitchLinks.map((link) => link.audio_track));
  const canAddLink = Boolean(
    selectedMidiTrack &&
    selectedAudioTrack &&
    !linkedAudioTrackIds.has(selectedAudioTrack),
  );

  const trackName = (id: string): string => {
    const track = doc.edit.tracks.find((candidate) => candidate.id === id);
    return track ? track.name : id.slice(0, 8);
  };

  return (
    <DialogWrapper
      open={open}
      onClose={onClose}
      title="Pitch Links (MIDI -> Audio)"
      width={520}
    >
      <Panel variant="inset" className={activeLinksPanelClass}>
        <div className={sectionHeaderRowClass}>
          <div>
            <div className={sectionEyebrowClass}>Active links</div>
            <div className={sectionCaptionClass}>
              Link one MIDI track to one audio track for note-follow pitch control.
            </div>
          </div>
          <StatusPill tone={pitchLinks.length > 0 ? "warning" : "neutral"}>
            {pitchLinks.length} active
          </StatusPill>
        </div>

        {pitchLinks.length === 0 ? (
          <div className={emptyStateClass}>No pitch links configured.</div>
        ) : (
          <div className={activeLinksListClass}>
            {pitchLinks.map((link) => (
              <div key={link.id} className={linkRowClass}>
                <div className={linkSummaryClass}>
                  <div className={linkTracksClass}>
                    <StatusPill tone="success" className={trackTagClass}>
                      MIDI
                    </StatusPill>
                    <span className={trackNameClass}>{trackName(link.midi_track)}</span>
                    <span className={arrowClass}>-&gt;</span>
                    <StatusPill tone="info" className={trackTagClass}>
                      Audio
                    </StatusPill>
                    <span className={trackNameClass}>{trackName(link.audio_track)}</span>
                  </div>
                  <div className={linkMetaClass}>
                    <StatusPill tone="neutral">{link.no_note_behavior === "HoldLast" ? "Hold last" : "Keep original"}</StatusPill>
                    <StatusPill tone="neutral">{link.priority}</StatusPill>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleRemove(link.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {midiTracks.length === 0 || audioTracks.length === 0 ? (
        <Panel variant="muted" className={missingTracksPanelClass}>
          Need at least one MIDI track and one audio track to create a link.
        </Panel>
      ) : (
        <>
          <FieldRow label="MIDI Source">
            <select
              aria-label="Pitch link MIDI source"
              className={selectClass}
              value={selectedMidiTrack}
              onChange={(event) => setSelectedMidiTrack(event.target.value)}
            >
              <option value="">-- Select MIDI track --</option>
              {midiTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="Audio Target">
            <select
              aria-label="Pitch link audio target"
              className={selectClass}
              value={selectedAudioTrack}
              onChange={(event) => setSelectedAudioTrack(event.target.value)}
            >
              <option value="">-- Select audio track --</option>
              {audioTracks.map((track) => {
                const alreadyLinked = linkedAudioTrackIds.has(track.id);
                return (
                  <option key={track.id} value={track.id} disabled={alreadyLinked}>
                    {track.name}{alreadyLinked ? " (already linked)" : ""}
                  </option>
                );
              })}
            </select>
          </FieldRow>

          <FieldRow label="No-Note" className={alignStartRowClass}>
            <div className={optionStackClass}>
              {NO_NOTE_OPTIONS.map((option) => {
                const active = noNote === option.value;
                return (
                  <label key={option.value} className={optionCardClass}>
                    <input
                      type="radio"
                      name="pitch-link-no-note"
                      aria-label={option.title}
                      checked={active}
                      onChange={() => setNoNote(option.value)}
                    />
                    <div className={active ? optionTextActiveClass : optionTextClass}>
                      <span className={optionTitleClass}>{option.title}</span>
                      <span className={optionDescriptionClass}>{option.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </FieldRow>

          <FieldRow label="Priority" className={alignStartRowClass}>
            <div className={optionStackClass}>
              {NOTE_PRIORITY_OPTIONS.map((option) => {
                const active = notePriority === option.value;
                return (
                  <label key={option.value} className={optionCardClass}>
                    <input
                      type="radio"
                      name="pitch-link-priority"
                      aria-label={option.title}
                      checked={active}
                      onChange={() => setNotePriority(option.value)}
                    />
                    <div className={active ? optionTextActiveClass : optionTextClass}>
                      <span className={optionTitleClass}>{option.title}</span>
                      <span className={optionDescriptionClass}>{option.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </FieldRow>

          <DialogButtonRow>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={!canAddLink}
            >
              Add Link
            </Button>
          </DialogButtonRow>
        </>
      )}
    </DialogWrapper>
  );
}

const activeLinksPanelClass = css({
  padding: "16px 16px 12px",
  marginBottom: "16px",
});

const sectionHeaderRowClass = css({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "12px",
});

const sectionEyebrowClass = css({
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.8px",
  textTransform: "uppercase",
  color: "var(--feedback-info)",
});

const sectionCaptionClass = css({
  marginTop: "4px",
  fontSize: "12px",
  lineHeight: 1.5,
  color: "var(--text-muted)",
});

const emptyStateClass = css({
  fontSize: "12px",
  color: "var(--text-dim)",
});

const activeLinksListClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "10px",
});

const linkRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  justifyContent: "space-between",
  paddingTop: "10px",
  borderTop: "1px solid var(--border-default)",
});

const linkSummaryClass = css({
  minWidth: 0,
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

const linkTracksClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
});

const trackTagClass = css({ flexShrink: 0 });

const trackNameClass = css({
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--text-primary)",
  minWidth: 0,
});

const arrowClass = css({
  color: "var(--text-dim)",
  fontSize: "14px",
  flexShrink: 0,
});

const linkMetaClass = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
});

const missingTracksPanelClass = css({
  padding: "16px",
  fontSize: "12px",
  color: "var(--text-dim)",
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

const optionStackClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  flex: 1,
});

const optionCardClass = css({
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

const optionTextClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

const optionTextActiveClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  color: "var(--text-primary)",
});

const optionTitleClass = css({
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--text-primary)",
});

const optionDescriptionClass = css({
  fontSize: "11px",
  lineHeight: 1.4,
  color: "var(--text-muted)",
});
