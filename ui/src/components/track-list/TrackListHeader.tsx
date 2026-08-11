import { AudioWaveform, Piano } from "lucide-react";
import type { TrackListInteractionPolicy } from "@/app/deviceInteraction.ts";
import { Button, ToolbarGroup } from "@/design-system/index.ts";
import { trackListButtonStyles, trackListStyles } from "./trackListStyles";

interface TrackListHeaderProps {
  interactionPolicy: TrackListInteractionPolicy;
  onCreateTrack: (type: "audio" | "midi") => void;
}

export function TrackListHeader({
  interactionPolicy,
  onCreateTrack,
}: TrackListHeaderProps) {
  const usesTouchControls = interactionPolicy.controlSize === "touch";

  return (
    <div className={trackListStyles.header}>
      {/* The panel is a fixed 196px and "Tracks" never fit alongside both
          actions — the MIDI button was clipped mid-word at every width. The
          heading was the redundant half: the actions name what they create. */}
      <div className={trackListStyles.headerTitleRow}>
        <ToolbarGroup className={trackListStyles.headerActions}>
          <Button
            data-testid="track-add-audio"
            size="sm"
            variant="secondary"
            style={trackListButtonStyles.headerAudio(usesTouchControls)}
            onClick={() => onCreateTrack("audio")}
            title="Add audio track"
          >
            <AudioWaveform size={13} />
            <span>Audio</span>
          </Button>
          <Button
            data-testid="track-add-midi"
            size="sm"
            variant="secondary"
            style={trackListButtonStyles.headerMidi(usesTouchControls)}
            onClick={() => onCreateTrack("midi")}
            title="Add MIDI track"
          >
            <Piano size={13} />
            <span>MIDI</span>
          </Button>
        </ToolbarGroup>
      </div>
    </div>
  );
}
