import { memo, useMemo } from "react";
import type { ClipEdit, MidiNote, ProjectDocument } from "@/types";
import { useShellVariantValue } from "@/app/interactionMode.tsx";
import { useClipDrag } from "@/hooks/useClipDrag";
import { useClipResize } from "@/hooks/useClipResize";
import { useWarpAnchor } from "@/hooks/useWarpAnchor";
import type { TimelineInteractionPolicy } from "@/app/deviceInteraction.ts";
import { type ClipSelectionMode } from "@/utils/timelineInteractions";
import { buildMidiPreviewSegments } from "@/utils/midiPreview";
import { ClipActionStrip } from "./clip-view/ClipActionStrip";
import { ClipHandleOverlays } from "./clip-view/ClipHandleOverlays";
import { ClipHeaderOverlay } from "./clip-view/ClipHeaderOverlay";
import { ClipPreviewLayer } from "./clip-view/ClipPreviewLayer";
import { buildClipGeometry } from "./clip-view/clipGeometry";
import { countClipActions } from "./clip-view/clipActionRegistry";
import { clipSurfaceStyles } from "./clip-view/surfaceStyles";
import { useClipWaveformPreview } from "./clip-view/useClipWaveformPreview";
import {
  type ClipSelectionTriggerEvent,
} from "./clip-view/useClipInteractions";
import { useClipInteractionsDesktop } from "./clip-view/useClipInteractionsDesktop";
import { useClipInteractionsMobile } from "./clip-view/useClipInteractionsMobile";

interface ClipViewProps {
  clip: ClipEdit;
  document: ProjectDocument | null;
  selectedClipIds: string[];
  primaryClipId: string | null;
  pixelsPerTick: number;
  trackHeight: number;
  isSelected: boolean;
  isPrimarySelection: boolean;
  selectionSize: number;
  onSelect: (
    clipId: string,
    event: ClipSelectionTriggerEvent,
    intent?: { clickTick?: number; selectionMode?: ClipSelectionMode },
  ) => void;
  onDoubleClick?: (clipId: string) => void;
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onPitchChange?: (clipId: string, delta: number) => void;
  onFinePitchChange?: (clipId: string, delta: number) => void;
  onSplitClip?: (clipId: string, tickInClip: number) => void;
  interactionPolicy: TimelineInteractionPolicy;
  mediaId?: string;
  audioLabel?: string | null;
  midiNotes?: MidiNote[];
  trackMuted?: boolean;
  hasPitchLink?: boolean;
}

export const ClipView = memo(function ClipView({
  clip,
  document,
  selectedClipIds,
  primaryClipId,
  pixelsPerTick,
  trackHeight,
  isSelected,
  isPrimarySelection,
  selectionSize,
  onSelect,
  onDoubleClick,
  onDeleteClip,
  onDuplicateClip,
  onPitchChange,
  onFinePitchChange,
  onSplitClip,
  interactionPolicy,
  mediaId,
  audioLabel,
  midiNotes,
  trackMuted,
  hasPitchLink,
}: ClipViewProps) {
  const drag = useClipDrag({
    clipId: clip.id,
    trackHeight,
    context: {
      document,
      selectedClipIds,
      primaryClipId,
      pixelsPerTick,
    },
  });
  const resize = useClipResize({
    clipId: clip.id,
    document,
    pixelsPerTick,
  });
  const warp = useWarpAnchor(clip.id, pixelsPerTick);

  const isAudio = clip.kind.clip_type === "audio";
  const isMidi = clip.kind.clip_type === "midi";
  const canUseModifierShortcuts = interactionPolicy.allowsModifierShortcuts;
  const usesTouchSizedActions = interactionPolicy.clipActionSize === "touch";

  // Use preview positions during interactions, otherwise real positions
  const displayStart =
    resize.previewStart ??
    (drag.previewMode === "move" ? (drag.previewStart ?? clip.start) : clip.start);
  const displayLength = resize.previewLength ?? clip.length;
  const displaySourceIn =
    clip.kind.clip_type === "audio"
      ? (resize.previewSourceIn ?? clip.kind.audio.src_in)
      : null;
  const displaySourceOut =
    clip.kind.clip_type === "audio"
      ? (resize.previewSourceOut ?? clip.kind.audio.src_out)
      : null;
  const displayContentIn =
    clip.kind.clip_type === "midi"
      ? (resize.previewContentIn ?? clip.kind.midi.content_in)
      : null;
  const displayContentOut =
    clip.kind.clip_type === "midi"
      ? (resize.previewContentOut ?? clip.kind.midi.content_out)
      : null;
  const midiPreview = useMemo(() => {
    if (
      clip.kind.clip_type !== "midi" ||
      !midiNotes ||
      displayContentIn === null ||
      displayContentOut === null
    ) {
      return [];
    }
    return buildMidiPreviewSegments(
      {
        content_in: displayContentIn,
        content_out: displayContentOut,
        transpose_semitones: clip.kind.midi.transpose_semitones,
      },
      midiNotes,
    );
  }, [clip.kind, midiNotes, displayContentIn, displayContentOut]);

  const isInteracting = drag.isDragging || resize.isResizing;
  const disableGroupEdit = isSelected && selectionSize > 1;
  const shouldShowMidiOpenAction = clip.kind.clip_type === "midi" && Boolean(onDoubleClick);
  const visibleActionCount = countClipActions({
    clipId: clip.id,
    isAudio,
    isMidi,
    canUseModifierShortcuts,
    hasPitchLink: Boolean(hasPitchLink),
    warpPlacementArmed: false,
    shouldShowMidiOpenAction,
    onDeleteClip,
    onDuplicateClip,
    onDoubleClick,
    onPitchChange,
    onFinePitchChange,
    onToggleWarpPlacementArmed: () => {},
  });
  const clipGeometry = buildClipGeometry({
    displayStart,
    displayLength,
    pixelsPerTick,
    trackHeight,
    isInteracting,
    isSelected,
    isPrimarySelection,
    selectionSize,
    usesTouchSizedActions,
    visibleActionCount,
  });
  const {
    left,
    width,
    clipHeight,
    shouldShowClipDetails,
    shouldShowActionStrip,
    headerPaddingRight,
  } = clipGeometry;

  const bgColor = isAudio
    ? "rgba(66,165,245,0.35)"
    : "rgba(102,187,106,0.35)";
  const borderColor = isSelected
    ? "#fff"
    : isAudio
      ? "#42a5f5"
      : "#66bb6a";
  const headerColor = isAudio
    ? "rgba(66,165,245,0.6)"
    : "rgba(102,187,106,0.6)";

  const clipName =
    clip.kind.clip_type === "audio"
      ? (audioLabel?.trim() || "Audio Clip")
      : "MIDI Clip";
  // Warp anchors for audio clips
  const warpAnchors =
    clip.kind.clip_type === "audio" && clip.kind.audio.warp.warp_type === "anchors"
      ? clip.kind.audio.warp.anchors
      : [];

  // Pitch display for audio clips
  const pitchSemitones = clip.kind.clip_type === "audio" ? clip.kind.audio.pitch.manual_coarse_semitones : 0;
  const pitchFineCents = clip.kind.clip_type === "audio" ? clip.kind.audio.pitch.manual_fine_cents : 0;
  const midiTransposeSemitones = clip.kind.clip_type === "midi"
    ? clip.kind.midi.transpose_semitones
    : 0;
  const { waveformTiles, waveformCanvasRefs } = useClipWaveformPreview({
    clip,
    clipHeight,
    width,
    mediaId,
    displaySourceIn,
    displaySourceOut,
  });

  const clipInteractionArgs = {
    clipId: clip.id,
    clipStart: clip.start,
    clipLength: clip.length,
    isAudio,
    isSelected,
    isPrimarySelection,
    disableGroupEdit,
    canUseModifierShortcuts,
    usesTouchSizedActions,
    pixelsPerTick,
    interactionPolicy,
    onSelect,
    onDoubleClick,
    onSplitClip,
    drag,
    resize,
    warp,
  };
  const useClipInteractionAdapter = useShellVariantValue({
    desktop: useClipInteractionsDesktop,
    mobile: useClipInteractionsMobile,
  });
  const {
    isSplitLongPressing,
    warpPlacementArmed,
    toggleWarpPlacementArmed,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
    handleDoubleClick,
  } = useClipInteractionAdapter(clipInteractionArgs);

  return (
    <div
      data-testid={`clip-${clip.id}`}
      data-clip-root="true"
      data-clip-type={clip.kind.clip_type}
      data-selected={isSelected ? "true" : "false"}
      data-glow-state={isSelected ? "selected" : undefined}
      className={clipSurfaceStyles.root}
      style={{
        left,
        width,
        height: clipHeight,
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        cursor: isInteracting ? "grabbing" : "grab",
        opacity: (clip.muted || trackMuted) ? 0.35 : 1,
        boxShadow: isSelected
          ? "0 0 6px rgba(255,255,255,0.3)"
          : "none",
        ...(isInteracting
          ? { outline: "1px dashed rgba(255,255,255,0.5)" }
          : {}),
        ...(isSplitLongPressing
          ? { outline: "2px solid rgba(255,200,0,0.7)" }
          : {}),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <ClipPreviewLayer
        clipId={clip.id}
        clipType={clip.kind.clip_type}
        clipHeight={clipHeight}
        mediaId={mediaId}
        waveformTiles={waveformTiles}
        waveformCanvasRefs={waveformCanvasRefs}
        midiPreview={midiPreview}
        displayLength={displayLength}
        warpAnchors={warpAnchors}
        pixelsPerTick={pixelsPerTick}
      />
      <ClipHeaderOverlay
        clipId={clip.id}
        headerColor={headerColor}
        headerPaddingRight={headerPaddingRight}
        clipName={clipName}
        visible={shouldShowClipDetails}
        pitchSemitones={pitchSemitones}
        pitchFineCents={pitchFineCents}
        midiTransposeSemitones={midiTransposeSemitones}
        gainMilliDb={clip.gain_milli_db}
        isAudioLabelBadge={clip.kind.clip_type === "audio" && Boolean(audioLabel)}
      />

      {/* Float action buttons (visible when selected / touch focus) */}
      {shouldShowActionStrip && (
        <ClipActionStrip
          clipId={clip.id}
          isAudio={isAudio}
          isMidi={isMidi}
          usesTouchSizedActions={usesTouchSizedActions}
          canUseModifierShortcuts={canUseModifierShortcuts}
          hasPitchLink={hasPitchLink}
          warpPlacementArmed={warpPlacementArmed}
          shouldShowMidiOpenAction={shouldShowMidiOpenAction}
          onDeleteClip={onDeleteClip}
          onDuplicateClip={onDuplicateClip}
          onDoubleClick={onDoubleClick}
          onPitchChange={onPitchChange}
          onFinePitchChange={onFinePitchChange}
          onToggleWarpPlacementArmed={toggleWarpPlacementArmed}
        />
      )}

      <ClipHandleOverlays
        disableGroupEdit={disableGroupEdit}
        isAudio={isAudio}
        isSelected={isSelected}
      />
    </div>
  );
});

ClipView.displayName = "ClipView";
