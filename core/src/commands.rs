use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::edit::*;
use crate::ids::*;
use crate::time::*;
use crate::warp::FullWarp;

// =============================================================================
// Command enum
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PositionedClip {
    pub index: usize,
    pub clip: ClipEdit,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PositionedPitchLink {
    pub index: usize,
    pub link: MidiToAudioPitchLink,
}

/// A single atomic edit operation on the project.
/// Each variant carries exactly the data needed to apply and to construct its inverse.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    // -- Project metadata --
    /// Rename the project document. Mutates `ProjectDocument.meta.name`;
    /// must be dispatched via `apply_project_command`.
    RenameProject {
        name: String,
    },

    // -- Tempo --
    SetBpm {
        /// BPM in micro-BPM (120 BPM = 120_000_000).
        micro_bpm: i64,
    },
    SetBpmPreserveSeconds {
        /// BPM in micro-BPM (120 BPM = 120_000_000).
        micro_bpm: i64,
    },
    SetTimeSignature {
        time_sig: TimeSignature,
    },
    SetGridSettings {
        grid: GridSettings,
    },

    // -- Track --
    AddTrack {
        track: TrackEdit,
    },
    RemoveTrack {
        id: TrackId,
    },
    MoveTrack {
        id: TrackId,
        new_index: usize,
    },
    SetTrackName {
        id: TrackId,
        name: String,
    },
    SetTrackMute {
        id: TrackId,
        mute: bool,
    },
    SetTrackSolo {
        id: TrackId,
        solo: bool,
    },
    SetTrackGain {
        id: TrackId,
        gain_milli_db: i32,
    },
    SetTrackPan {
        id: TrackId,
        pan_permille: i32,
    },

    // -- Media --
    AddMediaAsset {
        asset: MediaAsset,
    },

    // -- Content --
    AddContent {
        content: ContentEdit,
    },

    // -- Clip --
    AddClip {
        clip: ClipEdit,
    },
    RemoveClip {
        clip_id: ClipId,
    },
    MoveClip {
        clip_id: ClipId,
        new_start: Tick,
    },
    /// Move clip to a different track (same-kind only).
    MoveClipToTrack {
        clip_id: ClipId,
        new_track_id: TrackId,
    },
    ResizeClip {
        clip_id: ClipId,
        new_length: Tick,
    },
    SetAudioSourceRange {
        clip_id: ClipId,
        src_in: SrcFrame,
        src_out: SrcFrame,
    },
    SetClipGain {
        clip_id: ClipId,
        gain_milli_db: i32,
    },
    SetClipMute {
        clip_id: ClipId,
        muted: bool,
    },

    // -- Warp anchors --
    AddWarpAnchor {
        clip_id: ClipId,
        anchor: WarpAnchorEdit,
    },
    RemoveWarpAnchor {
        clip_id: ClipId,
        index: usize,
    },

    // -- Pitch control --
    SetPitchCoarse {
        clip_id: ClipId,
        semitones: i16,
    },
    SetPitchFine {
        clip_id: ClipId,
        cents: i16,
    },
    SetPitchMode {
        clip_id: ClipId,
        mode: PitchControlMode,
    },
    SetTimePitch {
        clip_id: ClipId,
        time_pitch: TimePitchModeEdit,
    },

    // -- MIDI notes --
    AddMidiNote {
        content_id: ContentId,
        note: MidiNote,
    },
    RemoveMidiNote {
        content_id: ContentId,
        note_id: NoteId,
    },

    // -- MIDI clip content window --
    SetMidiContentWindow {
        clip_id: ClipId,
        content_in: Tick,
        content_out: Tick,
    },
    SetMidiTranspose {
        clip_id: ClipId,
        semitones: i16,
    },

    // -- Pitch links --
    AddPitchLink {
        link: MidiToAudioPitchLink,
    },
    RemovePitchLink {
        id: PitchLinkId,
    },

    // -- Command composition --
    Batch {
        commands: Vec<Command>,
    },

    // -- Atomic operations --
    /// Atomic split of a clip at a given tick position within the clip.
    SplitClip {
        clip_id: ClipId,
        /// Tick offset within the clip where the split occurs.
        tick_in_clip: Tick,
        /// Pre-generated ID for the new (right) clip.
        new_clip_id: ClipId,
    },
    /// Atomic red-trim operation: adjusts source window and clip length/start together.
    /// Preserves playback speed. The fixed end stays in place.
    AudioRedTrim {
        clip_id: ClipId,
        new_src_in: SrcFrame,
        new_src_out: SrcFrame,
        new_start: Tick,
        new_length: Tick,
    },
    /// Atomic blue-stretch operation: adjusts clip start/length while preserving source bounds.
    AudioBlueStretch {
        clip_id: ClipId,
        new_start: Tick,
        new_length: Tick,
    },
    /// Atomic red-trim for MIDI clips: adjusts content window and clip start together.
    MidiRedTrim {
        clip_id: ClipId,
        new_start: Tick,
        new_content_in: Tick,
        new_content_out: Tick,
    },
    /// Add a warp anchor using the clip's current time map at a clip-local tick.
    AddWarpAnchorAtTick {
        clip_id: ClipId,
        tick_in_clip: Tick,
    },

    // == Internal inverse-only variants ==
    /// Inverse of AddMediaAsset.
    #[serde(rename = "_remove_media_asset")]
    RemoveMediaAsset {
        id: MediaId,
    },
    /// Inverse of RemoveMediaAsset.
    #[serde(rename = "_restore_media_asset")]
    RestoreMediaAsset {
        asset: MediaAsset,
        index: usize,
    },
    /// Inverse of AddContent.
    #[serde(rename = "_remove_content")]
    RemoveContent {
        id: ContentId,
    },
    /// Inverse of RemoveContent.
    #[serde(rename = "_restore_content")]
    RestoreContent {
        content: ContentEdit,
        index: usize,
    },
    /// Inverse of RemoveTrack: re-inserts a fully populated track.
    #[serde(rename = "_restore_track")]
    RestoreTrack {
        track: TrackEdit,
        index: usize,
        /// Clips that belonged to this track, with their creation-order positions.
        clips: Vec<PositionedClip>,
        /// Pitch links that referenced this track, with their creation-order positions.
        pitch_links: Vec<PositionedPitchLink>,
    },
    /// Inverse of SetTrackName.
    #[serde(rename = "_restore_track_name")]
    RestoreTrackName {
        id: TrackId,
        name: String,
    },
    /// Inverse of RemoveClip.
    #[serde(rename = "_restore_clip")]
    RestoreClip {
        clip: ClipEdit,
        index: usize,
    },
    /// Inverse-only swap for clip-local complex geometry changes.
    #[serde(rename = "_set_clip_state")]
    SetClipState {
        clip: ClipEdit,
    },
    /// Inverse-only restore for the complete manual pitch state. Forward pitch
    /// commands normalize coarse/fine together, so restoring only the field
    /// they wrote would lose normalization carry.
    #[serde(rename = "_restore_pitch_control")]
    RestorePitchControl {
        clip_id: ClipId,
        coarse: i16,
        fine: i16,
    },
    /// Inverse-only swap for the complete MIDI note collection. A full
    /// snapshot preserves exact undo/redo state even if save normalization
    /// reordered notes between operations.
    #[serde(rename = "_restore_midi_note")]
    RestoreMidiNote {
        content_id: ContentId,
        notes: Vec<MidiNote>,
    },
    /// Inverse of RemoveWarpAnchor.
    #[serde(rename = "_restore_warp_anchor")]
    RestoreWarpAnchor {
        clip_id: ClipId,
        index: usize,
        anchor: WarpAnchorEdit,
    },
    /// Inverse of RemovePitchLink.
    #[serde(rename = "_restore_pitch_link")]
    RestorePitchLink {
        link: MidiToAudioPitchLink,
        index: usize,
    },
    /// Inverse-only restore for preserve-seconds BPM changes.
    #[serde(rename = "_restore_bpm_preserve_seconds_state")]
    RestoreBpmPreserveSecondsState {
        tempo: TempoMapEdit,
        contents: Vec<ContentEdit>,
        clips: Vec<ClipEdit>,
        automation: Vec<AutomationLane>,
    },
    /// Inverse of SplitClip: removes the right clip and restores the original.
    #[serde(rename = "_unsplit_clip")]
    UnsplitClip {
        /// The original clip state before split.
        original_clip: ClipEdit,
        /// The ID of the right clip that was created.
        right_clip_id: ClipId,
    },
}

// =============================================================================
// CommandError
// =============================================================================

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("unsupported schema_version: {0}")]
    UnsupportedSchemaVersion(u32),

    #[error("track not found: {0:?}")]
    TrackNotFound(TrackId),

    #[error("track already exists: {0:?}")]
    TrackAlreadyExists(TrackId),

    #[error("invalid track name: {reason}")]
    InvalidTrackName { reason: &'static str },

    #[error("clip not found: {0:?}")]
    ClipNotFound(ClipId),

    #[error("clip already exists: {0:?}")]
    ClipAlreadyExists(ClipId),

    #[error("content not found: {0:?}")]
    ContentNotFound(ContentId),

    #[error("content already exists: {0:?}")]
    ContentAlreadyExists(ContentId),

    #[error("media not found: {0:?}")]
    MediaNotFound(MediaId),

    #[error("media already exists: {0:?}")]
    MediaAlreadyExists(MediaId),

    #[error("micro_bpm must be positive, got {0}")]
    InvalidBpm(i64),

    #[error("invalid time signature: {num}/{den}")]
    InvalidTimeSignature { num: u8, den: u8 },

    #[error("grid setting {field} must be <= {max}, got {value}")]
    InvalidGridSetting {
        field: &'static str,
        value: u16,
        max: u16,
    },

    #[error("grid division base must be positive")]
    InvalidGridDivisionBase,

    #[error("invalid audio source range: src_in={src_in:?} >= src_out={src_out:?}")]
    InvalidAudioSourceRange { src_in: SrcFrame, src_out: SrcFrame },

    #[error("clip {0:?} is not an audio clip")]
    NotAudioClip(ClipId),

    #[error("clip {0:?} is not a MIDI clip")]
    NotMidiClip(ClipId),

    #[error("content {0:?} is not MIDI content")]
    NotMidiContent(ContentId),

    #[error("MIDI note not found: {0:?}")]
    MidiNoteNotFound(NoteId),

    #[error("MIDI note already exists: {0:?}")]
    MidiNoteAlreadyExists(NoteId),

    #[error("invalid MIDI note {note:?}: {field}={value}")]
    InvalidMidiNote {
        note: NoteId,
        field: &'static str,
        value: i64,
    },

    #[error("index {index} out of bounds (len={len})")]
    IndexOutOfBounds { index: usize, len: usize },

    #[error("pitch link not found: {0:?}")]
    PitchLinkNotFound(PitchLinkId),

    #[error("pitch link already exists: {0:?}")]
    PitchLinkAlreadyExists(PitchLinkId),

    #[error("pitch link source is not a MIDI track: {0:?}")]
    PitchLinkSourceNotMidi(TrackId),

    #[error("pitch link target is not an audio track: {0:?}")]
    PitchLinkTargetNotAudio(TrackId),

    #[error("audio track already has a pitch link: {0:?}")]
    DuplicatePitchLinkForAudioTrack(TrackId),

    #[error("nothing to undo")]
    NothingToUndo,

    #[error("nothing to redo")]
    NothingToRedo,

    #[error("tempo map is empty")]
    EmptyTempoMap,

    #[error("tempo map with {point_count} points is not supported by this command")]
    UnsupportedTempoMapPointCount { point_count: usize },

    #[error("track kind mismatch: cannot move clip to track of different kind")]
    TrackKindMismatch,

    #[error(
        "invalid MIDI content window: content_in={content_in:?} >= content_out={content_out:?}"
    )]
    InvalidMidiWindow { content_in: Tick, content_out: Tick },

    #[error("split crosses MIDI note in clip {0:?}")]
    SplitCrossesMidiNote(ClipId),

    #[error("invalid split position in clip {0:?}")]
    InvalidSplitPosition(ClipId),

    #[error("MIDI trim crosses note in clip {clip:?}")]
    MidiTrimCrossesNote { clip: ClipId },

    #[error("source range exceeds media length for clip {clip:?}")]
    SourceRangeExceedsMedia { clip: ClipId },

    #[error("clip length must be > 0 for clip {clip:?}, got {length:?}")]
    InvalidClipLength { clip: ClipId, length: Tick },

    #[error("invalid fade range for clip {clip:?}")]
    InvalidFadeRange { clip: ClipId },

    #[error("invalid warp anchor for clip {clip:?}")]
    InvalidWarpAnchor { clip: ClipId },

    #[error("invalid audio trim geometry for clip {clip:?}")]
    InvalidAudioTrimGeometry { clip: ClipId },

    #[error("invalid project name: {reason}")]
    InvalidProjectName { reason: &'static str },

    #[error("{0} must be dispatched via apply_project_command, not apply_command")]
    RequiresProjectContext(&'static str),
}

impl CommandError {
    /// Stable, machine-readable code for this error variant.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedSchemaVersion(_) => "UNSUPPORTED_SCHEMA_VERSION",
            Self::TrackNotFound(_) => "TRACK_NOT_FOUND",
            Self::TrackAlreadyExists(_) => "TRACK_ALREADY_EXISTS",
            Self::InvalidTrackName { .. } => "INVALID_TRACK_NAME",
            Self::ClipNotFound(_) => "CLIP_NOT_FOUND",
            Self::ClipAlreadyExists(_) => "CLIP_ALREADY_EXISTS",
            Self::ContentNotFound(_) => "CONTENT_NOT_FOUND",
            Self::ContentAlreadyExists(_) => "CONTENT_ALREADY_EXISTS",
            Self::MediaNotFound(_) => "MEDIA_NOT_FOUND",
            Self::MediaAlreadyExists(_) => "MEDIA_ALREADY_EXISTS",
            Self::InvalidBpm(_) => "INVALID_BPM",
            Self::InvalidTimeSignature { .. } => "INVALID_TIME_SIGNATURE",
            Self::InvalidGridSetting { .. } => "INVALID_GRID_SETTING",
            Self::InvalidGridDivisionBase => "INVALID_GRID_DIVISION_BASE",
            Self::InvalidAudioSourceRange { .. } => "INVALID_AUDIO_SOURCE_RANGE",
            Self::NotAudioClip(_) => "NOT_AUDIO_CLIP",
            Self::NotMidiClip(_) => "NOT_MIDI_CLIP",
            Self::NotMidiContent(_) => "NOT_MIDI_CONTENT",
            Self::MidiNoteNotFound(_) => "MIDI_NOTE_NOT_FOUND",
            Self::MidiNoteAlreadyExists(_) => "MIDI_NOTE_ALREADY_EXISTS",
            Self::InvalidMidiNote { .. } => "INVALID_MIDI_NOTE",
            Self::IndexOutOfBounds { .. } => "INDEX_OUT_OF_BOUNDS",
            Self::PitchLinkNotFound(_) => "PITCH_LINK_NOT_FOUND",
            Self::PitchLinkAlreadyExists(_) => "PITCH_LINK_ALREADY_EXISTS",
            Self::PitchLinkSourceNotMidi(_) => "PITCH_LINK_SOURCE_NOT_MIDI",
            Self::PitchLinkTargetNotAudio(_) => "PITCH_LINK_TARGET_NOT_AUDIO",
            Self::DuplicatePitchLinkForAudioTrack(_) => "DUPLICATE_PITCH_LINK_FOR_AUDIO_TRACK",
            Self::NothingToUndo => "NOTHING_TO_UNDO",
            Self::NothingToRedo => "NOTHING_TO_REDO",
            Self::EmptyTempoMap => "EMPTY_TEMPO_MAP",
            Self::UnsupportedTempoMapPointCount { .. } => "UNSUPPORTED_TEMPO_MAP_POINT_COUNT",
            Self::TrackKindMismatch => "TRACK_KIND_MISMATCH",
            Self::InvalidMidiWindow { .. } => "INVALID_MIDI_WINDOW",
            Self::SplitCrossesMidiNote(_) => "SPLIT_CROSSES_MIDI_NOTE",
            Self::InvalidSplitPosition(_) => "INVALID_SPLIT_POSITION",
            Self::MidiTrimCrossesNote { .. } => "MIDI_TRIM_CROSSES_NOTE",
            Self::SourceRangeExceedsMedia { .. } => "SOURCE_RANGE_EXCEEDS_MEDIA",
            Self::InvalidClipLength { .. } => "INVALID_CLIP_LENGTH",
            Self::InvalidFadeRange { .. } => "INVALID_FADE_RANGE",
            Self::InvalidWarpAnchor { .. } => "INVALID_WARP_ANCHOR",
            Self::InvalidAudioTrimGeometry { .. } => "INVALID_AUDIO_TRIM_GEOMETRY",
            Self::InvalidProjectName { .. } => "INVALID_PROJECT_NAME",
            Self::RequiresProjectContext(_) => "REQUIRES_PROJECT_CONTEXT",
        }
    }
}

// =============================================================================
// Vec-based lookup helpers
// =============================================================================

fn find_track(tracks: &[TrackEdit], id: TrackId) -> Option<usize> {
    tracks.iter().position(|t| t.id == id)
}

fn find_clip(clips: &[ClipEdit], id: ClipId) -> Option<usize> {
    clips.iter().position(|c| c.id == id)
}

fn find_content(contents: &[ContentEdit], id: ContentId) -> Option<usize> {
    contents.iter().position(|c| match c {
        ContentEdit::Audio(a) => a.id == id,
        ContentEdit::Midi(m) => m.id == id,
    })
}

fn find_media(media: &[MediaAsset], id: MediaId) -> Option<usize> {
    media.iter().position(|m| m.id == id)
}

fn find_pitch_link(links: &[MidiToAudioPitchLink], id: PitchLinkId) -> Option<usize> {
    links.iter().position(|l| l.id == id)
}

fn find_midi_note(notes: &[MidiNote], id: NoteId) -> Option<usize> {
    notes.iter().position(|note| note.id == id)
}

fn validate_audio_fades_for_length(
    clip_id: ClipId,
    fades: &FadesEdit,
    length: Tick,
) -> Result<(), CommandError> {
    let total_fade = fades.fade_in.0.checked_add(fades.fade_out.0);
    if fades.fade_in.0 < 0
        || fades.fade_out.0 < 0
        || fades.fade_in.0 > length.0
        || fades.fade_out.0 > length.0
        || !matches!(total_fade, Some(total) if total <= length.0)
    {
        return Err(CommandError::InvalidFadeRange { clip: clip_id });
    }
    Ok(())
}

fn edit_contains_midi_note(edit: &ProjectEdit, id: NoteId) -> bool {
    edit.contents.iter().any(|content| match content {
        ContentEdit::Audio(_) => false,
        ContentEdit::Midi(midi) => find_midi_note(&midi.notes, id).is_some(),
    })
}

fn validate_midi_note(note: &MidiNote) -> Result<(), CommandError> {
    if let Some((field, value)) = invalid_midi_note_value(note) {
        return Err(CommandError::InvalidMidiNote {
            note: note.id,
            field,
            value,
        });
    }
    Ok(())
}

fn validate_midi_notes_for_add(
    edit: &ProjectEdit,
    content: &ContentEdit,
) -> Result<(), CommandError> {
    let ContentEdit::Midi(midi) = content else {
        return Ok(());
    };
    let mut added_ids = std::collections::HashSet::new();
    for note in &midi.notes {
        validate_midi_note(note)?;
        if !added_ids.insert(note.id) || edit_contains_midi_note(edit, note.id) {
            return Err(CommandError::MidiNoteAlreadyExists(note.id));
        }
    }
    Ok(())
}

fn validate_pitch_link_for_add(
    edit: &ProjectEdit,
    link: &MidiToAudioPitchLink,
) -> Result<(), CommandError> {
    if find_pitch_link(&edit.pitch_links, link.id).is_some() {
        return Err(CommandError::PitchLinkAlreadyExists(link.id));
    }

    let midi_track = edit
        .tracks
        .get(
            find_track(&edit.tracks, link.midi_track)
                .ok_or(CommandError::TrackNotFound(link.midi_track))?,
        )
        .expect("find_track returned a valid index");
    if !matches!(&midi_track.kind, TrackKind::Midi { .. }) {
        return Err(CommandError::PitchLinkSourceNotMidi(link.midi_track));
    }

    let audio_track = edit
        .tracks
        .get(
            find_track(&edit.tracks, link.audio_track)
                .ok_or(CommandError::TrackNotFound(link.audio_track))?,
        )
        .expect("find_track returned a valid index");
    if !matches!(&audio_track.kind, TrackKind::Audio) {
        return Err(CommandError::PitchLinkTargetNotAudio(link.audio_track));
    }

    if edit
        .pitch_links
        .iter()
        .any(|existing| existing.audio_track == link.audio_track)
    {
        return Err(CommandError::DuplicatePitchLinkForAudioTrack(
            link.audio_track,
        ));
    }

    Ok(())
}

fn content_id_of(content: &ContentEdit) -> ContentId {
    match content {
        ContentEdit::Audio(a) => a.id,
        ContentEdit::Midi(m) => m.id,
    }
}

/// Get TrackKind discriminant for same-kind check.
fn track_kind_discriminant(kind: &TrackKind) -> u8 {
    match kind {
        TrackKind::Audio => 0,
        TrackKind::Midi { .. } => 1,
    }
}

/// Get clip kind discriminant for same-kind check.
fn clip_kind_discriminant(kind: &ClipKind) -> u8 {
    match kind {
        ClipKind::Audio { .. } => 0,
        ClipKind::Midi { .. } => 1,
    }
}

fn validate_grid_settings(grid: &GridSettings) -> Result<(), CommandError> {
    if grid.swing_permille > 1000 {
        return Err(CommandError::InvalidGridSetting {
            field: "swing_permille",
            value: grid.swing_permille,
            max: 1000,
        });
    }
    if grid.magnet_range_permille > 1000 {
        return Err(CommandError::InvalidGridSetting {
            field: "magnet_range_permille",
            value: grid.magnet_range_permille,
            max: 1000,
        });
    }
    if grid.snap_strength_permille > 1000 {
        return Err(CommandError::InvalidGridSetting {
            field: "snap_strength_permille",
            value: grid.snap_strength_permille,
            max: 1000,
        });
    }

    match grid.division {
        GridDivision::Triplet { base } | GridDivision::Dotted { base } if base == 0 => {
            Err(CommandError::InvalidGridDivisionBase)
        }
        _ => Ok(()),
    }
}

fn validate_time_signature(time_sig: TimeSignature) -> Result<(), CommandError> {
    if time_sig.num == 0 || time_sig.den == 0 || !time_sig.den.is_power_of_two() {
        return Err(CommandError::InvalidTimeSignature {
            num: time_sig.num,
            den: time_sig.den,
        });
    }

    Ok(())
}

const MAX_TRACK_NAME_CHARS: usize = 48;

fn validate_track_name(name: &str) -> Result<(), CommandError> {
    if name.trim().is_empty() {
        return Err(CommandError::InvalidTrackName {
            reason: "name must not be empty",
        });
    }
    if name.trim() != name {
        return Err(CommandError::InvalidTrackName {
            reason: "name must not start or end with spaces",
        });
    }
    if name.chars().count() > MAX_TRACK_NAME_CHARS {
        return Err(CommandError::InvalidTrackName {
            reason: "name must be 48 characters or fewer",
        });
    }
    Ok(())
}

fn validate_fixed_v1_tempo_map(tempo: &TempoMapEdit) -> Result<i64, CommandError> {
    if tempo.points.is_empty() {
        return Err(CommandError::EmptyTempoMap);
    }
    if tempo.points.len() != 1 {
        return Err(CommandError::UnsupportedTempoMapPointCount {
            point_count: tempo.points.len(),
        });
    }

    let micro_bpm = tempo.points[0].micro_bpm;
    if micro_bpm <= 0 {
        return Err(CommandError::InvalidBpm(micro_bpm));
    }

    Ok(micro_bpm)
}

fn rescale_tick_round_half_up(value: i64, new_micro_bpm: i64, old_micro_bpm: i64) -> i64 {
    debug_assert!(value >= 0, "tick-domain values must be non-negative");
    debug_assert!(new_micro_bpm > 0, "new_micro_bpm must be positive");
    debug_assert!(old_micro_bpm > 0, "old_micro_bpm must be positive");

    let numerator = value as i128 * new_micro_bpm as i128;
    let denominator = old_micro_bpm as i128;
    ((numerator + denominator / 2) / denominator) as i64
}

fn rescale_tick(value: Tick, new_micro_bpm: i64, old_micro_bpm: i64) -> Tick {
    Tick(rescale_tick_round_half_up(
        value.0,
        new_micro_bpm,
        old_micro_bpm,
    ))
}

fn round_half_even_ratio(numerator: i128, denominator: i128) -> i128 {
    debug_assert!(denominator > 0, "denominator must be positive");

    let quotient = numerator.div_euclid(denominator);
    let remainder = numerator.rem_euclid(denominator);
    let doubled = remainder * 2;

    if doubled < denominator {
        quotient
    } else if doubled > denominator {
        quotient + 1
    } else if quotient % 2 == 0 {
        quotient
    } else {
        quotient + 1
    }
}

fn add_warp_anchor_at_tick(
    clip_id: ClipId,
    audio: &mut AudioClipEdit,
    clip_length: Tick,
    tick_in_clip: Tick,
) -> Result<usize, CommandError> {
    if tick_in_clip.0 <= 0 || tick_in_clip.0 >= clip_length.0 {
        return Err(CommandError::InvalidWarpAnchor { clip: clip_id });
    }

    let full_warp = FullWarp::from_audio(clip_length, audio);
    let src_frame = full_warp.interpolate(tick_in_clip).0;

    let explicit_anchors = match &mut audio.warp {
        WarpMapEdit::None => {
            audio.warp = WarpMapEdit::Anchors { anchors: vec![] };
            match &mut audio.warp {
                WarpMapEdit::Anchors { anchors } => anchors,
                WarpMapEdit::None => unreachable!(),
            }
        }
        WarpMapEdit::Anchors { anchors } => anchors,
    };

    let insert_index =
        explicit_anchors.partition_point(|anchor| anchor.at_in_clip.0 < tick_in_clip.0);
    if let Some(existing) = explicit_anchors.get(insert_index) {
        if existing.at_in_clip == tick_in_clip {
            return Err(CommandError::InvalidWarpAnchor { clip: clip_id });
        }
    }

    explicit_anchors.insert(
        insert_index,
        WarpAnchorEdit {
            at_in_clip: tick_in_clip,
            src_frame: SrcFrame(src_frame),
        },
    );
    Ok(insert_index)
}

fn scale_warp_anchor_ticks(
    clip_id: ClipId,
    anchors: &[WarpAnchorEdit],
    old_length: Tick,
    new_length: Tick,
) -> Result<Vec<WarpAnchorEdit>, CommandError> {
    if anchors.is_empty() {
        return Ok(vec![]);
    }
    if old_length.0 <= 0 || new_length.0 <= 0 {
        return Err(CommandError::InvalidClipLength {
            clip: clip_id,
            length: new_length,
        });
    }
    let interior_anchor_count = anchors
        .iter()
        .filter(|anchor| anchor.at_in_clip.0 > 0 && anchor.at_in_clip.0 < old_length.0)
        .count() as i64;
    if interior_anchor_count > new_length.0 - 1 {
        return Err(CommandError::InvalidWarpAnchor { clip: clip_id });
    }

    let mut scaled = Vec::with_capacity(anchors.len());
    let mut previous_tick = -1i64;

    for (index, anchor) in anchors.iter().enumerate() {
        let clamped_tick = if anchor.at_in_clip.0 == 0 {
            0
        } else if anchor.at_in_clip.0 == old_length.0 {
            new_length.0
        } else {
            let remaining_interior = anchors[index + 1..]
                .iter()
                .filter(|candidate| {
                    candidate.at_in_clip.0 > 0 && candidate.at_in_clip.0 < old_length.0
                })
                .count() as i64;
            let min_tick = previous_tick + 1;
            let max_tick = new_length.0 - 1 - remaining_interior;
            if min_tick > max_tick {
                return Err(CommandError::InvalidWarpAnchor { clip: clip_id });
            }

            let scaled_tick = round_half_even_ratio(
                anchor.at_in_clip.0 as i128 * new_length.0 as i128,
                old_length.0 as i128,
            ) as i64;
            scaled_tick.clamp(min_tick, max_tick)
        };
        if clamped_tick <= previous_tick {
            return Err(CommandError::InvalidWarpAnchor { clip: clip_id });
        }
        previous_tick = clamped_tick;

        scaled.push(WarpAnchorEdit {
            at_in_clip: Tick(clamped_tick),
            src_frame: anchor.src_frame,
        });
    }

    Ok(scaled)
}

fn validate_midi_window_against_notes(
    midi_content: &MidiContentEdit,
    clip_id: ClipId,
    content_in: Tick,
    content_out: Tick,
) -> Result<(), CommandError> {
    for note in &midi_content.notes {
        let note_end = Tick(note.start.0 + note.length.0);
        if note.start.0 < content_in.0 && note_end.0 > content_in.0 {
            return Err(CommandError::MidiTrimCrossesNote { clip: clip_id });
        }
        if note.start.0 < content_out.0 && note_end.0 > content_out.0 {
            return Err(CommandError::MidiTrimCrossesNote { clip: clip_id });
        }
    }

    Ok(())
}

fn rescale_positive_tick(value: Tick, new_micro_bpm: i64, old_micro_bpm: i64) -> Tick {
    let scaled = rescale_tick(value, new_micro_bpm, old_micro_bpm);
    if value.0 > 0 && scaled.0 <= 0 {
        Tick(1)
    } else {
        scaled
    }
}

fn rescale_midi_content(midi: &mut MidiContentEdit, new_micro_bpm: i64, old_micro_bpm: i64) {
    for note in &mut midi.notes {
        note.start = rescale_tick(note.start, new_micro_bpm, old_micro_bpm);
        note.length = rescale_positive_tick(note.length, new_micro_bpm, old_micro_bpm);
    }

    for cc in &mut midi.ccs {
        cc.at = rescale_tick(cc.at, new_micro_bpm, old_micro_bpm);
    }
}

fn rescale_clip(clip: &mut ClipEdit, new_micro_bpm: i64, old_micro_bpm: i64) {
    clip.start = rescale_tick(clip.start, new_micro_bpm, old_micro_bpm);

    match &mut clip.kind {
        ClipKind::Audio { audio, .. } => {
            clip.length = rescale_positive_tick(clip.length, new_micro_bpm, old_micro_bpm);

            if let WarpMapEdit::Anchors { anchors } = &mut audio.warp {
                for anchor in anchors {
                    anchor.at_in_clip =
                        rescale_tick(anchor.at_in_clip, new_micro_bpm, old_micro_bpm);
                }
            }

            audio.fades.fade_in = rescale_tick(audio.fades.fade_in, new_micro_bpm, old_micro_bpm);
            audio.fades.fade_out = rescale_tick(audio.fades.fade_out, new_micro_bpm, old_micro_bpm);
        }
        ClipKind::Midi { midi, .. } => {
            let new_content_in = rescale_tick(midi.content_in, new_micro_bpm, old_micro_bpm);
            let mut new_content_out = rescale_tick(midi.content_out, new_micro_bpm, old_micro_bpm);
            if new_content_out.0 <= new_content_in.0 {
                new_content_out = Tick(new_content_in.0 + 1);
            }

            midi.content_in = new_content_in;
            midi.content_out = new_content_out;
            clip.length = Tick(new_content_out.0 - new_content_in.0);
        }
    }
}

fn rescale_automation_lane(lane: &mut AutomationLane, new_micro_bpm: i64, old_micro_bpm: i64) {
    for point in &mut lane.points {
        point.at = rescale_tick(point.at, new_micro_bpm, old_micro_bpm);
    }
}

fn rescale_tick_domain_for_bpm_change(
    edit: &mut ProjectEdit,
    new_micro_bpm: i64,
    old_micro_bpm: i64,
) {
    for content in &mut edit.contents {
        if let ContentEdit::Midi(midi) = content {
            rescale_midi_content(midi, new_micro_bpm, old_micro_bpm);
        }
    }

    for clip in &mut edit.clips {
        rescale_clip(clip, new_micro_bpm, old_micro_bpm);
    }

    for lane in &mut edit.automation {
        rescale_automation_lane(lane, new_micro_bpm, old_micro_bpm);
    }
}

fn apply_batch(edit: &mut ProjectEdit, commands: &[Command]) -> Result<Command, CommandError> {
    let mut staged = edit.clone();
    let mut inverses = Vec::with_capacity(commands.len());

    for command in commands {
        inverses.push(apply_command(&mut staged, command)?);
    }

    inverses.reverse();
    *edit = staged;
    Ok(Command::Batch { commands: inverses })
}

// =============================================================================
// Per-command handlers (extracted from apply_command)
//
// The largest match arms below are lifted here so `apply_command` reads as a
// dispatcher. Each handler mirrors the pre-refactor semantics 1:1 — behavior
// is unchanged; only the location and nesting depth differ.
// =============================================================================

fn apply_set_audio_source_range(
    edit: &mut ProjectEdit,
    clip_id: ClipId,
    src_in: SrcFrame,
    src_out: SrcFrame,
) -> Result<Command, CommandError> {
    if src_in.0 >= src_out.0 {
        return Err(CommandError::InvalidAudioSourceRange { src_in, src_out });
    }
    let idx = find_clip(&edit.clips, clip_id).ok_or(CommandError::ClipNotFound(clip_id))?;
    match &mut edit.clips[idx].kind {
        ClipKind::Audio {
            audio, content_id, ..
        } => {
            let content_idx = find_content(&edit.contents, *content_id)
                .ok_or(CommandError::ContentNotFound(*content_id))?;
            if let ContentEdit::Audio(ac) = &edit.contents[content_idx] {
                let media_idx = find_media(&edit.media, ac.media_id)
                    .ok_or(CommandError::MediaNotFound(ac.media_id))?;
                if src_out.0 > edit.media[media_idx].length_src_frames {
                    return Err(CommandError::SourceRangeExceedsMedia { clip: clip_id });
                }
            }
            let old_in = audio.src_in;
            let old_out = audio.src_out;
            audio.src_in = src_in;
            audio.src_out = src_out;
            Ok(Command::SetAudioSourceRange {
                clip_id,
                src_in: old_in,
                src_out: old_out,
            })
        }
        _ => Err(CommandError::NotAudioClip(clip_id)),
    }
}

fn apply_set_midi_content_window(
    edit: &mut ProjectEdit,
    clip_id: ClipId,
    content_in: Tick,
    content_out: Tick,
) -> Result<Command, CommandError> {
    if content_in.0 >= content_out.0 {
        return Err(CommandError::InvalidMidiWindow {
            content_in,
            content_out,
        });
    }
    let idx = find_clip(&edit.clips, clip_id).ok_or(CommandError::ClipNotFound(clip_id))?;
    match &edit.clips[idx].kind {
        ClipKind::Midi { content_id, .. } => {
            let content_idx = find_content(&edit.contents, *content_id)
                .ok_or(CommandError::ContentNotFound(*content_id))?;
            if let ContentEdit::Midi(midi_content) = &edit.contents[content_idx] {
                validate_midi_window_against_notes(midi_content, clip_id, content_in, content_out)?;
            }
        }
        _ => return Err(CommandError::NotMidiClip(clip_id)),
    }
    match &mut edit.clips[idx].kind {
        ClipKind::Midi { midi, .. } => {
            let old_in = midi.content_in;
            let old_out = midi.content_out;
            midi.content_in = content_in;
            midi.content_out = content_out;
            edit.clips[idx].length = Tick(content_out.0 - content_in.0);
            Ok(Command::SetMidiContentWindow {
                clip_id,
                content_in: old_in,
                content_out: old_out,
            })
        }
        _ => unreachable!(),
    }
}

fn apply_midi_red_trim(
    edit: &mut ProjectEdit,
    clip_id: ClipId,
    new_start: Tick,
    new_content_in: Tick,
    new_content_out: Tick,
) -> Result<Command, CommandError> {
    if new_content_in.0 >= new_content_out.0 {
        return Err(CommandError::InvalidMidiWindow {
            content_in: new_content_in,
            content_out: new_content_out,
        });
    }

    let idx = find_clip(&edit.clips, clip_id).ok_or(CommandError::ClipNotFound(clip_id))?;
    let old_start = edit.clips[idx].start;
    let old_end = Tick(old_start.0 + edit.clips[idx].length.0);
    let new_length = Tick(new_content_out.0 - new_content_in.0);
    let new_end = Tick(new_start.0 + new_length.0);
    if new_length.0 <= 0 {
        return Err(CommandError::InvalidClipLength {
            clip: clip_id,
            length: new_length,
        });
    }
    if new_start != old_start && new_end != old_end {
        return Err(CommandError::InvalidMidiWindow {
            content_in: new_content_in,
            content_out: new_content_out,
        });
    }

    let content_id = match &edit.clips[idx].kind {
        ClipKind::Midi { content_id, .. } => *content_id,
        _ => return Err(CommandError::NotMidiClip(clip_id)),
    };
    let content_idx = find_content(&edit.contents, content_id)
        .ok_or(CommandError::ContentNotFound(content_id))?;
    if let ContentEdit::Midi(midi_content) = &edit.contents[content_idx] {
        validate_midi_window_against_notes(midi_content, clip_id, new_content_in, new_content_out)?;
    }

    let (old_content_in, old_content_out) = match &mut edit.clips[idx].kind {
        ClipKind::Midi { midi, .. } => {
            let old_in = midi.content_in;
            let old_out = midi.content_out;
            midi.content_in = new_content_in;
            midi.content_out = new_content_out;
            (old_in, old_out)
        }
        _ => unreachable!(),
    };

    edit.clips[idx].start = new_start;
    edit.clips[idx].length = new_length;

    Ok(Command::MidiRedTrim {
        clip_id,
        new_start: old_start,
        new_content_in: old_content_in,
        new_content_out: old_content_out,
    })
}

fn apply_split_clip(
    edit: &mut ProjectEdit,
    clip_id: ClipId,
    tick_in_clip: Tick,
    new_clip_id: ClipId,
) -> Result<Command, CommandError> {
    let idx = find_clip(&edit.clips, clip_id).ok_or(CommandError::ClipNotFound(clip_id))?;

    if tick_in_clip.0 <= 0 || tick_in_clip.0 >= edit.clips[idx].length.0 {
        return Err(CommandError::InvalidSplitPosition(clip_id));
    }
    if find_clip(&edit.clips, new_clip_id).is_some() {
        return Err(CommandError::ClipAlreadyExists(new_clip_id));
    }

    let original_clip = edit.clips[idx].clone();

    match &edit.clips[idx].kind {
        ClipKind::Audio { content_id, audio } => {
            let content_id = *content_id;
            let clip_length = edit.clips[idx].length.0;
            let clip_start = edit.clips[idx].start;
            let tick_local = tick_in_clip.0;

            validate_audio_fades_for_length(
                clip_id,
                &FadesEdit {
                    fade_in: audio.fades.fade_in,
                    fade_out: Tick(0),
                },
                Tick(tick_local),
            )?;
            validate_audio_fades_for_length(
                clip_id,
                &FadesEdit {
                    fade_in: Tick(0),
                    fade_out: audio.fades.fade_out,
                },
                Tick(clip_length - tick_local),
            )?;

            match &audio.warp {
                WarpMapEdit::None => {
                    let src_in = audio.src_in.0;
                    let src_out = audio.src_out.0;
                    let src_range = src_out - src_in;
                    let src_split = src_in + (src_range * tick_local as u64) / clip_length as u64;

                    let right_clip = ClipEdit {
                        id: new_clip_id,
                        track_id: edit.clips[idx].track_id,
                        start: Tick(clip_start.0 + tick_local),
                        length: Tick(clip_length - tick_local),
                        lane: edit.clips[idx].lane,
                        muted: edit.clips[idx].muted,
                        gain_milli_db: edit.clips[idx].gain_milli_db,
                        kind: ClipKind::Audio {
                            content_id,
                            audio: AudioClipEdit {
                                src_in: SrcFrame(src_split),
                                src_out: SrcFrame(src_out),
                                warp: WarpMapEdit::None,
                                pitch: audio.pitch.clone(),
                                fades: FadesEdit {
                                    fade_in: Tick(0),
                                    fade_out: audio.fades.fade_out,
                                },
                                time_pitch: audio.time_pitch.clone(),
                            },
                        },
                    };

                    let clip = &mut edit.clips[idx];
                    clip.length = Tick(tick_local);
                    if let ClipKind::Audio { audio, .. } = &mut clip.kind {
                        audio.src_out = SrcFrame(src_split);
                        audio.fades.fade_out = Tick(0);
                    }

                    edit.clips.push(right_clip);

                    Ok(Command::UnsplitClip {
                        original_clip,
                        right_clip_id: new_clip_id,
                    })
                }
                WarpMapEdit::Anchors { anchors } => {
                    let full_warp = FullWarp::from_audio(Tick(clip_length), audio);
                    let src_split = full_warp.interpolate(Tick(tick_local)).0;

                    let mut left_anchors: Vec<WarpAnchorEdit> = Vec::new();
                    let mut right_anchors: Vec<WarpAnchorEdit> = Vec::new();
                    for a in anchors {
                        if a.at_in_clip.0 < tick_local {
                            left_anchors.push(a.clone());
                        } else {
                            right_anchors.push(WarpAnchorEdit {
                                at_in_clip: Tick(a.at_in_clip.0 - tick_local),
                                src_frame: a.src_frame,
                            });
                        }
                    }

                    let right_warp = if right_anchors.is_empty() {
                        WarpMapEdit::None
                    } else {
                        WarpMapEdit::Anchors {
                            anchors: right_anchors,
                        }
                    };
                    let left_warp = if left_anchors.is_empty() {
                        WarpMapEdit::None
                    } else {
                        WarpMapEdit::Anchors {
                            anchors: left_anchors,
                        }
                    };

                    let right_clip = ClipEdit {
                        id: new_clip_id,
                        track_id: edit.clips[idx].track_id,
                        start: Tick(clip_start.0 + tick_local),
                        length: Tick(clip_length - tick_local),
                        lane: edit.clips[idx].lane,
                        muted: edit.clips[idx].muted,
                        gain_milli_db: edit.clips[idx].gain_milli_db,
                        kind: ClipKind::Audio {
                            content_id,
                            audio: AudioClipEdit {
                                src_in: SrcFrame(src_split),
                                src_out: audio.src_out,
                                warp: right_warp,
                                pitch: audio.pitch.clone(),
                                fades: FadesEdit {
                                    fade_in: Tick(0),
                                    fade_out: audio.fades.fade_out,
                                },
                                time_pitch: audio.time_pitch.clone(),
                            },
                        },
                    };

                    let clip = &mut edit.clips[idx];
                    clip.length = Tick(tick_local);
                    if let ClipKind::Audio { audio, .. } = &mut clip.kind {
                        audio.src_out = SrcFrame(src_split);
                        audio.warp = left_warp;
                        audio.fades.fade_out = Tick(0);
                    }

                    edit.clips.push(right_clip);

                    Ok(Command::UnsplitClip {
                        original_clip,
                        right_clip_id: new_clip_id,
                    })
                }
            }
        }
        ClipKind::Midi { content_id, midi } => {
            let content_id = *content_id;
            let split_content_tick = Tick(midi.content_in.0 + tick_in_clip.0);
            let clip_start = edit.clips[idx].start;
            let clip_length = edit.clips[idx].length.0;
            let old_content_out = midi.content_out;

            let content_idx = find_content(&edit.contents, content_id)
                .ok_or(CommandError::ContentNotFound(content_id))?;
            let notes = match &edit.contents[content_idx] {
                ContentEdit::Midi(m) => &m.notes,
                _ => return Err(CommandError::NotMidiContent(content_id)),
            };

            for note in notes {
                let note_end = note.start.0 + note.length.0;
                if note.start.0 < split_content_tick.0 && note_end > split_content_tick.0 {
                    return Err(CommandError::SplitCrossesMidiNote(clip_id));
                }
            }

            let right_clip = ClipEdit {
                id: new_clip_id,
                track_id: edit.clips[idx].track_id,
                start: Tick(clip_start.0 + tick_in_clip.0),
                length: Tick(clip_length - tick_in_clip.0),
                lane: edit.clips[idx].lane,
                muted: edit.clips[idx].muted,
                gain_milli_db: edit.clips[idx].gain_milli_db,
                kind: ClipKind::Midi {
                    content_id,
                    midi: MidiClipEdit {
                        content_in: split_content_tick,
                        content_out: old_content_out,
                        transpose_semitones: midi.transpose_semitones,
                    },
                },
            };

            let clip = &mut edit.clips[idx];
            clip.length = tick_in_clip;
            if let ClipKind::Midi { midi, .. } = &mut clip.kind {
                midi.content_out = split_content_tick;
            }

            edit.clips.push(right_clip);

            Ok(Command::UnsplitClip {
                original_clip,
                right_clip_id: new_clip_id,
            })
        }
    }
}

fn apply_audio_red_trim(
    edit: &mut ProjectEdit,
    clip_id: ClipId,
    new_src_in: SrcFrame,
    new_src_out: SrcFrame,
    new_start: Tick,
    new_length: Tick,
) -> Result<Command, CommandError> {
    let idx = find_clip(&edit.clips, clip_id).ok_or(CommandError::ClipNotFound(clip_id))?;

    let content_id = match &edit.clips[idx].kind {
        ClipKind::Audio { content_id, .. } => *content_id,
        _ => return Err(CommandError::NotAudioClip(clip_id)),
    };

    let content_idx = find_content(&edit.contents, content_id)
        .ok_or(CommandError::ContentNotFound(content_id))?;
    if let ContentEdit::Audio(ac) = &edit.contents[content_idx] {
        let media_idx =
            find_media(&edit.media, ac.media_id).ok_or(CommandError::MediaNotFound(ac.media_id))?;
        if new_src_out.0 > edit.media[media_idx].length_src_frames {
            return Err(CommandError::SourceRangeExceedsMedia { clip: clip_id });
        }
    }

    let previous_clip = edit.clips[idx].clone();
    let old_start = edit.clips[idx].start;
    let old_length = edit.clips[idx].length;
    let old_end = Tick(old_start.0 + old_length.0);
    let new_end = Tick(new_start.0 + new_length.0);
    if new_length.0 <= 0 {
        return Err(CommandError::InvalidClipLength {
            clip: clip_id,
            length: new_length,
        });
    }
    if new_start != old_start && new_end != old_end {
        return Err(CommandError::InvalidAudioTrimGeometry { clip: clip_id });
    }

    // Compute and validate the new audio state before mutating anything, so a
    // failing command leaves the edit untouched (required by apply_batch rollback).
    let (next_src_in, next_src_out, next_warp) = match &edit.clips[idx].kind {
        ClipKind::Audio { audio, .. } => {
            validate_audio_fades_for_length(clip_id, &audio.fades, new_length)?;

            match &audio.warp {
                WarpMapEdit::None => {
                    if new_src_in.0 >= new_src_out.0 {
                        return Err(CommandError::InvalidAudioSourceRange {
                            src_in: new_src_in,
                            src_out: new_src_out,
                        });
                    }
                    (new_src_in, new_src_out, WarpMapEdit::None)
                }
                WarpMapEdit::Anchors { anchors } => {
                    let retain_start = if new_start == old_start {
                        0
                    } else {
                        old_length.0 - new_length.0
                    };
                    let retain_end = retain_start + new_length.0;
                    let full_warp = FullWarp::from_audio(old_length, audio);
                    let cropped_src_in = full_warp.interpolate(Tick(retain_start)).0;
                    let cropped_src_out = full_warp.interpolate(Tick(retain_end)).0;
                    let kept_anchors = anchors
                        .iter()
                        .filter(|anchor| {
                            anchor.at_in_clip.0 > retain_start && anchor.at_in_clip.0 < retain_end
                        })
                        .map(|anchor| WarpAnchorEdit {
                            at_in_clip: Tick(anchor.at_in_clip.0 - retain_start),
                            src_frame: anchor.src_frame,
                        })
                        .collect::<Vec<_>>();

                    let warp = if kept_anchors.is_empty() {
                        WarpMapEdit::None
                    } else {
                        WarpMapEdit::Anchors {
                            anchors: kept_anchors,
                        }
                    };
                    (SrcFrame(cropped_src_in), SrcFrame(cropped_src_out), warp)
                }
            }
        }
        _ => unreachable!(),
    };

    match &mut edit.clips[idx].kind {
        ClipKind::Audio { audio, .. } => {
            audio.src_in = next_src_in;
            audio.src_out = next_src_out;
            audio.warp = next_warp;
        }
        _ => unreachable!(),
    }

    edit.clips[idx].start = new_start;
    edit.clips[idx].length = new_length;

    Ok(Command::SetClipState {
        clip: previous_clip,
    })
}

// =============================================================================
// apply_command
// =============================================================================

/// Apply a command to the edit state. Returns the inverse command for undo on success.
///
/// This function is pure: the only mutation is to `edit`. No I/O or side effects.
/// Preconditions are validated before any mutation occurs.
pub fn apply_command(edit: &mut ProjectEdit, cmd: &Command) -> Result<Command, CommandError> {
    match cmd {
        Command::Batch { commands } => apply_batch(edit, commands),

        // ----- RenameProject (must be dispatched at document level) -----
        Command::RenameProject { .. } => Err(CommandError::RequiresProjectContext("RenameProject")),

        // ----- SetBpm -----
        Command::SetBpm { micro_bpm } => {
            if *micro_bpm <= 0 {
                return Err(CommandError::InvalidBpm(*micro_bpm));
            }
            if edit.tempo.points.is_empty() {
                return Err(CommandError::EmptyTempoMap);
            }
            let old = edit.tempo.points[0].micro_bpm;
            edit.tempo.points[0].micro_bpm = *micro_bpm;
            Ok(Command::SetBpm { micro_bpm: old })
        }

        // ----- SetBpmPreserveSeconds -----
        Command::SetBpmPreserveSeconds { micro_bpm } => {
            if *micro_bpm <= 0 {
                return Err(CommandError::InvalidBpm(*micro_bpm));
            }

            let old_micro_bpm = validate_fixed_v1_tempo_map(&edit.tempo)?;
            let inverse = Command::RestoreBpmPreserveSecondsState {
                tempo: edit.tempo.clone(),
                contents: edit.contents.clone(),
                clips: edit.clips.clone(),
                automation: edit.automation.clone(),
            };

            rescale_tick_domain_for_bpm_change(edit, *micro_bpm, old_micro_bpm);
            edit.tempo.points[0].micro_bpm = *micro_bpm;

            Ok(inverse)
        }

        // ----- SetTimeSignature -----
        Command::SetTimeSignature { time_sig } => {
            validate_time_signature(*time_sig)?;
            if edit.tempo.points.is_empty() {
                return Err(CommandError::EmptyTempoMap);
            }
            let old = edit.tempo.points[0].time_sig;
            edit.tempo.points[0].time_sig = *time_sig;
            Ok(Command::SetTimeSignature { time_sig: old })
        }

        // ----- SetGridSettings -----
        Command::SetGridSettings { grid } => {
            validate_grid_settings(grid)?;
            let old = edit.grid.clone();
            edit.grid = grid.clone();
            Ok(Command::SetGridSettings { grid: old })
        }

        // ----- AddTrack -----
        Command::AddTrack { track } => {
            validate_track_name(&track.name)?;
            if find_track(&edit.tracks, track.id).is_some() {
                return Err(CommandError::TrackAlreadyExists(track.id));
            }
            edit.tracks.push(track.clone());
            Ok(Command::RemoveTrack { id: track.id })
        }

        // ----- RemoveTrack -----
        Command::RemoveTrack { id } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let track = edit.tracks.remove(idx);
            let clips = edit
                .clips
                .iter()
                .enumerate()
                .filter(|(_, clip)| clip.track_id == *id)
                .map(|(index, clip)| PositionedClip {
                    index,
                    clip: clip.clone(),
                })
                .collect();
            edit.clips.retain(|clip| clip.track_id != *id);

            let pitch_links = edit
                .pitch_links
                .iter()
                .enumerate()
                .filter(|(_, link)| link.midi_track == *id || link.audio_track == *id)
                .map(|(index, link)| PositionedPitchLink {
                    index,
                    link: link.clone(),
                })
                .collect();
            edit.pitch_links
                .retain(|link| link.midi_track != *id && link.audio_track != *id);

            Ok(Command::RestoreTrack {
                track,
                index: idx,
                clips,
                pitch_links,
            })
        }

        // ----- MoveTrack -----
        Command::MoveTrack { id, new_index } => {
            let old_index =
                find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let max_target = edit.tracks.len().saturating_sub(1);
            let target_index = (*new_index).min(max_target);

            let track = edit.tracks.remove(old_index);
            let insert_index = target_index.min(edit.tracks.len());
            edit.tracks.insert(insert_index, track);

            Ok(Command::MoveTrack {
                id: *id,
                new_index: old_index,
            })
        }

        // ----- SetTrackName -----
        Command::SetTrackName { id, name } => {
            validate_track_name(name)?;
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].name.clone();
            edit.tracks[idx].name = name.clone();
            Ok(Command::RestoreTrackName { id: *id, name: old })
        }

        // ----- RestoreTrack (inverse-only) -----
        Command::RestoreTrack {
            track,
            index,
            clips,
            pitch_links,
        } => {
            let id = track.id;
            let idx = (*index).min(edit.tracks.len());
            edit.tracks.insert(idx, track.clone());

            for positioned in clips {
                let idx = positioned.index.min(edit.clips.len());
                edit.clips.insert(idx, positioned.clip.clone());
            }
            for positioned in pitch_links {
                let idx = positioned.index.min(edit.pitch_links.len());
                edit.pitch_links.insert(idx, positioned.link.clone());
            }

            Ok(Command::RemoveTrack { id })
        }

        // ----- RestoreTrackName (inverse-only) -----
        Command::RestoreTrackName { id, name } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].name.clone();
            edit.tracks[idx].name = name.clone();
            Ok(Command::SetTrackName { id: *id, name: old })
        }

        // ----- SetTrackMute -----
        Command::SetTrackMute { id, mute } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].mute;
            edit.tracks[idx].mute = *mute;
            Ok(Command::SetTrackMute { id: *id, mute: old })
        }

        // ----- SetTrackSolo -----
        Command::SetTrackSolo { id, solo } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].solo;
            edit.tracks[idx].solo = *solo;
            Ok(Command::SetTrackSolo { id: *id, solo: old })
        }

        // ----- SetTrackGain -----
        Command::SetTrackGain { id, gain_milli_db } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].gain_milli_db;
            edit.tracks[idx].gain_milli_db = *gain_milli_db;
            Ok(Command::SetTrackGain {
                id: *id,
                gain_milli_db: old,
            })
        }

        // ----- SetTrackPan -----
        Command::SetTrackPan { id, pan_permille } => {
            let idx = find_track(&edit.tracks, *id).ok_or(CommandError::TrackNotFound(*id))?;
            let old = edit.tracks[idx].pan_permille;
            edit.tracks[idx].pan_permille = (*pan_permille).clamp(-1000, 1000);
            Ok(Command::SetTrackPan {
                id: *id,
                pan_permille: old,
            })
        }

        // ----- AddMediaAsset -----
        Command::AddMediaAsset { asset } => {
            if find_media(&edit.media, asset.id).is_some() {
                return Err(CommandError::MediaAlreadyExists(asset.id));
            }
            let id = asset.id;
            edit.media.push(asset.clone());
            Ok(Command::RemoveMediaAsset { id })
        }

        // ----- RemoveMediaAsset (inverse-only) -----
        Command::RemoveMediaAsset { id } => {
            let idx = find_media(&edit.media, *id).ok_or(CommandError::MediaNotFound(*id))?;
            let asset = edit.media.remove(idx);
            Ok(Command::RestoreMediaAsset { asset, index: idx })
        }

        // ----- RestoreMediaAsset (inverse-only) -----
        Command::RestoreMediaAsset { asset, index } => {
            let id = asset.id;
            edit.media
                .insert((*index).min(edit.media.len()), asset.clone());
            Ok(Command::RemoveMediaAsset { id })
        }

        // ----- AddContent -----
        Command::AddContent { content } => {
            let id = content_id_of(content);
            if find_content(&edit.contents, id).is_some() {
                return Err(CommandError::ContentAlreadyExists(id));
            }
            validate_midi_notes_for_add(edit, content)?;
            edit.contents.push(content.clone());
            Ok(Command::RemoveContent { id })
        }

        // ----- RemoveContent (inverse-only) -----
        Command::RemoveContent { id } => {
            let idx =
                find_content(&edit.contents, *id).ok_or(CommandError::ContentNotFound(*id))?;
            let content = edit.contents.remove(idx);
            Ok(Command::RestoreContent {
                content,
                index: idx,
            })
        }

        // ----- RestoreContent (inverse-only) -----
        Command::RestoreContent { content, index } => {
            let id = content_id_of(content);
            edit.contents
                .insert((*index).min(edit.contents.len()), content.clone());
            Ok(Command::RemoveContent { id })
        }

        // ----- AddClip -----
        Command::AddClip { clip } => {
            // Validate track exists
            find_track(&edit.tracks, clip.track_id)
                .ok_or(CommandError::TrackNotFound(clip.track_id))?;
            if find_clip(&edit.clips, clip.id).is_some() {
                return Err(CommandError::ClipAlreadyExists(clip.id));
            }
            let clip_id = clip.id;
            edit.clips.push(clip.clone());
            Ok(Command::RemoveClip { clip_id })
        }

        // ----- RemoveClip -----
        Command::RemoveClip { clip_id } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let clip = edit.clips.remove(idx);
            Ok(Command::RestoreClip { clip, index: idx })
        }

        // ----- RestoreClip (inverse-only) -----
        Command::RestoreClip { clip, index } => {
            let clip_id = clip.id;
            edit.clips
                .insert((*index).min(edit.clips.len()), clip.clone());
            Ok(Command::RemoveClip { clip_id })
        }

        // ----- SetClipState (inverse-only) -----
        Command::SetClipState { clip } => {
            let idx = find_clip(&edit.clips, clip.id).ok_or(CommandError::ClipNotFound(clip.id))?;
            let previous = edit.clips[idx].clone();
            edit.clips[idx] = clip.clone();
            Ok(Command::SetClipState { clip: previous })
        }

        // ----- MoveClip -----
        Command::MoveClip { clip_id, new_start } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let old_start = edit.clips[idx].start;
            edit.clips[idx].start = *new_start;
            Ok(Command::MoveClip {
                clip_id: *clip_id,
                new_start: old_start,
            })
        }

        // ----- MoveClipToTrack -----
        Command::MoveClipToTrack {
            clip_id,
            new_track_id,
        } => {
            let clip_idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let previous = edit.clips[clip_idx].clone();

            // Validate new track exists
            let new_track_idx = find_track(&edit.tracks, *new_track_id)
                .ok_or(CommandError::TrackNotFound(*new_track_id))?;

            // Same-kind check
            let clip_disc = clip_kind_discriminant(&edit.clips[clip_idx].kind);
            let track_disc = track_kind_discriminant(&edit.tracks[new_track_idx].kind);
            if clip_disc != track_disc {
                return Err(CommandError::TrackKindMismatch);
            }

            edit.clips[clip_idx].track_id = *new_track_id;
            // v1: reset lane to 0 on track move
            edit.clips[clip_idx].lane = 0;

            Ok(Command::SetClipState { clip: previous })
        }

        // ----- ResizeClip -----
        Command::ResizeClip {
            clip_id,
            new_length,
        } => {
            if new_length.0 <= 0 {
                return Err(CommandError::InvalidClipLength {
                    clip: *clip_id,
                    length: *new_length,
                });
            }
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let old_length = edit.clips[idx].length;
            edit.clips[idx].length = *new_length;
            Ok(Command::ResizeClip {
                clip_id: *clip_id,
                new_length: old_length,
            })
        }

        // ----- SetAudioSourceRange -----
        Command::SetAudioSourceRange {
            clip_id,
            src_in,
            src_out,
        } => apply_set_audio_source_range(edit, *clip_id, *src_in, *src_out),

        // ----- SetClipGain -----
        Command::SetClipGain {
            clip_id,
            gain_milli_db,
        } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let old = edit.clips[idx].gain_milli_db;
            edit.clips[idx].gain_milli_db = *gain_milli_db;
            Ok(Command::SetClipGain {
                clip_id: *clip_id,
                gain_milli_db: old,
            })
        }

        // ----- SetClipMute -----
        Command::SetClipMute { clip_id, muted } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let old = edit.clips[idx].muted;
            edit.clips[idx].muted = *muted;
            Ok(Command::SetClipMute {
                clip_id: *clip_id,
                muted: old,
            })
        }

        // ----- AddWarpAnchor -----
        Command::AddWarpAnchor { clip_id, anchor } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let clip_length = edit.clips[idx].length;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    if anchor.at_in_clip.0 <= 0 || anchor.at_in_clip.0 >= clip_length.0 {
                        return Err(CommandError::InvalidWarpAnchor { clip: *clip_id });
                    }
                    let index = match &mut audio.warp {
                        WarpMapEdit::None => {
                            audio.warp = WarpMapEdit::Anchors {
                                anchors: vec![anchor.clone()],
                            };
                            0
                        }
                        WarpMapEdit::Anchors { anchors } => {
                            let insert_index = anchors.partition_point(|candidate| {
                                candidate.at_in_clip.0 < anchor.at_in_clip.0
                            });
                            if anchors
                                .get(insert_index)
                                .is_some_and(|candidate| candidate.at_in_clip == anchor.at_in_clip)
                            {
                                return Err(CommandError::InvalidWarpAnchor { clip: *clip_id });
                            }
                            anchors.insert(insert_index, anchor.clone());
                            insert_index
                        }
                    };
                    Ok(Command::RemoveWarpAnchor {
                        clip_id: *clip_id,
                        index,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- AddWarpAnchorAtTick -----
        Command::AddWarpAnchorAtTick {
            clip_id,
            tick_in_clip,
        } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let clip_length = edit.clips[idx].length;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let index =
                        add_warp_anchor_at_tick(*clip_id, audio, clip_length, *tick_in_clip)?;
                    Ok(Command::RemoveWarpAnchor {
                        clip_id: *clip_id,
                        index,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- RemoveWarpAnchor -----
        Command::RemoveWarpAnchor { clip_id, index } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => match &mut audio.warp {
                    WarpMapEdit::None => Err(CommandError::IndexOutOfBounds {
                        index: *index,
                        len: 0,
                    }),
                    WarpMapEdit::Anchors { anchors } => {
                        if *index >= anchors.len() {
                            return Err(CommandError::IndexOutOfBounds {
                                index: *index,
                                len: anchors.len(),
                            });
                        }
                        let removed = anchors.remove(*index);
                        if anchors.is_empty() {
                            audio.warp = WarpMapEdit::None;
                        }
                        Ok(Command::RestoreWarpAnchor {
                            clip_id: *clip_id,
                            index: *index,
                            anchor: removed,
                        })
                    }
                },
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- RestoreWarpAnchor (inverse-only) -----
        Command::RestoreWarpAnchor {
            clip_id,
            index,
            anchor,
        } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    match &mut audio.warp {
                        WarpMapEdit::None => {
                            audio.warp = WarpMapEdit::Anchors {
                                anchors: vec![anchor.clone()],
                            };
                        }
                        WarpMapEdit::Anchors { anchors } => {
                            let i = (*index).min(anchors.len());
                            anchors.insert(i, anchor.clone());
                        }
                    }
                    Ok(Command::RemoveWarpAnchor {
                        clip_id: *clip_id,
                        index: *index,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- SetPitchCoarse -----
        Command::SetPitchCoarse { clip_id, semitones } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let old_coarse = audio.pitch.manual_coarse_semitones;
                    let old_fine = audio.pitch.manual_fine_cents;
                    audio.pitch.manual_coarse_semitones = *semitones;
                    audio.pitch.normalize();
                    Ok(Command::RestorePitchControl {
                        clip_id: *clip_id,
                        coarse: old_coarse,
                        fine: old_fine,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- SetPitchFine -----
        Command::SetPitchFine { clip_id, cents } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let old_coarse = audio.pitch.manual_coarse_semitones;
                    let old_fine = audio.pitch.manual_fine_cents;
                    audio.pitch.manual_fine_cents = *cents;
                    audio.pitch.normalize();
                    Ok(Command::RestorePitchControl {
                        clip_id: *clip_id,
                        coarse: old_coarse,
                        fine: old_fine,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- RestorePitchControl (inverse-only) -----
        Command::RestorePitchControl {
            clip_id,
            coarse,
            fine,
        } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let inverse = Command::RestorePitchControl {
                        clip_id: *clip_id,
                        coarse: audio.pitch.manual_coarse_semitones,
                        fine: audio.pitch.manual_fine_cents,
                    };
                    audio.pitch.manual_coarse_semitones = *coarse;
                    audio.pitch.manual_fine_cents = *fine;
                    Ok(inverse)
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- SetPitchMode -----
        Command::SetPitchMode { clip_id, mode } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let old = audio.pitch.mode.clone();
                    audio.pitch.mode = mode.clone();
                    Ok(Command::SetPitchMode {
                        clip_id: *clip_id,
                        mode: old,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- SetTimePitch -----
        Command::SetTimePitch {
            clip_id,
            time_pitch,
        } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    let old = audio.time_pitch.clone();
                    audio.time_pitch = time_pitch.clone();
                    Ok(Command::SetTimePitch {
                        clip_id: *clip_id,
                        time_pitch: old,
                    })
                }
                _ => Err(CommandError::NotAudioClip(*clip_id)),
            }
        }

        // ----- AddMidiNote -----
        Command::AddMidiNote { content_id, note } => {
            let idx = find_content(&edit.contents, *content_id)
                .ok_or(CommandError::ContentNotFound(*content_id))?;
            if !matches!(&edit.contents[idx], ContentEdit::Midi(_)) {
                return Err(CommandError::NotMidiContent(*content_id));
            }
            validate_midi_note(note)?;
            if edit_contains_midi_note(edit, note.id) {
                return Err(CommandError::MidiNoteAlreadyExists(note.id));
            }
            match &mut edit.contents[idx] {
                ContentEdit::Midi(midi) => {
                    midi.notes.push(note.clone());
                    Ok(Command::RemoveMidiNote {
                        content_id: *content_id,
                        note_id: note.id,
                    })
                }
                _ => Err(CommandError::NotMidiContent(*content_id)),
            }
        }

        // ----- RemoveMidiNote -----
        Command::RemoveMidiNote {
            content_id,
            note_id,
        } => {
            let idx = find_content(&edit.contents, *content_id)
                .ok_or(CommandError::ContentNotFound(*content_id))?;
            match &mut edit.contents[idx] {
                ContentEdit::Midi(midi) => {
                    let note_index = find_midi_note(&midi.notes, *note_id)
                        .ok_or(CommandError::MidiNoteNotFound(*note_id))?;
                    let previous_notes = midi.notes.clone();
                    midi.notes.remove(note_index);
                    Ok(Command::RestoreMidiNote {
                        content_id: *content_id,
                        notes: previous_notes,
                    })
                }
                _ => Err(CommandError::NotMidiContent(*content_id)),
            }
        }

        // ----- RestoreMidiNote (inverse-only) -----
        Command::RestoreMidiNote { content_id, notes } => {
            let idx = find_content(&edit.contents, *content_id)
                .ok_or(CommandError::ContentNotFound(*content_id))?;
            match &mut edit.contents[idx] {
                ContentEdit::Midi(midi) => {
                    let inverse = Command::RestoreMidiNote {
                        content_id: *content_id,
                        notes: midi.notes.clone(),
                    };
                    midi.notes = notes.clone();
                    Ok(inverse)
                }
                _ => Err(CommandError::NotMidiContent(*content_id)),
            }
        }

        // ----- SetMidiContentWindow -----
        Command::SetMidiContentWindow {
            clip_id,
            content_in,
            content_out,
        } => apply_set_midi_content_window(edit, *clip_id, *content_in, *content_out),

        // ----- SetMidiTranspose -----
        Command::SetMidiTranspose { clip_id, semitones } => {
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            match &mut edit.clips[idx].kind {
                ClipKind::Midi { midi, .. } => {
                    let old = midi.transpose_semitones;
                    midi.transpose_semitones = *semitones;
                    Ok(Command::SetMidiTranspose {
                        clip_id: *clip_id,
                        semitones: old,
                    })
                }
                _ => Err(CommandError::NotMidiClip(*clip_id)),
            }
        }

        // ----- MidiRedTrim -----
        Command::MidiRedTrim {
            clip_id,
            new_start,
            new_content_in,
            new_content_out,
        } => apply_midi_red_trim(
            edit,
            *clip_id,
            *new_start,
            *new_content_in,
            *new_content_out,
        ),

        // ----- AddPitchLink -----
        Command::AddPitchLink { link } => {
            validate_pitch_link_for_add(edit, link)?;
            edit.pitch_links.push(link.clone());
            Ok(Command::RemovePitchLink { id: link.id })
        }

        // ----- RemovePitchLink -----
        Command::RemovePitchLink { id } => {
            let idx = find_pitch_link(&edit.pitch_links, *id)
                .ok_or(CommandError::PitchLinkNotFound(*id))?;
            let removed = edit.pitch_links.remove(idx);
            Ok(Command::RestorePitchLink {
                link: removed,
                index: idx,
            })
        }

        // ----- RestorePitchLink (inverse-only) -----
        Command::RestorePitchLink { link, index } => {
            let idx = (*index).min(edit.pitch_links.len());
            edit.pitch_links.insert(idx, link.clone());
            Ok(Command::RemovePitchLink { id: link.id })
        }

        // ----- RestoreBpmPreserveSecondsState (inverse-only) -----
        Command::RestoreBpmPreserveSecondsState {
            tempo,
            contents,
            clips,
            automation,
        } => {
            let inverse = Command::RestoreBpmPreserveSecondsState {
                tempo: edit.tempo.clone(),
                contents: edit.contents.clone(),
                clips: edit.clips.clone(),
                automation: edit.automation.clone(),
            };

            edit.tempo = tempo.clone();
            edit.contents = contents.clone();
            edit.clips = clips.clone();
            edit.automation = automation.clone();

            Ok(inverse)
        }

        // ----- SplitClip -----
        Command::SplitClip {
            clip_id,
            tick_in_clip,
            new_clip_id,
        } => apply_split_clip(edit, *clip_id, *tick_in_clip, *new_clip_id),

        // ----- UnsplitClip (inverse-only) -----
        Command::UnsplitClip {
            original_clip,
            right_clip_id,
        } => {
            // Remove the right clip
            let right_idx = find_clip(&edit.clips, *right_clip_id)
                .ok_or(CommandError::ClipNotFound(*right_clip_id))?;
            edit.clips.remove(right_idx);

            // Find the left clip (same ID as original) and restore it
            let left_idx = find_clip(&edit.clips, original_clip.id)
                .ok_or(CommandError::ClipNotFound(original_clip.id))?;

            // Compute the inverse: the left clip's current length IS tick_in_clip
            let split_tick = edit.clips[left_idx].length;

            edit.clips[left_idx] = original_clip.clone();

            Ok(Command::SplitClip {
                clip_id: original_clip.id,
                tick_in_clip: split_tick,
                new_clip_id: *right_clip_id,
            })
        }

        // ----- AudioRedTrim -----
        Command::AudioRedTrim {
            clip_id,
            new_src_in,
            new_src_out,
            new_start,
            new_length,
        } => apply_audio_red_trim(
            edit,
            *clip_id,
            *new_src_in,
            *new_src_out,
            *new_start,
            *new_length,
        ),

        // ----- AudioBlueStretch -----
        Command::AudioBlueStretch {
            clip_id,
            new_start,
            new_length,
        } => {
            if new_length.0 <= 0 {
                return Err(CommandError::InvalidClipLength {
                    clip: *clip_id,
                    length: *new_length,
                });
            }
            let idx =
                find_clip(&edit.clips, *clip_id).ok_or(CommandError::ClipNotFound(*clip_id))?;
            let previous_clip = edit.clips[idx].clone();
            let old_start = edit.clips[idx].start;
            let old_length = edit.clips[idx].length;
            let old_end = Tick(old_start.0 + edit.clips[idx].length.0);
            let new_end = Tick(new_start.0 + new_length.0);
            if *new_start != old_start && new_end != old_end {
                return Err(CommandError::InvalidAudioTrimGeometry { clip: *clip_id });
            }

            // Compute and validate the new warp before mutating anything, so a
            // failing command leaves the edit untouched (required by apply_batch rollback).
            let next_warp = match &edit.clips[idx].kind {
                ClipKind::Audio { audio, .. } => {
                    validate_audio_fades_for_length(*clip_id, &audio.fades, *new_length)?;
                    match &audio.warp {
                        WarpMapEdit::Anchors { anchors } => {
                            let scaled = scale_warp_anchor_ticks(
                                *clip_id,
                                anchors,
                                old_length,
                                *new_length,
                            )?;
                            Some(if scaled.is_empty() {
                                WarpMapEdit::None
                            } else {
                                WarpMapEdit::Anchors { anchors: scaled }
                            })
                        }
                        WarpMapEdit::None => None,
                    }
                }
                _ => return Err(CommandError::NotAudioClip(*clip_id)),
            };

            if let Some(warp) = next_warp {
                match &mut edit.clips[idx].kind {
                    ClipKind::Audio { audio, .. } => audio.warp = warp,
                    _ => unreachable!(),
                }
            }

            edit.clips[idx].start = *new_start;
            edit.clips[idx].length = *new_length;

            let _ = old_start;
            Ok(Command::SetClipState {
                clip: previous_clip,
            })
        }
    }
}

// =============================================================================
// UndoStack
// =============================================================================

/// Undo/redo stack that stores inverse commands.
#[derive(Debug, Default)]
pub struct UndoStack {
    undo: Vec<Command>,
    redo: Vec<Command>,
}

impl UndoStack {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push an inverse command onto the undo stack and clear redo.
    pub fn push(&mut self, inverse: Command) {
        self.undo.push(inverse);
        self.redo.clear();
    }

    /// Pop from undo stack, apply inverse to edit, push result to redo stack.
    pub fn undo(&mut self, edit: &mut ProjectEdit) -> Result<(), CommandError> {
        let inverse = self.undo.pop().ok_or(CommandError::NothingToUndo)?;
        let re_inverse = apply_command(edit, &inverse)?;
        self.redo.push(re_inverse);
        Ok(())
    }

    /// Pop from redo stack, apply to edit, push inverse to undo stack.
    pub fn redo(&mut self, edit: &mut ProjectEdit) -> Result<(), CommandError> {
        let cmd = self.redo.pop().ok_or(CommandError::NothingToRedo)?;
        let inverse = apply_command(edit, &cmd)?;
        self.undo.push(inverse);
        Ok(())
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_json_rejects_unknown_fields() {
        let error = serde_json::from_value::<Command>(serde_json::json!({
            "command": "set_bpm",
            "micro_bpm": 120_000_000,
            "unexpected_field": true
        }))
        .unwrap_err();

        assert!(error.to_string().contains("unexpected_field"));
    }

    #[test]
    fn remove_midi_note_wire_contract_uses_note_id_instead_of_index() {
        let content_id = ContentId::new();
        let note_id = uuid::Uuid::new_v4();

        assert!(serde_json::from_value::<Command>(serde_json::json!({
            "command": "remove_midi_note",
            "content_id": content_id,
            "note_id": note_id,
        }))
        .is_ok());
        assert!(serde_json::from_value::<Command>(serde_json::json!({
            "command": "remove_midi_note",
            "content_id": content_id,
            "index": 0,
        }))
        .is_err());
    }

    /// Create a minimal empty project edit for testing.
    fn empty_edit() -> ProjectEdit {
        ProjectEdit {
            tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
            grid: GridSettings::default(),
            tracks: vec![],
            media: vec![],
            contents: vec![],
            clips: vec![],
            routing: RoutingEdit { schema_hint: None },
            automation: vec![],
            pitch_links: vec![],
        }
    }

    fn make_test_media(id: MediaId) -> MediaAsset {
        MediaAsset {
            id,
            in_zip_path: "media/test.wav".into(),
            channels: 2,
            src_sample_rate: 44100,
            length_src_frames: 44100,
            hash: None,
            original_name: None,
        }
    }

    fn make_default_track(id: TrackId, name: &str, kind: TrackKind) -> TrackEdit {
        TrackEdit {
            id,
            name: name.into(),
            kind,
            mute: false,
            solo: false,
            gain_milli_db: 0,
            pan_permille: 0,
            fx_chain: vec![],
            routing: TrackRoutingEdit {
                output: BusTarget::Master,
                sends: vec![],
            },
        }
    }

    fn json_snapshot<T: serde::Serialize>(value: &T) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }

    fn make_preserve_seconds_edit() -> ProjectEdit {
        let mut edit = empty_edit();

        let audio_track_id = TrackId::new();
        let midi_track_id = TrackId::new();
        let media_id = MediaId::new();
        let audio_content_id = ContentId::new();
        let midi_content_id = ContentId::new();
        let audio_clip_id = ClipId::new();
        let midi_clip_id = ClipId::new();

        edit.media.push(make_test_media(media_id));
        edit.tracks.push(make_default_track(
            audio_track_id,
            "Audio 1",
            TrackKind::Audio,
        ));
        edit.tracks.push(make_default_track(
            midi_track_id,
            "MIDI 1",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        edit.contents.push(ContentEdit::Audio(AudioContentEdit {
            id: audio_content_id,
            media_id,
            analysis_refs: vec![],
        }));
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: midi_content_id,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(480),
                length: Tick(960),
                key: 60,
                vel: 100,
            }],
            ccs: vec![MidiCc {
                at: Tick(960),
                cc: 1,
                value: 64,
            }],
        }));
        edit.clips.push(ClipEdit {
            id: audio_clip_id,
            track_id: audio_track_id,
            start: Tick(960),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Audio {
                content_id: audio_content_id,
                audio: AudioClipEdit {
                    src_in: SrcFrame(1000),
                    src_out: SrcFrame(45100),
                    warp: WarpMapEdit::Anchors {
                        anchors: vec![WarpAnchorEdit {
                            at_in_clip: Tick(480),
                            src_frame: SrcFrame(22050),
                        }],
                    },
                    pitch: PitchControlEdit::default(),
                    fades: FadesEdit {
                        fade_in: Tick(240),
                        fade_out: Tick(480),
                    },
                    time_pitch: TimePitchModeEdit::Voice {
                        analysis: VoiceAnalysisModeEdit::Local,
                        preserve_formant: false,
                    },
                },
            },
        });
        edit.clips.push(ClipEdit {
            id: midi_clip_id,
            track_id: midi_track_id,
            start: Tick(1920),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: midi_content_id,
                midi: MidiClipEdit {
                    content_in: Tick(480),
                    content_out: Tick(1440),
                    transpose_semitones: 0,
                },
            },
        });
        edit.automation.push(AutomationLane {
            id: AutomationId::new(),
            target: AutomationTarget::TrackParam {
                track: audio_track_id,
                param: TrackParam::Gain,
            },
            points: vec![
                AutomationPoint {
                    at: Tick(0),
                    value: 0,
                    curve: CurveShape::Linear,
                },
                AutomationPoint {
                    at: Tick(960),
                    value: 50,
                    curve: CurveShape::Hold,
                },
                AutomationPoint {
                    at: Tick(1920),
                    value: 100,
                    curve: CurveShape::Linear,
                },
            ],
        });

        edit
    }

    fn make_audio_clip(clip_id: ClipId, track_id: TrackId, content_id: ContentId) -> ClipEdit {
        ClipEdit {
            id: clip_id,
            track_id,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Audio {
                content_id,
                audio: AudioClipEdit {
                    src_in: SrcFrame(0),
                    src_out: SrcFrame(44100),
                    warp: WarpMapEdit::None,
                    pitch: PitchControlEdit::default(),
                    fades: FadesEdit {
                        fade_in: Tick(0),
                        fade_out: Tick(0),
                    },
                    time_pitch: TimePitchModeEdit::Voice {
                        analysis: VoiceAnalysisModeEdit::Local,
                        preserve_formant: false,
                    },
                },
            },
        }
    }

    fn setup_audio_track_with_content(edit: &mut ProjectEdit) -> (TrackId, ContentId, MediaId) {
        let mid = MediaId::new();
        let cid = ContentId::new();
        let tid = TrackId::new();

        edit.media.push(make_test_media(mid));
        edit.contents.push(ContentEdit::Audio(AudioContentEdit {
            id: cid,
            media_id: mid,
            analysis_refs: vec![],
        }));
        apply_command(
            edit,
            &Command::AddTrack {
                track: make_default_track(tid, "Audio 1", TrackKind::Audio),
            },
        )
        .unwrap();
        (tid, cid, mid)
    }

    // -- SetBpm --

    #[test]
    fn set_bpm_produces_inverse() {
        let mut edit = empty_edit();
        let new_bpm = 140_000_000_i64; // 140 BPM
        let inverse = apply_command(&mut edit, &Command::SetBpm { micro_bpm: new_bpm }).unwrap();
        assert_eq!(edit.tempo.points[0].micro_bpm, new_bpm);
        match inverse {
            Command::SetBpm { micro_bpm } => assert_eq!(micro_bpm, 120_000_000),
            _ => panic!("expected SetBpm inverse"),
        }
    }

    #[test]
    fn set_bpm_rejects_zero() {
        let mut edit = empty_edit();
        assert!(apply_command(&mut edit, &Command::SetBpm { micro_bpm: 0 }).is_err());
    }

    #[test]
    fn set_bpm_rejects_negative() {
        let mut edit = empty_edit();
        assert!(apply_command(&mut edit, &Command::SetBpm { micro_bpm: -10 }).is_err());
    }

    #[test]
    fn set_bpm_preserve_seconds_updates_bpm_and_rescales_tick_domain_fields() {
        let mut edit = make_preserve_seconds_edit();

        let inverse = apply_command(
            &mut edit,
            &Command::SetBpmPreserveSeconds {
                micro_bpm: 60_000_000,
            },
        )
        .unwrap();

        assert!(matches!(
            inverse,
            Command::RestoreBpmPreserveSecondsState { .. }
        ));
        assert_eq!(edit.tempo.points[0].micro_bpm, 60_000_000);

        match &edit.contents[1] {
            ContentEdit::Midi(midi) => {
                assert_eq!(midi.notes[0].start, Tick(240));
                assert_eq!(midi.notes[0].length, Tick(480));
                assert_eq!(midi.ccs[0].at, Tick(480));
            }
            _ => panic!("expected MIDI content"),
        }

        match &edit.clips[0] {
            ClipEdit {
                start,
                length,
                kind: ClipKind::Audio { audio, .. },
                ..
            } => {
                assert_eq!(*start, Tick(480));
                assert_eq!(*length, Tick(480));
                assert_eq!(audio.src_in, SrcFrame(1000));
                assert_eq!(audio.src_out, SrcFrame(45100));
                assert_eq!(audio.fades.fade_in, Tick(120));
                assert_eq!(audio.fades.fade_out, Tick(240));
                match &audio.warp {
                    WarpMapEdit::Anchors { anchors } => {
                        assert_eq!(anchors[0].at_in_clip, Tick(240));
                        assert_eq!(anchors[0].src_frame, SrcFrame(22050));
                    }
                    _ => panic!("expected anchored warp"),
                }
            }
            _ => panic!("expected audio clip"),
        }

        match &edit.clips[1] {
            ClipEdit {
                start,
                length,
                kind: ClipKind::Midi { midi, .. },
                ..
            } => {
                assert_eq!(*start, Tick(960));
                assert_eq!(*length, Tick(480));
                assert_eq!(midi.content_in, Tick(240));
                assert_eq!(midi.content_out, Tick(720));
                assert_eq!(length.0, midi.content_out.0 - midi.content_in.0);
            }
            _ => panic!("expected MIDI clip"),
        }

        assert_eq!(edit.automation[0].points[0].at, Tick(0));
        assert_eq!(edit.automation[0].points[1].at, Tick(480));
        assert_eq!(edit.automation[0].points[2].at, Tick(960));
    }

    #[test]
    fn set_bpm_preserve_seconds_inverse_restores_original_and_redo_restores_rescaled_state() {
        let mut edit = make_preserve_seconds_edit();
        let original_snapshot = json_snapshot(&edit);

        let inverse = apply_command(
            &mut edit,
            &Command::SetBpmPreserveSeconds {
                micro_bpm: 60_000_000,
            },
        )
        .unwrap();
        let rescaled_snapshot = json_snapshot(&edit);

        let redo = apply_command(&mut edit, &inverse).unwrap();
        assert_eq!(json_snapshot(&edit), original_snapshot);

        apply_command(&mut edit, &redo).unwrap();
        assert_eq!(json_snapshot(&edit), rescaled_snapshot);
    }

    #[test]
    fn set_bpm_preserve_seconds_rejects_zero_and_negative() {
        let mut edit = make_preserve_seconds_edit();
        assert!(matches!(
            apply_command(&mut edit, &Command::SetBpmPreserveSeconds { micro_bpm: 0 }),
            Err(CommandError::InvalidBpm(0))
        ));
        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::SetBpmPreserveSeconds { micro_bpm: -10 }
            ),
            Err(CommandError::InvalidBpm(-10))
        ));
    }

    #[test]
    fn set_bpm_preserve_seconds_rejects_multi_point_tempo_map() {
        let mut edit = make_preserve_seconds_edit();
        edit.tempo.points.push(TempoPointEdit {
            at: Tick(960),
            micro_bpm: 90_000_000,
            time_sig: TimeSignature { num: 4, den: 4 },
        });

        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::SetBpmPreserveSeconds {
                    micro_bpm: 60_000_000
                }
            ),
            Err(CommandError::UnsupportedTempoMapPointCount { point_count: 2 })
        ));
    }

    // -- SetTimeSignature --

    #[test]
    fn set_time_signature_produces_inverse() {
        let mut edit = empty_edit();
        let new_time_sig = TimeSignature { num: 4, den: 8 };
        let inverse = apply_command(
            &mut edit,
            &Command::SetTimeSignature {
                time_sig: new_time_sig,
            },
        )
        .unwrap();

        assert_eq!(edit.tempo.points[0].time_sig, new_time_sig);
        match inverse {
            Command::SetTimeSignature { time_sig } => {
                assert_eq!(time_sig, TimeSignature { num: 4, den: 4 })
            }
            _ => panic!("expected SetTimeSignature inverse"),
        }
    }

    #[test]
    fn set_time_signature_rejects_zero_parts() {
        let mut edit = empty_edit();
        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::SetTimeSignature {
                    time_sig: TimeSignature { num: 0, den: 4 },
                },
            ),
            Err(CommandError::InvalidTimeSignature { num: 0, den: 4 })
        ));
        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::SetTimeSignature {
                    time_sig: TimeSignature { num: 4, den: 0 },
                },
            ),
            Err(CommandError::InvalidTimeSignature { num: 4, den: 0 })
        ));
    }

    #[test]
    fn set_time_signature_rejects_non_power_of_two_denominator() {
        let mut edit = empty_edit();
        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::SetTimeSignature {
                    time_sig: TimeSignature { num: 5, den: 3 },
                },
            ),
            Err(CommandError::InvalidTimeSignature { num: 5, den: 3 })
        ));
    }

    // -- SetGridSettings --

    #[test]
    fn default_grid_uses_25_percent_magnet_range() {
        let edit = empty_edit();
        assert_eq!(edit.grid.magnet_range_permille, 250);
    }

    #[test]
    fn set_grid_settings_produces_inverse() {
        let mut edit = empty_edit();
        let old_grid = edit.grid.clone();
        let new_grid = GridSettings {
            snap_enabled: false,
            division: GridDivision::Sixteenth,
            swing_permille: 125,
            magnet_range_permille: 250,
            snap_strength_permille: 900,
        };

        let inverse = apply_command(
            &mut edit,
            &Command::SetGridSettings {
                grid: new_grid.clone(),
            },
        )
        .unwrap();

        assert_eq!(edit.grid.snap_enabled, new_grid.snap_enabled);
        assert!(matches!(edit.grid.division, GridDivision::Sixteenth));
        assert_eq!(edit.grid.swing_permille, 125);
        assert_eq!(edit.grid.snap_strength_permille, 900);

        match inverse {
            Command::SetGridSettings { grid } => {
                assert_eq!(grid.snap_enabled, old_grid.snap_enabled);
                assert_eq!(grid.magnet_range_permille, old_grid.magnet_range_permille);
            }
            _ => panic!("expected SetGridSettings inverse"),
        }
    }

    #[test]
    fn set_grid_settings_rejects_invalid_permille() {
        let mut edit = empty_edit();
        let bad_grid = GridSettings {
            snap_enabled: true,
            division: GridDivision::Beat,
            swing_permille: 0,
            magnet_range_permille: 1001,
            snap_strength_permille: 1000,
        };

        assert!(matches!(
            apply_command(&mut edit, &Command::SetGridSettings { grid: bad_grid }),
            Err(CommandError::InvalidGridSetting {
                field: "magnet_range_permille",
                ..
            })
        ));
    }

    #[test]
    fn set_grid_settings_round_trips_through_undo_redo() {
        let mut edit = empty_edit();
        let original = edit.grid.clone();

        let cmd = Command::SetGridSettings {
            grid: GridSettings {
                snap_enabled: false,
                division: GridDivision::Triplet { base: 8 },
                swing_permille: 0,
                magnet_range_permille: 250,
                snap_strength_permille: 1000,
            },
        };
        let undo = apply_command(&mut edit, &cmd).unwrap();
        assert!(!edit.grid.snap_enabled);
        assert!(matches!(
            edit.grid.division,
            GridDivision::Triplet { base: 8 }
        ));

        let redo = apply_command(&mut edit, &undo).unwrap();
        assert_eq!(edit.grid.snap_enabled, original.snap_enabled);
        assert_eq!(
            edit.grid.magnet_range_permille,
            original.magnet_range_permille
        );

        apply_command(&mut edit, &redo).unwrap();
        assert!(!edit.grid.snap_enabled);
        assert!(matches!(
            edit.grid.division,
            GridDivision::Triplet { base: 8 }
        ));
    }

    // -- AddTrack / RemoveTrack --

    #[test]
    fn add_and_remove_track() {
        let mut edit = empty_edit();
        let track_id = TrackId::new();

        let inv = apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(track_id, "Audio 1", TrackKind::Audio),
            },
        )
        .unwrap();

        assert!(find_track(&edit.tracks, track_id).is_some());
        assert_eq!(
            edit.tracks.iter().find(|t| t.id == track_id).unwrap().name,
            "Audio 1"
        );

        // Inverse should be RemoveTrack
        let inv2 = apply_command(&mut edit, &inv).unwrap();
        assert!(find_track(&edit.tracks, track_id).is_none());

        // Re-apply restores
        apply_command(&mut edit, &inv2).unwrap();
        assert!(find_track(&edit.tracks, track_id).is_some());
    }

    #[test]
    fn add_track_rejects_duplicate() {
        let mut edit = empty_edit();
        let track_id = TrackId::new();
        let cmd = Command::AddTrack {
            track: make_default_track(track_id, "T", TrackKind::Audio),
        };
        apply_command(&mut edit, &cmd).unwrap();
        assert!(apply_command(&mut edit, &cmd).is_err());
    }

    #[test]
    fn remove_nonexistent_track_errors() {
        let mut edit = empty_edit();
        assert!(apply_command(&mut edit, &Command::RemoveTrack { id: TrackId::new() }).is_err());
    }

    #[test]
    fn move_track_reorders_tracks_without_touching_clip_membership() {
        let mut edit = empty_edit();
        let track_a = TrackId::new();
        let track_b = TrackId::new();
        let track_c = TrackId::new();

        for (track_id, name) in [(track_a, "A"), (track_b, "B"), (track_c, "C")] {
            apply_command(
                &mut edit,
                &Command::AddTrack {
                    track: make_default_track(track_id, name, TrackKind::Audio),
                },
            )
            .unwrap();
        }

        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let clip_id = ClipId::new();
        edit.media.push(make_test_media(media_id));
        edit.contents.push(ContentEdit::Audio(AudioContentEdit {
            id: content_id,
            media_id,
            analysis_refs: vec![],
        }));
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, track_b, content_id),
            },
        )
        .unwrap();

        let inverse = apply_command(
            &mut edit,
            &Command::MoveTrack {
                id: track_a,
                new_index: 2,
            },
        )
        .unwrap();

        assert_eq!(
            edit.tracks.iter().map(|track| track.id).collect::<Vec<_>>(),
            vec![track_b, track_c, track_a]
        );
        assert_eq!(
            edit.clips
                .iter()
                .find(|clip| clip.id == clip_id)
                .unwrap()
                .track_id,
            track_b
        );

        apply_command(&mut edit, &inverse).unwrap();

        assert_eq!(
            edit.tracks.iter().map(|track| track.id).collect::<Vec<_>>(),
            vec![track_a, track_b, track_c]
        );
        assert_eq!(
            edit.clips
                .iter()
                .find(|clip| clip.id == clip_id)
                .unwrap()
                .track_id,
            track_b
        );
    }

    // -- SetTrackMute / SetTrackSolo --

    #[test]
    fn set_track_mute_produces_inverse() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "T", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackMute {
                id: tid,
                mute: true,
            },
        )
        .unwrap();
        assert!(edit.tracks.iter().find(|t| t.id == tid).unwrap().mute);

        apply_command(&mut edit, &inv).unwrap();
        assert!(!edit.tracks.iter().find(|t| t.id == tid).unwrap().mute);
    }

    #[test]
    fn set_track_solo_produces_inverse() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "T", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackSolo {
                id: tid,
                solo: true,
            },
        )
        .unwrap();
        assert!(edit.tracks.iter().find(|t| t.id == tid).unwrap().solo);

        apply_command(&mut edit, &inv).unwrap();
        assert!(!edit.tracks.iter().find(|t| t.id == tid).unwrap().solo);
    }

    #[test]
    fn set_track_gain_produces_inverse() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "T", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackGain {
                id: tid,
                gain_milli_db: -6000,
            },
        )
        .unwrap();
        assert_eq!(
            edit.tracks
                .iter()
                .find(|t| t.id == tid)
                .unwrap()
                .gain_milli_db,
            -6000
        );

        apply_command(&mut edit, &inv).unwrap();
        assert_eq!(
            edit.tracks
                .iter()
                .find(|t| t.id == tid)
                .unwrap()
                .gain_milli_db,
            0
        );
    }

    #[test]
    fn set_track_pan_produces_inverse_and_clamps() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "T", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackPan {
                id: tid,
                pan_permille: 1200,
            },
        )
        .unwrap();
        assert_eq!(
            edit.tracks
                .iter()
                .find(|t| t.id == tid)
                .unwrap()
                .pan_permille,
            1000
        );

        apply_command(&mut edit, &inv).unwrap();
        assert_eq!(
            edit.tracks
                .iter()
                .find(|t| t.id == tid)
                .unwrap()
                .pan_permille,
            0
        );
    }

    #[test]
    fn set_track_name_produces_inverse() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackName {
                id: tid,
                name: "Lead Vox [Main]".to_string(),
            },
        )
        .unwrap();
        assert_eq!(
            edit.tracks.iter().find(|t| t.id == tid).unwrap().name,
            "Lead Vox [Main]"
        );
        assert!(matches!(
            &inv,
            Command::RestoreTrackName { id, name } if *id == tid && name == "Track 1"
        ));

        apply_command(&mut edit, &inv).unwrap();
        assert_eq!(
            edit.tracks.iter().find(|t| t.id == tid).unwrap().name,
            "Track 1"
        );
    }

    #[test]
    fn set_track_name_inverse_restores_legacy_name() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
        )
        .unwrap();
        edit.tracks.iter_mut().find(|t| t.id == tid).unwrap().name = "ボーカル".to_string();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackName {
                id: tid,
                name: "Lead Vox".to_string(),
            },
        )
        .unwrap();
        apply_command(&mut edit, &inv).unwrap();

        assert_eq!(
            edit.tracks.iter().find(|t| t.id == tid).unwrap().name,
            "ボーカル"
        );
    }

    #[test]
    fn set_track_name_allows_unicode_characters() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetTrackName {
                id: tid,
                name: "ボーカル".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            edit.tracks.iter().find(|t| t.id == tid).unwrap().name,
            "ボーカル"
        );
        assert!(matches!(
            &inv,
            Command::RestoreTrackName { id, name } if *id == tid && name == "Track 1"
        ));
    }

    #[test]
    fn add_track_rejects_invalid_name() {
        let mut edit = empty_edit();
        let track_id = TrackId::new();
        let err = apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(track_id, " Track 1 ", TrackKind::Audio),
            },
        )
        .unwrap_err();

        assert!(matches!(
            err,
            CommandError::InvalidTrackName {
                reason: "name must not start or end with spaces",
            }
        ));
    }

    #[test]
    fn restore_track_preserves_legacy_name_for_undo() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
        )
        .unwrap();
        edit.tracks.iter_mut().find(|t| t.id == tid).unwrap().name = "ボーカル".to_string();

        let inv = apply_command(&mut edit, &Command::RemoveTrack { id: tid }).unwrap();
        apply_command(&mut edit, &inv).unwrap();

        assert_eq!(
            edit.tracks.iter().find(|t| t.id == tid).unwrap().name,
            "ボーカル"
        );
    }

    // -- AddMediaAsset --

    #[test]
    fn add_media_produces_inverse() {
        let mut edit = empty_edit();
        let mid = MediaId::new();
        let asset = make_test_media(mid);

        let inv = apply_command(&mut edit, &Command::AddMediaAsset { asset }).unwrap();
        assert!(find_media(&edit.media, mid).is_some());

        apply_command(&mut edit, &inv).unwrap();
        assert!(find_media(&edit.media, mid).is_none());
    }

    // -- AddContent --

    #[test]
    fn add_midi_content_produces_inverse() {
        let mut edit = empty_edit();
        let cid = ContentId::new();
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![],
            ccs: vec![],
        });
        let inv = apply_command(&mut edit, &Command::AddContent { content }).unwrap();
        assert!(find_content(&edit.contents, cid).is_some());

        apply_command(&mut edit, &inv).unwrap();
        assert!(find_content(&edit.contents, cid).is_none());
    }

    // -- AddClip / RemoveClip --

    #[test]
    fn add_and_remove_clip() {
        let mut edit = empty_edit();
        let (tid, cid, _mid) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let clip = make_audio_clip(clip_id, tid, cid);

        let inv = apply_command(&mut edit, &Command::AddClip { clip }).unwrap();
        assert!(find_clip(&edit.clips, clip_id).is_some());

        // Inverse removes clip
        let inv2 = apply_command(&mut edit, &inv).unwrap();
        assert!(find_clip(&edit.clips, clip_id).is_none());

        // Re-inverse restores clip
        apply_command(&mut edit, &inv2).unwrap();
        assert!(find_clip(&edit.clips, clip_id).is_some());
    }

    // -- MoveClip --

    #[test]
    fn move_clip_produces_inverse() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::MoveClip {
                clip_id,
                new_start: Tick(480),
            },
        )
        .unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.start, Tick(480));

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.start, Tick(0));
    }

    // -- MoveClipToTrack --

    #[test]
    fn move_clip_to_track_same_kind() {
        let mut edit = empty_edit();
        let (tid1, cid, _) = setup_audio_track_with_content(&mut edit);
        let tid2 = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(tid2, "Audio 2", TrackKind::Audio),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid1, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::MoveClipToTrack {
                clip_id,
                new_track_id: tid2,
            },
        )
        .unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.track_id, tid2);

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.track_id, tid1);
    }

    #[test]
    fn move_clip_to_track_rejects_kind_mismatch() {
        let mut edit = empty_edit();
        let (tid_audio, cid, _) = setup_audio_track_with_content(&mut edit);
        let tid_midi = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid_midi,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid_audio, cid),
            },
        )
        .unwrap();

        // Try to move audio clip to midi track -> should fail
        assert!(apply_command(
            &mut edit,
            &Command::MoveClipToTrack {
                clip_id,
                new_track_id: tid_midi,
            },
        )
        .is_err());
    }

    // -- ResizeClip --

    #[test]
    fn resize_clip_produces_inverse() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::ResizeClip {
                clip_id,
                new_length: Tick(1920),
            },
        )
        .unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.length, Tick(1920));

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.length, Tick(960));
    }

    // -- SetAudioSourceRange --

    #[test]
    fn set_audio_source_range() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetAudioSourceRange {
                clip_id,
                src_in: SrcFrame(100),
                src_out: SrcFrame(22050),
            },
        )
        .unwrap();

        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(100));
                assert_eq!(audio.src_out, SrcFrame(22050));
            }
            _ => panic!("expected audio clip"),
        }

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(0));
                assert_eq!(audio.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio clip"),
        }
    }

    #[test]
    fn set_audio_source_range_rejects_invalid() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        assert!(apply_command(
            &mut edit,
            &Command::SetAudioSourceRange {
                clip_id,
                src_in: SrcFrame(1000),
                src_out: SrcFrame(1000),
            },
        )
        .is_err());
    }

    // -- AddWarpAnchor / RemoveWarpAnchor --

    #[test]
    fn add_and_remove_warp_anchor() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let anchor = WarpAnchorEdit {
            at_in_clip: Tick(480),
            src_frame: SrcFrame(22050),
        };
        let inv = apply_command(
            &mut edit,
            &Command::AddWarpAnchor {
                clip_id,
                anchor: anchor.clone(),
            },
        )
        .unwrap();

        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 1);
                    assert_eq!(anchors[0].at_in_clip, Tick(480));
                }
                _ => panic!("expected Anchors"),
            },
            _ => panic!("expected audio clip"),
        }

        // Inverse removes the anchor
        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::None => {}
                _ => panic!("expected None after removing last anchor"),
            },
            _ => panic!("expected audio clip"),
        }
    }

    // -- SetPitchCoarse / SetPitchFine --

    struct InverseRoundTripCase {
        name: &'static str,
        edit: ProjectEdit,
        command: Command,
    }

    fn assert_inverse_round_trip(case: InverseRoundTripCase) {
        let InverseRoundTripCase {
            name,
            mut edit,
            command,
        } = case;
        let before = json_snapshot(&edit);

        let inverse = apply_command(&mut edit, &command)
            .unwrap_or_else(|error| panic!("{name}: forward command failed: {error}"));
        let after = json_snapshot(&edit);

        let redo = apply_command(&mut edit, &inverse)
            .unwrap_or_else(|error| panic!("{name}: inverse command failed: {error}"));
        assert_eq!(
            json_snapshot(&edit),
            before,
            "{name}: inverse did not restore the complete edit state"
        );

        apply_command(&mut edit, &redo)
            .unwrap_or_else(|error| panic!("{name}: redo command failed: {error}"));
        assert_eq!(
            json_snapshot(&edit),
            after,
            "{name}: redo did not reproduce the forward state"
        );
    }

    fn make_pitch_inverse_case(
        name: &'static str,
        coarse: i16,
        fine: i16,
        command: impl FnOnce(ClipId) -> Command,
    ) -> InverseRoundTripCase {
        let mut edit = empty_edit();
        let (track_id, content_id, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, track_id, content_id);
        match &mut clip.kind {
            ClipKind::Audio { audio, .. } => {
                audio.pitch.manual_coarse_semitones = coarse;
                audio.pitch.manual_fine_cents = fine;
            }
            ClipKind::Midi { .. } => unreachable!(),
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        InverseRoundTripCase {
            name,
            edit,
            command: command(clip_id),
        }
    }

    #[test]
    fn pitch_commands_restore_normalization_carry() {
        let cases = [
            make_pitch_inverse_case("set_pitch_fine", 0, 90, |clip_id| Command::SetPitchFine {
                clip_id,
                cents: 100,
            }),
            make_pitch_inverse_case("set_pitch_coarse", 0, -90, |clip_id| {
                Command::SetPitchCoarse {
                    clip_id,
                    semitones: 1,
                }
            }),
        ];

        for case in cases {
            assert_inverse_round_trip(case);
        }
    }

    #[test]
    fn set_pitch_coarse() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetPitchCoarse {
                clip_id,
                semitones: 3,
            },
        )
        .unwrap();

        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.pitch.manual_coarse_semitones, 3);
            }
            _ => panic!("expected audio clip"),
        }

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.pitch.manual_coarse_semitones, 0);
            }
            _ => panic!("expected audio clip"),
        }
    }

    #[test]
    fn set_midi_transpose_produces_inverse() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        make_midi_clip_with_notes(&mut edit, clip_id, tid);

        let inverse = apply_command(
            &mut edit,
            &Command::SetMidiTranspose {
                clip_id,
                semitones: 3,
            },
        )
        .unwrap();

        let clip = edit
            .clips
            .iter()
            .find(|candidate| candidate.id == clip_id)
            .unwrap();
        match &clip.kind {
            ClipKind::Midi { midi, .. } => assert_eq!(midi.transpose_semitones, 3),
            _ => panic!("expected MIDI clip"),
        }

        apply_command(&mut edit, &inverse).unwrap();
        let clip = edit
            .clips
            .iter()
            .find(|candidate| candidate.id == clip_id)
            .unwrap();
        match &clip.kind {
            ClipKind::Midi { midi, .. } => assert_eq!(midi.transpose_semitones, 0),
            _ => panic!("expected MIDI clip"),
        }
    }

    // -- AddMidiNote / RemoveMidiNote --

    #[test]
    fn add_and_remove_midi_note() {
        let mut edit = empty_edit();
        let cid = ContentId::new();
        apply_command(
            &mut edit,
            &Command::AddContent {
                content: ContentEdit::Midi(MidiContentEdit {
                    id: cid,
                    notes: vec![],
                    ccs: vec![],
                }),
            },
        )
        .unwrap();

        let note = MidiNote {
            id: NoteId::new(),
            start: Tick(0),
            length: Tick(480),
            key: 60,
            vel: 100,
        };
        let inv = apply_command(
            &mut edit,
            &Command::AddMidiNote {
                content_id: cid,
                note: note.clone(),
            },
        )
        .unwrap();

        let idx = find_content(&edit.contents, cid).unwrap();
        match &edit.contents[idx] {
            ContentEdit::Midi(m) => {
                assert_eq!(m.notes.len(), 1);
                assert_eq!(m.notes[0].key, 60);
            }
            _ => panic!("expected midi"),
        }

        apply_command(&mut edit, &inv).unwrap();
        let idx = find_content(&edit.contents, cid).unwrap();
        match &edit.contents[idx] {
            ContentEdit::Midi(m) => assert_eq!(m.notes.len(), 0),
            _ => panic!("expected midi"),
        }
    }

    #[test]
    fn remove_midi_note_rejects_unknown_id() {
        let mut edit = empty_edit();
        let cid = ContentId::new();
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![],
            ccs: vec![],
        }));
        assert!(apply_command(
            &mut edit,
            &Command::RemoveMidiNote {
                content_id: cid,
                note_id: NoteId::new(),
            }
        )
        .is_err());
    }

    #[test]
    fn remove_midi_note_targets_stable_id_after_save_normalization() {
        let mut edit = empty_edit();
        let content_id = ContentId::new();
        let target_id = NoteId::new();
        let other_id = NoteId::new();
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: content_id,
            notes: vec![
                MidiNote {
                    id: target_id,
                    start: Tick(480),
                    length: Tick(120),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: other_id,
                    start: Tick(0),
                    length: Tick(120),
                    key: 64,
                    vel: 100,
                },
            ],
            ccs: vec![],
        }));
        edit.normalize_for_save();
        let before = json_snapshot(&edit);

        let inverse = apply_command(
            &mut edit,
            &Command::RemoveMidiNote {
                content_id,
                note_id: target_id,
            },
        )
        .unwrap();

        let ContentEdit::Midi(midi) = &edit.contents[0] else {
            panic!("expected MIDI content");
        };
        assert_eq!(midi.notes.len(), 1);
        assert_eq!(midi.notes[0].id, other_id);

        apply_command(&mut edit, &inverse).unwrap();
        assert_eq!(json_snapshot(&edit), before);
    }

    #[test]
    fn add_midi_note_rejects_duplicate_id() {
        let mut edit = empty_edit();
        let content_id = ContentId::new();
        let note = MidiNote {
            id: NoteId::new(),
            start: Tick(0),
            length: Tick(120),
            key: 60,
            vel: 100,
        };
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: content_id,
            notes: vec![note.clone()],
            ccs: vec![],
        }));

        assert!(matches!(
            apply_command(
                &mut edit,
                &Command::AddMidiNote {
                    content_id,
                    note: note.clone(),
                },
            ),
            Err(CommandError::MidiNoteAlreadyExists(id)) if id == note.id
        ));
    }

    #[test]
    fn add_midi_note_rejects_invalid_values_without_mutation() {
        let content_id = ContentId::new();
        let invalid_notes = [
            MidiNote {
                id: NoteId::new(),
                start: Tick(-1),
                length: Tick(120),
                key: 60,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(0),
                key: 60,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(120),
                key: 128,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(120),
                key: 60,
                vel: 128,
            },
        ];

        for note in invalid_notes {
            let mut edit = empty_edit();
            edit.contents.push(ContentEdit::Midi(MidiContentEdit {
                id: content_id,
                notes: vec![],
                ccs: vec![],
            }));
            let before = json_snapshot(&edit);
            let error = apply_command(&mut edit, &Command::AddMidiNote { content_id, note })
                .expect_err("invalid MIDI note must be rejected");

            assert_eq!(error.code(), "INVALID_MIDI_NOTE");
            assert_eq!(json_snapshot(&edit), before);
        }
    }

    #[test]
    fn add_content_rejects_invalid_midi_notes_without_mutation() {
        let invalid_notes = [
            MidiNote {
                id: NoteId::new(),
                start: Tick(-1),
                length: Tick(120),
                key: 60,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(0),
                key: 60,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(120),
                key: 128,
                vel: 100,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(120),
                key: 60,
                vel: 128,
            },
        ];

        for note in invalid_notes {
            let mut edit = empty_edit();
            let before = json_snapshot(&edit);
            let error = apply_command(
                &mut edit,
                &Command::AddContent {
                    content: ContentEdit::Midi(MidiContentEdit {
                        id: ContentId::new(),
                        notes: vec![note],
                        ccs: vec![],
                    }),
                },
            )
            .expect_err("MIDI content with an invalid note must be rejected");

            assert_eq!(error.code(), "INVALID_MIDI_NOTE");
            assert_eq!(json_snapshot(&edit), before);
        }
    }

    #[test]
    fn midi_note_value_boundaries_are_valid() {
        let mut edit = empty_edit();
        let content_id = ContentId::new();
        let notes = vec![
            MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(1),
                key: 0,
                vel: 0,
            },
            MidiNote {
                id: NoteId::new(),
                start: Tick(1),
                length: Tick(1),
                key: 127,
                vel: 127,
            },
        ];

        apply_command(
            &mut edit,
            &Command::AddContent {
                content: ContentEdit::Midi(MidiContentEdit {
                    id: content_id,
                    notes,
                    ccs: vec![],
                }),
            },
        )
        .expect("MIDI note boundary values must remain valid");
    }

    // -- SetClipGain / SetClipMute --

    #[test]
    fn set_clip_gain_produces_inverse() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetClipGain {
                clip_id,
                gain_milli_db: -6000,
            },
        )
        .unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.gain_milli_db, -6000);

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.gain_milli_db, 0);
    }

    #[test]
    fn set_clip_mute_produces_inverse() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let inv = apply_command(
            &mut edit,
            &Command::SetClipMute {
                clip_id,
                muted: true,
            },
        )
        .unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert!(c.muted);

        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert!(!c.muted);
    }

    // -- AddPitchLink / RemovePitchLink --

    #[test]
    fn add_and_remove_pitch_link() {
        let mut edit = empty_edit();
        let midi_track = TrackId::new();
        let audio_track = TrackId::new();
        edit.tracks.push(make_default_track(
            midi_track,
            "MIDI",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        edit.tracks
            .push(make_default_track(audio_track, "Audio", TrackKind::Audio));
        let link = MidiToAudioPitchLink {
            id: PitchLinkId::new(),
            midi_track,
            audio_track,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        };

        let inv = apply_command(&mut edit, &Command::AddPitchLink { link: link.clone() }).unwrap();
        assert_eq!(edit.pitch_links.len(), 1);

        apply_command(&mut edit, &inv).unwrap();
        assert_eq!(edit.pitch_links.len(), 0);
    }

    #[test]
    fn add_pitch_link_rejects_invalid_references_kinds_and_duplicates() {
        let midi_track = TrackId::new();
        let audio_track = TrackId::new();
        let mut base = empty_edit();
        base.tracks.push(make_default_track(
            midi_track,
            "MIDI",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        base.tracks
            .push(make_default_track(audio_track, "Audio", TrackKind::Audio));

        let make_link = |id, midi_track, audio_track| MidiToAudioPitchLink {
            id,
            midi_track,
            audio_track,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        };
        let existing_id = PitchLinkId::new();
        let existing = make_link(existing_id, midi_track, audio_track);

        let invalid_links = [
            (
                make_link(PitchLinkId::new(), TrackId::new(), audio_track),
                "TRACK_NOT_FOUND",
            ),
            (
                make_link(PitchLinkId::new(), audio_track, audio_track),
                "PITCH_LINK_SOURCE_NOT_MIDI",
            ),
            (
                make_link(PitchLinkId::new(), midi_track, TrackId::new()),
                "TRACK_NOT_FOUND",
            ),
            (
                make_link(PitchLinkId::new(), midi_track, midi_track),
                "PITCH_LINK_TARGET_NOT_AUDIO",
            ),
        ];
        for (link, expected_code) in invalid_links {
            let mut edit = base.clone();
            let error = apply_command(&mut edit, &Command::AddPitchLink { link }).unwrap_err();
            assert_eq!(error.code(), expected_code);
            assert!(edit.pitch_links.is_empty());
        }

        let mut duplicate_id_edit = base.clone();
        duplicate_id_edit.pitch_links.push(existing.clone());
        let error = apply_command(
            &mut duplicate_id_edit,
            &Command::AddPitchLink {
                link: existing.clone(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "PITCH_LINK_ALREADY_EXISTS");
        assert_eq!(duplicate_id_edit.pitch_links.len(), 1);

        let mut duplicate_target_edit = base;
        duplicate_target_edit.pitch_links.push(existing);
        let error = apply_command(
            &mut duplicate_target_edit,
            &Command::AddPitchLink {
                link: make_link(PitchLinkId::new(), midi_track, audio_track),
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "DUPLICATE_PITCH_LINK_FOR_AUDIO_TRACK");
        assert_eq!(duplicate_target_edit.pitch_links.len(), 1);
    }

    #[test]
    fn remove_pitch_link_rejects_bad_id() {
        let mut edit = empty_edit();
        assert!(apply_command(
            &mut edit,
            &Command::RemovePitchLink {
                id: PitchLinkId::new()
            }
        )
        .is_err());
    }

    // -- UndoStack --

    #[test]
    fn undo_stack_basic() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();

        assert!(!stack.can_undo());
        assert!(!stack.can_redo());

        let inv = apply_command(
            &mut edit,
            &Command::SetBpm {
                micro_bpm: 140_000_000,
            },
        )
        .unwrap();
        stack.push(inv);

        assert!(stack.can_undo());
        assert!(!stack.can_redo());

        stack.undo(&mut edit).unwrap();
        assert_eq!(edit.tempo.points[0].micro_bpm, 120_000_000);
        assert!(!stack.can_undo());
        assert!(stack.can_redo());

        stack.redo(&mut edit).unwrap();
        assert_eq!(edit.tempo.points[0].micro_bpm, 140_000_000);
        assert!(stack.can_undo());
        assert!(!stack.can_redo());
    }

    #[test]
    fn undo_stack_push_clears_redo() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();

        let inv1 = apply_command(
            &mut edit,
            &Command::SetBpm {
                micro_bpm: 140_000_000,
            },
        )
        .unwrap();
        stack.push(inv1);

        stack.undo(&mut edit).unwrap();
        assert!(stack.can_redo());

        let inv2 = apply_command(
            &mut edit,
            &Command::SetBpm {
                micro_bpm: 160_000_000,
            },
        )
        .unwrap();
        stack.push(inv2);
        assert!(!stack.can_redo());
    }

    #[test]
    fn undo_nothing_errors() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();
        assert!(stack.undo(&mut edit).is_err());
    }

    #[test]
    fn redo_nothing_errors() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();
        assert!(stack.redo(&mut edit).is_err());
    }

    // -- Replay test: apply N commands, undo all, state matches original --

    #[test]
    fn replay_undo_all_restores_original() {
        let original = empty_edit();
        let mut edit = original.clone();
        let mut stack = UndoStack::new();

        let tid = TrackId::new();
        let commands = vec![
            Command::SetBpm {
                micro_bpm: 140_000_000,
            },
            Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
            Command::SetTrackName {
                id: tid,
                name: "Lead 1".to_string(),
            },
            Command::SetTrackMute {
                id: tid,
                mute: true,
            },
            Command::SetBpm {
                micro_bpm: 180_000_000,
            },
        ];

        for cmd in &commands {
            let inv = apply_command(&mut edit, cmd).unwrap();
            stack.push(inv);
        }

        assert_eq!(edit.tempo.points[0].micro_bpm, 180_000_000);
        assert!(find_track(&edit.tracks, tid).is_some());

        while stack.can_undo() {
            stack.undo(&mut edit).unwrap();
        }

        assert_eq!(edit.tempo.points[0].micro_bpm, 120_000_000);
        assert!(edit.tracks.is_empty());
        assert_eq!(edit.clips.len(), original.clips.len());
        assert_eq!(edit.contents.len(), original.contents.len());
        assert_eq!(edit.media.len(), original.media.len());
    }

    #[test]
    fn replay_undo_all_then_redo_all() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();

        let tid = TrackId::new();
        let commands = vec![
            Command::SetBpm {
                micro_bpm: 140_000_000,
            },
            Command::AddTrack {
                track: make_default_track(tid, "Track 1", TrackKind::Audio),
            },
            Command::SetTrackName {
                id: tid,
                name: "Lead 1".to_string(),
            },
            Command::SetTrackSolo {
                id: tid,
                solo: true,
            },
        ];

        for cmd in &commands {
            let inv = apply_command(&mut edit, cmd).unwrap();
            stack.push(inv);
        }

        let after_all_bpm = edit.tempo.points[0].micro_bpm;

        while stack.can_undo() {
            stack.undo(&mut edit).unwrap();
        }

        while stack.can_redo() {
            stack.redo(&mut edit).unwrap();
        }

        assert_eq!(edit.tempo.points[0].micro_bpm, after_all_bpm);
        assert_eq!(edit.tracks.len(), 1);
        assert!(find_track(&edit.tracks, tid).is_some());
    }

    #[test]
    fn batch_command_is_undone_as_one_step() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();
        let track_id = TrackId::new();

        let inverse = apply_command(
            &mut edit,
            &Command::Batch {
                commands: vec![
                    Command::AddTrack {
                        track: make_default_track(track_id, "Track 1", TrackKind::Audio),
                    },
                    Command::SetBpm {
                        micro_bpm: 140_000_000,
                    },
                ],
            },
        )
        .unwrap();
        stack.push(inverse);

        assert_eq!(edit.tempo.points[0].micro_bpm, 140_000_000);
        assert!(find_track(&edit.tracks, track_id).is_some());

        stack.undo(&mut edit).unwrap();
        assert_eq!(edit.tempo.points[0].micro_bpm, 120_000_000);
        assert!(find_track(&edit.tracks, track_id).is_none());

        stack.redo(&mut edit).unwrap();
        assert_eq!(edit.tempo.points[0].micro_bpm, 140_000_000);
        assert!(find_track(&edit.tracks, track_id).is_some());
    }

    #[test]
    fn batch_command_rolls_back_on_failure() {
        let mut edit = empty_edit();
        let original = edit.clone();
        let missing_track = TrackId::new();

        let result = apply_command(
            &mut edit,
            &Command::Batch {
                commands: vec![
                    Command::SetBpm {
                        micro_bpm: 140_000_000,
                    },
                    Command::SetTrackMute {
                        id: missing_track,
                        mute: true,
                    },
                ],
            },
        );

        assert!(matches!(result, Err(CommandError::TrackNotFound(id)) if id == missing_track));
        assert_eq!(
            edit.tempo.points[0].micro_bpm,
            original.tempo.points[0].micro_bpm
        );
        assert_eq!(edit.tracks.len(), original.tracks.len());
        assert_eq!(edit.clips.len(), original.clips.len());
    }

    #[test]
    fn batch_failure_does_not_depend_on_inverse_rollback() {
        let mut edit = empty_edit();
        let track_id = TrackId::new();
        let content_id = ContentId::new();
        let clip_id = ClipId::new();
        edit.tracks.push(make_default_track(
            track_id,
            "MIDI 1",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: content_id,
            notes: vec![],
            ccs: vec![],
        }));
        edit.clips.push(ClipEdit {
            id: clip_id,
            track_id,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        });
        let before = json_snapshot(&edit);
        let missing_track = TrackId::new();

        let result = apply_command(
            &mut edit,
            &Command::Batch {
                commands: vec![
                    Command::AddMidiNote {
                        content_id,
                        note: MidiNote {
                            id: NoteId::new(),
                            start: Tick(900),
                            length: Tick(120),
                            key: 60,
                            vel: 100,
                        },
                    },
                    Command::MidiRedTrim {
                        clip_id,
                        new_start: Tick(0),
                        new_content_in: Tick(0),
                        new_content_out: Tick(840),
                    },
                    Command::SetTrackMute {
                        id: missing_track,
                        mute: true,
                    },
                ],
            },
        );

        assert!(matches!(result, Err(CommandError::TrackNotFound(id)) if id == missing_track));
        assert_eq!(json_snapshot(&edit), before);
    }

    // -- Command serialization roundtrip --

    #[test]
    fn command_json_roundtrip() {
        let cmd = Command::SetBpm {
            micro_bpm: 140_000_000,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SetBpm { micro_bpm } => assert_eq!(micro_bpm, 140_000_000),
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn command_add_track_json_roundtrip() {
        let cmd = Command::AddTrack {
            track: make_default_track(
                TrackId::new(),
                "Test",
                TrackKind::Midi {
                    audition_instrument: None,
                    render_enabled: false,
                },
            ),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let _cmd2: Command = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn batch_command_json_roundtrip() {
        let cmd = Command::Batch {
            commands: vec![
                Command::SetBpm {
                    micro_bpm: 140_000_000,
                },
                Command::SetGridSettings {
                    grid: GridSettings {
                        snap_enabled: false,
                        division: GridDivision::Quarter,
                        swing_permille: 0,
                        magnet_range_permille: 250,
                        snap_strength_permille: 1000,
                    },
                },
            ],
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::Batch { commands } => assert_eq!(commands.len(), 2),
            _ => panic!("roundtrip failed"),
        }
    }

    // -- Complex scenario: clip operations with undo --

    #[test]
    fn clip_lifecycle_with_undo() {
        let mut edit = empty_edit();
        let mut stack = UndoStack::new();

        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let clip = make_audio_clip(clip_id, tid, cid);

        // Add clip
        let inv = apply_command(&mut edit, &Command::AddClip { clip }).unwrap();
        stack.push(inv);

        // Move clip
        let inv = apply_command(
            &mut edit,
            &Command::MoveClip {
                clip_id,
                new_start: Tick(960),
            },
        )
        .unwrap();
        stack.push(inv);

        // Resize clip
        let inv = apply_command(
            &mut edit,
            &Command::ResizeClip {
                clip_id,
                new_length: Tick(1920),
            },
        )
        .unwrap();
        stack.push(inv);

        // Set pitch coarse
        let inv = apply_command(
            &mut edit,
            &Command::SetPitchCoarse {
                clip_id,
                semitones: 5,
            },
        )
        .unwrap();
        stack.push(inv);

        // Verify current state
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.start, Tick(960));
        assert_eq!(c.length, Tick(1920));

        // Undo all clip operations
        while stack.can_undo() {
            stack.undo(&mut edit).unwrap();
        }

        // Clip should be gone
        assert!(find_clip(&edit.clips, clip_id).is_none());
    }

    // -- RemoveTrack cascades owned clips and pitch links --

    #[test]
    fn remove_track_removes_owned_clips_and_pitch_links() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let midi_track_id = TrackId::new();
        edit.tracks.push(make_default_track(
            midi_track_id,
            "MIDI 1",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();
        let link_id = PitchLinkId::new();
        edit.pitch_links.push(MidiToAudioPitchLink {
            id: link_id,
            midi_track: midi_track_id,
            audio_track: tid,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        });
        let before = json_snapshot(&edit);

        assert!(find_clip(&edit.clips, clip_id).is_some());
        assert!(find_pitch_link(&edit.pitch_links, link_id).is_some());

        let inv = apply_command(&mut edit, &Command::RemoveTrack { id: tid }).unwrap();

        // Owned clips and links referencing the track are removed together.
        assert!(find_clip(&edit.clips, clip_id).is_none());
        assert!(find_pitch_link(&edit.pitch_links, link_id).is_none());
        assert!(find_track(&edit.tracks, tid).is_none());

        // Undo restores the complete edit, including collection positions.
        apply_command(&mut edit, &inv).unwrap();
        assert_eq!(json_snapshot(&edit), before);
    }

    #[test]
    fn remove_midi_track_removes_referencing_pitch_links() {
        let mut edit = empty_edit();
        let (audio_track_id, _, _) = setup_audio_track_with_content(&mut edit);
        let midi_track_id = TrackId::new();
        edit.tracks.push(make_default_track(
            midi_track_id,
            "MIDI 1",
            TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
        ));
        let link_id = PitchLinkId::new();
        edit.pitch_links.push(MidiToAudioPitchLink {
            id: link_id,
            midi_track: midi_track_id,
            audio_track: audio_track_id,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        });

        apply_command(&mut edit, &Command::RemoveTrack { id: midi_track_id }).unwrap();

        assert!(find_pitch_link(&edit.pitch_links, link_id).is_none());
    }

    // -- Pitch normalization --

    #[test]
    fn pitch_normalize() {
        let mut p = PitchControlEdit {
            mode: PitchControlMode::ManualOnly,
            manual_coarse_semitones: 1,
            manual_fine_cents: 130,
        };
        p.normalize();
        assert_eq!(p.manual_coarse_semitones, 2);
        assert_eq!(p.manual_fine_cents, 30);
    }

    #[test]
    fn pitch_normalize_negative() {
        let mut p = PitchControlEdit {
            mode: PitchControlMode::ManualOnly,
            manual_coarse_semitones: -1,
            manual_fine_cents: -130,
        };
        p.normalize();
        assert_eq!(p.manual_coarse_semitones, -2);
        assert_eq!(p.manual_fine_cents, -30);
    }

    // ===================================================================
    // SplitClip tests
    // ===================================================================

    #[test]
    fn split_audio_clip_no_warp() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        // clip: start=0, length=960, src_in=0, src_out=44100
        clip.start = Tick(0);
        clip.length = Tick(960);
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let right_id = ClipId::new();
        let inv = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        // Left clip: length=480, src_out = 44100 * 480 / 960 = 22050
        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(left.length, Tick(480));
        assert_eq!(left.start, Tick(0));
        match &left.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(0));
                assert_eq!(audio.src_out, SrcFrame(22050));
            }
            _ => panic!("expected audio"),
        }

        // Right clip: start=480, length=480, src_in=22050, src_out=44100
        let right = edit.clips.iter().find(|c| c.id == right_id).unwrap();
        assert_eq!(right.start, Tick(480));
        assert_eq!(right.length, Tick(480));
        match &right.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(22050));
                assert_eq!(audio.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio"),
        }

        // Undo should restore original clip
        apply_command(&mut edit, &inv).unwrap();
        assert!(find_clip(&edit.clips, right_id).is_none());
        let restored = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(restored.length, Tick(960));
        match &restored.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(0));
                assert_eq!(audio.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn split_audio_clip_with_warp_anchors() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        // Add a warp anchor at tick 240 -> src_frame 5000
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(5000),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(720),
                        src_frame: SrcFrame(30000),
                    },
                ],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let right_id = ClipId::new();
        let inv = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        // Left clip should keep anchor at tick 240
        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(left.length, Tick(480));
        match &left.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 1);
                    assert_eq!(anchors[0].at_in_clip, Tick(240));
                }
                _ => panic!("expected anchors on left"),
            },
            _ => panic!("expected audio"),
        }

        // Right clip should have anchor at tick 720-480=240
        let right = edit.clips.iter().find(|c| c.id == right_id).unwrap();
        assert_eq!(right.length, Tick(480));
        match &right.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 1);
                    assert_eq!(anchors[0].at_in_clip, Tick(240));
                    assert_eq!(anchors[0].src_frame, SrcFrame(30000));
                }
                _ => panic!("expected anchors on right"),
            },
            _ => panic!("expected audio"),
        }

        // Undo restores everything
        apply_command(&mut edit, &inv).unwrap();
        assert!(find_clip(&edit.clips, right_id).is_none());
        let restored = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(restored.length, Tick(960));
        match &restored.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => assert_eq!(anchors.len(), 2),
                _ => panic!("expected anchors restored"),
            },
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn split_audio_clip_keeps_anchor_at_split_on_right_clip() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(480),
                        src_frame: SrcFrame(22_050),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(720),
                        src_frame: SrcFrame(30_000),
                    },
                ],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let right_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &left.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::None => {}
                other => panic!("expected left crop to drop split anchor, got {:?}", other),
            },
            _ => panic!("expected audio"),
        }

        let right = edit.clips.iter().find(|c| c.id == right_id).unwrap();
        match &right.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 2);
                    assert_eq!(anchors[0].at_in_clip, Tick(0));
                    assert_eq!(anchors[0].src_frame, SrcFrame(22_050));
                    assert_eq!(anchors[1].at_in_clip, Tick(240));
                }
                other => panic!("expected right anchors, got {:?}", other),
            },
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn audio_blue_stretch_keeps_zero_tick_warp_anchor_at_zero() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(0),
                        src_frame: SrcFrame(0),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(10_000),
                    },
                ],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        apply_command(
            &mut edit,
            &Command::AudioBlueStretch {
                clip_id,
                new_start: Tick(0),
                new_length: Tick(1_920),
            },
        )
        .unwrap();

        let stretched = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &stretched.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 2);
                    assert_eq!(anchors[0].at_in_clip, Tick(0));
                    assert_eq!(anchors[0].src_frame, SrcFrame(0));
                    assert_eq!(anchors[1].at_in_clip, Tick(480));
                }
                other => panic!("expected anchors, got {:?}", other),
            },
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn split_audio_clip_fades_distributed() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades.fade_in = Tick(100);
            audio.fades.fade_out = Tick(200);
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let right_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        // Left gets original fade_in, fade_out zeroed
        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &left.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.fades.fade_in, Tick(100));
                assert_eq!(audio.fades.fade_out, Tick(0));
            }
            _ => panic!("expected audio"),
        }

        // Right gets original fade_out, fade_in zeroed
        let right = edit.clips.iter().find(|c| c.id == right_id).unwrap();
        match &right.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.fades.fade_in, Tick(0));
                assert_eq!(audio.fades.fade_out, Tick(200));
            }
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn split_audio_clip_rejects_left_fade_longer_than_child_without_mutation() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades = FadesEdit {
                fade_in: Tick(600),
                fade_out: Tick(200),
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let before = json_snapshot(&edit);
        let result = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: ClipId::new(),
            },
        );

        assert!(matches!(result, Err(CommandError::InvalidFadeRange { .. })));
        assert_eq!(before, json_snapshot(&edit));
    }

    #[test]
    fn split_warped_audio_clip_rejects_right_fade_longer_than_child_without_mutation() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades = FadesEdit {
                fade_in: Tick(200),
                fade_out: Tick(600),
            };
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(720),
                    src_frame: SrcFrame(30_000),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let before = json_snapshot(&edit);
        let result = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: ClipId::new(),
            },
        );

        assert!(matches!(result, Err(CommandError::InvalidFadeRange { .. })));
        assert_eq!(before, json_snapshot(&edit));
    }

    #[test]
    fn split_clip_rejects_invalid_position() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        // tick_in_clip = 0 (at the very start) is invalid
        assert!(apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(0),
                new_clip_id: ClipId::new(),
            },
        )
        .is_err());

        // tick_in_clip = clip.length is invalid
        assert!(apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(960),
                new_clip_id: ClipId::new(),
            },
        )
        .is_err());
    }

    fn make_midi_clip_with_notes(
        edit: &mut ProjectEdit,
        clip_id: ClipId,
        track_id: TrackId,
    ) -> ContentId {
        let cid = ContentId::new();
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(240),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(480),
                    length: Tick(240),
                    key: 62,
                    vel: 100,
                },
            ],
            ccs: vec![],
        });
        edit.contents.push(content);

        let clip = ClipEdit {
            id: clip_id,
            track_id,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: cid,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        };
        apply_command(edit, &Command::AddClip { clip }).unwrap();
        cid
    }

    #[test]
    fn split_midi_clip_no_crossing() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        let _cid = make_midi_clip_with_notes(&mut edit, clip_id, tid);
        if let ClipKind::Midi { midi, .. } = &mut edit
            .clips
            .iter_mut()
            .find(|clip| clip.id == clip_id)
            .unwrap()
            .kind
        {
            midi.transpose_semitones = 4;
        }

        let right_id = ClipId::new();
        let inv = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        // Left clip: length=480, content window [0, 480)
        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(left.length, Tick(480));
        match &left.kind {
            ClipKind::Midi { midi, .. } => {
                assert_eq!(midi.content_in, Tick(0));
                assert_eq!(midi.content_out, Tick(480));
                assert_eq!(midi.transpose_semitones, 4);
            }
            _ => panic!("expected midi"),
        }

        // Right clip: length=480, content window [480, 960)
        let right = edit.clips.iter().find(|c| c.id == right_id).unwrap();
        assert_eq!(right.length, Tick(480));
        assert_eq!(right.start, Tick(480));
        match &right.kind {
            ClipKind::Midi { content_id, midi } => {
                let left_content_id = match &left.kind {
                    ClipKind::Midi { content_id, .. } => *content_id,
                    _ => unreachable!("expected midi left clip"),
                };
                assert_eq!(*content_id, left_content_id);
                assert_eq!(midi.content_in, Tick(480));
                assert_eq!(midi.content_out, Tick(960));
                assert_eq!(midi.transpose_semitones, 4);
            }
            _ => panic!("expected midi"),
        }

        // Shared MIDI content should remain single-source-of-truth
        assert_eq!(edit.contents.len(), 1);

        // Undo should remove right clip without touching shared content
        apply_command(&mut edit, &inv).unwrap();
        assert!(find_clip(&edit.clips, right_id).is_none());
        assert_eq!(edit.contents.len(), 1);
        let restored = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(restored.length, Tick(960));
    }

    #[test]
    fn split_midi_clip_rejects_note_crossing() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        // Note at start=0 length=240 -> ends at 240. Safe at split=240.
        // But let's put a note crossing the split point.
        let cid = ContentId::new();
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(200),
                length: Tick(400),
                key: 60,
                vel: 100,
            }],
            ccs: vec![],
        });
        edit.contents.push(content);

        let clip = ClipEdit {
            id: clip_id,
            track_id: tid,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: cid,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        };
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        // Split at tick 480 in clip. The note at [200, 600) crosses this point.
        let result = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: ClipId::new(),
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn split_clip_undo_redo_roundtrip() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let original_clip = edit.clips.iter().find(|c| c.id == clip_id).unwrap().clone();

        let right_id = ClipId::new();
        let inv = apply_command(
            &mut edit,
            &Command::SplitClip {
                clip_id,
                tick_in_clip: Tick(480),
                new_clip_id: right_id,
            },
        )
        .unwrap();

        // Undo
        let redo_cmd = apply_command(&mut edit, &inv).unwrap();
        let restored = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(restored.length, original_clip.length);
        assert!(find_clip(&edit.clips, right_id).is_none());

        // Redo
        let undo_again = apply_command(&mut edit, &redo_cmd).unwrap();
        assert_eq!(edit.clips.len(), 2); // original (modified) + right
        let left = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(left.length, Tick(480));

        // Undo again to verify cycle
        apply_command(&mut edit, &undo_again).unwrap();
        let restored = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(restored.length, Tick(960));
    }

    #[test]
    fn audio_blue_stretch_scales_warp_anchors_and_preserves_source() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(240),
                    src_frame: SrcFrame(10_000),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        apply_command(
            &mut edit,
            &Command::AudioBlueStretch {
                clip_id,
                new_start: Tick(0),
                new_length: Tick(1_920),
            },
        )
        .unwrap();

        let stretched = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(stretched.length, Tick(1_920));
        match &stretched.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(0));
                assert_eq!(audio.src_out, SrcFrame(44_100));
                match &audio.warp {
                    WarpMapEdit::Anchors { anchors } => {
                        assert_eq!(anchors.len(), 1);
                        assert_eq!(anchors[0].at_in_clip, Tick(480));
                        assert_eq!(anchors[0].src_frame, SrcFrame(10_000));
                    }
                    other => panic!("expected anchors, got {:?}", other),
                }
            }
            _ => panic!("expected audio"),
        }
    }

    // ===================================================================
    // AudioRedTrim tests
    // ===================================================================

    #[test]
    fn audio_red_trim_basic() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        // Red-trim: shrink from the start side
        let inv = apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(11025),
                new_src_out: SrcFrame(44100),
                new_start: Tick(240),
                new_length: Tick(720),
            },
        )
        .unwrap();

        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.start, Tick(240));
        assert_eq!(c.length, Tick(720));
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(11025));
                assert_eq!(audio.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio"),
        }

        // Undo restores original
        apply_command(&mut edit, &inv).unwrap();
        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(c.start, Tick(0));
        assert_eq!(c.length, Tick(960));
        match &c.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(0));
                assert_eq!(audio.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn audio_red_trim_rejects_invalid_src_range() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        assert!(apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(44100),
                new_src_out: SrcFrame(44100),
                new_start: Tick(0),
                new_length: Tick(480),
            },
        )
        .is_err());
    }

    #[test]
    fn audio_red_trim_rejects_non_audio_clip() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        make_midi_clip_with_notes(&mut edit, clip_id, tid);

        assert!(apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(0),
                new_src_out: SrcFrame(22050),
                new_start: Tick(0),
                new_length: Tick(480),
            },
        )
        .is_err());
    }

    #[test]
    fn audio_red_trim_rejects_exceeds_media() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        let result = apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(0),
                new_src_out: SrcFrame(44101),
                new_start: Tick(0),
                new_length: Tick(961),
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn audio_red_trim_fade_failure_leaves_edit_untouched() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades = FadesEdit {
                fade_in: Tick(240),
                fade_out: Tick(480),
            };
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(480),
                    src_frame: SrcFrame(22050),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let before = json_snapshot(&edit);
        // fade_in + fade_out (720) > new_length (480) -> InvalidFadeRange.
        // The warp/src mutation must not survive the failure.
        let result = apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(0),
                new_src_out: SrcFrame(22050),
                new_start: Tick(0),
                new_length: Tick(480),
            },
        );
        assert!(matches!(result, Err(CommandError::InvalidFadeRange { .. })));
        assert_eq!(before, json_snapshot(&edit));
    }

    #[test]
    fn audio_blue_stretch_fade_failure_leaves_edit_untouched() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades = FadesEdit {
                fade_in: Tick(240),
                fade_out: Tick(480),
            };
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(480),
                    src_frame: SrcFrame(22050),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let before = json_snapshot(&edit);
        // fade_in + fade_out (720) > new_length (480) -> InvalidFadeRange.
        // The anchor rescale must not survive the failure.
        let result = apply_command(
            &mut edit,
            &Command::AudioBlueStretch {
                clip_id,
                new_start: Tick(0),
                new_length: Tick(480),
            },
        );
        assert!(matches!(result, Err(CommandError::InvalidFadeRange { .. })));
        assert_eq!(before, json_snapshot(&edit));
    }

    #[test]
    fn batch_rollback_after_fade_failure_leaves_edit_untouched() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.fades = FadesEdit {
                fade_in: Tick(240),
                fade_out: Tick(480),
            };
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(480),
                    src_frame: SrcFrame(22050),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        let before = json_snapshot(&edit);
        // A batch whose second command fails must roll back to the exact
        // pre-batch state, including the state touched by the failing command.
        let result = apply_command(
            &mut edit,
            &Command::Batch {
                commands: vec![
                    Command::MoveClip {
                        clip_id,
                        new_start: Tick(480),
                    },
                    Command::AudioRedTrim {
                        clip_id,
                        new_src_in: SrcFrame(0),
                        new_src_out: SrcFrame(22050),
                        new_start: Tick(480),
                        new_length: Tick(480),
                    },
                ],
            },
        );
        assert!(result.is_err());
        assert_eq!(before, json_snapshot(&edit));
    }

    #[test]
    fn audio_red_trim_with_warp_crops_anchors_without_restoring_deleted_side() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(10_000),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(720),
                        src_frame: SrcFrame(30_000),
                    },
                ],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        apply_command(
            &mut edit,
            &Command::AudioRedTrim {
                clip_id,
                new_src_in: SrcFrame(0),
                new_src_out: SrcFrame(0),
                new_start: Tick(240),
                new_length: Tick(720),
            },
        )
        .unwrap();

        let trimmed = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(trimmed.start, Tick(240));
        assert_eq!(trimmed.length, Tick(720));
        match &trimmed.kind {
            ClipKind::Audio { audio, .. } => {
                assert_eq!(audio.src_in, SrcFrame(10_000));
                assert_eq!(audio.src_out, SrcFrame(44_100));
                match &audio.warp {
                    WarpMapEdit::Anchors { anchors } => {
                        assert_eq!(anchors.len(), 1);
                        assert_eq!(anchors[0].at_in_clip, Tick(480));
                        assert_eq!(anchors[0].src_frame, SrcFrame(30_000));
                    }
                    other => panic!("expected anchors, got {:?}", other),
                }
            }
            _ => panic!("expected audio"),
        }
    }

    #[test]
    fn midi_red_trim_updates_start_and_window_together() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let clip_id = ClipId::new();
        make_midi_clip_with_notes(&mut edit, clip_id, tid);

        apply_command(
            &mut edit,
            &Command::MidiRedTrim {
                clip_id,
                new_start: Tick(480),
                new_content_in: Tick(480),
                new_content_out: Tick(960),
            },
        )
        .unwrap();

        let trimmed = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        assert_eq!(trimmed.start, Tick(480));
        assert_eq!(trimmed.length, Tick(480));
        match &trimmed.kind {
            ClipKind::Midi { midi, .. } => {
                assert_eq!(midi.content_in, Tick(480));
                assert_eq!(midi.content_out, Tick(960));
            }
            _ => panic!("expected midi"),
        }
    }

    #[test]
    fn add_warp_anchor_at_tick_uses_current_time_map() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        clip.length = Tick(960);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(480),
                    src_frame: SrcFrame(22_050),
                }],
            };
        }
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        apply_command(
            &mut edit,
            &Command::AddWarpAnchorAtTick {
                clip_id,
                tick_in_clip: Tick(240),
            },
        )
        .unwrap();

        let updated = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &updated.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors.len(), 2);
                    assert_eq!(anchors[0].at_in_clip, Tick(240));
                    assert_eq!(anchors[0].src_frame, SrcFrame(11_025));
                    assert_eq!(anchors[1].at_in_clip, Tick(480));
                }
                other => panic!("expected anchors, got {:?}", other),
            },
            _ => panic!("expected audio"),
        }
    }

    // ===================================================================
    // SetMidiContentWindow note-crossing validation tests
    // ===================================================================

    #[test]
    fn midi_content_window_rejects_note_crossing_at_in() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let cid = ContentId::new();
        // Note from tick 100 to tick 500
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(100),
                length: Tick(400),
                key: 60,
                vel: 100,
            }],
            ccs: vec![],
        });
        edit.contents.push(content);

        let clip_id = ClipId::new();
        let clip = ClipEdit {
            id: clip_id,
            track_id: tid,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: cid,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        };
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        // Try to set content_in to 200 -- crosses note [100, 500)
        let result = apply_command(
            &mut edit,
            &Command::SetMidiContentWindow {
                clip_id,
                content_in: Tick(200),
                content_out: Tick(960),
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn midi_content_window_rejects_note_crossing_at_out() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let cid = ContentId::new();
        // Note from tick 700 to tick 900
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(700),
                length: Tick(200),
                key: 60,
                vel: 100,
            }],
            ccs: vec![],
        });
        edit.contents.push(content);

        let clip_id = ClipId::new();
        let clip = ClipEdit {
            id: clip_id,
            track_id: tid,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: cid,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        };
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        // Try to set content_out to 800 -- crosses note [700, 900)
        let result = apply_command(
            &mut edit,
            &Command::SetMidiContentWindow {
                clip_id,
                content_in: Tick(0),
                content_out: Tick(800),
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn midi_content_window_accepts_non_crossing() {
        let mut edit = empty_edit();
        let tid = TrackId::new();
        apply_command(
            &mut edit,
            &Command::AddTrack {
                track: make_default_track(
                    tid,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            },
        )
        .unwrap();

        let cid = ContentId::new();
        // Note from tick 100 to tick 200
        let content = ContentEdit::Midi(MidiContentEdit {
            id: cid,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(100),
                length: Tick(100),
                key: 60,
                vel: 100,
            }],
            ccs: vec![],
        });
        edit.contents.push(content);

        let clip_id = ClipId::new();
        let clip = ClipEdit {
            id: clip_id,
            track_id: tid,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: cid,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        };
        apply_command(&mut edit, &Command::AddClip { clip }).unwrap();

        // Trim to [200, 960) -- note ends exactly at 200, no crossing
        let result = apply_command(
            &mut edit,
            &Command::SetMidiContentWindow {
                clip_id,
                content_in: Tick(200),
                content_out: Tick(960),
            },
        );
        assert!(result.is_ok());
    }

    // ===================================================================
    // SetAudioSourceRange media length validation tests
    // ===================================================================

    #[test]
    fn set_audio_source_range_rejects_exceeds_media() {
        let mut edit = empty_edit();
        let (tid, cid, _mid) = setup_audio_track_with_content(&mut edit);
        // media.length_src_frames = 44100
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        // Try to set src_out beyond media length
        let result = apply_command(
            &mut edit,
            &Command::SetAudioSourceRange {
                clip_id,
                src_in: SrcFrame(0),
                src_out: SrcFrame(44101), // exceeds 44100
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn set_audio_source_range_accepts_exact_media_length() {
        let mut edit = empty_edit();
        let (tid, cid, _mid) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        apply_command(
            &mut edit,
            &Command::AddClip {
                clip: make_audio_clip(clip_id, tid, cid),
            },
        )
        .unwrap();

        // Exactly at media length should be OK
        let result = apply_command(
            &mut edit,
            &Command::SetAudioSourceRange {
                clip_id,
                src_in: SrcFrame(0),
                src_out: SrcFrame(44100),
            },
        );
        assert!(result.is_ok());
    }

    // ===================================================================
    // normalize_for_save tests
    // ===================================================================

    #[test]
    fn normalize_for_save_sorts_midi_notes() {
        let mut edit = empty_edit();
        edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: ContentId::new(),
            notes: vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(480),
                    length: Tick(240),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(240),
                    key: 62,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(240),
                    key: 60,
                    vel: 100,
                },
            ],
            ccs: vec![],
        }));

        edit.normalize_for_save();

        match &edit.contents[0] {
            ContentEdit::Midi(m) => {
                assert_eq!(m.notes[0].start, Tick(0));
                assert_eq!(m.notes[0].key, 60);
                assert_eq!(m.notes[1].start, Tick(0));
                assert_eq!(m.notes[1].key, 62);
                assert_eq!(m.notes[2].start, Tick(480));
            }
            _ => panic!("expected midi"),
        }
    }

    #[test]
    fn normalize_for_save_sorts_automation_points() {
        use crate::edit::*;
        let mut edit = empty_edit();
        edit.automation.push(AutomationLane {
            id: AutomationId::new(),
            target: AutomationTarget::TrackParam {
                track: TrackId::new(),
                param: TrackParam::Gain,
            },
            points: vec![
                AutomationPoint {
                    at: Tick(960),
                    value: 100,
                    curve: CurveShape::Linear,
                },
                AutomationPoint {
                    at: Tick(0),
                    value: 0,
                    curve: CurveShape::Linear,
                },
                AutomationPoint {
                    at: Tick(480),
                    value: 50,
                    curve: CurveShape::Hold,
                },
            ],
        });

        edit.normalize_for_save();

        assert_eq!(edit.automation[0].points[0].at, Tick(0));
        assert_eq!(edit.automation[0].points[1].at, Tick(480));
        assert_eq!(edit.automation[0].points[2].at, Tick(960));
    }

    #[test]
    fn normalize_for_save_sorts_warp_anchors() {
        let mut edit = empty_edit();
        let (tid, cid, _) = setup_audio_track_with_content(&mut edit);
        let clip_id = ClipId::new();
        let mut clip = make_audio_clip(clip_id, tid, cid);
        if let ClipKind::Audio { audio, .. } = &mut clip.kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(720),
                        src_frame: SrcFrame(30000),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(10000),
                    },
                ],
            };
        }
        edit.clips.push(clip);

        edit.normalize_for_save();

        let c = edit.clips.iter().find(|c| c.id == clip_id).unwrap();
        match &c.kind {
            ClipKind::Audio { audio, .. } => match &audio.warp {
                WarpMapEdit::Anchors { anchors } => {
                    assert_eq!(anchors[0].at_in_clip, Tick(240));
                    assert_eq!(anchors[1].at_in_clip, Tick(720));
                }
                _ => panic!("expected anchors"),
            },
            _ => panic!("expected audio"),
        }
    }

    // ===================================================================
    // SplitClip JSON roundtrip test
    // ===================================================================

    #[test]
    fn split_clip_json_roundtrip() {
        let cmd = Command::SplitClip {
            clip_id: ClipId::new(),
            tick_in_clip: Tick(480),
            new_clip_id: ClipId::new(),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        assert!(!json.contains("new_content_id"));
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SplitClip { tick_in_clip, .. } => assert_eq!(tick_in_clip, Tick(480)),
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn audio_blue_stretch_json_roundtrip() {
        let cmd = Command::AudioBlueStretch {
            clip_id: ClipId::new(),
            new_start: Tick(120),
            new_length: Tick(1440),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::AudioBlueStretch {
                new_start,
                new_length,
                ..
            } => {
                assert_eq!(new_start, Tick(120));
                assert_eq!(new_length, Tick(1440));
            }
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn midi_red_trim_json_roundtrip() {
        let cmd = Command::MidiRedTrim {
            clip_id: ClipId::new(),
            new_start: Tick(480),
            new_content_in: Tick(480),
            new_content_out: Tick(960),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::MidiRedTrim {
                new_start,
                new_content_in,
                new_content_out,
                ..
            } => {
                assert_eq!(new_start, Tick(480));
                assert_eq!(new_content_in, Tick(480));
                assert_eq!(new_content_out, Tick(960));
            }
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn set_midi_transpose_json_roundtrip() {
        let cmd = Command::SetMidiTranspose {
            clip_id: ClipId::new(),
            semitones: -2,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SetMidiTranspose { semitones, .. } => assert_eq!(semitones, -2),
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn set_track_gain_json_roundtrip() {
        let cmd = Command::SetTrackGain {
            id: TrackId::new(),
            gain_milli_db: -6000,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SetTrackGain { gain_milli_db, .. } => assert_eq!(gain_milli_db, -6000),
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn set_track_pan_json_roundtrip() {
        let cmd = Command::SetTrackPan {
            id: TrackId::new(),
            pan_permille: -250,
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SetTrackPan { pan_permille, .. } => assert_eq!(pan_permille, -250),
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn set_time_pitch_json_roundtrip() {
        let cmd = Command::SetTimePitch {
            clip_id: ClipId::new(),
            time_pitch: TimePitchModeEdit::Music {},
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["time_pitch"], serde_json::json!({ "mode": "Music" }));
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::SetTimePitch { time_pitch, .. } => {
                assert_eq!(time_pitch, TimePitchModeEdit::Music {})
            }
            _ => panic!("roundtrip failed"),
        }

        let voice = Command::SetTimePitch {
            clip_id: ClipId::new(),
            time_pitch: TimePitchModeEdit::Voice {
                analysis: VoiceAnalysisModeEdit::Source,
                preserve_formant: true,
            },
        };
        let voice_json = serde_json::to_string(&voice).unwrap();
        let voice_value: serde_json::Value = serde_json::from_str(&voice_json).unwrap();
        assert_eq!(
            voice_value["time_pitch"],
            serde_json::json!({
                "mode": "Voice",
                "analysis": "Source",
                "preserve_formant": true
            })
        );
        let voice_roundtrip: Command = serde_json::from_str(&voice_json).unwrap();
        match voice_roundtrip {
            Command::SetTimePitch {
                time_pitch:
                    TimePitchModeEdit::Voice {
                        analysis: VoiceAnalysisModeEdit::Source,
                        preserve_formant,
                    },
                ..
            } => assert!(preserve_formant),
            _ => panic!("roundtrip failed"),
        }

        let old_shape = serde_json::json!({
            "command": "set_time_pitch",
            "clip_id": ClipId::new(),
            "time_pitch": { "mode": "Voice" }
        });
        assert!(serde_json::from_value::<Command>(old_shape).is_err());

        let invalid_music_formant = serde_json::json!({
            "command": "set_time_pitch",
            "clip_id": ClipId::new(),
            "time_pitch": {
                "mode": "Music",
                "preserve_formant": true
            }
        });
        assert!(serde_json::from_value::<Command>(invalid_music_formant).is_err());
    }

    #[test]
    fn set_time_pitch_inverse_restores_variant_formant_option() {
        let mut edit = make_preserve_seconds_edit();
        let clip_id = edit.clips[0].id;
        let before = json_snapshot(&edit);

        let inverse = apply_command(
            &mut edit,
            &Command::SetTimePitch {
                clip_id,
                time_pitch: TimePitchModeEdit::Voice {
                    analysis: VoiceAnalysisModeEdit::Source,
                    preserve_formant: true,
                },
            },
        )
        .unwrap();

        match &edit.clips[0].kind {
            ClipKind::Audio { audio, .. } => assert_eq!(
                audio.time_pitch,
                TimePitchModeEdit::Voice {
                    analysis: VoiceAnalysisModeEdit::Source,
                    preserve_formant: true,
                }
            ),
            _ => panic!("expected audio clip"),
        }

        apply_command(&mut edit, &inverse).unwrap();
        assert_eq!(json_snapshot(&edit), before);
    }

    #[test]
    fn add_warp_anchor_at_tick_json_roundtrip() {
        let cmd = Command::AddWarpAnchorAtTick {
            clip_id: ClipId::new(),
            tick_in_clip: Tick(240),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::AddWarpAnchorAtTick { tick_in_clip, .. } => {
                assert_eq!(tick_in_clip, Tick(240));
            }
            _ => panic!("roundtrip failed"),
        }
    }

    #[test]
    fn audio_red_trim_json_roundtrip() {
        let cmd = Command::AudioRedTrim {
            clip_id: ClipId::new(),
            new_src_in: SrcFrame(100),
            new_src_out: SrcFrame(22050),
            new_start: Tick(240),
            new_length: Tick(720),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let cmd2: Command = serde_json::from_str(&json).unwrap();
        match cmd2 {
            Command::AudioRedTrim {
                new_src_in,
                new_src_out,
                ..
            } => {
                assert_eq!(new_src_in, SrcFrame(100));
                assert_eq!(new_src_out, SrcFrame(22050));
            }
            _ => panic!("roundtrip failed"),
        }
    }

    mod inverse_contract {
        use std::collections::BTreeSet;

        use proptest::prelude::*;

        use super::*;

        #[derive(Clone, Copy)]
        struct ContractIds {
            audio_track: TrackId,
            second_audio_track: TrackId,
            midi_track: TrackId,
            media: MediaId,
            audio_content: ContentId,
            midi_content: ContentId,
            audio_clip: ClipId,
            midi_clip: ClipId,
        }

        #[derive(Clone, Debug)]
        struct GeneratedEditState {
            micro_bpm: i64,
            swing_permille: u16,
            magnet_range_permille: u16,
            snap_strength_permille: u16,
            track_gain_milli_db: i32,
            track_pan_permille: i32,
            clip_gain_milli_db: i32,
            clip_lane: u16,
            pitch_coarse: i16,
            pitch_fine: i16,
            midi_transpose: i16,
            muted: bool,
            solo: bool,
            name_seed: u16,
        }

        fn generated_edit_state() -> impl Strategy<Value = GeneratedEditState> {
            (
                (
                    40_000_000i64..=240_000_000,
                    0u16..=1000,
                    0u16..=1000,
                    0u16..=1000,
                    -60_000i32..=12_000,
                ),
                (
                    -1000i32..=1000,
                    -60_000i32..=12_000,
                    0u16..=16,
                    -24i16..=24,
                    -99i16..=99,
                ),
                (-24i16..=24, any::<bool>(), any::<bool>(), any::<u16>()),
            )
                .prop_map(
                    |(
                        (
                            micro_bpm,
                            swing_permille,
                            magnet_range_permille,
                            snap_strength_permille,
                            track_gain_milli_db,
                        ),
                        (
                            track_pan_permille,
                            clip_gain_milli_db,
                            clip_lane,
                            pitch_coarse,
                            pitch_fine,
                        ),
                        (midi_transpose, muted, solo, name_seed),
                    )| GeneratedEditState {
                        micro_bpm,
                        swing_permille,
                        magnet_range_permille,
                        snap_strength_permille,
                        track_gain_milli_db,
                        track_pan_permille,
                        clip_gain_milli_db,
                        clip_lane,
                        pitch_coarse,
                        pitch_fine,
                        midi_transpose,
                        muted,
                        solo,
                        name_seed,
                    },
                )
        }

        fn perturb_case_edit(case: &mut InverseRoundTripCase, state: &GeneratedEditState) {
            // Unsplit carries a snapshot that must correspond to both split children.
            // The other inverse-only commands capture their replaced state at apply time.
            if matches!(&case.command, Command::UnsplitClip { .. }) {
                return;
            }

            let edit = &mut case.edit;
            if let Some(point) = edit.tempo.points.first_mut() {
                point.micro_bpm = state.micro_bpm;
            }
            edit.grid.swing_permille = state.swing_permille;
            edit.grid.magnet_range_permille = state.magnet_range_permille;
            edit.grid.snap_strength_permille = state.snap_strength_permille;

            for (index, track) in edit.tracks.iter_mut().enumerate() {
                track.name = format!("Generated {} {index}", state.name_seed);
                track.mute = state.muted;
                track.solo = state.solo;
                track.gain_milli_db = state.track_gain_milli_db;
                track.pan_permille = state.track_pan_permille;
            }

            for clip in &mut edit.clips {
                clip.lane = state.clip_lane;
                clip.muted = state.muted;
                clip.gain_milli_db = state.clip_gain_milli_db;
                match &mut clip.kind {
                    ClipKind::Audio { audio, .. } => {
                        audio.pitch.mode = if state.solo {
                            PitchControlMode::ManualPlusFollow
                        } else {
                            PitchControlMode::ManualOnly
                        };
                        audio.pitch.manual_coarse_semitones = state.pitch_coarse;
                        audio.pitch.manual_fine_cents = state.pitch_fine;
                        audio.time_pitch = if state.muted {
                            TimePitchModeEdit::Music {}
                        } else {
                            TimePitchModeEdit::Voice {
                                analysis: VoiceAnalysisModeEdit::Source,
                                preserve_formant: state.solo,
                            }
                        };
                    }
                    ClipKind::Midi { midi, .. } => {
                        midi.transpose_semitones = state.midi_transpose;
                    }
                }
            }
        }

        #[derive(Clone, Debug)]
        enum GeneratedMutation {
            SetBpm(i64),
            SetTrackMute(bool),
            SetTrackGain(i32),
            MoveClip(i64),
            SetClipGain(i32),
            SetPitchFine(i16),
            SetMidiTranspose(i16),
        }

        fn generated_mutation() -> impl Strategy<Value = GeneratedMutation> {
            prop_oneof![
                (40_000_000i64..=240_000_000).prop_map(GeneratedMutation::SetBpm),
                any::<bool>().prop_map(GeneratedMutation::SetTrackMute),
                (-60_000i32..=12_000).prop_map(GeneratedMutation::SetTrackGain),
                (0i64..=3840).prop_map(GeneratedMutation::MoveClip),
                (-60_000i32..=12_000).prop_map(GeneratedMutation::SetClipGain),
                (-500i16..=500).prop_map(GeneratedMutation::SetPitchFine),
                (-48i16..=48).prop_map(GeneratedMutation::SetMidiTranspose),
            ]
        }

        impl GeneratedMutation {
            fn command(&self, ids: ContractIds) -> Command {
                match self {
                    Self::SetBpm(micro_bpm) => Command::SetBpm {
                        micro_bpm: *micro_bpm,
                    },
                    Self::SetTrackMute(mute) => Command::SetTrackMute {
                        id: ids.audio_track,
                        mute: *mute,
                    },
                    Self::SetTrackGain(gain_milli_db) => Command::SetTrackGain {
                        id: ids.audio_track,
                        gain_milli_db: *gain_milli_db,
                    },
                    Self::MoveClip(start) => Command::MoveClip {
                        clip_id: ids.audio_clip,
                        new_start: Tick(*start),
                    },
                    Self::SetClipGain(gain_milli_db) => Command::SetClipGain {
                        clip_id: ids.audio_clip,
                        gain_milli_db: *gain_milli_db,
                    },
                    Self::SetPitchFine(cents) => Command::SetPitchFine {
                        clip_id: ids.audio_clip,
                        cents: *cents,
                    },
                    Self::SetMidiTranspose(semitones) => Command::SetMidiTranspose {
                        clip_id: ids.midi_clip,
                        semitones: *semitones,
                    },
                }
            }
        }

        fn make_contract_fixture() -> (ProjectEdit, ContractIds) {
            let ids = ContractIds {
                audio_track: TrackId::new(),
                second_audio_track: TrackId::new(),
                midi_track: TrackId::new(),
                media: MediaId::new(),
                audio_content: ContentId::new(),
                midi_content: ContentId::new(),
                audio_clip: ClipId::new(),
                midi_clip: ClipId::new(),
            };
            let mut edit = empty_edit();
            edit.tracks = vec![
                make_default_track(ids.audio_track, "Audio 1", TrackKind::Audio),
                make_default_track(ids.second_audio_track, "Audio 2", TrackKind::Audio),
                make_default_track(
                    ids.midi_track,
                    "MIDI 1",
                    TrackKind::Midi {
                        audition_instrument: None,
                        render_enabled: false,
                    },
                ),
            ];
            edit.media.push(make_test_media(ids.media));
            edit.contents = vec![
                ContentEdit::Audio(AudioContentEdit {
                    id: ids.audio_content,
                    media_id: ids.media,
                    analysis_refs: vec![],
                }),
                ContentEdit::Midi(MidiContentEdit {
                    id: ids.midi_content,
                    notes: vec![],
                    ccs: vec![],
                }),
            ];
            edit.clips = vec![
                make_audio_clip(ids.audio_clip, ids.audio_track, ids.audio_content),
                ClipEdit {
                    id: ids.midi_clip,
                    track_id: ids.midi_track,
                    start: Tick(0),
                    length: Tick(960),
                    lane: 0,
                    muted: false,
                    gain_milli_db: 0,
                    kind: ClipKind::Midi {
                        content_id: ids.midi_content,
                        midi: MidiClipEdit {
                            content_in: Tick(0),
                            content_out: Tick(960),
                            transpose_semitones: 0,
                        },
                    },
                },
            ];
            (edit, ids)
        }

        fn pitch_link(ids: ContractIds) -> MidiToAudioPitchLink {
            MidiToAudioPitchLink {
                id: PitchLinkId::new(),
                midi_track: ids.midi_track,
                audio_track: ids.audio_track,
                no_note_behavior: NoNoteBehavior::KeepOriginal,
                no_pitch_behavior: NoPitchBehavior::Bypass,
                priority: NotePriority::Highest,
            }
        }

        fn midi_note() -> MidiNote {
            MidiNote {
                id: NoteId::new(),
                start: Tick(120),
                length: Tick(120),
                key: 64,
                vel: 96,
            }
        }

        fn case(name: &'static str, edit: ProjectEdit, command: Command) -> InverseRoundTripCase {
            InverseRoundTripCase {
                name,
                edit,
                command,
            }
        }

        fn command_kind(command: &Command) -> &'static str {
            match command {
                Command::RenameProject { .. } => "rename_project",
                Command::SetBpm { .. } => "set_bpm",
                Command::SetBpmPreserveSeconds { .. } => "set_bpm_preserve_seconds",
                Command::SetTimeSignature { .. } => "set_time_signature",
                Command::SetGridSettings { .. } => "set_grid_settings",
                Command::AddTrack { .. } => "add_track",
                Command::RemoveTrack { .. } => "remove_track",
                Command::MoveTrack { .. } => "move_track",
                Command::SetTrackName { .. } => "set_track_name",
                Command::SetTrackMute { .. } => "set_track_mute",
                Command::SetTrackSolo { .. } => "set_track_solo",
                Command::SetTrackGain { .. } => "set_track_gain",
                Command::SetTrackPan { .. } => "set_track_pan",
                Command::AddMediaAsset { .. } => "add_media_asset",
                Command::AddContent { .. } => "add_content",
                Command::AddClip { .. } => "add_clip",
                Command::RemoveClip { .. } => "remove_clip",
                Command::MoveClip { .. } => "move_clip",
                Command::MoveClipToTrack { .. } => "move_clip_to_track",
                Command::ResizeClip { .. } => "resize_clip",
                Command::SetAudioSourceRange { .. } => "set_audio_source_range",
                Command::SetClipGain { .. } => "set_clip_gain",
                Command::SetClipMute { .. } => "set_clip_mute",
                Command::AddWarpAnchor { .. } => "add_warp_anchor",
                Command::RemoveWarpAnchor { .. } => "remove_warp_anchor",
                Command::SetPitchCoarse { .. } => "set_pitch_coarse",
                Command::SetPitchFine { .. } => "set_pitch_fine",
                Command::SetPitchMode { .. } => "set_pitch_mode",
                Command::SetTimePitch { .. } => "set_time_pitch",
                Command::AddMidiNote { .. } => "add_midi_note",
                Command::RemoveMidiNote { .. } => "remove_midi_note",
                Command::SetMidiContentWindow { .. } => "set_midi_content_window",
                Command::SetMidiTranspose { .. } => "set_midi_transpose",
                Command::AddPitchLink { .. } => "add_pitch_link",
                Command::RemovePitchLink { .. } => "remove_pitch_link",
                Command::Batch { .. } => "batch",
                Command::SplitClip { .. } => "split_clip",
                Command::AudioRedTrim { .. } => "audio_red_trim",
                Command::AudioBlueStretch { .. } => "audio_blue_stretch",
                Command::MidiRedTrim { .. } => "midi_red_trim",
                Command::AddWarpAnchorAtTick { .. } => "add_warp_anchor_at_tick",
                Command::RemoveMediaAsset { .. } => "_remove_media_asset",
                Command::RestoreMediaAsset { .. } => "_restore_media_asset",
                Command::RemoveContent { .. } => "_remove_content",
                Command::RestoreContent { .. } => "_restore_content",
                Command::RestoreTrack { .. } => "_restore_track",
                Command::RestoreTrackName { .. } => "_restore_track_name",
                Command::RestoreClip { .. } => "_restore_clip",
                Command::SetClipState { .. } => "_set_clip_state",
                Command::RestorePitchControl { .. } => "_restore_pitch_control",
                Command::RestoreMidiNote { .. } => "_restore_midi_note",
                Command::RestoreWarpAnchor { .. } => "_restore_warp_anchor",
                Command::RestorePitchLink { .. } => "_restore_pitch_link",
                Command::RestoreBpmPreserveSecondsState { .. } => {
                    "_restore_bpm_preserve_seconds_state"
                }
                Command::UnsplitClip { .. } => "_unsplit_clip",
            }
        }

        fn project_edit_cases() -> Vec<InverseRoundTripCase> {
            let (fixture, ids) = make_contract_fixture();
            let mut cases = vec![
                case(
                    "set_bpm",
                    fixture.clone(),
                    Command::SetBpm {
                        micro_bpm: 135_000_000,
                    },
                ),
                case(
                    "set_bpm_preserve_seconds",
                    make_preserve_seconds_edit(),
                    Command::SetBpmPreserveSeconds {
                        micro_bpm: 150_000_000,
                    },
                ),
                case(
                    "set_time_signature",
                    fixture.clone(),
                    Command::SetTimeSignature {
                        time_sig: TimeSignature { num: 3, den: 4 },
                    },
                ),
                case(
                    "set_grid_settings",
                    fixture.clone(),
                    Command::SetGridSettings {
                        grid: GridSettings {
                            snap_enabled: false,
                            division: GridDivision::Quarter,
                            swing_permille: 0,
                            magnet_range_permille: 100,
                            snap_strength_permille: 500,
                        },
                    },
                ),
                case(
                    "add_track",
                    fixture.clone(),
                    Command::AddTrack {
                        track: make_default_track(TrackId::new(), "Audio 3", TrackKind::Audio),
                    },
                ),
                case(
                    "remove_track",
                    {
                        let mut edit = fixture.clone();
                        let target_link = pitch_link(ids);
                        let mut surviving_link = pitch_link(ids);
                        surviving_link.audio_track = ids.second_audio_track;
                        edit.pitch_links = vec![target_link, surviving_link];
                        edit
                    },
                    Command::RemoveTrack {
                        id: ids.audio_track,
                    },
                ),
                case(
                    "move_track",
                    fixture.clone(),
                    Command::MoveTrack {
                        id: ids.audio_track,
                        new_index: 1,
                    },
                ),
                case(
                    "set_track_name",
                    fixture.clone(),
                    Command::SetTrackName {
                        id: ids.audio_track,
                        name: "Lead".to_string(),
                    },
                ),
                case(
                    "set_track_mute",
                    fixture.clone(),
                    Command::SetTrackMute {
                        id: ids.audio_track,
                        mute: true,
                    },
                ),
                case(
                    "set_track_solo",
                    fixture.clone(),
                    Command::SetTrackSolo {
                        id: ids.audio_track,
                        solo: true,
                    },
                ),
                case(
                    "set_track_gain",
                    fixture.clone(),
                    Command::SetTrackGain {
                        id: ids.audio_track,
                        gain_milli_db: -3000,
                    },
                ),
                case(
                    "set_track_pan",
                    fixture.clone(),
                    Command::SetTrackPan {
                        id: ids.audio_track,
                        pan_permille: 250,
                    },
                ),
                case(
                    "add_media_asset",
                    fixture.clone(),
                    Command::AddMediaAsset {
                        asset: make_test_media(MediaId::new()),
                    },
                ),
                case(
                    "add_content",
                    fixture.clone(),
                    Command::AddContent {
                        content: ContentEdit::Audio(AudioContentEdit {
                            id: ContentId::new(),
                            media_id: ids.media,
                            analysis_refs: vec![],
                        }),
                    },
                ),
                case(
                    "add_clip",
                    fixture.clone(),
                    Command::AddClip {
                        clip: make_audio_clip(ClipId::new(), ids.audio_track, ids.audio_content),
                    },
                ),
                case(
                    "remove_clip",
                    fixture.clone(),
                    Command::RemoveClip {
                        clip_id: ids.audio_clip,
                    },
                ),
                case(
                    "move_clip",
                    fixture.clone(),
                    Command::MoveClip {
                        clip_id: ids.audio_clip,
                        new_start: Tick(480),
                    },
                ),
                case(
                    "move_clip_to_track",
                    {
                        let mut edit = fixture.clone();
                        edit.clips[0].lane = 3;
                        edit
                    },
                    Command::MoveClipToTrack {
                        clip_id: ids.audio_clip,
                        new_track_id: ids.second_audio_track,
                    },
                ),
                case(
                    "resize_clip",
                    fixture.clone(),
                    Command::ResizeClip {
                        clip_id: ids.audio_clip,
                        new_length: Tick(1440),
                    },
                ),
                case(
                    "set_audio_source_range",
                    fixture.clone(),
                    Command::SetAudioSourceRange {
                        clip_id: ids.audio_clip,
                        src_in: SrcFrame(100),
                        src_out: SrcFrame(44_000),
                    },
                ),
                case(
                    "set_clip_gain",
                    fixture.clone(),
                    Command::SetClipGain {
                        clip_id: ids.audio_clip,
                        gain_milli_db: -1200,
                    },
                ),
                case(
                    "set_clip_mute",
                    fixture.clone(),
                    Command::SetClipMute {
                        clip_id: ids.audio_clip,
                        muted: true,
                    },
                ),
                case(
                    "add_warp_anchor",
                    fixture.clone(),
                    Command::AddWarpAnchor {
                        clip_id: ids.audio_clip,
                        anchor: WarpAnchorEdit {
                            at_in_clip: Tick(480),
                            src_frame: SrcFrame(22_050),
                        },
                    },
                ),
                case(
                    "set_pitch_mode",
                    fixture.clone(),
                    Command::SetPitchMode {
                        clip_id: ids.audio_clip,
                        mode: PitchControlMode::ManualPlusFollow,
                    },
                ),
                case(
                    "set_time_pitch",
                    fixture.clone(),
                    Command::SetTimePitch {
                        clip_id: ids.audio_clip,
                        time_pitch: TimePitchModeEdit::Music {},
                    },
                ),
                case(
                    "add_midi_note",
                    fixture.clone(),
                    Command::AddMidiNote {
                        content_id: ids.midi_content,
                        note: midi_note(),
                    },
                ),
                case(
                    "set_midi_content_window",
                    fixture.clone(),
                    Command::SetMidiContentWindow {
                        clip_id: ids.midi_clip,
                        content_in: Tick(0),
                        content_out: Tick(720),
                    },
                ),
                case(
                    "set_midi_transpose",
                    fixture.clone(),
                    Command::SetMidiTranspose {
                        clip_id: ids.midi_clip,
                        semitones: -3,
                    },
                ),
                case(
                    "add_pitch_link",
                    fixture.clone(),
                    Command::AddPitchLink {
                        link: pitch_link(ids),
                    },
                ),
                case(
                    "batch",
                    fixture.clone(),
                    Command::Batch {
                        commands: vec![
                            Command::SetBpm {
                                micro_bpm: 145_000_000,
                            },
                            Command::SetTrackMute {
                                id: ids.audio_track,
                                mute: true,
                            },
                        ],
                    },
                ),
                case(
                    "split_clip",
                    fixture.clone(),
                    Command::SplitClip {
                        clip_id: ids.audio_clip,
                        tick_in_clip: Tick(480),
                        new_clip_id: ClipId::new(),
                    },
                ),
                case(
                    "audio_red_trim",
                    fixture.clone(),
                    Command::AudioRedTrim {
                        clip_id: ids.audio_clip,
                        new_src_in: SrcFrame(0),
                        new_src_out: SrcFrame(22_050),
                        new_start: Tick(0),
                        new_length: Tick(480),
                    },
                ),
                case(
                    "audio_blue_stretch",
                    fixture.clone(),
                    Command::AudioBlueStretch {
                        clip_id: ids.audio_clip,
                        new_start: Tick(0),
                        new_length: Tick(1440),
                    },
                ),
                case(
                    "midi_red_trim",
                    fixture.clone(),
                    Command::MidiRedTrim {
                        clip_id: ids.midi_clip,
                        new_start: Tick(240),
                        new_content_in: Tick(240),
                        new_content_out: Tick(960),
                    },
                ),
                case(
                    "add_warp_anchor_at_tick",
                    fixture.clone(),
                    Command::AddWarpAnchorAtTick {
                        clip_id: ids.audio_clip,
                        tick_in_clip: Tick(480),
                    },
                ),
                case(
                    "_remove_media_asset",
                    {
                        let mut edit = fixture.clone();
                        edit.media.push(make_test_media(MediaId::new()));
                        edit
                    },
                    Command::RemoveMediaAsset { id: ids.media },
                ),
                case(
                    "_remove_content",
                    fixture.clone(),
                    Command::RemoveContent {
                        id: ids.audio_content,
                    },
                ),
                case(
                    "_restore_track_name",
                    fixture.clone(),
                    Command::RestoreTrackName {
                        id: ids.audio_track,
                        name: "Restored".to_string(),
                    },
                ),
                case(
                    "_set_clip_state",
                    fixture.clone(),
                    Command::SetClipState {
                        clip: {
                            let mut clip = fixture.clips[0].clone();
                            clip.start = Tick(240);
                            clip.gain_milli_db = -600;
                            clip
                        },
                    },
                ),
                case(
                    "_restore_pitch_control",
                    fixture.clone(),
                    Command::RestorePitchControl {
                        clip_id: ids.audio_clip,
                        coarse: 2,
                        fine: 35,
                    },
                ),
                case(
                    "_restore_midi_note",
                    fixture.clone(),
                    Command::RestoreMidiNote {
                        content_id: ids.midi_content,
                        notes: vec![midi_note()],
                    },
                ),
                case(
                    "_restore_warp_anchor",
                    fixture.clone(),
                    Command::RestoreWarpAnchor {
                        clip_id: ids.audio_clip,
                        index: 0,
                        anchor: WarpAnchorEdit {
                            at_in_clip: Tick(480),
                            src_frame: SrcFrame(22_050),
                        },
                    },
                ),
                case(
                    "_restore_pitch_link",
                    fixture.clone(),
                    Command::RestorePitchLink {
                        link: pitch_link(ids),
                        index: 0,
                    },
                ),
                case("_restore_bpm_preserve_seconds_state", empty_edit(), {
                    let restored = make_preserve_seconds_edit();
                    Command::RestoreBpmPreserveSecondsState {
                        tempo: restored.tempo,
                        contents: restored.contents,
                        clips: restored.clips,
                        automation: restored.automation,
                    }
                }),
            ];

            cases.push(make_pitch_inverse_case(
                "set_pitch_coarse",
                0,
                -90,
                |clip_id| Command::SetPitchCoarse {
                    clip_id,
                    semitones: 1,
                },
            ));
            cases.push(make_pitch_inverse_case(
                "set_pitch_fine",
                0,
                90,
                |clip_id| Command::SetPitchFine {
                    clip_id,
                    cents: 100,
                },
            ));

            let mut remove_warp_edit = fixture.clone();
            match &mut remove_warp_edit.clips[0].kind {
                ClipKind::Audio { audio, .. } => {
                    audio.warp = WarpMapEdit::Anchors {
                        anchors: vec![WarpAnchorEdit {
                            at_in_clip: Tick(480),
                            src_frame: SrcFrame(22_050),
                        }],
                    };
                }
                ClipKind::Midi { .. } => unreachable!(),
            }
            cases.push(case(
                "remove_warp_anchor",
                remove_warp_edit,
                Command::RemoveWarpAnchor {
                    clip_id: ids.audio_clip,
                    index: 0,
                },
            ));

            let mut remove_note_edit = fixture.clone();
            let removed_note = midi_note();
            let removed_note_id = removed_note.id;
            match &mut remove_note_edit.contents[1] {
                ContentEdit::Midi(midi) => midi.notes.push(removed_note),
                ContentEdit::Audio(_) => unreachable!(),
            }
            cases.push(case(
                "remove_midi_note",
                remove_note_edit,
                Command::RemoveMidiNote {
                    content_id: ids.midi_content,
                    note_id: removed_note_id,
                },
            ));

            let mut remove_link_edit = fixture.clone();
            let link = pitch_link(ids);
            let link_id = link.id;
            remove_link_edit.pitch_links.push(link);
            cases.push(case(
                "remove_pitch_link",
                remove_link_edit,
                Command::RemovePitchLink { id: link_id },
            ));

            cases.push(case(
                "_restore_track",
                empty_edit(),
                Command::RestoreTrack {
                    track: make_default_track(TrackId::new(), "Restored", TrackKind::Audio),
                    index: 0,
                    clips: vec![],
                    pitch_links: vec![],
                },
            ));

            let mut restore_media_edit = fixture.clone();
            let restored_media = restore_media_edit.media.remove(0);
            cases.push(case(
                "_restore_media_asset",
                restore_media_edit,
                Command::RestoreMediaAsset {
                    asset: restored_media,
                    index: 0,
                },
            ));

            let mut restore_content_edit = fixture.clone();
            let restored_content = restore_content_edit.contents.remove(0);
            cases.push(case(
                "_restore_content",
                restore_content_edit,
                Command::RestoreContent {
                    content: restored_content,
                    index: 0,
                },
            ));

            let mut restore_clip_edit = fixture.clone();
            let restored_clip = restore_clip_edit.clips.remove(0);
            cases.push(case(
                "_restore_clip",
                restore_clip_edit,
                Command::RestoreClip {
                    clip: restored_clip,
                    index: 0,
                },
            ));

            let mut split_edit = fixture;
            let unsplit = apply_command(
                &mut split_edit,
                &Command::SplitClip {
                    clip_id: ids.audio_clip,
                    tick_in_clip: Tick(480),
                    new_clip_id: ClipId::new(),
                },
            )
            .unwrap();
            assert!(matches!(unsplit, Command::UnsplitClip { .. }));
            cases.push(case("_unsplit_clip", split_edit, unsplit));

            cases
        }

        fn assert_rename_project_round_trip(before_name: &str, after_name: &str) {
            let mut document = crate::api::create_project_document(before_name, 120.0, 44_100);
            let before = json_snapshot(&document);
            let inverse = crate::api::apply_project_command(
                &mut document,
                &Command::RenameProject {
                    name: after_name.to_string(),
                },
            )
            .unwrap();
            let after = json_snapshot(&document);

            let redo = crate::api::apply_project_command(&mut document, &inverse).unwrap();
            assert_eq!(json_snapshot(&document), before);

            crate::api::apply_project_command(&mut document, &redo).unwrap();
            assert_eq!(json_snapshot(&document), after);
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(64))]

            #[test]
            fn all_command_variants_round_trip_across_generated_edit_state(
                state in generated_edit_state(),
            ) {
                let mut cases = project_edit_cases();
                prop_assert_eq!(cases.len() + 1, 55);
                for case in &mut cases {
                    perturb_case_edit(case, &state);
                }
                for case in cases {
                    assert_inverse_round_trip(case);
                }
                assert_rename_project_round_trip(
                    &format!("Before {}", state.name_seed),
                    &format!("After {}", state.name_seed),
                );
            }

            #[test]
            fn failed_commands_leave_generated_edit_state_unchanged(
                state in generated_edit_state(),
                invalid_bpm in -1_000_000_000i64..=0,
                invalid_split_tick in prop_oneof![-1920i64..=0, 960i64..=2880],
                invalid_length in -1920i64..=0,
                invalid_grid_value in 1001u16..=u16::MAX,
                source_frame in any::<u64>(),
            ) {
                let (fixture, ids) = make_contract_fixture();
                let mut template = InverseRoundTripCase {
                    name: "generated_failure_fixture",
                    edit: fixture,
                    command: Command::SetBpm { micro_bpm: 120_000_000 },
                };
                perturb_case_edit(&mut template, &state);
                let missing_track = TrackId(uuid::Uuid::nil());
                let missing_clip = ClipId(uuid::Uuid::nil());
                let commands = vec![
                    Command::SetBpm { micro_bpm: invalid_bpm },
                    Command::SetGridSettings {
                        grid: GridSettings {
                            snap_enabled: true,
                            division: GridDivision::Quarter,
                            swing_permille: invalid_grid_value,
                            magnet_range_permille: 250,
                            snap_strength_permille: 1000,
                        },
                    },
                    Command::SetTrackMute { id: missing_track, mute: true },
                    Command::MoveClip { clip_id: missing_clip, new_start: Tick(0) },
                    Command::ResizeClip {
                        clip_id: ids.audio_clip,
                        new_length: Tick(invalid_length),
                    },
                    Command::AddMidiNote {
                        content_id: ids.midi_content,
                        note: MidiNote {
                            id: NoteId(uuid::Uuid::from_u128(0xbad)),
                            start: Tick(0),
                            length: Tick(invalid_length),
                            key: 60,
                            vel: 100,
                        },
                    },
                    Command::SetAudioSourceRange {
                        clip_id: ids.audio_clip,
                        src_in: SrcFrame(source_frame),
                        src_out: SrcFrame(source_frame),
                    },
                    Command::SplitClip {
                        clip_id: ids.audio_clip,
                        tick_in_clip: Tick(invalid_split_tick),
                        new_clip_id: ClipId(uuid::Uuid::from_u128(0xfeed)),
                    },
                ];

                for command in commands {
                    let mut edit = template.edit.clone();
                    let before = json_snapshot(&edit);
                    let kind = command_kind(&command);
                    prop_assert!(
                        apply_command(&mut edit, &command).is_err(),
                        "{}: generated invalid command unexpectedly succeeded",
                        kind,
                    );
                    prop_assert_eq!(
                        json_snapshot(&edit),
                        before,
                        "{}: failed command changed edit state",
                        kind,
                    );
                }
            }

            #[test]
            fn failed_generated_batch_rolls_back_every_successful_prefix(
                state in generated_edit_state(),
                mutations in prop::collection::vec(generated_mutation(), 0..24),
            ) {
                let (fixture, ids) = make_contract_fixture();
                let mut template = InverseRoundTripCase {
                    name: "generated_batch_fixture",
                    edit: fixture,
                    command: Command::SetBpm { micro_bpm: 120_000_000 },
                };
                perturb_case_edit(&mut template, &state);
                let mut commands = mutations
                    .iter()
                    .map(|mutation| mutation.command(ids))
                    .collect::<Vec<_>>();
                commands.push(Command::SetTrackMute {
                    id: TrackId(uuid::Uuid::nil()),
                    mute: true,
                });

                let mut edit = template.edit;
                let before = json_snapshot(&edit);
                let result = apply_command(&mut edit, &Command::Batch { commands });

                prop_assert!(matches!(result, Err(CommandError::TrackNotFound(_))));
                prop_assert_eq!(json_snapshot(&edit), before);
            }
        }

        #[test]
        fn every_command_variant_has_an_inverse_round_trip_case() {
            const EXPECTED_KINDS: [&str; 55] = [
                "rename_project",
                "set_bpm",
                "set_bpm_preserve_seconds",
                "set_time_signature",
                "set_grid_settings",
                "add_track",
                "remove_track",
                "move_track",
                "set_track_name",
                "set_track_mute",
                "set_track_solo",
                "set_track_gain",
                "set_track_pan",
                "add_media_asset",
                "add_content",
                "add_clip",
                "remove_clip",
                "move_clip",
                "move_clip_to_track",
                "resize_clip",
                "set_audio_source_range",
                "set_clip_gain",
                "set_clip_mute",
                "add_warp_anchor",
                "remove_warp_anchor",
                "set_pitch_coarse",
                "set_pitch_fine",
                "set_pitch_mode",
                "set_time_pitch",
                "add_midi_note",
                "remove_midi_note",
                "set_midi_content_window",
                "set_midi_transpose",
                "add_pitch_link",
                "remove_pitch_link",
                "batch",
                "split_clip",
                "audio_red_trim",
                "audio_blue_stretch",
                "midi_red_trim",
                "add_warp_anchor_at_tick",
                "_remove_media_asset",
                "_restore_media_asset",
                "_remove_content",
                "_restore_content",
                "_restore_track",
                "_restore_track_name",
                "_restore_clip",
                "_set_clip_state",
                "_restore_pitch_control",
                "_restore_midi_note",
                "_restore_warp_anchor",
                "_restore_pitch_link",
                "_restore_bpm_preserve_seconds_state",
                "_unsplit_clip",
            ];

            let cases = project_edit_cases();
            let mut actual = cases
                .iter()
                .map(|case| command_kind(&case.command))
                .collect::<BTreeSet<_>>();
            assert!(actual.insert("rename_project"));
            let expected = EXPECTED_KINDS.into_iter().collect::<BTreeSet<_>>();
            assert_eq!(actual, expected, "inverse contract case coverage drifted");
            assert_eq!(cases.len() + 1, EXPECTED_KINDS.len());
        }

        #[test]
        fn every_project_edit_command_round_trips_through_undo_and_redo() {
            for case in project_edit_cases() {
                assert_inverse_round_trip(case);
            }
        }

        #[test]
        fn rename_project_round_trips_through_undo_and_redo() {
            assert_rename_project_round_trip("Before", "After");
        }
    }
}
