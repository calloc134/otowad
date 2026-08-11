import { useShellVariantValue } from "@/app/interactionMode.tsx";
import { usePlaybackPrepareUiState } from "@/hooks/useAudioEngine.ts";
import { useMediaRelink } from "@/hooks/useMediaRelink.ts";
import { buildSetTimePitchCommand } from "@/intents/clipCommands.ts";
import {
  getTimeSelectionRange,
  useDocumentState,
  useProjectActions,
  useSelectionState,
  useTransportState,
} from "@/store";
import type { TimePitchSelection } from "@/types";
import { StatusBarDesktopPresenter } from "./status-bar/StatusBarDesktopPresenter";
import { StatusBarMobilePresenter } from "./status-bar/StatusBarMobilePresenter";
import { StatusSummary } from "./status-bar/StatusSummary";
import { SelectionSummary } from "./status-bar/SelectionSummary";

export function StatusBar() {
  const actions = useProjectActions();
  const isMobileShell = useShellVariantValue({ desktop: false, mobile: true });
  const playbackPrepareUi = usePlaybackPrepareUiState();
  const documentState = useDocumentState();
  const selectionState = useSelectionState();
  const transportState = useTransportState();
  const { unavailableMedia, relinkNextUnavailableMedia } = useMediaRelink();
  const doc = documentState.document;

  const selectedClips = doc
    ? doc.edit.clips.filter((clip) => selectionState.selectedClipIds.includes(clip.id))
    : [];
  const primaryClip =
    selectionState.primaryClipId && doc
      ? doc.edit.clips.find((clip) => clip.id === selectionState.primaryClipId) ?? null
      : null;
  const primaryClipLabel = (() => {
    if (!doc || !primaryClip) {
      return null;
    }
    if (primaryClip.kind.clip_type === "midi") {
      return "MIDI Clip";
    }
    const content = doc.edit.contents.find(
      (candidate) =>
        candidate.type === "audio" && candidate.id === primaryClip.kind.content_id,
    );
    const media =
      content?.type === "audio"
        ? doc.edit.media.find((candidate) => candidate.id === content.media_id)
        : null;
    return media?.original_name?.trim() || "Audio Clip";
  })();

  const selectedTrack =
    selectionState.selectedTrackId && doc
      ? doc.edit.tracks.find((t) => t.id === selectionState.selectedTrackId) ?? null
      : null;
  const timeSelection = getTimeSelectionRange(selectionState);

  const firstUnavailableMedia = unavailableMedia[0] ?? null;
  const firstUnavailableAsset = firstUnavailableMedia
    ? doc?.edit.media.find((asset) => asset.id === firstUnavailableMedia.mediaId) ?? null
    : null;

  const handleTimePitchChange = (selection: TimePitchSelection) => {
    if (!doc || !primaryClip || primaryClip.kind.clip_type !== "audio") {
      return;
    }
    const command = buildSetTimePitchCommand(doc, primaryClip.id, selection);
    if (command) {
      actions.applyCommand(command);
    }
  };

  const unavailableMediaLabel = firstUnavailableMedia
    ? `${firstUnavailableMedia.status === "invalid" ? "Invalid" : "Missing"} media: ${firstUnavailableAsset?.original_name || firstUnavailableMedia.mediaId}${unavailableMedia.length > 1 ? ` (+${unavailableMedia.length - 1})` : ""}`
    : null;

  /** Anything the user may have to act on, as opposed to "Ready". */
  const hasAlert = Boolean(
    transportState.busyTask ||
      transportState.error ||
      unavailableMediaLabel ||
      (playbackPrepareUi.active && !playbackPrepareUi.overlayVisible),
  );

  const statusContent = (
    <StatusSummary
      busyTask={transportState.busyTask}
      error={transportState.error}
      playbackPreparing={playbackPrepareUi.active}
      playbackOverlayVisible={playbackPrepareUi.overlayVisible}
      hasDocument={Boolean(doc)}
      unavailableMediaLabel={unavailableMediaLabel}
      onRelinkMedia={() => {
        void relinkNextUnavailableMedia();
      }}
    />
  );

  if (isMobileShell) {
    return <StatusBarMobilePresenter alertContent={hasAlert ? statusContent : null} />;
  }

  const selectionContent = (
    <SelectionSummary
      timeSelection={timeSelection}
      loopEnabled={transportState.loopEnabled}
      selectedClips={selectedClips}
      primaryClip={primaryClip}
      primaryClipLabel={primaryClipLabel}
      selectedTrack={selectedTrack}
      onTimePitchChange={handleTimePitchChange}
    />
  );

  return (
    <StatusBarDesktopPresenter
      statusContent={statusContent}
      selectionContent={selectionContent}
    />
  );
}
