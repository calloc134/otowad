import type { MidiEditorStoreState, ProjectAction } from "./projectStoreTypes.ts";

export const initialMidiEditorStoreState: MidiEditorStoreState = {
  midiEditorTarget: null,
};

export function reduceMidiEditorStore(
  state: MidiEditorStoreState,
  action: ProjectAction,
): MidiEditorStoreState {
  switch (action.type) {
    case "OPEN_MIDI_EDITOR":
      return {
        ...state,
        midiEditorTarget: {
          contentId: action.contentId,
          clipId: action.clipId,
        },
      };

    case "CLOSE_MIDI_EDITOR":
      return { ...state, midiEditorTarget: null };

    default:
      return state;
  }
}
