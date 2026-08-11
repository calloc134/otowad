import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useProjectActions } from "@/store";
import type { TrackEdit, MidiToAudioPitchLink } from "@/types";
import type { TrackListInteractionPolicy } from "@/app/deviceInteraction.ts";
import { getPitchLinkInfo } from "@/intents/trackList.ts";
import {
  TRACK_NAME_RULE_HINT,
  getTrackNameValidationError,
  normalizeTrackName,
  sanitizeTrackNameDraft,
} from "@/utils/trackName.ts";
import { Panel } from "@/design-system/index.ts";
import { resolveTrackActions } from "./trackActionRegistry";
import { buildTrackListRowPresenterParts } from "./TrackListRowPresenterParts";

export interface TrackListRowProps {
  track: TrackEdit;
  pitchLinks: MidiToAudioPitchLink[];
  allTracks: TrackEdit[];
  isSelected: boolean;
  isReorderSource: boolean;
  trackHeight: number;
  usesOverflowSheet: boolean;
  onOpenActionSheet: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  interactionPolicy: TrackListInteractionPolicy;
  onSelect: () => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onGainChange: (gainMilliDb: number) => void;
  onPanChange: (panPermille: number) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onBeginRename: () => void;
  onImport: () => void;
  onExport?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function TrackListRow({
  track,
  pitchLinks,
  allTracks,
  isSelected,
  isReorderSource,
  trackHeight,
  usesOverflowSheet,
  onOpenActionSheet,
  canMoveUp,
  canMoveDown,
  interactionPolicy,
  onSelect,
  onMuteToggle,
  onSoloToggle,
  onGainChange,
  onPanChange,
  onDelete,
  onRename,
  onBeginRename,
  onImport,
  onExport,
  onMoveUp,
  onMoveDown,
  onReorderStart,
}: TrackListRowProps) {
  const actions = useProjectActions();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(track.name);
  const [nameFeedback, setNameFeedback] = useState<string | null>(null);
  const blurModeRef = useRef<"commit" | "cancel">("commit");

  useEffect(() => {
    if (!editing) {
      setNameValue(track.name);
      setNameFeedback(null);
    }
  }, [editing, track.name]);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    onBeginRename();
    setNameValue(track.name);
    setNameFeedback(null);
    setEditing(true);
  }, [onBeginRename, track.name]);

  const handleRenameAction = useCallback(() => {
    onBeginRename();
    setNameValue(track.name);
    setNameFeedback(null);
    setEditing(true);
  }, [onBeginRename, track.name]);

  const commitRename = useCallback(() => {
    setEditing(false);
    setNameFeedback(null);

    if (nameValue === track.name) {
      setNameValue(track.name);
      return;
    }

    const validationError = getTrackNameValidationError(nameValue);
    const normalizedName = normalizeTrackName(nameValue);

    if (validationError) {
      setNameValue(track.name);
      actions.setError(validationError);
      return;
    }

    if (!normalizedName || normalizedName === track.name) {
      setNameValue(track.name);
      return;
    }

    setNameValue(normalizedName);
    actions.setError(null);
    onRename(normalizedName);
  }, [actions, nameValue, onRename, track.name]);

  const handleBlur = useCallback(() => {
    const blurMode = blurModeRef.current;
    blurModeRef.current = "commit";
    if (blurMode === "cancel") {
      setNameValue(track.name);
      setNameFeedback(null);
      setEditing(false);
      return;
    }
    commitRename();
  }, [commitRename, track.name]);

  const handleNameChange = useCallback((value: string) => {
    const sanitizedValue = sanitizeTrackNameDraft(value);
    setNameValue(sanitizedValue);
    if (sanitizedValue !== value) {
      setNameFeedback(TRACK_NAME_RULE_HINT);
      return;
    }
    setNameFeedback(getTrackNameValidationError(sanitizedValue));
  }, []);

  const handleNameKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      blurModeRef.current = "commit";
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      blurModeRef.current = "cancel";
      event.currentTarget.blur();
    }
  }, []);

  const linkedInfo = getPitchLinkInfo(track.id, pitchLinks, allTracks);
  const isNameInvalid = Boolean(editing && getTrackNameValidationError(nameValue));
  const usesTouchControls = interactionPolicy.controlSize === "touch";
  const gainLabel = `${(track.gain_milli_db / 1000).toFixed(1)} dB`;
  const panLabel = track.pan_permille === 0
    ? "C"
    : `${track.pan_permille < 0 ? "L" : "R"}${Math.round(Math.abs(track.pan_permille) / 10)}`;
  const trackActions = resolveTrackActions({
    track,
    isSelected,
    onMuteToggle,
    onSoloToggle,
    onImport,
    onExport,
    onDelete,
    usesTouchControls,
  });
  const { panelClassName, panelStyle, presenter } = buildTrackListRowPresenterParts({
    trackId: track.id,
    trackType: track.kind.track_type,
    trackName: track.name,
    isSelected,
    isReorderSource,
    trackHeight,
    usesOverflowSheet,
    canMoveUp,
    canMoveDown,
    usesTouchControls,
    showsExplicitRenameAction: interactionPolicy.showsExplicitRenameAction,
    showsExplicitReorderButtons: interactionPolicy.showsExplicitReorderButtons,
    editing,
    nameValue,
    nameFeedback,
    isNameInvalid,
    linkedInfo,
    gainLabel,
    panLabel,
    gainMilliDb: track.gain_milli_db,
    panPermille: track.pan_permille,
    actions: trackActions,
    onSelect,
    onNameChange: handleNameChange,
    onNameKeyDown: handleNameKeyDown,
    onNameBlur: handleBlur,
    onNameDoubleClick: handleDoubleClick,
    onGainChange,
    onPanChange,
    handlers: {
      onMoveUp,
      onMoveDown,
      onReorderStart,
      onRenameAction: handleRenameAction,
      onOpenActionSheet,
    },
  });

  return (
    <Panel
      variant={isSelected ? "raised" : "muted"}
      data-track-header-root="true"
      data-testid={`track-header-${track.id}`}
      className={panelClassName}
      style={{
        ...panelStyle,
        opacity: track.mute ? 0.5 : 1,
        filter: track.mute ? "grayscale(0.7)" : "none",
      }}
      onClick={onSelect}
    >
      {presenter}
    </Panel>
  );
}
