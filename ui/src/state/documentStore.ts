import type { DocumentStoreState, ProjectAction } from "./projectStoreTypes.ts";

export const initialDocumentStoreState: DocumentStoreState = {
  document: null,
  projectRevision: 0,
  undoStack: [],
  redoStack: [],
  hasUnsavedChanges: false,
};

export function reduceDocumentStore(
  state: DocumentStoreState,
  action: ProjectAction,
): DocumentStoreState {
  switch (action.type) {
    case "SET_PROJECT":
      return {
        ...state,
        document: action.document,
        projectRevision: action.revision ?? state.projectRevision + 1,
        undoStack: [],
        redoStack: [],
      };

    case "COMMAND_APPLIED":
      return {
        ...state,
        document: action.document,
        undoStack: [...state.undoStack, action.inverse],
        redoStack: [],
        projectRevision: state.projectRevision + 1,
        hasUnsavedChanges: true,
      };

    case "UNDO_APPLIED":
      return {
        ...state,
        document: action.document,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, action.inverse],
        projectRevision: state.projectRevision + 1,
        hasUnsavedChanges: true,
      };

    case "REDO_APPLIED":
      return {
        ...state,
        document: action.document,
        undoStack: [...state.undoStack, action.inverse],
        redoStack: state.redoStack.slice(0, -1),
        projectRevision: state.projectRevision + 1,
        hasUnsavedChanges: true,
      };

    case "SET_HAS_UNSAVED_CHANGES":
      return { ...state, hasUnsavedChanges: action.value };

    case "MARK_SAVED":
      return { ...state, hasUnsavedChanges: false };

    default:
      return state;
  }
}
