import {
  initialDocumentStoreState,
  reduceDocumentStore,
} from "./documentStore.ts";
import {
  initialMidiEditorStoreState,
  reduceMidiEditorStore,
} from "./midiEditorStore.ts";
import {
  initialSelectionStoreState,
  reduceSelectionStore,
} from "./selectionStore.ts";
import type {
  DocumentStoreState,
  MidiEditorStoreState,
  ProjectAction,
  ProjectState,
  SelectionStoreState,
  TransportStoreState,
  ViewportStoreState,
} from "./projectStoreTypes.ts";
import {
  initialTransportStoreState,
  reduceTransportStore,
} from "./transportStore.ts";
import {
  initialViewportStoreState,
  reduceViewportStore,
} from "./viewportStore.ts";

function getDocumentStoreState(state: ProjectState): DocumentStoreState {
  return {
    document: state.document,
    projectRevision: state.projectRevision,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    hasUnsavedChanges: state.hasUnsavedChanges,
  };
}

function getSelectionStoreState(state: ProjectState): SelectionStoreState {
  return {
    selectedTrackId: state.selectedTrackId,
    selectedClipIds: state.selectedClipIds,
    primaryClipId: state.primaryClipId,
    selectedClipKind: state.selectedClipKind,
    timeSelectionStartTick: state.timeSelectionStartTick,
    timeSelectionEndTick: state.timeSelectionEndTick,
  };
}

function getViewportStoreState(state: ProjectState): ViewportStoreState {
  return {
    zoom: state.zoom,
    scrollX: state.scrollX,
    scrollY: state.scrollY,
  };
}

function getTransportStoreState(state: ProjectState): TransportStoreState {
  return {
    playheadTick: state.playheadTick,
    loopEnabled: state.loopEnabled,
    isPlaying: state.isPlaying,
    error: state.error,
    busyTask: state.busyTask,
  };
}

function getMidiEditorStoreState(state: ProjectState): MidiEditorStoreState {
  return {
    midiEditorTarget: state.midiEditorTarget,
  };
}

export const initialProjectState: ProjectState = {
  wasmReady: false,
  ...initialDocumentStoreState,
  ...initialSelectionStoreState,
  ...initialViewportStoreState,
  ...initialTransportStoreState,
  ...initialMidiEditorStoreState,
};

export function projectReducer(
  state: ProjectState,
  action: ProjectAction,
): ProjectState {
  if (action.type === "INIT_WASM") {
    return { ...state, wasmReady: true };
  }

  const documentState = reduceDocumentStore(getDocumentStoreState(state), action);
  const selectionState = reduceSelectionStore(
    getSelectionStoreState(state),
    action,
    documentState.document,
  );
  const viewportState = reduceViewportStore(
    getViewportStoreState(state),
    action,
  );
  const transportState = reduceTransportStore(
    getTransportStoreState(state),
    action,
    selectionState,
  );
  const midiEditorState = reduceMidiEditorStore(
    getMidiEditorStoreState(state),
    action,
  );

  return {
    ...state,
    ...documentState,
    ...selectionState,
    ...viewportState,
    ...transportState,
    ...midiEditorState,
  };
}
