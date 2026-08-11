import { AudioWaveform, ChevronDown, ChevronUp, Download, Ellipsis, GripVertical, Headphones, Link2, Pencil, Piano, Trash2, Upload, VolumeX } from "lucide-react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { IconButton, StatusPill, ToolbarGroup } from "@/design-system/index.ts";
import type { ResolvedInteractionAction } from "@/app/interaction-contracts/actions.ts";
import { TRACK_KIND_BADGE_BG } from "@/design-system/trackKindColors";
import { trackRowShowsMixControls } from "../editorGeometry.ts";
import { TrackHeaderDesktopPresenter } from "./TrackHeaderDesktopPresenter";
import { TrackHeaderMobilePresenter } from "./TrackHeaderMobilePresenter";
import { trackListStyles } from "./trackListStyles";

interface TrackListRowActionHandlers {
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onRenameAction: () => void;
  onOpenActionSheet: () => void;
}

interface TrackListRowPresenterPartsArgs {
  trackId: string;
  trackType: "audio" | "midi";
  trackName: string;
  isSelected: boolean;
  isReorderSource: boolean;
  trackHeight: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  usesTouchControls: boolean;
  /** True where the panel is too narrow for every action to sit in the row. */
  usesOverflowSheet: boolean;
  showsExplicitRenameAction: boolean;
  showsExplicitReorderButtons: boolean;
  editing: boolean;
  nameValue: string;
  nameFeedback: string | null;
  isNameInvalid: boolean;
  linkedInfo: { label: string; tooltip: string } | null;
  gainLabel: string;
  panLabel: string;
  gainMilliDb: number;
  panPermille: number;
  actions: ResolvedInteractionAction[];
  onSelect: () => void;
  onNameChange: (value: string) => void;
  onNameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onNameBlur: () => void;
  onNameDoubleClick: (event: ReactMouseEvent<HTMLSpanElement>) => void;
  onGainChange: (gainMilliDb: number) => void;
  onPanChange: (panPermille: number) => void;
  handlers: TrackListRowActionHandlers;
}

interface TrackListRowPresenterPartsResult {
  panelClassName: string;
  panelStyle: CSSProperties;
  presenter: React.ReactNode;
}

export function buildTrackListRowPresenterParts(
  args: TrackListRowPresenterPartsArgs,
): TrackListRowPresenterPartsResult {
  const compactControlSize = "sm" as const;
  const typeColor = args.trackType === "audio" ? "var(--accent-blue)" : "var(--accent-green)";
  const typeBg = TRACK_KIND_BADGE_BG[args.trackType];
  const typeTone = args.trackType === "audio" ? "info" : "success";

  // A phone panel has room for mute and solo beside the name; import, export
  // and delete would need roughly another 100px, so they move to the sheet.
  const inlineActions = args.usesOverflowSheet
    ? args.actions.filter((action) => action.id === "mute" || action.id === "solo")
    : args.actions;

  const reorderButtonClass = args.usesTouchControls
    ? trackListStyles.trackReorderButtonTouch
    : trackListStyles.trackReorderButton;

  // A phone row spends its width on the name. Reordering lives in the sheet,
  // and the type is carried by the coloured left edge instead of a badge.
  const topControl = args.usesOverflowSheet ? null : args.showsExplicitReorderButtons ? (
    <div className={trackListStyles.trackReorderStack}>
      <IconButton
        size={compactControlSize}
        variant="ghost"
        className={reorderButtonClass}
        style={{ opacity: args.canMoveUp ? 1 : 0.45 }}
        data-testid={`track-move-up-${args.trackId}`}
        onClick={(event) => {
          event.stopPropagation();
          args.handlers.onMoveUp();
        }}
        disabled={!args.canMoveUp}
        title="Move track up"
        aria-label="Move track up"
      >
        <ChevronUp size={12} />
      </IconButton>
      <IconButton
        size={compactControlSize}
        variant="ghost"
        className={reorderButtonClass}
        style={{ opacity: args.canMoveDown ? 1 : 0.45 }}
        data-testid={`track-move-down-${args.trackId}`}
        onClick={(event) => {
          event.stopPropagation();
          args.handlers.onMoveDown();
        }}
        disabled={!args.canMoveDown}
        title="Move track down"
        aria-label="Move track down"
      >
        <ChevronDown size={12} />
      </IconButton>
    </div>
  ) : (
    <IconButton
      size={compactControlSize}
      variant="ghost"
      className={trackListStyles.trackGrip}
      style={{
        cursor: args.isReorderSource ? "grabbing" : "grab",
        touchAction: "none",
      }}
      onPointerDown={args.handlers.onReorderStart}
      onClick={(event) => event.stopPropagation()}
      title="Drag to reorder track"
      aria-label="Drag to reorder track"
    >
      <GripVertical size={12} />
    </IconButton>
  );

  const typeBadge = args.usesOverflowSheet ? null : (
    <StatusPill
      tone={typeTone}
      className={trackListStyles.trackTypeBadge}
      style={{ backgroundColor: typeBg }}
    >
      {args.trackType === "audio" ? <AudioWaveform size={12} /> : <Piano size={12} />}
    </StatusPill>
  );

  const nameField = args.editing ? (
    <input
      className={trackListStyles.nameInput}
      style={{
        borderColor: args.isNameInvalid ? "rgba(255, 117, 135, 0.5)" : "var(--border-accent)",
        boxShadow: args.isNameInvalid
          ? "0 0 0 1px rgba(255,117,135,0.16), 0 0 14px rgba(255,117,135,0.18)"
          : "none",
      }}
      data-glow-state={args.isNameInvalid ? "warning" : undefined}
      value={args.nameValue}
      onChange={(event) => args.onNameChange(event.target.value)}
      onBlur={args.onNameBlur}
      onKeyDown={args.onNameKeyDown}
      autoFocus
      onClick={(event) => event.stopPropagation()}
      maxLength={64}
      title={args.nameFeedback ?? undefined}
      aria-label="Track name"
      aria-invalid={args.isNameInvalid}
    />
  ) : (
    <span
      className={trackListStyles.trackName}
      onDoubleClick={args.onNameDoubleClick}
      title="Double-click to edit name"
    >
      {args.trackName}
    </span>
  );

  const overflowAction = args.usesOverflowSheet ? (
    <IconButton
      size={compactControlSize}
      variant="ghost"
      className={args.usesTouchControls ? trackListStyles.trackRenameButtonTouch : trackListStyles.trackRenameButton}
      data-testid={`track-actions-${args.trackId}`}
      onClick={(event) => {
        event.stopPropagation();
        args.handlers.onOpenActionSheet();
      }}
      title="More track actions"
      aria-label="More track actions"
    >
      <Ellipsis size={12} />
    </IconButton>
  ) : null;

  const renameAction = args.usesOverflowSheet ? overflowAction : args.showsExplicitRenameAction && !args.editing ? (
    <IconButton
      size={compactControlSize}
      variant="ghost"
      className={args.usesTouchControls ? trackListStyles.trackRenameButtonTouch : trackListStyles.trackRenameButton}
      data-testid={`track-rename-${args.trackId}`}
      onClick={(event) => {
        event.stopPropagation();
        args.handlers.onRenameAction();
      }}
      title="Rename track"
      aria-label="Rename track"
    >
      <Pencil size={12} />
    </IconButton>
  ) : null;

  const statusRow = args.editing && args.nameFeedback ? (
    <div className={trackListStyles.nameFeedbackRow} title={args.nameFeedback}>
      <span
        className={trackListStyles.nameFeedbackText}
        style={{ color: args.isNameInvalid ? "var(--danger)" : "var(--text-dim)" }}
      >
        {args.nameFeedback}
      </span>
    </div>
  ) : args.linkedInfo ? (
    <StatusPill tone="warning" className={trackListStyles.pitchLinkPill} title={args.linkedInfo.tooltip}>
      <span className={trackListStyles.pitchLinkIcon}>
        <Link2 size={10} />
      </span>
      <span className={trackListStyles.pitchLinkText}>{args.linkedInfo.label}</span>
    </StatusPill>
  ) : null;

  // A row shorter than this cannot fit the sliders under the name and the
  // controls; rendering them anyway overflowed the row into the next track.
  const mixRow = !trackRowShowsMixControls(args.trackHeight, args.usesTouchControls) ? null : (
    <div className={trackListStyles.trackMixRow}>
      <label className={trackListStyles.trackMixField} onClick={(event) => event.stopPropagation()}>
        <span className={trackListStyles.trackMixLabel}>G {args.gainLabel}</span>
        <input
          data-testid={`track-gain-${args.trackId}`}
          type="range"
          min={-24000}
          max={12000}
          step={100}
          value={args.gainMilliDb}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => args.onGainChange(Number(event.currentTarget.value))}
          aria-label="Track gain"
          className={trackListStyles.trackMixSlider}
        />
      </label>
      <label className={trackListStyles.trackMixField} onClick={(event) => event.stopPropagation()}>
        <span className={trackListStyles.trackMixLabel}>P {args.panLabel}</span>
        <input
          data-testid={`track-pan-${args.trackId}`}
          type="range"
          min={-1000}
          max={1000}
          step={10}
          value={args.panPermille}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => args.onPanChange(Number(event.currentTarget.value))}
          aria-label="Track pan"
          className={trackListStyles.trackMixSlider}
        />
      </label>
    </div>
  );

  const controls = (
    <ToolbarGroup className={trackListStyles.trackControls}>
      {inlineActions.map((action) => (
        <TrackRowActionButton
          key={action.id}
          trackId={args.trackId}
          action={action}
          compactControlSize={compactControlSize}
        />
      ))}
    </ToolbarGroup>
  );

  const presenter = args.showsExplicitRenameAction ? (
    <TrackHeaderMobilePresenter
      topControl={topControl}
      typeBadge={typeBadge}
      nameField={nameField}
      renameAction={renameAction}
      statusRow={statusRow}
      mixRow={mixRow}
      controls={controls}
    />
  ) : (
    <TrackHeaderDesktopPresenter
      topControl={topControl}
      typeBadge={typeBadge}
      nameField={nameField}
      statusRow={statusRow}
      mixRow={mixRow}
      controls={controls}
    />
  );

  return {
    panelClassName: trackListStyles.trackHeader,
    panelStyle: {
      height: `${args.trackHeight}px`,
      backgroundColor: args.isSelected ? "rgba(22, 32, 62, 0.98)" : "rgba(12, 17, 35, 0.92)",
      borderLeft: args.isSelected || args.usesOverflowSheet
        ? `3px solid ${typeColor}`
        : "3px solid transparent",
    },
    presenter,
  };
}

function TrackRowActionButton({
  action,
  compactControlSize,
}: {
  trackId: string;
  action: ResolvedInteractionAction;
  compactControlSize: "sm";
}) {
  const variant = action.id === "delete" ? "danger" : "secondary";
  const icon = resolveActionIcon(action.iconKey);

  return (
    <IconButton
      size={compactControlSize}
      variant={variant}
      className={baseTrackActionClassName(action.id)}
      style={action.presentation?.style}
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation();
        action.execute();
      }}
      title={action.title}
      aria-label={action.title}
    >
      {icon}
    </IconButton>
  );
}

function baseTrackActionClassName(actionId: string): string {
  switch (actionId) {
    case "import":
      return trackListStyles.importBtn;
    case "export":
      return trackListStyles.exportBtn;
    case "delete":
      return trackListStyles.deleteBtn;
    default:
      return trackListStyles.toggleBtn;
  }
}

function resolveActionIcon(iconKey: string) {
  switch (iconKey) {
    case "mute":
      return <VolumeX size={12} />;
    case "solo":
      return <Headphones size={12} />;
    case "import":
      return <Upload size={12} />;
    case "export":
      return <Download size={12} />;
    case "delete":
      return <Trash2 size={12} />;
    default:
      return null;
  }
}
