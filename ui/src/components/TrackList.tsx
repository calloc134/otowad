import { useCallback, useMemo, useState } from "react";
import {
  useDocumentState,
  useProjectActions,
  useSelectionState,
  useTransportState,
  useViewportState,
} from "@/store";
import { useFileImport } from "@/hooks/useFileImport.ts";
import { useExport } from "@/hooks/useExport.ts";
import { DEFAULT_TIME_SIGNATURE } from "@/grid";
import { DEFAULT_PPQ } from "@/types";
import {
  buildRenameTrackCommand,
  buildSetTrackGainCommand,
  buildSetTrackPanCommand,
  buildTrackCreateIntent,
  buildTrackMuteToggleCommand,
  buildTrackSoloToggleCommand,
} from "@/intents/trackList.ts";
import { useLayoutMode, useTrackListInteractionPolicy } from "@/app/interactionMode.tsx";
import { Panel } from "@/design-system/index.ts";
import { TrackCreateDialog } from "./dialogs/TrackCreateDialog";
import { TrackDeleteDialog } from "./dialogs/TrackDeleteDialog";
import { TrackActionSheet } from "./track-list/TrackActionSheet";
import { TrackListHeader } from "./track-list/TrackListHeader";
import { useTrackHeight } from "@/hooks/useTrackHeight.ts";
import { TrackListRow } from "./track-list/TrackListRow";
import {
  PHONE_TRACK_LIST_WIDTH,
  TRACK_LIST_WIDTH,
  trackListStyles,
} from "./track-list/trackListStyles";
import { useTrackListInteractionsDesktop } from "./track-list/useTrackListInteractionsDesktop";
import { useTrackListInteractionsMobile } from "./track-list/useTrackListInteractionsMobile";

/**
 * The `Panel` recipe draws a border on all four sides and outranks the
 * utility class, so the override has to be inline. Without it the top border
 * pushes this surface 1px below the timeline and offsets every track from its
 * lane.
 */
const TRACK_LIST_PANEL_STYLE = { borderTopWidth: 0 } as const;

function trackListPanelStyle(width: number) {
  return { ...TRACK_LIST_PANEL_STYLE, width, minWidth: width };
}

export function TrackList() {
  const { document: doc } = useDocumentState();
  const selectionState = useSelectionState();
  const viewportState = useViewportState();
  const transportState = useTransportState();
  const actions = useProjectActions();
  const interactionPolicy = useTrackListInteractionPolicy();
  const { importAudioFile, importMidiFile } = useFileImport();
  const { exportAudioTrack, exportMidiTrack } = useExport();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const trackHeight = useTrackHeight();
  // A phone panel is too narrow to hold every action beside the name.
  const usesOverflowSheet = useLayoutMode() === "phone";
  const panelWidth = usesOverflowSheet ? PHONE_TRACK_LIST_WIDTH : TRACK_LIST_WIDTH;
  const tracks = doc?.edit.tracks ?? [];
  const pitchLinks = doc?.edit.pitch_links ?? [];
  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;
  const isBusy = transportState.busyTask !== null;

  const trackClipCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clip of doc?.edit.clips ?? []) {
      counts.set(clip.track_id, (counts.get(clip.track_id) ?? 0) + 1);
    }
    return counts;
  }, [doc?.edit.clips]);

  const handleCreateTrack = useCallback(
    (type: "audio" | "midi") => {
      const intent = buildTrackCreateIntent(type, ppq, timeSig);
      actions.applyCommand(intent.command);
      actions.selectTrack(intent.trackId);
      setCreateDialogOpen(false);
    },
    [actions, ppq, timeSig],
  );

  const trackListInteractionArgs = {
    doc,
    tracks,
    interactionPolicy,
    scrollX: viewportState.scrollX,
    scrollY: viewportState.scrollY,
    zoomX: viewportState.zoom.x,
    zoomY: viewportState.zoom.y,
    trackClipCountById,
    onRequestCreateDialog: () => setCreateDialogOpen(true),
  };
  const {
    listRef,
    wheelSurfaceRef,
    activeReorderTrackId,
    pendingTrackDeleteTrack,
    pendingTrackDeleteClipCount,
    handleListScroll,
    handleListDoubleClick,
    handleTrackReorderStart,
    moveTrackToIndex,
    requestTrackDelete,
    confirmTrackDelete,
    closePendingTrackDelete,
    actionSheetTrack,
    openTrackActionSheet,
    closeTrackActionSheet,
    dropIndicatorTop,
  } = interactionPolicy.controlSize === "touch"
    ? useTrackListInteractionsMobile(trackListInteractionArgs)
    : useTrackListInteractionsDesktop(trackListInteractionArgs);

  const actionSheetTrackIndex = actionSheetTrack
    ? tracks.findIndex((track) => track.id === actionSheetTrack.id)
    : -1;

  if (!doc) {
    return (
      <Panel variant="muted" className={trackListStyles.container} style={trackListPanelStyle(panelWidth)}>
        <div className={trackListStyles.empty}>No project loaded</div>
      </Panel>
    );
  }

  return (
    <Panel variant="muted" className={trackListStyles.container} style={trackListPanelStyle(panelWidth)}>
      <div
        ref={wheelSurfaceRef}
        data-testid="track-list-surface"
        className={trackListStyles.surface}
        style={{ overscrollBehavior: "none" }}
      >
        <TrackListHeader
          interactionPolicy={interactionPolicy}
          onCreateTrack={handleCreateTrack}
        />
        <div
          ref={listRef}
          className={trackListStyles.list}
          style={{ overscrollBehavior: "none" }}
          onDoubleClick={handleListDoubleClick}
          onScroll={handleListScroll}
          data-testid="track-list-scroll"
        >
          {tracks.length === 0 && (
            <div className={trackListStyles.empty}>No tracks yet</div>
          )}
          <div className={trackListStyles.listInner}>
            {tracks.map((track, index) => (
              <div
                key={track.id}
                style={{ opacity: activeReorderTrackId === track.id ? 0.5 : 1 }}
              >
                <TrackListRow
                  track={track}
                  pitchLinks={pitchLinks}
                  allTracks={tracks}
                  isSelected={selectionState.selectedTrackId === track.id}
                  isReorderSource={activeReorderTrackId === track.id}
                  trackHeight={trackHeight}
                  usesOverflowSheet={usesOverflowSheet}
                  onOpenActionSheet={() => openTrackActionSheet(track.id)}
                  canMoveUp={index > 0}
                  canMoveDown={index < tracks.length - 1}
                  interactionPolicy={interactionPolicy}
                  onSelect={() => actions.selectTrack(track.id)}
                  onMuteToggle={() => actions.applyCommand(buildTrackMuteToggleCommand(track))}
                  onSoloToggle={() => actions.applyCommand(buildTrackSoloToggleCommand(track))}
                  onGainChange={(gainMilliDb) =>
                    actions.applyCommand(buildSetTrackGainCommand(track.id, gainMilliDb))}
                  onPanChange={(panPermille) =>
                    actions.applyCommand(buildSetTrackPanCommand(track.id, panPermille))}
                  onDelete={() => requestTrackDelete(track)}
                  onRename={(name) => actions.applyCommand(buildRenameTrackCommand(track.id, name))}
                  onBeginRename={() => actions.selectTrack(track.id)}
                  onImport={() => {
                    if (isBusy) {
                      return;
                    }
                    actions.selectTrack(track.id);
                    void (
                      track.kind.track_type === "audio"
                        ? importAudioFile(track.id)
                        : importMidiFile(track.id)
                    );
                  }}
                  onExport={() => {
                    if (isBusy) {
                      return;
                    }
                    actions.selectTrack(track.id);
                    void (
                      track.kind.track_type === "audio"
                        ? exportAudioTrack(track.id)
                        : exportMidiTrack(track.id)
                    );
                  }}
                  onMoveUp={() => moveTrackToIndex(track.id, index - 1)}
                  onMoveDown={() => moveTrackToIndex(track.id, index + 1)}
                  onReorderStart={(event) => handleTrackReorderStart(track.id, index, event)}
                />
              </div>
            ))}
            {activeReorderTrackId && tracks.length > 0 && (
              <div
                data-testid="track-reorder-drop-indicator"
                data-glow-state="drop-target"
                className={trackListStyles.dropIndicator}
                style={{ top: dropIndicatorTop }}
              />
            )}
          </div>
        </div>
      </div>
      <TrackCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreateTrack}
      />
      <TrackActionSheet
        track={actionSheetTrack}
        canMoveUp={actionSheetTrackIndex > 0}
        canMoveDown={actionSheetTrackIndex >= 0 && actionSheetTrackIndex < tracks.length - 1}
        onClose={closeTrackActionSheet}
        onRename={() => actionSheetTrack && actions.selectTrack(actionSheetTrack.id)}
        onMoveUp={() => actionSheetTrack && moveTrackToIndex(actionSheetTrack.id, actionSheetTrackIndex - 1)}
        onMoveDown={() => actionSheetTrack && moveTrackToIndex(actionSheetTrack.id, actionSheetTrackIndex + 1)}
        onImport={() => {
          if (!actionSheetTrack || isBusy) return;
          void (actionSheetTrack.kind.track_type === "audio"
            ? importAudioFile(actionSheetTrack.id)
            : importMidiFile(actionSheetTrack.id));
        }}
        onExport={actionSheetTrack
          ? () => {
              if (isBusy) return;
              void (actionSheetTrack.kind.track_type === "audio"
                ? exportAudioTrack(actionSheetTrack.id)
                : exportMidiTrack(actionSheetTrack.id));
            }
          : undefined}
        onDelete={() => actionSheetTrack && requestTrackDelete(actionSheetTrack)}
      />
      <TrackDeleteDialog
        open={pendingTrackDeleteTrack !== null && pendingTrackDeleteClipCount > 0}
        trackName={pendingTrackDeleteTrack?.name ?? ""}
        itemCount={pendingTrackDeleteClipCount}
        onClose={closePendingTrackDelete}
        onConfirm={confirmTrackDelete}
      />
    </Panel>
  );
}
