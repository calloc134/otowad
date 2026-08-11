import type { ClipId, ContentId, TrackId } from "@/types";
import type { ClipSelectionMode } from "@/utils/timelineInteractions";

export type SelectionCommand =
  | { type: "clear_selection" }
  | { type: "select_track"; trackId: TrackId | null }
  | { type: "set_clip_selection"; clipIds: ClipId[]; primaryClipId: ClipId | null }
  | {
      type: "select_clip";
      clipId: ClipId;
      toggle: boolean;
      clickTick?: number;
      selectionMode?: ClipSelectionMode;
    }
  | { type: "select_notes"; noteIndices: number[] };

export type ViewportCommand =
  | { type: "set_playhead"; tick: number }
  | { type: "set_zoom"; x: number; y: number }
  | { type: "set_scroll"; x: number; y: number }
  | { type: "set_time_selection"; startTick: number | null; endTick: number | null };

export type EditCommand =
  | { type: "delete_clip"; clipId: ClipId }
  | { type: "duplicate_clip"; clipId: ClipId }
  | { type: "split_clip"; clipId: ClipId; tickInClip: number }
  | { type: "change_pitch"; clipId: ClipId; delta: number; precision: "coarse" | "fine" }
  | { type: "open_midi_editor"; contentId: ContentId; clipId: ClipId }
  | { type: "toggle_track_mute"; trackId: TrackId }
  | { type: "toggle_track_solo"; trackId: TrackId }
  | { type: "set_track_gain"; trackId: TrackId; gainMilliDb: number }
  | { type: "set_track_pan"; trackId: TrackId; panPermille: number }
  | { type: "delete_track"; trackId: TrackId }
  | { type: "rename_track"; trackId: TrackId; name: string }
  | { type: "reorder_track"; trackId: TrackId; targetIndex: number };
