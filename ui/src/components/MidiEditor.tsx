import {
  useMemo,
} from "react";
import {
  useDocumentState,
  useProjectActions,
  useTransportState,
} from "@/store";
import { DEFAULT_PPQ } from "@/types";
import type { ContentId, ClipId } from "@/types";
import { useMidiEditor } from "@/hooks/useMidiEditor";
import {
  describeGridDivision,
  DEFAULT_TIME_SIGNATURE,
  GRID_LINE_COLORS,
  effectiveBeatTicks,
  ticksPerBar as getTicksPerBar,
} from "@/grid";
import {
  contentTickFromProjectTick,
} from "@/utils/midiTimeMapping";
import {
  getMidiNoteIndicesInsideWindow,
  isContentTickInMidiWindow,
} from "@/utils/midiClipWindow.ts";
import {
  getPageStepTicks,
  getPlayheadStepTicks,
} from "@/utils/timelineInteractions";
import { useMidiEditorInteractionPolicy, useShellVariantValue } from "@/app/interactionMode.tsx";
import { MidiEditorDesktopPresenter } from "./midi-editor/MidiEditorDesktopPresenter";
import { MidiEditorMobilePresenter } from "./midi-editor/MidiEditorMobilePresenter";
import { useMidiEditorInteractionsDesktop } from "./midi-editor/useMidiEditorInteractionsDesktop";
import { useMidiEditorInteractionsMobile } from "./midi-editor/useMidiEditorInteractionsMobile";
import { buildMidiEditorGeometry } from "./midi-editor/midiEditorGeometry";
import { useMidiEditorPlayheadMarker } from "./midi-editor/useMidiEditorPlayheadMarker";
import {
  MIDI_EDITOR_PIANO_KEY_WIDTH,
  midiEditorSurfaceStyles,
} from "./midi-editor/surfaceStyles";
import {
  TIMELINE_RULER_LABEL,
  TIMELINE_RULER_LABEL_BORDER,
} from "@/design-system/trackKindColors";

// =============================================================================
// Constants
// =============================================================================

const TOTAL_KEYS = 128;
// =============================================================================
// Piano helpers
// =============================================================================

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

function isBlackKey(key: number): boolean {
  const n = key % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

function noteName(key: number): string {
  const name = NOTE_NAMES[key % 12];
  const octave = Math.floor(key / 12) - 1; // MIDI 60 = C4
  return `${name ?? ""}${octave}`;
}

function isCNote(key: number): boolean {
  return key % 12 === 0;
}

// =============================================================================
// Component
// =============================================================================

interface MidiEditorProps {
  contentId: ContentId;
  clipId: ClipId;
}

export function MidiEditor({ contentId, clipId }: MidiEditorProps) {
  const { document: doc } = useDocumentState();
  const transportState = useTransportState();
  const projectActions = useProjectActions();
  const interactionPolicy = useMidiEditorInteractionPolicy();
  const clip = doc?.edit.clips.find((candidate) => candidate.id === clipId);
  const clipName = clip ? "MIDI Clip" : "Unknown Clip";
  const midiClipTiming = useMemo(
    () =>
      clip?.kind.clip_type === "midi"
        ? {
            clipStart: clip.start,
            contentIn: clip.kind.midi.content_in,
            contentOut: clip.kind.midi.content_out,
          }
        : null,
    [clip],
  );
  const {
    editorState,
    notes,
    gridTickSize,
    magnetRangeTicks,
    snapTick,
    snapTickWithThreshold,
    isSnapEnabled,
    actions,
  } = useMidiEditor({ contentId, document: doc, contentWindow: midiClipTiming });

  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;
  const ticksPerBeat = effectiveBeatTicks(ppq, timeSig);
  const ticksPerBar = getTicksPerBar(ppq, timeSig);
  const playheadStepTicks = getPlayheadStepTicks({
    snapEnabled: doc?.edit.grid.snap_enabled ?? true,
    division: doc?.edit.grid.division ?? "Beat",
    ppq,
    timeSig,
  });
  const pageStepTicks = getPageStepTicks(playheadStepTicks, timeSig.num);

  const pxPerTick = editorState.zoomX;
  const rowHeight = editorState.zoomY;
  const selectedNoteIndexSet = useMemo(
    () => new Set(editorState.selectedNoteIndices),
    [editorState.selectedNoteIndices],
  );
  const visibleNoteIndices = useMemo(
    () =>
      midiClipTiming
        ? getMidiNoteIndicesInsideWindow(notes, midiClipTiming)
        : notes.map((_, index) => index),
    [midiClipTiming, notes],
  );
  const visibleNoteIndexSet = useMemo(
    () => new Set(visibleNoteIndices),
    [visibleNoteIndices],
  );
  const visibleNotes = useMemo(
    () => visibleNoteIndices.flatMap((index) => (notes[index] ? [notes[index]] : [])),
    [notes, visibleNoteIndices],
  );
  const gridLabel = isSnapEnabled
    ? describeGridDivision(doc?.edit.grid.division ?? "Beat", ppq, timeSig)
    : "Off";
  const rawPlayheadContentTick = midiClipTiming
    ? contentTickFromProjectTick({
        projectTick: transportState.playheadTick,
        clipStart: midiClipTiming.clipStart,
        contentIn: midiClipTiming.contentIn,
      })
    : null;
  const playheadContentTick =
    midiClipTiming &&
    rawPlayheadContentTick !== null &&
    isContentTickInMidiWindow(rawPlayheadContentTick, midiClipTiming)
      ? rawPlayheadContentTick
      : null;
  const geometry = useMemo(
    () =>
      buildMidiEditorGeometry({
        notes: visibleNotes,
        ticksPerBar,
        ticksPerBeat,
        pxPerTick,
        rowHeight,
        totalKeys: TOTAL_KEYS,
        gridTickSize,
        isSnapEnabled,
        playheadContentTick,
        contentEndTick: midiClipTiming?.contentOut ?? null,
      }),
    [
      gridTickSize,
      isSnapEnabled,
      midiClipTiming?.contentOut,
      visibleNotes,
      playheadContentTick,
      pxPerTick,
      rowHeight,
      ticksPerBar,
      ticksPerBeat,
    ],
  );
  const {
    totalHeight,
    totalWidth,
    barLabelInterval,
    totalBars,
    gridLines,
  } = geometry;

  const rulerPlayheadRef = useMidiEditorPlayheadMarker({
    clipTiming: midiClipTiming,
    pxPerTick,
  });
  const gridPlayheadRef = useMidiEditorPlayheadMarker({
    clipTiming: midiClipTiming,
    pxPerTick,
  });

  const midiInteractionArgs = {
    notes,
    selectedNoteIndices: editorState.selectedNoteIndices,
    transportPlayheadTick: transportState.playheadTick,
    playheadStepTicks,
    pageStepTicks,
    pxPerTick,
    rowHeight,
    gridTickSize,
    magnetRangeTicks,
    isSnapEnabled,
    interactionPolicy,
    midiClipTiming,
    setPlayhead: projectActions.setPlayhead,
    closeMidiEditor: projectActions.closeMidiEditor,
    actions,
    snapTick,
    snapTickWithThreshold,
  };
  const useMidiInteractionAdapter = useShellVariantValue({
    desktop: useMidiEditorInteractionsDesktop,
    mobile: useMidiEditorInteractionsMobile,
  });
  const {
    gridScrollRef,
    pianoScrollRef,
    rulerScrollRef,
    handleGridScroll,
    handleGridPointerDown,
    handleGridPointerMove,
    finishGridPointerGesture,
    handleContextMenu,
    handleRulerClick,
    handleEditorBodyPointerDown,
    handleEditorBodyPointerMove,
    finishEditorBodyPointerGesture,
    handleAuxClick,
    draftNote,
    marqueeRect,
    dragState,
    movingNoteIndexSet,
    copyGhostNotes,
    mobileTransientActionBadge,
  } = useMidiInteractionAdapter(midiInteractionArgs);

  const headerInfo =
    `Notes: ${visibleNoteIndices.length}/${notes.length} | Selected: ${editorState.selectedNoteIndices.length} | Grid: ${gridLabel}`;

  const editorBody = (
      <div
        className={midiEditorSurfaceStyles.editorBody}
        onPointerDown={handleEditorBodyPointerDown}
        onPointerMove={handleEditorBodyPointerMove}
        onPointerUp={finishEditorBodyPointerGesture}
      onPointerCancel={finishEditorBodyPointerGesture}
      onAuxClick={handleAuxClick}
    >
      {/* Piano keyboard column */}
      <div className={midiEditorSurfaceStyles.pianoColumn}>
        {/* Corner spacer (above piano, aligns with ruler) */}
        <div className={midiEditorSurfaceStyles.cornerSpacer} />
        {/* Piano keys */}
        <div
          ref={pianoScrollRef}
          className={midiEditorSurfaceStyles.pianoScroll}
        >
          <div
            className={midiEditorSurfaceStyles.pianoInner}
            style={{
              height: totalHeight,
              width: MIDI_EDITOR_PIANO_KEY_WIDTH,
            }}
          >
            {Array.from({ length: TOTAL_KEYS }, (_, i) => {
              const key = 127 - i;
              const black = isBlackKey(key);
              const isC = isCNote(key);
              return (
                <div
                  key={key}
                  style={{
                    position: "absolute",
                    top: i * rowHeight,
                    left: 0,
                    width: MIDI_EDITOR_PIANO_KEY_WIDTH,
                    height: rowHeight,
                    backgroundColor: black ? "#2a2a2a" : "#cccccc",
                    borderBottom: `1px solid ${black ? "#1a1a1a" : "#aaaaaa"}`,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 4,
                    fontSize: 10,
                    color: black ? "#888" : "#444",
                    fontWeight: isC ? 700 : 400,
                    userSelect: "none",
                    cursor: "pointer",
                  }}
                >
                  {isC ? noteName(key) : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right side: ruler + grid */}
      <div className={midiEditorSurfaceStyles.rightColumn}>
        {/* Time ruler */}
        <div
          ref={rulerScrollRef}
          data-testid="midi-editor-ruler"
          className={midiEditorSurfaceStyles.rulerOuter}
        >
          <div
            className={midiEditorSurfaceStyles.rulerInner}
            style={{ width: totalWidth }}
            onClick={handleRulerClick}
          >
            {Array.from({ length: totalBars }, (_, i) => {
              if (i % barLabelInterval !== 0) return null;
              const barNumber = i + 1;
              const x = i * ticksPerBar * pxPerTick;
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
                  }}
                >
                  {barNumber}
                </div>
              );
            })}
            {/* Positioned imperatively from the live playback tick; rendered
                without `left` so React does not fight the per-frame writes. */}
            <div
              ref={rulerPlayheadRef}
              data-testid="midi-editor-ruler-playhead"
              style={{
                position: "absolute",
                top: 0,
                width: 2,
                height: "100%",
                backgroundColor: "#ffcc66",
                pointerEvents: "none",
                zIndex: 4,
              }}
            />
          </div>
        </div>

        {/* Note grid */}
        <div
          ref={gridScrollRef}
          data-testid="midi-editor-grid-scroll"
          className={midiEditorSurfaceStyles.gridOuter}
          onScroll={handleGridScroll}
        >
          <div
            data-testid="midi-editor-grid"
            className={midiEditorSurfaceStyles.gridInner}
            style={{
              width: totalWidth,
              height: totalHeight,
            }}
            onPointerDown={handleGridPointerDown}
            onPointerMove={handleGridPointerMove}
            onPointerUp={finishGridPointerGesture}
            onPointerCancel={finishGridPointerGesture}
            onContextMenu={handleContextMenu}
          >
            {midiClipTiming && (
              <div
                data-testid="midi-editor-content-window"
                data-content-in={midiClipTiming.contentIn}
                data-content-out={midiClipTiming.contentOut}
                style={{
                  position: "absolute",
                  left: midiClipTiming.contentIn * pxPerTick,
                  top: 0,
                  width: (midiClipTiming.contentOut - midiClipTiming.contentIn) * pxPerTick,
                  height: "100%",
                  borderLeft: "1px solid rgba(102, 187, 106, 0.68)",
                  borderRight: "1px solid rgba(102, 187, 106, 0.68)",
                  backgroundColor: "rgba(102, 187, 106, 0.035)",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />
            )}
            {/* Row backgrounds */}
            {Array.from({ length: TOTAL_KEYS }, (_, i) => {
              const key = 127 - i;
              const black = isBlackKey(key);
              const isC = isCNote(key);
              return (
                <div
                  key={`row-${key}`}
                  style={{
                    position: "absolute",
                    top: i * rowHeight,
                    left: 0,
                    width: "100%",
                    height: rowHeight,
                    backgroundColor: black
                      ? "rgba(255,255,255,0.025)"
                      : "rgba(62,72,104,0.18)",
                    backgroundImage: black
                      ? "linear-gradient(90deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.035) 48%, rgba(255,255,255,0.01) 100%)"
                      : "linear-gradient(90deg, rgba(92,104,146,0.28) 0%, rgba(62,72,104,0.14) 48%, rgba(36,42,60,0.04) 100%)",
                    borderBottom: isC
                      ? "1px solid rgba(255,255,255,0.1)"
                      : black
                        ? "1px solid rgba(255,255,255,0.035)"
                        : "1px solid rgba(255,255,255,0.05)",
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                />
              );
            })}

            {/* Bar lines */}
            {Array.from({ length: totalBars }, (_, i) => {
              const x = i * ticksPerBar * pxPerTick;
              const isMajor = i % barLabelInterval === 0;
              return (
                <div
                  key={`bar-${i}`}
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

            {/* Grid subdivision lines */}
            {gridLines.map((line, i) => (
              <div
                key={`sub-${i}`}
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

            <div
              ref={gridPlayheadRef}
              data-testid="midi-editor-grid-playhead"
              style={{
                position: "absolute",
                top: 0,
                width: 2,
                height: "100%",
                backgroundColor: "#ffcc66",
                pointerEvents: "none",
                zIndex: 3,
              }}
            />

            {marqueeRect && (
              <div
                style={{
                  position: "absolute",
                  left: marqueeRect.left,
                  top: marqueeRect.top,
                  width: Math.max(1, marqueeRect.right - marqueeRect.left),
                  height: Math.max(1, marqueeRect.bottom - marqueeRect.top),
                  backgroundColor: "rgba(129,212,250,0.16)",
                  border: "1px dashed rgba(225,245,254,0.95)",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            )}

            {/* MIDI Notes */}
            {notes.map((note, i) => {
              if (!visibleNoteIndexSet.has(i)) {
                return null;
              }
              const isMoving =
                dragState?.type === "move" &&
                dragState.hasStarted &&
                !dragState.copy &&
                movingNoteIndexSet?.has(i) === true;
              const isResizing =
                dragState?.type === "resize" && dragState.noteIndex === i;
              const displayStart = isMoving
                ? note.start + dragState.currentTickDelta
                : note.start;
              const displayKey = isMoving
                ? note.key + dragState.currentKeyDelta
                : note.key;
              const displayLength = isResizing
                ? dragState.currentLength
                : note.length;
              const isDragging = isMoving || isResizing;

              const noteRow = 127 - displayKey;
              const noteX = displayStart * pxPerTick;
              const noteW = Math.max(
                displayLength * pxPerTick,
                2,
              );
              const noteY = noteRow * rowHeight;
              const isSelected = selectedNoteIndexSet.has(i);

              return (
                <div
                  key={note.id}
                  data-testid={`midi-editor-note-${i}`}
                  data-glow-state={isSelected ? "selected" : undefined}
                  style={{
                    position: "absolute",
                    left: noteX,
                    top: noteY + 1,
                    width: noteW,
                    height: rowHeight - 2,
                    backgroundColor: isSelected
                      ? "#81d4fa"
                      : "#4fc3f7",
                    border: isSelected
                      ? "1px solid #fff"
                      : "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 2,
                    boxSizing: "border-box",
                    cursor: isDragging
                      ? "grabbing"
                      : "grab",
                    opacity: isDragging ? 0.8 : 1,
                    zIndex: isDragging ? 6 : isSelected ? 5 : 2,
                    pointerEvents: "auto",
                    boxShadow: isSelected
                      ? "0 0 4px rgba(129,212,250,0.5)"
                      : "none",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: `${(note.vel / 127) * 100}%`,
                      height: 2,
                      backgroundColor: "rgba(0,0,0,0.3)",
                      borderRadius: "0 0 1px 1px",
                      pointerEvents: "none",
                    }}
                  />
                  {noteW > 30 && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(0,0,0,0.6)",
                        padding: "0 2px",
                        pointerEvents: "none",
                        userSelect: "none",
                        lineHeight: `${rowHeight - 4}px`,
                      }}
                    >
                      {noteName(displayKey)}
                    </span>
                  )}
                </div>
              );
            })}

            {copyGhostNotes.map((note) => {
              const noteRow = 127 - note.key;
              return (
                <div
                  key={`ghost-note-${note.index}`}
                  style={{
                    position: "absolute",
                    left: note.start * pxPerTick,
                    top: noteRow * rowHeight + 1,
                    width: Math.max(note.length * pxPerTick, 2),
                    height: rowHeight - 2,
                    backgroundColor: "rgba(129,212,250,0.38)",
                    border: "1px dashed rgba(255,255,255,0.9)",
                    borderRadius: 2,
                    boxSizing: "border-box",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                />
              );
            })}

            {draftNote && (
              <div
                style={{
                  position: "absolute",
                  left: draftNote.start * pxPerTick,
                  top: (127 - draftNote.key) * rowHeight + 1,
                  width: Math.max(draftNote.length * pxPerTick, 2),
                  height: rowHeight - 2,
                  backgroundColor: "rgba(165,214,167,0.5)",
                  border: "1px dashed rgba(225,255,225,0.9)",
                  borderRadius: 2,
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const Presenter = useShellVariantValue({
    desktop: MidiEditorDesktopPresenter,
    mobile: MidiEditorMobilePresenter,
  });

  return (
    <Presenter
      clipTitle={clipName}
      headerInfo={headerInfo}
      onBack={() => projectActions.closeMidiEditor()}
      editorBody={editorBody}
      mobileTransientActionBadge={mobileTransientActionBadge}
    />
  );
}
