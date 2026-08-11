import { ClipView } from "@/components/ClipView";
import { desktopTimelinePolicy } from "@/app/deviceInteraction.ts";
import { renderWithProject } from "@/test/renderWithProject";
import type { ClipEdit } from "@/types";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { useProject } from "@/store";

interface ClipViewHarnessOptions {
  project?: ReturnType<typeof createBaseTimelineProject>;
  clip: ClipEdit;
  isSelected?: boolean;
  isPrimarySelection?: boolean;
  selectionSize?: number;
  onSelect?: Parameters<typeof ClipView>[0]["onSelect"];
  onDoubleClick?: Parameters<typeof ClipView>[0]["onDoubleClick"];
  onDeleteClip?: Parameters<typeof ClipView>[0]["onDeleteClip"];
  onSplitClip?: Parameters<typeof ClipView>[0]["onSplitClip"];
  onDuplicateClip?: Parameters<typeof ClipView>[0]["onDuplicateClip"];
  onPitchChange?: Parameters<typeof ClipView>[0]["onPitchChange"];
  onFinePitchChange?: Parameters<typeof ClipView>[0]["onFinePitchChange"];
  interactionPolicy?: Parameters<typeof ClipView>[0]["interactionPolicy"];
}

function BoundClipViewHarness(options: ClipViewHarnessOptions) {
  const { state } = useProject();
  const clip = state.document?.edit.clips.find((candidate) => candidate.id === options.clip.id) ?? options.clip;

  return (
    <ClipView
      clip={clip}
      document={state.document}
      selectedClipIds={state.selectedClipIds}
      primaryClipId={state.primaryClipId}
      pixelsPerTick={1}
      trackHeight={80}
      isSelected={options.isSelected ?? false}
      isPrimarySelection={options.isPrimarySelection ?? false}
      selectionSize={options.selectionSize ?? 1}
      onSelect={options.onSelect ?? (() => {})}
      onDoubleClick={options.onDoubleClick}
      onDeleteClip={options.onDeleteClip}
      onDuplicateClip={options.onDuplicateClip}
      onPitchChange={options.onPitchChange}
      onFinePitchChange={options.onFinePitchChange}
      onSplitClip={options.onSplitClip}
      interactionPolicy={options.interactionPolicy ?? desktopTimelinePolicy}
      mediaId={clip.kind.clip_type === "audio" ? "media-1" : undefined}
      audioLabel={clip.kind.clip_type === "audio" ? "voice.wav" : null}
      trackMuted={false}
      hasPitchLink={false}
    />
  );
}

export function renderClipViewHarness(options: ClipViewHarnessOptions) {
  const project = options.project ?? createBaseTimelineProject();
  return renderWithProject(
    <BoundClipViewHarness {...options} />,
    { project },
  );
}
