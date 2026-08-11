import {
  DocumentStateContext,
  MidiEditorStateContext,
  SelectionStateContext,
  TransportStateContext,
  ViewportStateContext,
} from "@/state/projectStores.ts";
import { initialProjectState, projectReducer } from "@/state/projectReducer.ts";
import type {
  BusyTask,
  ProjectAction,
  ProjectState,
} from "@/state/projectStoreTypes.ts";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  Command,
  ProjectDocument,
  TrackId,
  ClipId,
  ContentId,
} from "../types/index.ts";
import { analysisStore } from "../audio/analysisStore.ts";
import { livePlayheadStore } from "../audio/livePlayheadStore.ts";
import { mediaAvailabilityRegistry } from "../audio/mediaAvailability.ts";
import { mediaCache } from "../audio/mediaCache.ts";
import {
  applyProjectInverseCommand,
  applyProjectCommand,
  createProjectDocument,
} from "../adapters/projectDocument.ts";
import { wasmErrorMessage } from "../adapters/wasmError.ts";

// =============================================================================
// Context
// =============================================================================

interface ProjectContextValue {
  state: ProjectState;
  dispatch: React.Dispatch<ProjectAction>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);
const ProjectActionsContext = createContext<ProjectActions | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialProjectState);
  const actions = useProjectActionsValue(state, dispatch);

  const value = useMemo<ProjectContextValue>(
    () => ({ state, dispatch }),
    [state, dispatch],
  );

  const documentState = useMemo(
    () => ({
      document: state.document,
      projectRevision: state.projectRevision,
      undoDepth: state.undoStack.length,
      redoDepth: state.redoStack.length,
      hasUnsavedChanges: state.hasUnsavedChanges,
    }),
    [
      state.document,
      state.projectRevision,
      state.undoStack.length,
      state.redoStack.length,
      state.hasUnsavedChanges,
    ],
  );

  const selectionState = useMemo(
    () => ({
      selectedTrackId: state.selectedTrackId,
      selectedClipIds: state.selectedClipIds,
      primaryClipId: state.primaryClipId,
      selectedClipKind: state.selectedClipKind,
      timeSelectionStartTick: state.timeSelectionStartTick,
      timeSelectionEndTick: state.timeSelectionEndTick,
    }),
    [
      state.selectedTrackId,
      state.selectedClipIds,
      state.primaryClipId,
      state.selectedClipKind,
      state.timeSelectionStartTick,
      state.timeSelectionEndTick,
    ],
  );

  const viewportState = useMemo(
    () => ({
      zoom: state.zoom,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
    }),
    [state.zoom, state.scrollX, state.scrollY],
  );

  const transportState = useMemo(
    () => ({
      playheadTick: state.playheadTick,
      loopEnabled: state.loopEnabled,
      isPlaying: state.isPlaying,
      busyTask: state.busyTask,
      error: state.error,
    }),
    [
      state.playheadTick,
      state.loopEnabled,
      state.isPlaying,
      state.busyTask,
      state.error,
    ],
  );

  const midiEditorState = useMemo(
    () => ({ midiEditorTarget: state.midiEditorTarget }),
    [state.midiEditorTarget],
  );

  return (
    <ProjectContext.Provider value={value}>
      <ProjectActionsContext.Provider value={actions}>
        <DocumentStateContext.Provider value={documentState}>
          <SelectionStateContext.Provider value={selectionState}>
            <ViewportStateContext.Provider value={viewportState}>
              <TransportStateContext.Provider value={transportState}>
                <MidiEditorStateContext.Provider value={midiEditorState}>
                  {children}
                </MidiEditorStateContext.Provider>
              </TransportStateContext.Provider>
            </ViewportStateContext.Provider>
          </SelectionStateContext.Provider>
        </DocumentStateContext.Provider>
      </ProjectActionsContext.Provider>
    </ProjectContext.Provider>
  );
}

// =============================================================================
// useProject — raw context access
// =============================================================================

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
}

// =============================================================================
// useProjectActions — typed action creators with WASM calls
// =============================================================================

export interface ProjectActions {
  initWasm: () => void;
  createProject: (name: string, bpm: number, sampleRate: number) => void;
  setProject: (
    doc: ProjectDocument,
    options?: { resetRuntimeCaches?: boolean; revision?: number },
  ) => void;
  applyCommand: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  selectTrack: (id: TrackId | null) => void;
  selectClip: (id: ClipId | null) => void;
  setClipSelection: (clipIds: ClipId[], primaryClipId: ClipId | null) => void;
  clearSelection: () => void;
  setPlayhead: (tick: number) => void;
  setZoom: (x: number, y: number) => void;
  setScroll: (x: number, y: number) => void;
  setTimeSelection: (startTick: number | null, endTick: number | null) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setPlaying: (playing: boolean) => void;
  openMidiEditor: (contentId: ContentId, clipId: ClipId) => void;
  closeMidiEditor: () => void;
  setProjectName: (name: string) => void;
  setHasUnsavedChanges: (value: boolean) => void;
  markSaved: () => void;
  setError: (error: string | null) => void;
  setBusyTask: (busyTask: BusyTask) => void;
  clearBusyTask: () => void;
}

function useProjectActionsValue(
  state: ProjectState,
  dispatch: React.Dispatch<ProjectAction>,
): ProjectActions {
  // Keep a ref to state so callbacks don't go stale when captured in closures
  const stateRef = useRef(state);

  // Separate document ref that is updated synchronously within applyCommand
  // so sequential commands in the same tick always see the latest document.
  const documentRef = useRef(state.document);
  useLayoutEffect(() => {
    stateRef.current = state;
    documentRef.current = state.document;
  }, [state]);

  const initWasm = useCallback(() => {
    dispatch({ type: "INIT_WASM" });
  }, [dispatch]);

  const createProjectAction = useCallback(
    (name: string, bpm: number, sampleRate: number) => {
      try {
        const document = createProjectDocument(name, bpm, sampleRate);
        const nextRevision = stateRef.current.projectRevision + 1;
        analysisStore.clear();
        mediaCache.clear();
        mediaAvailabilityRegistry.reconcile(document, (mediaId) => mediaCache.has(mediaId));
        documentRef.current = document;
        dispatch({ type: "SET_PROJECT", document, revision: nextRevision });
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: wasmErrorMessage(e) });
      }
    },
    [dispatch],
  );

  const setProject = useCallback(
    (doc: ProjectDocument, options?: { resetRuntimeCaches?: boolean; revision?: number }) => {
      if (options?.resetRuntimeCaches !== false) {
        analysisStore.clear();
        mediaCache.clear();
      }
      mediaAvailabilityRegistry.reconcile(doc, (mediaId) => mediaCache.has(mediaId));
      documentRef.current = doc;
      dispatch({ type: "SET_PROJECT", document: doc, revision: options?.revision });
    },
    [dispatch],
  );

  const applyCommand = useCallback(
    (command: Command) => {
      const doc = documentRef.current;
      if (!doc) {
        dispatch({
          type: "SET_ERROR",
          error: "No project loaded",
        });
        return;
      }
      try {
        const result = applyProjectCommand(doc, command);
        mediaAvailabilityRegistry.reconcile(
          result.project,
          (mediaId) => mediaCache.has(mediaId),
        );
        // Synchronously update the ref so subsequent calls in the same tick see the latest doc
        documentRef.current = result.project;
        dispatch({
          type: "COMMAND_APPLIED",
          document: result.project,
          inverse: result.inverseCommandJson,
        });
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: wasmErrorMessage(e) });
      }
    },
    [dispatch],
  );

  const undo = useCallback(() => {
    const current = stateRef.current;
    const doc = documentRef.current;
    if (!doc) {
      dispatch({ type: "SET_ERROR", error: "No project loaded" });
      return;
    }
    const lastInverse = current.undoStack[current.undoStack.length - 1];
    if (!lastInverse) {
      dispatch({ type: "SET_ERROR", error: "Nothing to undo" });
      return;
    }
    try {
      const result = applyProjectInverseCommand(doc, lastInverse);
      mediaAvailabilityRegistry.reconcile(
        result.project,
        (mediaId) => mediaCache.has(mediaId),
      );
      documentRef.current = result.project;
      dispatch({
        type: "UNDO_APPLIED",
        document: result.project,
        inverse: result.inverseCommandJson,
        undoneCommand: lastInverse,
      });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: wasmErrorMessage(e) });
    }
  }, [dispatch]);

  const redo = useCallback(() => {
    const current = stateRef.current;
    const doc = documentRef.current;
    if (!doc) {
      dispatch({ type: "SET_ERROR", error: "No project loaded" });
      return;
    }
    const lastRedo = current.redoStack[current.redoStack.length - 1];
    if (!lastRedo) {
      dispatch({ type: "SET_ERROR", error: "Nothing to redo" });
      return;
    }
    try {
      const result = applyProjectInverseCommand(doc, lastRedo);
      mediaAvailabilityRegistry.reconcile(
        result.project,
        (mediaId) => mediaCache.has(mediaId),
      );
      documentRef.current = result.project;
      dispatch({
        type: "REDO_APPLIED",
        document: result.project,
        inverse: result.inverseCommandJson,
        redoneCommand: lastRedo,
      });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: wasmErrorMessage(e) });
    }
  }, [dispatch]);

  const selectTrack = useCallback(
    (id: TrackId | null) => {
      dispatch({ type: "SELECT_TRACK", trackId: id });
    },
    [dispatch],
  );

  const selectClip = useCallback(
    (id: ClipId | null) => {
      dispatch({
        type: "SET_CLIP_SELECTION",
        clipIds: id ? [id] : [],
        primaryClipId: id,
      });
    },
    [dispatch],
  );

  const setClipSelection = useCallback(
    (clipIds: ClipId[], primaryClipId: ClipId | null) => {
      dispatch({
        type: "SET_CLIP_SELECTION",
        clipIds,
        primaryClipId,
      });
    },
    [dispatch],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "CLEAR_SELECTION" });
  }, [dispatch]);

  const setPlayhead = useCallback(
    (tick: number) => {
      dispatch({ type: "SET_PLAYHEAD", tick });
      // The playhead has two representations: this reducer slice, which
      // re-renders its subscribers, and `livePlayheadStore`, which the rAF
      // playback loop drives without re-rendering anything. Seeking wrote only
      // the reducer, so the marker — which reads the live store — stayed put
      // while the position readout moved. Every write goes to both.
      livePlayheadStore.set(tick);
    },
    [dispatch],
  );

  const setZoom = useCallback(
    (x: number, y: number) => {
      dispatch({ type: "SET_ZOOM", x, y });
    },
    [dispatch],
  );

  const setScroll = useCallback(
    (x: number, y: number) => {
      dispatch({ type: "SET_SCROLL", x, y });
    },
    [dispatch],
  );

  const setTimeSelection = useCallback(
    (startTick: number | null, endTick: number | null) => {
      dispatch({ type: "SET_TIME_SELECTION", startTick, endTick });
    },
    [dispatch],
  );

  const setLoopEnabled = useCallback(
    (enabled: boolean) => {
      dispatch({ type: "SET_LOOP_ENABLED", enabled });
    },
    [dispatch],
  );

  const setPlaying = useCallback(
    (playing: boolean) => {
      dispatch({ type: "SET_PLAYING", playing });
    },
    [dispatch],
  );

  const openMidiEditor = useCallback(
    (contentId: ContentId, clipId: ClipId) => {
      dispatch({ type: "OPEN_MIDI_EDITOR", contentId, clipId });
    },
    [dispatch],
  );

  const closeMidiEditor = useCallback(() => {
    dispatch({ type: "CLOSE_MIDI_EDITOR" });
  }, [dispatch]);

  const setProjectName = useCallback(
    (name: string) => {
      const currentDocument = documentRef.current;
      if (!currentDocument) {
        return;
      }
      const trimmed = name.trim();
      if (!trimmed || currentDocument.meta.name === trimmed) {
        return;
      }
      applyCommand({ command: "rename_project", name: trimmed });
    },
    [applyCommand],
  );

  const setHasUnsavedChanges = useCallback(
    (value: boolean) => {
      dispatch({ type: "SET_HAS_UNSAVED_CHANGES", value });
    },
    [dispatch],
  );

  const markSaved = useCallback(() => {
    dispatch({ type: "MARK_SAVED" });
  }, [dispatch]);

  const setError = useCallback(
    (error: string | null) => {
      dispatch({ type: "SET_ERROR", error });
    },
    [dispatch],
  );

  const setBusyTask = useCallback(
    (busyTask: BusyTask) => {
      dispatch({ type: "SET_BUSY_TASK", busyTask });
    },
    [dispatch],
  );

  const clearBusyTask = useCallback(() => {
    dispatch({ type: "CLEAR_BUSY_TASK" });
  }, [dispatch]);

  return useMemo(
    () => ({
      initWasm,
      createProject: createProjectAction,
      setProject,
      applyCommand,
      undo,
      redo,
      selectTrack,
      selectClip,
      setClipSelection,
      clearSelection,
      setPlayhead,
      setZoom,
      setScroll,
      setTimeSelection,
      setLoopEnabled,
      setPlaying,
      openMidiEditor,
      closeMidiEditor,
      setProjectName,
      setHasUnsavedChanges,
      markSaved,
      setError,
      setBusyTask,
      clearBusyTask,
    }),
    [
      initWasm,
      createProjectAction,
      setProject,
      applyCommand,
      undo,
      redo,
      selectTrack,
      selectClip,
      setClipSelection,
      clearSelection,
      setPlayhead,
      setZoom,
      setScroll,
      setTimeSelection,
      setLoopEnabled,
      setPlaying,
      openMidiEditor,
      closeMidiEditor,
      setProjectName,
      setHasUnsavedChanges,
      markSaved,
      setError,
      setBusyTask,
      clearBusyTask,
    ],
  );
}

export function useProjectActions(): ProjectActions {
  const actions = useContext(ProjectActionsContext);
  if (!actions) {
    throw new Error("useProjectActions must be used within a ProjectProvider");
  }
  return actions;
}
