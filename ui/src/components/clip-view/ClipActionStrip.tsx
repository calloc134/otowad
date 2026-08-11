import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ResolvedInteractionAction } from "@/app/interaction-contracts/actions.ts";
import { resolveClipActions } from "./clipActionRegistry";
import { ClipActionStripDesktopPresenter } from "./ClipActionStripDesktopPresenter";
import { ClipActionStripMobilePresenter } from "./ClipActionStripMobilePresenter";

interface ClipActionStripProps {
  clipId: string;
  isAudio: boolean;
  isMidi: boolean;
  usesTouchSizedActions: boolean;
  canUseModifierShortcuts: boolean;
  hasPitchLink?: boolean;
  warpPlacementArmed: boolean;
  shouldShowMidiOpenAction: boolean;
  onDeleteClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onDoubleClick?: (clipId: string) => void;
  onPitchChange?: (clipId: string, delta: number) => void;
  onFinePitchChange?: (clipId: string, delta: number) => void;
  onToggleWarpPlacementArmed: () => void;
}

interface ActionButtonProps {
  clipId: string;
  action: ResolvedInteractionAction;
  usesTouchSizedActions: boolean;
  dataTestId?: string;
}

function ActionButton({
  clipId,
  action,
  usesTouchSizedActions,
  dataTestId,
}: ActionButtonProps) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.stopPropagation();
    action.execute();
  };

  // The button carries an aria-label but ran its action only from
  // onPointerDown, so keyboard users could focus it and never fire it.
  // Calling preventDefault stops the browser from synthesising the click that
  // Enter and Space would otherwise produce, which is what keeps this from
  // double-executing alongside onPointerDown.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    action.execute();
  };

  return (
    <button
      type="button"
      aria-label={buildActionAriaLabel(action.id, clipId)}
      data-testid={dataTestId}
      data-touch-action={usesTouchSizedActions ? "true" : "false"}
      data-glow-state={action.active ? "selected" : undefined}
      style={{
        ...floatButtonBaseStyle,
        ...(usesTouchSizedActions ? touchFloatButtonStyle : null),
        ...resolveActionButtonStyle(action),
      }}
      disabled={action.disabled}
      title={action.title}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      {action.label}
    </button>
  );
}

export function ClipActionStrip({
  clipId,
  isAudio,
  isMidi,
  usesTouchSizedActions,
  canUseModifierShortcuts,
  hasPitchLink,
  warpPlacementArmed,
  shouldShowMidiOpenAction,
  onDeleteClip,
  onDuplicateClip,
  onDoubleClick,
  onPitchChange,
  onFinePitchChange,
  onToggleWarpPlacementArmed,
}: ClipActionStripProps) {
  const actions = resolveClipActions({
    clipId,
    isAudio,
    isMidi,
    canUseModifierShortcuts,
    hasPitchLink: Boolean(hasPitchLink),
    warpPlacementArmed,
    shouldShowMidiOpenAction,
    onDeleteClip,
    onDuplicateClip,
    onDoubleClick,
    onPitchChange,
    onFinePitchChange,
    onToggleWarpPlacementArmed,
  });
  const actionNodes = actions.map((action) => (
    <ActionButton
      key={action.id}
      clipId={clipId}
      action={action}
      dataTestId={buildActionTestId(action.id, clipId)}
      usesTouchSizedActions={usesTouchSizedActions}
    />
  ));

  return usesTouchSizedActions ? (
    <ClipActionStripMobilePresenter clipId={clipId}>{actionNodes}</ClipActionStripMobilePresenter>
  ) : (
    <ClipActionStripDesktopPresenter clipId={clipId}>{actionNodes}</ClipActionStripDesktopPresenter>
  );
}

function buildActionTestId(actionId: string, clipId: string): string {
  switch (actionId) {
    case "delete":
      return `clip-delete-${clipId}`;
    case "duplicate":
      return `clip-duplicate-${clipId}`;
    case "warp":
      return `clip-warp-${clipId}`;
    case "open-midi":
      return `clip-open-midi-${clipId}`;
    case "midi-transpose-up":
      return `clip-transpose-up-${clipId}`;
    case "midi-transpose-down":
      return `clip-transpose-down-${clipId}`;
    default:
      return `clip-action-${actionId}-${clipId}`;
  }
}

function buildActionAriaLabel(actionId: string, clipId: string): string {
  switch (actionId) {
    case "delete":
      return `Delete clip ${clipId}`;
    case "duplicate":
      return `Duplicate clip ${clipId}`;
    case "warp":
      return `Arm warp anchor placement on clip ${clipId}`;
    case "open-midi":
      return `Open MIDI editor for clip ${clipId}`;
    default:
      return `Clip action ${actionId} for ${clipId}`;
  }
}

function resolveActionButtonStyle(action: ResolvedInteractionAction): CSSProperties {
  const activeStyle = action.active ? { boxShadow: "0 0 0 1px rgba(255,255,255,0.24)" } : null;
  switch (action.tone) {
    case "success":
      return {
        backgroundColor: "rgba(102,187,106,0.76)",
        color: "#09101e",
        ...activeStyle,
      };
    case "warning":
      return {
        backgroundColor: action.active ? "rgba(246,197,108,0.92)" : "rgba(246,197,108,0.72)",
        color: "#09101e",
        ...activeStyle,
      };
    case "accent":
      return {
        backgroundColor: action.id.startsWith("audio-fine")
          ? "rgba(66,165,245,0.5)"
          : "rgba(66,165,245,0.7)",
        color: "#fff",
        fontSize: action.id.startsWith("audio-fine") ? 8 : undefined,
        ...activeStyle,
      };
    case "danger":
      return {
        backgroundColor: "rgba(239,83,80,0.7)",
        color: "#fff",
        ...activeStyle,
      };
    default:
      return activeStyle ?? {};
  }
}

const floatButtonBaseStyle: CSSProperties = {
  width: 16,
  height: 16,
  border: "none",
  borderRadius: 2,
  backgroundColor: "rgba(239,83,80,0.7)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};

/**
 * 24px was what fitted inside a clip. The bar is the width of the screen now,
 * so these can be a size a fingertip actually lands on.
 */
const touchFloatButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  fontSize: 15,
};
