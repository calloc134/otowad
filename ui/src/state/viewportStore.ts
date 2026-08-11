import type { ProjectAction, ViewportStoreState } from "./projectStoreTypes.ts";
import { DEFAULT_TRACK_HEIGHT } from "../components/editorGeometry.ts";
import { DEFAULT_ZOOM_X } from "./zoomLimits.ts";

export const initialViewportStoreState: ViewportStoreState = {
  zoom: { x: DEFAULT_ZOOM_X, y: DEFAULT_TRACK_HEIGHT },
  scrollX: 0,
  scrollY: 0,
};

export function reduceViewportStore(
  state: ViewportStoreState,
  action: ProjectAction,
): ViewportStoreState {
  switch (action.type) {
    case "SET_ZOOM":
      return { ...state, zoom: { x: action.x, y: action.y } };

    case "SET_SCROLL":
      return { ...state, scrollX: action.x, scrollY: action.y };

    default:
      return state;
  }
}
