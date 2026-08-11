import { useCallback, useMemo } from "react";
import {
  getTimeSelectionRange,
  useDocumentState,
  useProjectActions,
  useSelectionState,
  useViewportState,
} from "@/store";
import { DEFAULT_PPQ } from "@/types";
import {
  DEFAULT_TIME_SIGNATURE,
  GRID_LINE_COLORS,
  effectiveBeatTicks,
  ticksPerBar as getTicksPerBar,
} from "@/grid";
import { useFileImport } from "@/hooks/useFileImport.ts";
import { usePlayheadMarker } from "@/hooks/usePlayheadMarker.ts";
import { useElementSize } from "@/hooks/useElementSize.ts";
import { useTrackHeight } from "@/hooks/useTrackHeight.ts";
import { useGridSnap } from "@/hooks/useGridSnap";
import { useClipDragPreview } from "@/hooks/useClipDrag";
import type { DragPreviewSnapshot } from "@/hooks/clipDragPreviewStore";
import { useShellVariantValue, useTimelineInteractionPolicy } from "@/app/interactionMode.tsx";
import { ClipView } from "./ClipView";
import { createTimelineController } from "./timelineController";
import { TimelineDesktopPresenter } from "./timeline/TimelineDesktopPresenter";
import { TimelineMobilePresenter } from "./timeline/TimelineMobilePresenter";
import { useTimelineInteractionsDesktop } from "./timeline/useTimelineInteractionsDesktop";
import { useTimelineInteractionsMobile } from "./timeline/useTimelineInteractionsMobile";
import { buildTimelineGeometry } from "./timeline/timelineGeometry";
import { timelineSurfaceStyles } from "./timeline/surfaceStyles";
import {
  resolveTimelineVisibleWindow,
  selectVisibleTimelineClips,
  selectVisibleTimelineStepIndices,
  selectVisibleTimelineTrackIndices,
} from "./timeline/timelineVirtualization.ts";
import {
  TIMELINE_LANE_BORDER,
  TIMELINE_LANE_HOVER_BG,
  TIMELINE_LANE_MUTED_BG,
  TIMELINE_PLAYHEAD,
  TIMELINE_RULER_LABEL,
  TIMELINE_RULER_LABEL_BORDER,
  TRACK_KIND_DROP_PREVIEW_ACTIVE,
  TRACK_KIND_DROP_PREVIEW_APPEND,
  TRACK_KIND_DROP_PREVIEW_HINT,
  TRACK_KIND_GLOW,
  TRACK_KIND_SOLID,
} from "@/design-system/trackKindColors";

export function Timeline() {
  const { document: doc } = useDocumentState();
  const selectionState = useSelectionState();
  const viewportState = useViewportState();
  const actions = useProjectActions();
  const { importFileToTrack } = useFileImport();
  const { gridTickSize, isSnapEnabled, snapTick } = useGridSnap();
  const interactionPolicy = useTimelineInteractionPolicy();

  const pixelsPerTick = viewportState.zoom.x;
  // `zoom.y` used to be displayed by the V zoom control and read by nothing,
  // so the control changed a number and no track ever resized.
  const trackHeight = useTrackHeight();
  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;
  const ticksPerBeat = effectiveBeatTicks(ppq, timeSig);
  const ticksPerBar = getTicksPerBar(ppq, timeSig);

  const tracks = doc ? doc.edit.tracks : [];
  const clips = doc?.edit.clips ?? [];
  const dragPreview = useClipDragPreview();
  const selectedClipIdSet = useMemo(
    () => new Set(selectionState.selectedClipIds),
    [selectionState.selectedClipIds],
  );
  const trackIndexById = useMemo(
    () => new Map(tracks.map((track, index) => [track.id, index])),
    [tracks],
  );
  const mediaById = useMemo(
    () => new Map((doc?.edit.media ?? []).map((media) => [media.id, media])),
    [doc?.edit.media],
  );
  const contentById = useMemo(
    () => new Map((doc?.edit.contents ?? []).map((content) => [content.id, content])),
    [doc?.edit.contents],
  );
  const clipById = useMemo(
    () => new Map(clips.map((clip) => [clip.id, clip])),
    [clips],
  );
  const previewTargetTrackIdSet = useMemo(() => {
    const trackIds = new Set<string>();
    for (const clipId of dragPreview.activeClipIds) {
      const clip = clipById.get(clipId);
      const previewTrackId = dragPreview.previewTrackIds[clipId];
      if (clip && previewTrackId && previewTrackId !== clip.track_id) {
        trackIds.add(previewTrackId);
      }
    }
    return trackIds;
  }, [clipById, dragPreview]);
  const copyDragGhosts = useMemo<Array<{
    clip: (typeof clips)[number];
    trackIndex: number;
    previewStart: number;
  }>>(() => {
    if (dragPreview.mode !== "copy") {
      return [];
    }

    return dragPreview.activeClipIds.flatMap((clipId: DragPreviewSnapshot["activeClipIds"][number]) => {
      const clip = clipById.get(clipId);
      if (!clip) {
        return [];
      }

      const trackId = dragPreview.previewTrackIds[clipId] ?? clip.track_id;
      const trackIndex = trackIndexById.get(trackId);
      if (trackIndex === undefined) {
        return [];
      }

      return [{
        clip,
        trackIndex,
        previewStart: dragPreview.previewStarts[clipId] ?? clip.start,
      }];
    });
  }, [clipById, dragPreview, trackIndexById]);
  const timeSelection = getTimeSelectionRange(selectionState);
  const handleClipDoubleClick = useCallback(
    (clipId: string) => {
      const clickedClip = clips.find((c) => c.id === clipId);
      if (clickedClip && clickedClip.kind.clip_type === "midi") {
        actions.openMidiEditor(clickedClip.kind.content_id, clipId);
      }
    },
    [clips, actions],
  );

  /** Set of audio track IDs that have an active pitch link. */
  const pitchLinkedAudioTrackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of doc?.edit.pitch_links ?? []) {
      ids.add(link.audio_track);
    }
    return ids;
  }, [doc?.edit.pitch_links]);
  const controller = useMemo(
    () =>
      createTimelineController({
        document: doc,
        tracks,
        clips,
        state: {
          selectedClipIds: selectionState.selectedClipIds,
          primaryClipId: selectionState.primaryClipId,
          selectedClipKind: selectionState.selectedClipKind,
        },
        actions,
        snapTick,
        ticksPerBar,
        pitchLinkedAudioTrackIds,
      }),
    [
      actions,
      clips,
      doc,
      pitchLinkedAudioTrackIds,
      snapTick,
      selectionState.primaryClipId,
      selectionState.selectedClipKind,
      selectionState.selectedClipIds,
      ticksPerBar,
      tracks,
    ],
  );
  const timelineInteractionsArgs = {
    doc,
    tracks,
    clips,
    pixelsPerTick,
    selectionState: {
      scrollX: viewportState.scrollX,
      scrollY: viewportState.scrollY,
      zoom: viewportState.zoom,
      selectedClipIds: selectionState.selectedClipIds,
      selectedClipKind: selectionState.selectedClipKind,
      primaryClipId: selectionState.primaryClipId,
    },
    interactionPolicy,
    actions,
    importFileToTrack,
  };
  const useTimelineInteractionAdapter = useShellVariantValue({
    desktop: useTimelineInteractionsDesktop,
    mobile: useTimelineInteractionsMobile,
  });
  const {
    rootRef,
    scrollRef,
    rulerRef,
    timelineRef,
    marquee,
    fileDropPreview,
    getViewportContentPoint,
    getTickFromViewportClientX,
    handleRulerClick,
    handleTimelineClick,
    handleLanesScroll,
    handleRulerPointerDown,
    handleRulerPointerMove,
    finishRulerPointerGesture,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    finishTimelinePointerGesture,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
    mobileTransientActionBadge,
  } = useTimelineInteractionAdapter(timelineInteractionsArgs);
  const [measureTimelineViewport, timelineViewportSize] = useElementSize<HTMLDivElement>();
  const fallbackViewportWidth = typeof window === "undefined" ? 1_280 : window.innerWidth;
  const fallbackViewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  const setTimelineScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      measureTimelineViewport(element);
    },
    [measureTimelineViewport, scrollRef],
  );
  const visibleWindow = useMemo(
    () =>
      resolveTimelineVisibleWindow({
        scrollX: viewportState.scrollX,
        scrollY: viewportState.scrollY,
        viewportWidth: timelineViewportSize.width || fallbackViewportWidth,
        viewportHeight: timelineViewportSize.height || fallbackViewportHeight,
        pixelsPerTick,
        trackHeight,
        trackCount: tracks.length,
      }),
    [
      pixelsPerTick,
      fallbackViewportHeight,
      fallbackViewportWidth,
      timelineViewportSize.height,
      timelineViewportSize.width,
      trackHeight,
      tracks.length,
      viewportState.scrollX,
      viewportState.scrollY,
    ],
  );
  const activeDragClipIdSet = useMemo(
    () => new Set(dragPreview.activeClipIds),
    [dragPreview.activeClipIds],
  );
  const visibleClips = useMemo(
    () =>
      selectVisibleTimelineClips({
        clips,
        trackIndexById,
        visibleWindow,
        alwaysIncludeClipIds: activeDragClipIdSet,
      }),
    [activeDragClipIdSet, clips, trackIndexById, visibleWindow],
  );
  const visibleTrackIndices = useMemo(
    () => selectVisibleTimelineTrackIndices(tracks.length, visibleWindow),
    [tracks.length, visibleWindow],
  );
  const timelineGeometry = useMemo(
    () =>
      buildTimelineGeometry({
        clips,
        ticksPerBar,
        ticksPerBeat,
        pixelsPerTick,
        trackCount: tracks.length,
        trackHeight,
        appendNewTrack: Boolean(fileDropPreview?.appendNewTrack),
        timeSelection,
        isSnapEnabled,
        gridTickSize,
      }),
    [
      clips,
      fileDropPreview?.appendNewTrack,
      gridTickSize,
      isSnapEnabled,
      pixelsPerTick,
      ticksPerBar,
      ticksPerBeat,
      timeSelection,
      tracks.length,
    ],
  );
  const {
    totalWidth,
    barWidthPx,
    barLabelInterval,
    totalBars,
    timelineHeight,
    canvasHeight,
    timeSelectionLeft,
    timeSelectionWidth,
    gridLines,
    showSubGrid,
  } = timelineGeometry;
  const visibleBarIndices = useMemo(
    () => selectVisibleTimelineStepIndices(totalBars, ticksPerBar, visibleWindow),
    [ticksPerBar, totalBars, visibleWindow],
  );
  const visibleBeatIndices = useMemo(
    () =>
      selectVisibleTimelineStepIndices(
        totalBars * timeSig.num,
        ticksPerBeat,
        visibleWindow,
      ),
    [ticksPerBeat, timeSig.num, totalBars, visibleWindow],
  );
  const visibleGridLines = useMemo(() => {
    if (!visibleWindow) {
      return gridLines;
    }
    const left = visibleWindow.startTick * pixelsPerTick;
    const right = visibleWindow.endTick * pixelsPerTick;
    return gridLines.filter((line) => line.x >= left && line.x < right);
  }, [gridLines, pixelsPerTick, visibleWindow]);

  const handleTimelineDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        !doc ||
        (
          event.target instanceof Element &&
          event.target.closest("[data-clip-root='true']")
        )
      ) {
        return;
      }

      const point = getViewportContentPoint(
        event.clientX,
        event.clientY,
        scrollRef.current,
      );
      if (!point) {
        return;
      }
      const trackIndex = Math.floor(point.y / trackHeight);
      const track = controller.findTrackAtIndex(trackIndex);
      if (!track || track.kind.track_type !== "midi") {
        return;
      }

      controller.createEmptyMidiClip(
        track.id,
        getTickFromViewportClientX(event.clientX, scrollRef.current),
      );
    },
    [controller, doc, getTickFromViewportClientX, getViewportContentPoint],
  );

  const handleClipSelect = useCallback(
    (
      clipId: string,
      event: Pick<React.MouseEvent | React.PointerEvent, "ctrlKey" | "metaKey">,
      intent?: { clickTick?: number; selectionMode?: "default" | "preserve_clicked" },
    ) => {
      controller.handleClipSelect(clipId, event, intent);
    },
    [controller],
  );

  const handleDeleteClip = useCallback(
    (clipId: string) => {
      controller.handleDeleteClip(clipId);
    },
    [controller],
  );

  const handleDuplicateClip = useCallback(
    (clipId: string) => {
      controller.handleDuplicateClip(clipId);
    },
    [controller],
  );

  const handlePitchChange = useCallback(
    (clipId: string, delta: number) => {
      controller.handlePitchChange(clipId, delta);
    },
    [controller],
  );

  const handleFinePitchChange = useCallback(
    (clipId: string, delta: number) => {
      controller.handleFinePitchChange(clipId, delta);
    },
    [controller],
  );

  const handleSplitClip = useCallback(
    (clipId: string, tickInClip: number) => {
      controller.handleSplitClip(clipId, tickInClip);
    },
    [controller],
  );

  // Playhead markers use imperative refs so the rAF playback loop can move
  // them without re-rendering Timeline (and its clips) every frame.
  const rulerPlayheadRef = usePlayheadMarker(pixelsPerTick, -5);
  const lanePlayheadRef = usePlayheadMarker(pixelsPerTick, 0);
  const emptyState = !doc ? (
    <div className={timelineSurfaceStyles.emptyState}>
      Create or load a project to get started
    </div>
  ) : null;

  const rulerNode = doc ? (
    <div ref={rulerRef} data-testid="timeline-ruler" className={timelineSurfaceStyles.rulerOuter}>
      <div
        data-testid="timeline-ruler-inner"
        className={timelineSurfaceStyles.rulerInner}
        style={{ width: totalWidth }}
        onClick={handleRulerClick}
        onPointerDown={handleRulerPointerDown}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={finishRulerPointerGesture}
        onPointerCancel={finishRulerPointerGesture}
      >
        {timeSelection && (
          <div
            className={timelineSurfaceStyles.timeSelection}
            style={{
              left: timeSelectionLeft,
              width: timeSelectionWidth,
            }}
          />
        )}
        {visibleBarIndices.map((i) => {
          if (i % barLabelInterval !== 0) return null;
          const barNumber = i + 1;
          const x = i * ticksPerBar * pixelsPerTick;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: 0,
                height: "100%",
                display: "flex",
                alignItems: "center",
                paddingLeft: 4,
                fontSize: 10,
                color: TIMELINE_RULER_LABEL,
                userSelect: "none",
                borderLeft: `1px solid ${TIMELINE_RULER_LABEL_BORDER}`,
                pointerEvents: "none",
              }}
            >
              {barNumber}
            </div>
          );
        })}
        <div
          ref={rulerPlayheadRef}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderBottom: `6px solid ${TIMELINE_PLAYHEAD}`,
          }}
        />
      </div>
    </div>
  ) : null;

  const lanesNode = doc ? (
    <div
      ref={setTimelineScrollRef}
      data-testid="timeline-scroll"
      className={timelineSurfaceStyles.lanesOuter}
      style={{ overscrollBehavior: "none" }}
      onScroll={handleLanesScroll}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={handleTimelineDragOver}
      onDragLeave={handleTimelineDragLeave}
      onDrop={handleTimelineDrop}
    >
      <div
        ref={timelineRef}
        data-testid="timeline-canvas"
        data-total-clip-count={clips.length}
        data-rendered-clip-count={visibleClips.length}
        className={timelineSurfaceStyles.timelineCanvas}
        style={{
          width: totalWidth,
          height: canvasHeight,
        }}
        onClick={handleTimelineClick}
        onDoubleClick={handleTimelineDoubleClick}
        onPointerDown={handleTimelinePointerDown}
        onPointerMove={handleTimelinePointerMove}
        onPointerUp={finishTimelinePointerGesture}
        onPointerCancel={finishTimelinePointerGesture}
      >
          {/* Grid lines (bar lines) */}
          {visibleBarIndices.map((i) => {
            const x = i * ticksPerBar * pixelsPerTick;
            const isMajor = i % barLabelInterval === 0;
            return (
              <div
                key={`grid-${i}`}
                style={{
                  position: "absolute",
                  left: x,
                  top: 0,
                  width: 1,
                  height: "100%",
                  backgroundColor: isMajor
                    ? GRID_LINE_COLORS.barMajor
                    : GRID_LINE_COLORS.barMinor,
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {/* Beat grid lines (subdivisions within bars) */}
          {showSubGrid &&
            barWidthPx >= 40 &&
            visibleBeatIndices.map((i) => {
                if (i % timeSig.num === 0) return null; // skip bar lines
                const x = i * ticksPerBeat * pixelsPerTick;
                return (
                  <div
                    key={`beat-${i}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: 0,
                      width: 1,
                      height: "100%",
                      backgroundColor: GRID_LINE_COLORS.beat,
                      pointerEvents: "none",
                    }}
                  />
                );
            })}

          {/* Grid subdivision lines (based on grid settings) */}
          {visibleGridLines.map((line) => (
            <div
              key={`sub-${line.x}`}
              style={{
                position: "absolute",
                left: line.x,
                top: 0,
                width: 1,
                height: "100%",
                backgroundColor: line.isBeat
                  ? GRID_LINE_COLORS.beat
                  : GRID_LINE_COLORS.subdivision,
                pointerEvents: "none",
              }}
            />
          ))}

          {/* Track lane backgrounds */}
          {visibleTrackIndices.map((idx) => {
            const track = tracks[idx];
            if (!track) {
              return null;
            }
            const dropKind = fileDropPreview?.kind ?? "other";
            const isDropTarget = fileDropPreview?.trackIndex === idx;
            const isAppendTarget = fileDropPreview?.appendNewTrack && idx === tracks.length - 1;
            const isPreviewTarget = previewTargetTrackIdSet.has(track.id);
            const laneBg = isDropTarget
              ? TRACK_KIND_DROP_PREVIEW_ACTIVE[dropKind]
              : isAppendTarget
                ? TRACK_KIND_DROP_PREVIEW_APPEND[dropKind]
                : isPreviewTarget
                  ? TRACK_KIND_DROP_PREVIEW_HINT[track.kind.track_type]
                  : track.mute
                    ? TIMELINE_LANE_MUTED_BG
                    : selectionState.selectedTrackId === track.id
                      ? TIMELINE_LANE_HOVER_BG
                      : "transparent";
            return (
              <div
                key={`lane-${track.id}`}
                style={{
                  position: "absolute",
                  left: 0,
                  top: idx * trackHeight,
                  width: "100%",
                  height: trackHeight,
                  borderBottom: `1px solid ${TIMELINE_LANE_BORDER}`,
                  backgroundColor: laneBg,
                  boxSizing: "border-box",
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {fileDropPreview && (
            <div
              data-glow-state="drop-target"
              style={{
                position: "absolute",
                left: Number.isFinite(fileDropPreview.tick)
                  ? fileDropPreview.tick * pixelsPerTick
                  : 0,
                top: (fileDropPreview.trackIndex ?? tracks.length) * trackHeight,
                width: 2,
                height: trackHeight,
                backgroundColor: TRACK_KIND_SOLID[fileDropPreview.kind ?? "other"],
                boxShadow: TRACK_KIND_GLOW[fileDropPreview.kind ?? "other"],
                pointerEvents: "none",
                zIndex: 8,
              }}
            />
          )}

          {fileDropPreview?.appendNewTrack && (
            <div
              data-testid="timeline-drop-preview-new-track"
              style={{
                position: "absolute",
                left: 0,
                top: timelineHeight,
                width: totalWidth,
                height: trackHeight,
                borderTop: "1px dashed rgba(255,255,255,0.18)",
                backgroundColor:
                  fileDropPreview.kind === "audio"
                    ? "rgba(79, 195, 247, 0.1)"
                    : fileDropPreview.kind === "midi"
                      ? "rgba(102, 187, 106, 0.14)"
                      : "rgba(147, 167, 224, 0.1)",
                pointerEvents: "none",
                zIndex: 7,
              }}
            />
          )}

          {timeSelection && (
            <div
              style={{
                position: "absolute",
                left: timeSelectionLeft,
                top: 0,
                width: timeSelectionWidth,
                height: timelineHeight,
                backgroundColor: "rgba(255, 183, 77, 0.1)",
                borderLeft: "1px solid rgba(255, 183, 77, 0.45)",
                borderRight: "1px solid rgba(255, 183, 77, 0.45)",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Clips */}
          {visibleClips.map((clip) => {
            const trackIdx = trackIndexById.get(clip.track_id);
            if (trackIdx === undefined) {
              return null;
            }
            const track = tracks[trackIdx];
            if (!track) {
              return null;
            }
            // Resolve content data for waveform/MIDI preview
            const displayTrackId =
              dragPreview.previewTrackIds[clip.id] ?? clip.track_id;
            const displayTrackIndex = trackIndexById.get(displayTrackId) ?? trackIdx;
            const displayTrack = tracks[displayTrackIndex] ?? track;
            const content =
              clip.kind.clip_type === "audio" || clip.kind.clip_type === "midi"
                ? contentById.get(clip.kind.content_id)
                : undefined;
            const mediaId =
              content && content.type === "audio" ? content.media_id : undefined;
            const mediaOriginalName =
              content && content.type === "audio"
                ? mediaById.get(content.media_id)?.original_name ?? null
                : null;
            const midiNotes =
              content && content.type === "midi" && clip.kind.clip_type === "midi"
                ? content.notes
                : undefined;
            return (
              <div
                key={clip.id}
                style={{
                  position: "absolute",
                  top: displayTrackIndex * trackHeight,
                  left: 0,
                  height: trackHeight,
                  width: "100%",
                  pointerEvents: "none",
                  zIndex:
                    selectionState.primaryClipId === clip.id
                      ? 4
                      : selectedClipIdSet.has(clip.id)
                        ? 3
                        : 2,
                }}
              >
                <ClipView
                  clip={clip}
                  document={doc}
                  selectedClipIds={selectionState.selectedClipIds}
                  primaryClipId={selectionState.primaryClipId}
                  pixelsPerTick={pixelsPerTick}
                  trackHeight={trackHeight}
                  isSelected={selectedClipIdSet.has(clip.id)}
                  isPrimarySelection={selectionState.primaryClipId === clip.id}
                  selectionSize={selectionState.selectedClipIds.length}
                  onSelect={handleClipSelect}
                  onDoubleClick={handleClipDoubleClick}
                  onDeleteClip={handleDeleteClip}
                  onDuplicateClip={handleDuplicateClip}
                  onPitchChange={handlePitchChange}
                  onFinePitchChange={handleFinePitchChange}
                  onSplitClip={handleSplitClip}
                  interactionPolicy={interactionPolicy}
                  mediaId={mediaId}
                  audioLabel={mediaOriginalName}
                  midiNotes={midiNotes}
                  trackMuted={displayTrack.mute}
                  hasPitchLink={pitchLinkedAudioTrackIds.has(displayTrackId)}
                />
              </div>
            );
          })}

          {copyDragGhosts.map(({ clip, trackIndex, previewStart }) => {
            const isAudio = clip.kind.clip_type === "audio";
            return (
              <div
                key={`copy-ghost-${clip.id}`}
                data-glow-state="drop-target"
                style={{
                  position: "absolute",
                  left: previewStart * pixelsPerTick,
                  top: trackIndex * trackHeight + 2,
                  width: Math.max(clip.length * pixelsPerTick, 4),
                  height: trackHeight - 4,
                  borderRadius: 6,
                  border: `1px dashed ${isAudio ? "#90caf9" : "#a5d6a7"}`,
                  backgroundColor: isAudio
                    ? "rgba(66,165,245,0.22)"
                    : "rgba(102,187,106,0.24)",
                  boxShadow: isAudio
                    ? "0 0 16px rgba(66,165,245,0.18)"
                    : "0 0 16px rgba(102,187,106,0.18)",
                  color: "#e8eef8",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "8px 10px",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  opacity: 0.85,
                  zIndex: 6,
                }}
              >
                {isAudio ? "Audio Copy" : "MIDI Copy"}
              </div>
            );
          })}

          {marquee && (
            <div
              data-testid="timeline-marquee"
              style={{
                position: "absolute",
                left: Math.min(marquee.startX, marquee.currentX),
                top: Math.min(marquee.startY, marquee.currentY),
                width: Math.abs(marquee.currentX - marquee.startX),
                height: Math.abs(marquee.currentY - marquee.startY),
                border: "1px solid rgba(129,199,132,0.9)",
                backgroundColor: "rgba(129,199,132,0.16)",
                pointerEvents: "none",
                zIndex: 9,
              }}
            />
          )}

          {/* Playhead line — positioned imperatively via ref (see
              usePlayheadMarker) so per-frame playback updates don't re-render. */}
          <div
            ref={lanePlayheadRef}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 1,
              height: "100%",
              backgroundColor: "#ef5350",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
      </div>
    </div>
  ) : null;

  const Presenter = useShellVariantValue({
    desktop: TimelineDesktopPresenter,
    mobile: TimelineMobilePresenter,
  });

  return (
    <Presenter
      rootRef={rootRef}
      emptyState={emptyState}
      ruler={rulerNode}
      lanes={lanesNode}
      mobileTransientActionBadge={mobileTransientActionBadge}
    />
  );
}
