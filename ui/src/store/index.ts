export {
  ProjectProvider,
  useProject,
  useProjectActions,
} from "./useProjectStore.tsx";

export type {
  ProjectActions,
} from "./useProjectStore.tsx";

export type {
  BusyTask,
  MidiEditorTarget,
  ProjectState,
} from "@/state/projectStoreTypes.ts";

export type { TimeSelectionRange } from "../utils/timelineInteractions.ts";

export { getTimeSelectionRange } from "@/state/selectionStore.ts";

export {
  useDocumentState,
  useSelectionState,
  useViewportState,
  useTransportState,
  useMidiEditorUiState,
} from "@/state/projectStores.ts";
