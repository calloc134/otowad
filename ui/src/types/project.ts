// =============================================================================
// TypeScript mirrors of Rust Edit types (core/src/edit.rs, ids.rs, time.rs, commands.rs)
//
// These types match the JSON serialization format produced by serde.
// ID newtypes use #[serde(transparent)] so they serialize as plain UUID strings.
// Tagged enums use the discriminator field noted in each Rust type.
//
// IMPORTANT: Collections use arrays (Vec in Rust), NOT Record/Map.
// Order is semantic (tracks: UI order, clips/contents/media: creation order).
// =============================================================================

// ---------------------------------------------------------------------------
// IDs (serde(transparent) over Uuid -> plain string in JSON)
// ---------------------------------------------------------------------------

/** UUID string. All domain IDs are branded via type aliases for safety. */
export type TrackId = string;
export type ClipId = string;
export type ContentId = string;
export type MediaId = string;
export type FxId = string;
export type AutomationId = string;
export type AnalysisId = string;
export type PitchLinkId = string;
export type NoteId = string;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Musical time in ticks. serde(transparent) -> plain number in JSON. */
export type Tick = number;

/** Source frame (media sample rate). serde(transparent) -> plain number in JSON. */
export type SrcFrame = number;

export const DEFAULT_PPQ = 960;

export interface TimeSignature {
  num: number;
  den: number;
}

export interface TempoPointEdit {
  at: Tick;
  /** BPM in micro-BPM (e.g. 120 BPM = 120_000_000). */
  micro_bpm: number;
  time_sig: TimeSignature;
}

export interface TempoMapEdit {
  ppq: number;
  points: TempoPointEdit[];
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * GridDivision: externally tagged enum in serde (default for enums without
 * `#[serde(tag)]`). Unit variants serialize as strings, struct variants as
 * `{ "Triplet": { "base": 8 } }`.
 */
export type GridDivision =
  | "Beat"
  | "Half"
  | "Quarter"
  | "Eighth"
  | "Sixteenth"
  | "ThirtySecond"
  | { Triplet: { base: number } }
  | { Dotted: { base: number } };

export interface GridSettings {
  snap_enabled: boolean;
  division: GridDivision;
  /** Swing in permille (0..1000). */
  swing_permille: number;
  /** Magnet range in permille of grid unit (250 = +/-25%). */
  magnet_range_permille: number;
  /** Snap strength in permille (0..1000). */
  snap_strength_permille: number;
}

// ---------------------------------------------------------------------------
// Project document (top-level serialization unit)
// ---------------------------------------------------------------------------

export interface ProjectDocument {
  schema_version: 4;
  meta: ProjectMeta;
  edit: ProjectEdit;
}

export interface ProjectMeta {
  name: string;
  created_at: string;
  app_version: string;
  /** Project-wide sample rate (Hz). */
  project_sample_rate: number;
  /** PPQ. Must match edit.tempo.ppq. */
  ppq: number;
}

/**
 * Edit aggregate root.
 * All main collections are arrays (Vec), not maps.
 * Order is semantic.
 */
export interface ProjectEdit {
  tempo: TempoMapEdit;
  grid: GridSettings;
  /** Track definitions. Order = UI top-to-bottom. */
  tracks: TrackEdit[];
  /** Media assets. Order = creation order. */
  media: MediaAsset[];
  /** Content pool. Order = creation order. */
  contents: ContentEdit[];
  /** Clip pool. Order = creation order. Ownership via clip.track_id. */
  clips: ClipEdit[];
  routing: RoutingEdit;
  /** Automation lanes. Order = creation order. */
  automation: AutomationLane[];
  /** MIDI -> Audio pitch follow links. Order = creation order. */
  pitch_links: MidiToAudioPitchLink[];
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaAsset {
  id: MediaId;
  /** Relative path inside the zip archive. */
  in_zip_path: string;
  channels: number;
  /** Source sample rate of the media file. */
  src_sample_rate: number;
  /** Length in source frames. */
  length_src_frames: number;
  /** File hash for integrity (optional). */
  hash: string | null;
  /** Original file name before import (optional). */
  original_name: string | null;
}

// ---------------------------------------------------------------------------
// Content -- #[serde(tag = "type", rename_all = "snake_case")]
// ---------------------------------------------------------------------------

export type ContentEdit = AudioContentEdit | MidiContentEdit;

export interface AudioContentEdit {
  type: "audio";
  id: ContentId;
  media_id: MediaId;
  /** References to analysis artifacts (F0, waveform peaks, pitch marks, etc.) */
  analysis_refs: AnalysisId[];
}

export interface MidiContentEdit {
  type: "midi";
  id: ContentId;
  /** Notes sorted by: start asc -> key asc -> length asc. */
  notes: MidiNote[];
  ccs: MidiCc[];
}

export interface MidiNote {
  id: NoteId;
  start: Tick;
  length: Tick;
  key: number;
  vel: number;
}

export interface MidiCc {
  at: Tick;
  cc: number;
  value: number;
}

// ---------------------------------------------------------------------------
// Track -- TrackKind uses #[serde(tag = "track_type", rename_all = "snake_case")]
// ---------------------------------------------------------------------------

export interface TrackEdit {
  id: TrackId;
  name: string;
  kind: TrackKind;
  mute: boolean;
  solo: boolean;
  /** Gain in milli-dB (0 = unity, 6000 = +6dB). */
  gain_milli_db: number;
  /** Pan in permille (-1000..1000). */
  pan_permille: number;
  fx_chain: FxSlotEdit[];
  routing: TrackRoutingEdit;
}

export type TrackKind = AudioTrackKind | MidiTrackKind;

export interface AudioTrackKind {
  track_type: "audio";
}

export interface MidiTrackKind {
  track_type: "midi";
  audition_instrument: InstrumentRef | null;
  render_enabled: boolean;
}

export interface InstrumentRef {
  plugin_id: string;
  preset: string | null;
}

// ---------------------------------------------------------------------------
// Clip -- ClipKind uses #[serde(tag = "clip_type", rename_all = "snake_case")]
//
// Ownership: clip.track_id is the sole ownership field.
// Track does NOT store clip_ids.
// ---------------------------------------------------------------------------

export interface ClipEdit {
  id: ClipId;
  /** The owning track. Single source of truth for clip-to-track membership. */
  track_id: TrackId;
  start: Tick;
  length: Tick;
  /** Lane for overlapping clips. v1: usually 0. */
  lane: number;
  muted: boolean;
  /** Clip gain in milli-dB. */
  gain_milli_db: number;
  kind: ClipKind;
}

export type ClipKind = AudioClipKind | MidiClipKind;

export interface AudioClipKind {
  clip_type: "audio";
  content_id: ContentId;
  audio: AudioClipEdit;
}

export interface MidiClipKind {
  clip_type: "midi";
  content_id: ContentId;
  midi: MidiClipEdit;
}

export interface AudioClipEdit {
  /** Source start frame (SrcFrame basis). */
  src_in: SrcFrame;
  /** Source end frame (SrcFrame basis). Must be > src_in. */
  src_out: SrcFrame;
  warp: WarpMapEdit;
  pitch: PitchControlEdit;
  fades: FadesEdit;
  time_pitch: TimePitchModeEdit;
}

/** MIDI clip content window. Invariant: clip.length == content_out - content_in. */
export interface MidiClipEdit {
  content_in: Tick;
  content_out: Tick;
  transpose_semitones: number;
}

// ---------------------------------------------------------------------------
// Warp -- #[serde(tag = "warp_type", rename_all = "snake_case")]
// ---------------------------------------------------------------------------

export type WarpMapEdit = WarpNone | WarpAnchors;

export interface WarpNone {
  warp_type: "none";
}

export interface WarpAnchors {
  warp_type: "anchors";
  anchors: WarpAnchorEdit[];
}

export interface WarpAnchorEdit {
  at_in_clip: Tick;
  src_frame: SrcFrame;
}

// ---------------------------------------------------------------------------
// Pitch control
// ---------------------------------------------------------------------------

export interface PitchControlEdit {
  mode: PitchControlMode;
  /** Manual coarse adjustment in semitones. */
  manual_coarse_semitones: number;
  /** Manual fine adjustment in cents (-99..99). */
  manual_fine_cents: number;
}

export type PitchControlMode = "ManualOnly" | "FollowMidiOnly" | "ManualPlusFollow";

export interface FadesEdit {
  fade_in: Tick;
  fade_out: Tick;
}

type VoiceAnalysisModeEdit = "Local" | "Source";

export type TimePitchModeKind = TimePitchModeEdit["mode"];

export type TimePitchModeEdit =
  | {
      mode: "Voice";
      analysis: VoiceAnalysisModeEdit;
      preserve_formant: boolean;
    }
  | { mode: "Music" };

export type TimePitchSelection = "Local" | "Voice" | "Music";

// ---------------------------------------------------------------------------
// FX / Routing
// ---------------------------------------------------------------------------

export interface FxSlotEdit {
  id: FxId;
  plugin_id: string;
  enabled: boolean;
  /** Parameters as fixed-point integers. */
  params: Record<string, number>;
}

export interface TrackRoutingEdit {
  output: BusTarget;
  sends: SendEdit[];
}

/** #[serde(tag = "bus", rename_all = "snake_case")] */
export type BusTarget = BusMaster | BusTrack;

export interface BusMaster {
  bus: "master";
}

export interface BusTrack {
  bus: "track";
  track: TrackId;
}

export interface SendEdit {
  target: BusTarget;
  /** Send level in milli-dB. */
  level_milli_db: number;
  pre_fader: boolean;
}

export interface RoutingEdit {
  schema_hint: string | null;
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export interface AutomationLane {
  id: AutomationId;
  target: AutomationTarget;
  /** Points sorted by at ascending. */
  points: AutomationPoint[];
}

export interface AutomationPoint {
  at: Tick;
  /** Value as fixed-point integer. */
  value: number;
  curve: CurveShape;
}

/** CurveShape: plain enum without #[serde(tag)], externally tagged as string. */
export type CurveShape = "Hold" | "Linear";

/** #[serde(tag = "target", rename_all = "snake_case")] */
export type AutomationTarget =
  | AutomationTargetTrackParam
  | AutomationTargetFxParam
  | AutomationTargetClipParam;

export interface AutomationTargetTrackParam {
  target: "track_param";
  track: TrackId;
  param: TrackParam;
}

export interface AutomationTargetFxParam {
  target: "fx_param";
  track: TrackId;
  fx_id: FxId;
  param: string;
}

export interface AutomationTargetClipParam {
  target: "clip_param";
  clip: ClipId;
  param: ClipParam;
}

/** Plain enum -> string */
export type TrackParam = "Gain" | "Pan" | "Mute";

/** Plain enum -> string */
export type ClipParam = "Gain" | "Mute" | "PitchCents";

// ---------------------------------------------------------------------------
// MIDI -> Audio pitch follow
// ---------------------------------------------------------------------------

export interface MidiToAudioPitchLink {
  id: PitchLinkId;
  midi_track: TrackId;
  audio_track: TrackId;
  no_note_behavior: NoNoteBehavior;
  no_pitch_behavior: NoPitchBehavior;
  priority: NotePriority;
}

/** Plain enum -> string */
export type NoNoteBehavior = "KeepOriginal" | "HoldLast";

/** Plain enum -> string */
export type NoPitchBehavior = "Bypass" | "HoldLast";

/** Plain enum -> string */
export type NotePriority = "Highest" | "Lowest" | "Latest";

// ---------------------------------------------------------------------------
// Analysis Artifacts (spec section 10)
// ---------------------------------------------------------------------------

export interface CreatedBy {
  app_version: string;
  algo_version: string;
  params_hash: string;
}

export interface PeakPair {
  min: number;
  max: number;
}

export interface WaveformLevel {
  window_size_src_frames: number;
  /** Per-channel array of (min, max) peak pairs. */
  peaks_per_channel: PeakPair[][];
}

export interface WaveformPeaksArtifact {
  kind: "waveform_peaks";
  schema_version: number;
  media_id: MediaId;
  src_sample_rate: number;
  created_by: CreatedBy;
  channels: number;
  levels: WaveformLevel[];
}

export interface F0TrackArtifact {
  kind: "f0_track";
  schema_version: number;
  media_id: MediaId;
  src_sample_rate: number;
  created_by: CreatedBy;
  /** Hop size in source frames between consecutive F0 estimates. */
  hop_src_frames: number;
  /** F0 in Hz * 100 (fixed-point). Unvoiced frames = -1. */
  f0_hz_x100: number[];
  /** Voiced probability in permille [0..1000]. Optional. */
  voiced_prob_permille: number[] | null;
  method: string;
  params: string;
}

export interface PitchMarkFeature {
  transient_value: number;
  onset_value: number;
  cycle_energy: number;
  tonality: number;
  confidence: number;
  local_pitch_hz_x100?: number | null;
  epoch_strength?: number | null;
  gci_quality?: number | null;
  left_period_samples?: number | null;
  right_period_samples?: number | null;
  excitation_balance?: number | null;
  expression_baseline_hz_x100?: number | null;
  expression_deviation_cents?: number | null;
}

export interface PitchMarksArtifact {
  kind: "pitch_marks";
  schema_version: number;
  media_id: MediaId;
  src_sample_rate: number;
  created_by: CreatedBy;
  /** Pitch mark positions in source frames. */
  marks_src_frames: number[];
  /** Optional on legacy artifacts; normalizeAnalysisArtifact fills [] when missing. */
  mark_features?: PitchMarkFeature[];
  mark_policy: string;
  params: string;
}

export type AnalysisArtifact = WaveformPeaksArtifact | F0TrackArtifact | PitchMarksArtifact;

// ---------------------------------------------------------------------------
// Compiled pitch plan DTO (WASM compile output for playback/export)
// ---------------------------------------------------------------------------

export interface CompiledAudioClipPlan {
  clip_id: ClipId;
  track_id: TrackId;
  start_frame: number;
  end_frame: number;
  src_in_frame: number;
  src_out_frame: number;
  warp_plan: CompiledWarpPlan;
}

export interface CompiledWarpSegmentPlan {
  dst_start_frame: number;
  dst_end_frame: number;
  src_start_frame: number;
  src_end_frame: number;
}

export interface CompiledWarpPlan {
  kind: "linear" | "piecewise";
  segments: CompiledWarpSegmentPlan[];
}

export interface CompiledPitchSegmentPlan {
  clip_id: ClipId;
  audio_track: TrackId;
  start_frame: number;
  end_frame: number;
  shift_cents: number;
}

export interface CompiledPitchPlan {
  sample_rate: number;
  audio_clips: CompiledAudioClipPlan[];
  pitch_plan: CompiledPitchSegmentPlan[];
}

// =============================================================================
// Command -- #[serde(tag = "command", rename_all = "snake_case")]
// =============================================================================

export type Command =
  | { command: "batch"; commands: Command[] }
  | { command: "rename_project"; name: string }
  | { command: "set_bpm"; micro_bpm: number }
  | { command: "set_bpm_preserve_seconds"; micro_bpm: number }
  | { command: "set_time_signature"; time_sig: TimeSignature }
  | { command: "set_grid_settings"; grid: GridSettings }
  | { command: "add_track"; track: TrackEdit }
  | { command: "remove_track"; id: TrackId }
  | { command: "move_track"; id: TrackId; new_index: number }
  | { command: "set_track_name"; id: TrackId; name: string }
  | { command: "set_track_mute"; id: TrackId; mute: boolean }
  | { command: "set_track_solo"; id: TrackId; solo: boolean }
  | { command: "set_track_gain"; id: TrackId; gain_milli_db: number }
  | { command: "set_track_pan"; id: TrackId; pan_permille: number }
  | { command: "add_media_asset"; asset: MediaAsset }
  | { command: "add_content"; content: ContentEdit }
  | { command: "add_clip"; clip: ClipEdit }
  | { command: "remove_clip"; clip_id: ClipId }
  | { command: "move_clip"; clip_id: ClipId; new_start: Tick }
  | { command: "move_clip_to_track"; clip_id: ClipId; new_track_id: TrackId }
  | { command: "set_clip_gain"; clip_id: ClipId; gain_milli_db: number }
  | { command: "set_clip_mute"; clip_id: ClipId; muted: boolean }
  | { command: "set_pitch_coarse"; clip_id: ClipId; semitones: number }
  | { command: "set_pitch_fine"; clip_id: ClipId; cents: number }
  | { command: "set_pitch_mode"; clip_id: ClipId; mode: PitchControlMode }
  | {
      command: "set_time_pitch";
      clip_id: ClipId;
      time_pitch: TimePitchModeEdit;
    }
  | { command: "add_midi_note"; content_id: ContentId; note: MidiNote }
  | { command: "remove_midi_note"; content_id: ContentId; note_id: NoteId }
  | { command: "add_pitch_link"; link: MidiToAudioPitchLink }
  | { command: "remove_pitch_link"; id: PitchLinkId }
  | {
      command: "split_clip";
      clip_id: ClipId;
      tick_in_clip: Tick;
      new_clip_id: ClipId;
    }
  | {
      command: "audio_red_trim";
      clip_id: ClipId;
      new_src_in: SrcFrame;
      new_src_out: SrcFrame;
      new_start: Tick;
      new_length: Tick;
    }
  | {
      command: "audio_blue_stretch";
      clip_id: ClipId;
      new_start: Tick;
      new_length: Tick;
    }
  | {
      command: "midi_red_trim";
      clip_id: ClipId;
      new_start: Tick;
      new_content_in: Tick;
      new_content_out: Tick;
    }
  | { command: "set_midi_transpose"; clip_id: ClipId; semitones: number }
  | {
      command: "add_warp_anchor_at_tick";
      clip_id: ClipId;
      tick_in_clip: Tick;
    };

export type InternalCommand =
  | { command: "batch"; commands: InternalCommand[] }
  | { command: "resize_clip"; clip_id: ClipId; new_length: Tick }
  | {
      command: "set_audio_source_range";
      clip_id: ClipId;
      src_in: SrcFrame;
      src_out: SrcFrame;
    }
  | { command: "add_warp_anchor"; clip_id: ClipId; anchor: WarpAnchorEdit }
  | { command: "remove_warp_anchor"; clip_id: ClipId; index: number }
  | {
      command: "set_midi_content_window";
      clip_id: ClipId;
      content_in: Tick;
      content_out: Tick;
    }
  | { command: "_remove_media_asset"; id: MediaId }
  | {
      command: "_restore_media_asset";
      asset: MediaAsset;
      index: number;
    }
  | { command: "_remove_content"; id: ContentId }
  | {
      command: "_restore_content";
      content: ContentEdit;
      index: number;
    }
  | {
      command: "_restore_track";
      track: TrackEdit;
      index: number;
      clips: { index: number; clip: ClipEdit }[];
      pitch_links: { index: number; link: MidiToAudioPitchLink }[];
    }
  | { command: "_restore_track_name"; id: TrackId; name: string }
  | { command: "_restore_clip"; clip: ClipEdit; index: number }
  | {
      command: "_restore_midi_note";
      content_id: ContentId;
      notes: MidiNote[];
    }
  | {
      command: "_restore_warp_anchor";
      clip_id: ClipId;
      index: number;
      anchor: WarpAnchorEdit;
    }
  | {
      command: "_restore_pitch_link";
      link: MidiToAudioPitchLink;
      index: number;
    }
  | {
      command: "_restore_bpm_preserve_seconds_state";
      tempo: TempoMapEdit;
      contents: ContentEdit[];
      clips: ClipEdit[];
      automation: AutomationLane[];
    }
  | {
      command: "_set_clip_state";
      clip: ClipEdit;
    }
  | {
      command: "_restore_pitch_control";
      clip_id: ClipId;
      coarse: number;
      fine: number;
    }
  | {
      command: "_unsplit_clip";
      original_clip: ClipEdit;
      right_clip_id: ClipId;
    };

export type AnyCommand = Command | InternalCommand;
