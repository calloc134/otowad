import { useCallback, useEffect, useRef, useState } from "react";
import { useShellVariantValue } from "@/app/interactionMode.tsx";
import type { PersistenceAPI } from "@/hooks/usePersistence.ts";
import { useAudioEngine, usePlaybackPrepareUiState } from "@/hooks/useAudioEngine.ts";
import { useExport } from "@/hooks/useExport.ts";
import {
  DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
  DEFAULT_TIME_SIGNATURE,
  tickToBarBeatTick,
} from "@/grid";
import {
  buildSetGridSettingsCommand,
  buildToggleGridCommand,
} from "@/intents/projectSettings.ts";
import {
  getTimeSelectionRange,
  useDocumentState,
  useProjectActions,
  useSelectionState,
  useTransportState,
} from "@/store";
import { DEFAULT_PPQ } from "@/types";
import { ToolbarDesktopPresenter } from "./toolbar/ToolbarDesktopPresenter";
import { ToolbarMobilePresenter } from "./toolbar/ToolbarMobilePresenter";
import { ProjectIdentitySection } from "./toolbar/ProjectIdentitySection";
import { TransportSection } from "./toolbar/TransportSection";
import { ToolActionsSection } from "./toolbar/ToolActionsSection";
import { ExportSection } from "./toolbar/ExportSection";
import { ToolsToggleSection } from "./toolbar/ToolsToggleSection";
import { ToolbarDialogsHost } from "./toolbar/ToolbarDialogsHost";
import { LoopControl } from "./toolbar/LoopControl";

interface ToolbarProps {
  persistence: PersistenceAPI;
  projectDialogOpen: boolean;
  onProjectDialogOpen: () => void;
  onProjectDialogClose: () => void;
}

export function Toolbar({
  persistence,
  projectDialogOpen,
  onProjectDialogOpen,
  onProjectDialogClose,
}: ToolbarProps) {
  const actions = useProjectActions();
  const isMobileShell = useShellVariantValue({
    desktop: false,
    mobile: true,
  });
  const { play, stop, isPlaying } = useAudioEngine();
  const playbackPrepareUi = usePlaybackPrepareUiState();
  const { exportWav, isRendering, renderProgress } = useExport();
  const documentState = useDocumentState();
  const selectionState = useSelectionState();
  const transportState = useTransportState();
  const doc = documentState.document;
  const cancelNameEditRef = useRef(false);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [bpmDialogOpen, setBpmDialogOpen] = useState(false);
  const [timeSignatureDialogOpen, setTimeSignatureDialogOpen] = useState(false);
  const [gridDialogOpen, setGridDialogOpen] = useState(false);
  const [pitchLinkDialogOpen, setPitchLinkDialogOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolbarMagnetRange, setToolbarMagnetRange] = useState(
    doc?.edit.grid.magnet_range_permille ?? DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
  );

  const microBpm = doc?.edit.tempo.points[0]?.micro_bpm ?? 120_000_000;
  const bpm = microBpm / 1_000_000;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? { ...DEFAULT_TIME_SIGNATURE };
  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const pitchLinkCount = doc?.edit.pitch_links.length ?? 0;
  const gridEnabled = doc?.edit.grid.snap_enabled ?? true;
  const magnetRangePermille =
    doc?.edit.grid.magnet_range_permille ?? DEFAULT_GRID_MAGNET_RANGE_PERMILLE;
  const timeSelection = getTimeSelectionRange(selectionState);
  const hasTimeSelection = timeSelection !== null;
  const isBusy = transportState.busyTask !== null;
  const isPlaybackPreparing = playbackPrepareUi.active;

  useEffect(() => {
    setToolbarMagnetRange(magnetRangePermille);
  }, [magnetRangePermille]);

  const tickToPosition = useCallback(
    (tick: number) => {
      const position = tickToBarBeatTick(tick, ppq, timeSig);
      return `${position.bar}:${position.beat}:${String(position.tick).padStart(3, "0")}`;
    },
    [ppq, timeSig],
  );

  const handleNameDoubleClick = useCallback(() => {
    if (!doc) {
      return;
    }
    cancelNameEditRef.current = false;
    setNameValue(doc.meta.name);
    setEditingName(true);
  }, [doc]);

  const handleCommitName = useCallback(() => {
    if (cancelNameEditRef.current) {
      cancelNameEditRef.current = false;
      setEditingName(false);
      return;
    }

    if (doc) {
      const trimmedName = nameValue.trim();
      if (trimmedName) {
        actions.setProjectName(trimmedName);
      } else {
        setNameValue(doc.meta.name);
      }
    }
    setEditingName(false);
  }, [actions, doc, nameValue]);

  const handleCancelNameEdit = useCallback(() => {
    cancelNameEditRef.current = true;
    setNameValue(doc?.meta.name ?? "");
    setEditingName(false);
  }, [doc]);

  const handleOpenProjectManager = useCallback(() => {
    onProjectDialogOpen();
    void persistence.refreshBrowserProjects();
  }, [onProjectDialogOpen, persistence]);

  const handlePlay = useCallback(() => {
    if (isBusy || isPlaybackPreparing) {
      return;
    }
    if (isPlaying) {
      stop();
    } else {
      void play();
    }
  }, [isBusy, isPlaybackPreparing, isPlaying, play, stop]);

  const handleToggleLoop = useCallback(() => {
    if (!hasTimeSelection) {
      return;
    }
    actions.setLoopEnabled(!transportState.loopEnabled);
  }, [actions, hasTimeSelection, transportState.loopEnabled]);

  const handleExport = useCallback(() => {
    if (isBusy) {
      return;
    }
    void exportWav().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Export failed: ${msg}`);
    });
  }, [exportWav, isBusy]);

  const handleSave = useCallback(() => {
    if (isBusy) {
      return;
    }
    void persistence.save();
  }, [isBusy, persistence]);

  const handleToggleGrid = useCallback(() => {
    if (!doc) {
      return;
    }
    const command = buildToggleGridCommand(doc);
    if (command) {
      actions.applyCommand(command);
    }
  }, [actions, doc]);

  const commitToolbarMagnetRange = useCallback(() => {
    if (!doc || toolbarMagnetRange === magnetRangePermille) {
      return;
    }
    const command = buildSetGridSettingsCommand(doc, {
      magnet_range_permille: toolbarMagnetRange,
    });
    if (command) {
      actions.applyCommand(command);
    }
  }, [actions, doc, magnetRangePermille, toolbarMagnetRange]);

  const resetToolbarMagnetRange = useCallback(() => {
    setToolbarMagnetRange(DEFAULT_GRID_MAGNET_RANGE_PERMILLE);
    if (!doc || magnetRangePermille === DEFAULT_GRID_MAGNET_RANGE_PERMILLE) {
      return;
    }
    const command = buildSetGridSettingsCommand(doc, {
      magnet_range_permille: DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
    });
    if (command) {
      actions.applyCommand(command);
    }
  }, [actions, doc, magnetRangePermille]);

  const leftSection = (
    <ProjectIdentitySection
      isBusy={isBusy}
      projectName={doc?.meta.name ?? null}
      editingName={editingName}
      nameValue={nameValue}
      hasUnsavedChanges={persistence.hasUnsavedChanges}
      hasCurrentBrowserProject={persistence.currentBrowserProject !== null}
      onCreateProject={persistence.createNewProject}
      onSave={handleSave}
      onOpenProjectManager={handleOpenProjectManager}
      onStartNameEdit={handleNameDoubleClick}
      onNameValueChange={setNameValue}
      onCommitName={handleCommitName}
      onCancelNameEdit={handleCancelNameEdit}
    />
  );

  const centerSection = doc ? (
    <TransportSection
      bpm={bpm}
      timeSignature={timeSig}
      isPlaying={isPlaying}
      isBusy={isBusy}
      isPlaybackPreparing={isPlaybackPreparing}
      hasTimeSelection={hasTimeSelection}
      loopEnabled={transportState.loopEnabled}
      showLoop={!isMobileShell}
      formatPlayheadLabel={tickToPosition}
      onOpenBpmDialog={() => setBpmDialogOpen(true)}
      onOpenTimeSignatureDialog={() => setTimeSignatureDialogOpen(true)}
      onStop={stop}
      onPlayPause={handlePlay}
      onToggleLoop={handleToggleLoop}
    />
  ) : null;

  const secondaryActionProps = {
    gridEnabled,
    toolbarMagnetRange,
    pitchLinkCount,
    onToolbarMagnetRangeChange: setToolbarMagnetRange,
    onCommitToolbarMagnetRange: commitToolbarMagnetRange,
    onResetToolbarMagnetRange: resetToolbarMagnetRange,
    onOpenGridDialog: () => setGridDialogOpen(true),
    onOpenPitchLinkDialog: () => setPitchLinkDialogOpen(true),
  };

  const toolsToggleSection = doc ? (
    <ToolsToggleSection
      toolsOpen={toolsOpen}
      onToggle={() => setToolsOpen((open) => !open)}
    />
  ) : null;

  const secondaryRow = doc ? (
    <ToolActionsSection
      {...secondaryActionProps}
      leadingControl={
        isMobileShell ? (
          <LoopControl
            hasTimeSelection={hasTimeSelection}
            loopEnabled={transportState.loopEnabled}
            onToggleLoop={handleToggleLoop}
          />
        ) : null
      }
      undoDisabled={documentState.undoDepth === 0}
      redoDisabled={documentState.redoDepth === 0}
      onUndo={actions.undo}
      onRedo={actions.redo}
      onToggleGrid={handleToggleGrid}
    />
  ) : null;

  const rightSection = doc ? (
    <ExportSection
      isBusy={isBusy}
      isRendering={isRendering}
      renderProgressPhase={renderProgress?.phase ?? null}
      onExport={handleExport}
    />
  ) : null;

  const presenter = isMobileShell ? (
    <ToolbarMobilePresenter
      leftSection={leftSection}
      centerSection={centerSection}
      toolsToggleSection={toolsToggleSection}
      rightSection={rightSection}
      secondaryRow={secondaryRow}
      toolsOpen={toolsOpen}
    />
  ) : (
    <ToolbarDesktopPresenter
      leftSection={leftSection}
      centerSection={centerSection}
      rightSection={rightSection}
      secondaryRow={secondaryRow}
    />
  );

  return (
    <>
      {presenter}

      <ToolbarDialogsHost
        persistence={persistence}
        projectDialogOpen={projectDialogOpen}
        onProjectDialogClose={onProjectDialogClose}
        bpmDialogOpen={bpmDialogOpen}
        onBpmDialogClose={() => setBpmDialogOpen(false)}
        timeSignatureDialogOpen={timeSignatureDialogOpen}
        onTimeSignatureDialogClose={() => setTimeSignatureDialogOpen(false)}
        gridDialogOpen={gridDialogOpen}
        onGridDialogClose={() => setGridDialogOpen(false)}
        pitchLinkDialogOpen={pitchLinkDialogOpen}
        onPitchLinkDialogClose={() => setPitchLinkDialogOpen(false)}
        isBusy={isBusy}
      />
    </>
  );
}
