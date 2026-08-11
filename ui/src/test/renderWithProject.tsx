import { useEffect, useRef, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";

import { InteractionModeProvider } from "@/app/interactionMode.tsx";
import { ProjectProvider, useProjectActions } from "@/store";
import type { ProjectDocument, ClipId, TrackId, ContentId } from "@/types";

interface ProjectHarnessProps {
  project: ProjectDocument;
  selectedTrackId?: TrackId | null;
  selectedClipIds?: ClipId[];
  primaryClipId?: ClipId | null;
  playheadTick?: number;
  zoom?: { x: number; y: number };
  midiEditorTarget?: { contentId: ContentId; clipId: ClipId } | null;
  children: ReactNode;
}

function ProjectHarness({
  project,
  selectedTrackId = null,
  selectedClipIds = [],
  primaryClipId = null,
  playheadTick,
  zoom,
  midiEditorTarget = null,
  children,
}: ProjectHarnessProps) {
  const actions = useProjectActions();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    actions.initWasm();
    actions.setProject(project);
    if (selectedTrackId !== null) {
      actions.selectTrack(selectedTrackId);
    }
    if (selectedClipIds.length > 0 || primaryClipId !== null) {
      actions.setClipSelection(selectedClipIds, primaryClipId);
    }
    if (playheadTick !== undefined) {
      actions.setPlayhead(playheadTick);
    }
    if (zoom) {
      actions.setZoom(zoom.x, zoom.y);
    }
    if (midiEditorTarget) {
      actions.openMidiEditor(midiEditorTarget.contentId, midiEditorTarget.clipId);
    }
  }, [
    actions,
    midiEditorTarget,
    playheadTick,
    primaryClipId,
    project,
    selectedClipIds,
    selectedTrackId,
    zoom,
  ]);

  return <>{children}</>;
}

export function renderWithProject(
  ui: ReactNode,
  options: Omit<ProjectHarnessProps, "children">,
): RenderResult {
  return render(
    <ProjectProvider>
      <InteractionModeProvider>
        <ProjectHarness {...options}>{ui}</ProjectHarness>
      </InteractionModeProvider>
    </ProjectProvider>,
  );
}
