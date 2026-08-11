import { createContext, useContext, type Context } from "react";

import type { ProjectDocument } from "@/types";

import type {
  MidiEditorStoreState,
  SelectionStoreState,
  TransportStoreState,
  ViewportStoreState,
} from "./projectStoreTypes.ts";

export interface DocumentStateSlice {
  document: ProjectDocument | null;
  projectRevision: number;
  undoDepth: number;
  redoDepth: number;
  hasUnsavedChanges: boolean;
}

export type SelectionStateSlice = SelectionStoreState;
export type ViewportStateSlice = ViewportStoreState;
export type TransportStateSlice = TransportStoreState;
export type MidiEditorStateSlice = MidiEditorStoreState;

export const DocumentStateContext = createContext<DocumentStateSlice | null>(null);
export const SelectionStateContext = createContext<SelectionStateSlice | null>(null);
export const ViewportStateContext = createContext<ViewportStateSlice | null>(null);
export const TransportStateContext = createContext<TransportStateSlice | null>(null);
export const MidiEditorStateContext = createContext<MidiEditorStateSlice | null>(null);

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${name} must be used within a ProjectProvider`);
  }
  return value;
}

export function useDocumentState(): DocumentStateSlice {
  return useRequiredContext(DocumentStateContext, "useDocumentState");
}

export function useSelectionState(): SelectionStateSlice {
  return useRequiredContext(SelectionStateContext, "useSelectionState");
}

export function useTransportState(): TransportStateSlice {
  return useRequiredContext(TransportStateContext, "useTransportState");
}

export function useViewportState(): ViewportStateSlice {
  return useRequiredContext(ViewportStateContext, "useViewportState");
}

export function useMidiEditorUiState(): MidiEditorStateSlice {
  return useRequiredContext(MidiEditorStateContext, "useMidiEditorUiState");
}
