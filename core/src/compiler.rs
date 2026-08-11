use std::collections::{BTreeMap, HashSet};
use thiserror::Error;

use crate::analysis::{AnalysisArtifact, AnalysisResolver};
use crate::edit::*;
use crate::ids::*;
use crate::pitch::build_pitch_plan;
use crate::runtime::*;
use crate::time::*;
use crate::warp::FullWarp;

// =============================================================================
// Compile-stage helpers (extracted from `Compiler::compile_with_analysis`)
//
// Each helper covers a single validation or derivation stage. Behavior is
// unchanged from the original inline implementation.
// =============================================================================

fn validate_ids_unique(edit: &ProjectEdit) -> Result<(), CompileError> {
    let mut track_ids = HashSet::new();
    for t in &edit.tracks {
        if !track_ids.insert(t.id) {
            return Err(CompileError::DuplicateTrackId(t.id));
        }
    }
    let mut clip_ids = HashSet::new();
    for c in &edit.clips {
        if !clip_ids.insert(c.id) {
            return Err(CompileError::DuplicateClipId(c.id));
        }
    }
    let mut content_ids = HashSet::new();
    for c in &edit.contents {
        let id = match c {
            ContentEdit::Audio(a) => a.id,
            ContentEdit::Midi(m) => m.id,
        };
        if !content_ids.insert(id) {
            return Err(CompileError::DuplicateContentId(id));
        }
    }
    let mut media_ids = HashSet::new();
    for m in &edit.media {
        if !media_ids.insert(m.id) {
            return Err(CompileError::DuplicateMediaId(m.id));
        }
    }
    let mut pitch_link_ids = HashSet::new();
    for l in &edit.pitch_links {
        if !pitch_link_ids.insert(l.id) {
            return Err(CompileError::DuplicatePitchLinkId(l.id));
        }
    }
    let mut midi_note_ids = HashSet::new();
    for content in &edit.contents {
        let ContentEdit::Midi(midi) = content else {
            continue;
        };
        for note in &midi.notes {
            if let Some((field, value)) = invalid_midi_note_value(note) {
                return Err(CompileError::InvalidMidiNote {
                    note: note.id,
                    field,
                    value,
                });
            }
            if !midi_note_ids.insert(note.id) {
                return Err(CompileError::DuplicateMidiNoteId(note.id));
            }
        }
    }
    Ok(())
}

fn validate_pitch_links(edit: &ProjectEdit) -> Result<(), CompileError> {
    let track_kind = |track_id: TrackId| -> Result<&TrackKind, CompileError> {
        edit.tracks
            .iter()
            .find(|t| t.id == track_id)
            .map(|t| &t.kind)
            .ok_or(CompileError::TrackNotFound(track_id))
    };

    let mut audio_targets: HashSet<TrackId> = HashSet::new();
    for link in &edit.pitch_links {
        match track_kind(link.midi_track)? {
            TrackKind::Midi { .. } => {}
            _ => return Err(CompileError::PitchLinkSourceNotMidi(link.midi_track)),
        }
        match track_kind(link.audio_track)? {
            TrackKind::Audio => {}
            _ => return Err(CompileError::PitchLinkTargetNotAudio(link.audio_track)),
        }
        if !audio_targets.insert(link.audio_track) {
            return Err(CompileError::DuplicatePitchLinkForAudioTrack(
                link.audio_track,
            ));
        }
    }
    Ok(())
}

fn compile_warp_plan(
    clip: &ClipEdit,
    audio: &AudioClipEdit,
    tempo_rt: &TempoMapRt,
    sample_rate: u32,
) -> Result<WarpPlanRt, CompileError> {
    match &audio.warp {
        WarpMapEdit::None => Ok(WarpPlanRt::Linear),
        WarpMapEdit::Anchors { anchors } => {
            if anchors.is_empty() {
                return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
            }

            let mut last_tick: Option<i64> = None;
            let mut last_src: Option<u64> = None;
            for a in anchors {
                if a.at_in_clip.0 < 0 || a.at_in_clip.0 > clip.length.0 {
                    return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                }
                if a.at_in_clip.0 == 0 && a.src_frame.0 != audio.src_in.0 {
                    return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                }
                if a.at_in_clip.0 == clip.length.0 && a.src_frame.0 != audio.src_out.0 {
                    return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                }
                if a.src_frame.0 < audio.src_in.0 || a.src_frame.0 > audio.src_out.0 {
                    return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                }
                if let Some(t) = last_tick {
                    if a.at_in_clip.0 <= t {
                        return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                    }
                }
                if let Some(s) = last_src {
                    if a.src_frame.0 < s {
                        return Err(CompileError::InvalidWarpAnchors { clip: clip.id });
                    }
                }
                last_tick = Some(a.at_in_clip.0);
                last_src = Some(a.src_frame.0);
            }

            let full_warp = FullWarp::from_audio(clip.length, audio);
            let points = full_warp.points();
            let mut segments = Vec::with_capacity(points.len() - 1);
            for pair in points.windows(2) {
                let (tick_start, src_start) = (pair[0].tick, pair[0].src);
                let (tick_end, src_end) = (pair[1].tick, pair[1].src);
                let dst_start =
                    tempo_rt.tick_to_frame(Tick(clip.start.0 + tick_start.0), sample_rate);
                let dst_end = tempo_rt.tick_to_frame(Tick(clip.start.0 + tick_end.0), sample_rate);
                segments.push(WarpSegmentRt {
                    dst_start,
                    dst_end,
                    src_start,
                    src_end,
                });
            }
            Ok(WarpPlanRt::Piecewise { segments })
        }
    }
}

fn detect_routing_cycles(edit: &ProjectEdit) -> Result<(), CompileError> {
    let track_ids: Vec<TrackId> = edit.tracks.iter().map(|t| t.id).collect();
    let track_index =
        |id: TrackId| -> Option<usize> { track_ids.iter().position(|&tid| tid == id) };

    let n = track_ids.len();
    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];

    for (i, track) in edit.tracks.iter().enumerate() {
        if let BusTarget::Track { track: target } = &track.routing.output {
            let j = track_index(*target).ok_or(CompileError::TrackNotFound(*target))?;
            adj[i].push(j);
        }
        for send in &track.routing.sends {
            if let BusTarget::Track { track: target } = &send.target {
                let j = track_index(*target).ok_or(CompileError::TrackNotFound(*target))?;
                adj[i].push(j);
            }
        }
    }

    let mut state = vec![0u8; n];
    fn has_cycle(node: usize, adj: &[Vec<usize>], state: &mut [u8]) -> bool {
        state[node] = 1;
        for &next in &adj[node] {
            if state[next] == 1 {
                return true;
            }
            if state[next] == 0 && has_cycle(next, adj, state) {
                return true;
            }
        }
        state[node] = 2;
        false
    }
    for i in 0..n {
        if state[i] == 0 && has_cycle(i, &adj, &mut state) {
            return Err(CompileError::RoutingCycleDetected);
        }
    }
    Ok(())
}

fn compile_automation_lanes(
    edit: &ProjectEdit,
    tempo_rt: &TempoMapRt,
    sample_rate: u32,
) -> Result<Vec<AutomationLaneRt>, CompileError> {
    let track_exists = |track_id: TrackId| -> Result<(), CompileError> {
        edit.tracks
            .iter()
            .find(|t| t.id == track_id)
            .map(|_| ())
            .ok_or(CompileError::TrackNotFound(track_id))
    };
    let clip_exists = |clip_id: ClipId| -> Result<(), CompileError> {
        edit.clips
            .iter()
            .find(|c| c.id == clip_id)
            .map(|_| ())
            .ok_or(CompileError::ClipNotFound(clip_id))
    };

    let mut out = Vec::new();
    for lane in &edit.automation {
        let target = match &lane.target {
            AutomationTarget::TrackParam { track, param } => {
                track_exists(*track)?;
                match param {
                    TrackParam::Gain => AutomationTargetRt::TrackGain { track: *track },
                    TrackParam::Pan => AutomationTargetRt::TrackPan { track: *track },
                    TrackParam::Mute => AutomationTargetRt::TrackMute { track: *track },
                }
            }
            AutomationTarget::FxParam {
                track,
                fx_id,
                param,
            } => {
                let track_edit = edit
                    .tracks
                    .iter()
                    .find(|candidate| candidate.id == *track)
                    .ok_or(CompileError::TrackNotFound(*track))?;
                if !track_edit.fx_chain.iter().any(|slot| slot.id == *fx_id) {
                    return Err(CompileError::FxNotFound {
                        track: *track,
                        fx_id: *fx_id,
                    });
                }
                AutomationTargetRt::FxParam {
                    track: *track,
                    fx_id: *fx_id,
                    param: param.clone(),
                }
            }
            AutomationTarget::ClipParam { clip, param } => {
                clip_exists(*clip)?;
                match param {
                    ClipParam::Gain => AutomationTargetRt::ClipGain { clip: *clip },
                    ClipParam::Mute => AutomationTargetRt::ClipMute { clip: *clip },
                    ClipParam::PitchCents => AutomationTargetRt::ClipPitchCents { clip: *clip },
                }
            }
        };
        let points = lane
            .points
            .iter()
            .map(|p| AutomationPointRt {
                at: tempo_rt.tick_to_frame(p.at, sample_rate),
                value: p.value,
            })
            .collect();
        out.push(AutomationLaneRt { target, points });
    }
    Ok(out)
}

#[derive(Debug, Error)]
pub enum CompileError {
    #[error("unsupported schema_version: {0}")]
    UnsupportedSchema(u32),

    #[error("project serialization failed: {0}")]
    Serialize(String),

    #[error("tempo_map must have at least 1 point")]
    EmptyTempoMap,

    #[error("tempo_map.ppq must be > 0")]
    InvalidPpq,

    #[error("tempo micro_bpm must be > 0")]
    InvalidBpm,

    #[error("track not found: {0:?}")]
    TrackNotFound(TrackId),

    #[error("content not found: {0:?}")]
    ContentNotFound(ContentId),

    #[error("media not found: {0:?}")]
    MediaNotFound(MediaId),

    #[error("clip not found: {0:?}")]
    ClipNotFound(ClipId),

    #[error("FX not found on track {track:?}: {fx_id:?}")]
    FxNotFound { track: TrackId, fx_id: FxId },

    #[error("duplicate track id: {0:?}")]
    DuplicateTrackId(TrackId),

    #[error("duplicate clip id: {0:?}")]
    DuplicateClipId(ClipId),

    #[error("duplicate content id: {0:?}")]
    DuplicateContentId(ContentId),

    #[error("duplicate media id: {0:?}")]
    DuplicateMediaId(MediaId),

    #[error("duplicate pitch link id: {0:?}")]
    DuplicatePitchLinkId(PitchLinkId),

    #[error("duplicate MIDI note id: {0:?}")]
    DuplicateMidiNoteId(NoteId),

    #[error("invalid MIDI note {note:?}: {field}={value}")]
    InvalidMidiNote {
        note: NoteId,
        field: &'static str,
        value: i64,
    },

    #[error("track kind mismatch for clip {clip:?} on track {track:?}")]
    TrackKindMismatch { track: TrackId, clip: ClipId },

    #[error("content kind mismatch for clip {clip:?}")]
    ContentKindMismatch { clip: ClipId },

    #[error("invalid audio source range for clip {clip:?}: src_in >= src_out")]
    InvalidAudioSourceRange { clip: ClipId },

    #[error("invalid MIDI content window for clip {clip:?}")]
    InvalidMidiWindow { clip: ClipId },

    #[error("invalid warp anchors for clip {clip:?}")]
    InvalidWarpAnchors { clip: ClipId },

    #[error("invalid fade range for clip {clip:?}")]
    InvalidFadeRange { clip: ClipId },

    #[error("clip length must be > 0: clip {clip:?}")]
    ZeroLengthClip { clip: ClipId },

    #[error("end_frame <= start_frame for clip {clip:?}")]
    EndFrameNotGreater { clip: ClipId },

    #[error("pitch link refers to non-midi source track: {0:?}")]
    PitchLinkSourceNotMidi(TrackId),

    #[error("pitch link refers to non-audio target track: {0:?}")]
    PitchLinkTargetNotAudio(TrackId),

    #[error("duplicate pitch link for audio track: {0:?}")]
    DuplicatePitchLinkForAudioTrack(TrackId),

    #[error("clip references non-existent track: clip={clip:?} track={track:?}")]
    ClipTrackNotFound { clip: ClipId, track: TrackId },

    #[error("variable tempo not supported in v1 compiler yet")]
    VariableTempoNotSupported,

    #[error("meta.ppq ({meta_ppq}) != tempo.ppq ({tempo_ppq})")]
    PpqMismatch { meta_ppq: i32, tempo_ppq: i32 },

    #[error("routing cycle detected")]
    RoutingCycleDetected,
}

impl CompileError {
    /// Stable, machine-readable code for this error variant. Used by the WASM
    /// bridge to expose structured errors to JS without prefix-string matching.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedSchema(_) => "UNSUPPORTED_SCHEMA",
            Self::Serialize(_) => "SERIALIZE_ERROR",
            Self::EmptyTempoMap => "EMPTY_TEMPO_MAP",
            Self::InvalidPpq => "INVALID_PPQ",
            Self::InvalidBpm => "INVALID_BPM",
            Self::TrackNotFound(_) => "TRACK_NOT_FOUND",
            Self::ContentNotFound(_) => "CONTENT_NOT_FOUND",
            Self::MediaNotFound(_) => "MEDIA_NOT_FOUND",
            Self::ClipNotFound(_) => "CLIP_NOT_FOUND",
            Self::FxNotFound { .. } => "FX_NOT_FOUND",
            Self::DuplicateTrackId(_) => "DUPLICATE_TRACK_ID",
            Self::DuplicateClipId(_) => "DUPLICATE_CLIP_ID",
            Self::DuplicateContentId(_) => "DUPLICATE_CONTENT_ID",
            Self::DuplicateMediaId(_) => "DUPLICATE_MEDIA_ID",
            Self::DuplicatePitchLinkId(_) => "DUPLICATE_PITCH_LINK_ID",
            Self::DuplicateMidiNoteId(_) => "DUPLICATE_MIDI_NOTE_ID",
            Self::InvalidMidiNote { .. } => "INVALID_MIDI_NOTE",
            Self::TrackKindMismatch { .. } => "TRACK_KIND_MISMATCH",
            Self::ContentKindMismatch { .. } => "CONTENT_KIND_MISMATCH",
            Self::InvalidAudioSourceRange { .. } => "INVALID_AUDIO_SOURCE_RANGE",
            Self::InvalidMidiWindow { .. } => "INVALID_MIDI_WINDOW",
            Self::InvalidWarpAnchors { .. } => "INVALID_WARP_ANCHORS",
            Self::InvalidFadeRange { .. } => "INVALID_FADE_RANGE",
            Self::ZeroLengthClip { .. } => "ZERO_LENGTH_CLIP",
            Self::EndFrameNotGreater { .. } => "END_FRAME_NOT_GREATER",
            Self::PitchLinkSourceNotMidi(_) => "PITCH_LINK_SOURCE_NOT_MIDI",
            Self::PitchLinkTargetNotAudio(_) => "PITCH_LINK_TARGET_NOT_AUDIO",
            Self::DuplicatePitchLinkForAudioTrack(_) => "DUPLICATE_PITCH_LINK_FOR_AUDIO_TRACK",
            Self::ClipTrackNotFound { .. } => "CLIP_TRACK_NOT_FOUND",
            Self::VariableTempoNotSupported => "VARIABLE_TEMPO_NOT_SUPPORTED",
            Self::PpqMismatch { .. } => "PPQ_MISMATCH",
            Self::RoutingCycleDetected => "ROUTING_CYCLE_DETECTED",
        }
    }
}

/// Optional analysis registry for F0-based pitch follow.
///
/// The canonical source of truth is `AudioContentEdit.analysis_refs`, which are
/// resolved against this registry by `AnalysisResolver`. When an F0 artifact is
/// available, the compiler uses actual source analysis to compute
/// `shift_cents = 1200 * log2(f_target / f_source_ref)`. When absent, follow
/// falls back to the note-relative calculation `(note.key - 69) * 100`.
pub type AnalysisStore = BTreeMap<AnalysisId, AnalysisArtifact>;

pub struct Compiler;

impl Compiler {
    /// Compile Edit model (JSON-saveable) into Runtime model (playback-ready).
    /// Deterministic: same input always yields same output.
    pub fn compile(doc: &ProjectDocument) -> Result<ProjectRuntime, CompileError> {
        Self::compile_with_analysis(doc, None)
    }

    /// Compile with optional analysis data for F0-based pitch follow.
    pub fn compile_with_analysis(
        doc: &ProjectDocument,
        analysis: Option<&AnalysisStore>,
    ) -> Result<ProjectRuntime, CompileError> {
        if doc.schema_version != CURRENT_PROJECT_SCHEMA_VERSION {
            return Err(CompileError::UnsupportedSchema(doc.schema_version));
        }

        let sample_rate = doc.meta.project_sample_rate;
        let edit = &doc.edit;
        let analysis_resolver = analysis.map(AnalysisResolver::new);

        // ---- PPQ consistency ----
        if doc.meta.ppq != edit.tempo.ppq {
            return Err(CompileError::PpqMismatch {
                meta_ppq: doc.meta.ppq,
                tempo_ppq: edit.tempo.ppq,
            });
        }

        // ---- Tempo validation ----
        if edit.tempo.ppq <= 0 {
            return Err(CompileError::InvalidPpq);
        }
        if edit.tempo.points.is_empty() {
            return Err(CompileError::EmptyTempoMap);
        }
        // v1: fixed BPM only (exactly 1 tempo point)
        if edit.tempo.points.len() != 1 {
            return Err(CompileError::VariableTempoNotSupported);
        }
        let tp0 = &edit.tempo.points[0];
        if tp0.micro_bpm <= 0 {
            return Err(CompileError::InvalidBpm);
        }

        let tempo_rt = TempoMapRt {
            ppq: edit.tempo.ppq,
            micro_bpm: tp0.micro_bpm,
            points: edit
                .tempo
                .points
                .iter()
                .map(|p| TempoPointRt {
                    at_tick: p.at,
                    micro_bpm: p.micro_bpm,
                    time_sig: p.time_sig,
                })
                .collect(),
        };

        // ---- ID uniqueness checks ----
        validate_ids_unique(edit)?;

        // ---- Build track lookup ----
        let find_track_kind = |track_id: TrackId| -> Result<&TrackKind, CompileError> {
            edit.tracks
                .iter()
                .find(|t| t.id == track_id)
                .map(|t| &t.kind)
                .ok_or(CompileError::TrackNotFound(track_id))
        };

        // ---- Validate pitch links ----
        validate_pitch_links(edit)?;

        // ---- Content lookup helper ----
        let find_content = |content_id: ContentId| -> Result<&ContentEdit, CompileError> {
            edit.contents
                .iter()
                .find(|c| match c {
                    ContentEdit::Audio(a) => a.id == content_id,
                    ContentEdit::Midi(m) => m.id == content_id,
                })
                .ok_or(CompileError::ContentNotFound(content_id))
        };

        let find_media = |media_id: MediaId| -> Result<&MediaAsset, CompileError> {
            edit.media
                .iter()
                .find(|m| m.id == media_id)
                .ok_or(CompileError::MediaNotFound(media_id))
        };

        // ---- Compile clips per track ----
        let mut tracks_rt: Vec<TrackRuntime> = Vec::with_capacity(edit.tracks.len());

        for track in &edit.tracks {
            let kind_rt = match &track.kind {
                TrackKind::Audio => TrackKindRt::Audio,
                TrackKind::Midi { .. } => TrackKindRt::Midi,
            };

            // Collect clips belonging to this track
            let track_clips: Vec<&ClipEdit> = edit
                .clips
                .iter()
                .filter(|c| c.track_id == track.id)
                .collect();

            let mut clips_rt: Vec<ClipRuntime> = Vec::with_capacity(track_clips.len());

            for clip in &track_clips {
                // Validate clip.track_id references existing track
                if find_track_kind(clip.track_id).is_err() {
                    return Err(CompileError::ClipTrackNotFound {
                        clip: clip.id,
                        track: clip.track_id,
                    });
                }

                // Clip length > 0
                if clip.length.0 <= 0 {
                    return Err(CompileError::ZeroLengthClip { clip: clip.id });
                }

                // Track kind vs clip kind check
                match (&track.kind, &clip.kind) {
                    (TrackKind::Audio, ClipKind::Audio { .. }) => {}
                    (TrackKind::Midi { .. }, ClipKind::Midi { .. }) => {}
                    _ => {
                        return Err(CompileError::TrackKindMismatch {
                            track: track.id,
                            clip: clip.id,
                        });
                    }
                }

                let start_f = tempo_rt.tick_to_frame(clip.start, sample_rate);
                let end_f = tempo_rt.tick_to_frame(Tick(clip.start.0 + clip.length.0), sample_rate);

                if end_f.0 <= start_f.0 {
                    return Err(CompileError::EndFrameNotGreater { clip: clip.id });
                }

                match &clip.kind {
                    ClipKind::Midi { content_id, midi } => {
                        let c = find_content(*content_id)?;
                        match c {
                            ContentEdit::Midi(_) => {}
                            _ => return Err(CompileError::ContentKindMismatch { clip: clip.id }),
                        }

                        // Validate MIDI window
                        if midi.content_in.0 >= midi.content_out.0 {
                            return Err(CompileError::InvalidMidiWindow { clip: clip.id });
                        }
                        if clip.length.0 != midi.content_out.0 - midi.content_in.0 {
                            return Err(CompileError::InvalidMidiWindow { clip: clip.id });
                        }

                        clips_rt.push(ClipRuntime::Midi(MidiClipRt {
                            clip_id: clip.id,
                            content_id: *content_id,
                            start: start_f,
                            end: end_f,
                        }));
                    }
                    ClipKind::Audio { content_id, audio } => {
                        let c = find_content(*content_id)?;
                        let ac = match c {
                            ContentEdit::Audio(ac) => ac,
                            _ => return Err(CompileError::ContentKindMismatch { clip: clip.id }),
                        };

                        // Validate media exists
                        let media = find_media(ac.media_id)?;

                        if audio.src_in.0 >= audio.src_out.0 {
                            return Err(CompileError::InvalidAudioSourceRange { clip: clip.id });
                        }
                        if audio.src_out.0 > media.length_src_frames {
                            return Err(CompileError::InvalidAudioSourceRange { clip: clip.id });
                        }
                        if audio.fades.fade_in.0 < 0
                            || audio.fades.fade_out.0 < 0
                            || audio.fades.fade_in.0 > clip.length.0
                            || audio.fades.fade_out.0 > clip.length.0
                            || audio.fades.fade_in.0 + audio.fades.fade_out.0 > clip.length.0
                        {
                            return Err(CompileError::InvalidFadeRange { clip: clip.id });
                        }

                        // Warp validation + plan derivation (see `compile_warp_plan`).
                        let warp_plan = compile_warp_plan(clip, audio, &tempo_rt, sample_rate)?;

                        let pitch_mode = match &audio.pitch.mode {
                            PitchControlMode::ManualOnly => PitchModeRt::ManualOnly,
                            PitchControlMode::FollowMidiOnly => PitchModeRt::FollowMidiOnly,
                            PitchControlMode::ManualPlusFollow => PitchModeRt::ManualPlusFollow,
                        };

                        clips_rt.push(ClipRuntime::Audio(AudioClipRt {
                            clip_id: clip.id,
                            content_id: *content_id,
                            start: start_f,
                            end: end_f,
                            media_id: ac.media_id,
                            src_in: audio.src_in,
                            src_out: audio.src_out,
                            warp_plan,
                            manual_pitch_cents: audio.pitch.manual_cents(),
                            pitch_mode,
                        }));
                    }
                }
            }

            // Sort clips by start frame (runtime order for playback)
            clips_rt.sort_by_key(|c| match c {
                ClipRuntime::Audio(a) => a.start.0,
                ClipRuntime::Midi(m) => m.start.0,
            });

            tracks_rt.push(TrackRuntime {
                id: track.id,
                kind: kind_rt,
                clips: clips_rt,
            });
        }

        // ---- Routing cycle detection ----
        detect_routing_cycles(edit)?;

        let pitch_plan = build_pitch_plan(edit, &tempo_rt, sample_rate, analysis_resolver.as_ref());

        // ---- Automation: convert Tick -> TimelineFrame ----
        let automation_rt = compile_automation_lanes(edit, &tempo_rt, sample_rate)?;

        Ok(ProjectRuntime {
            sample_rate,
            tempo: tempo_rt,
            tracks: tracks_rt,
            pitch_plan,
            automation: automation_rt,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::F0TrackArtifact;

    fn make_minimal_project() -> ProjectDocument {
        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let clip_id = ClipId::new();
        let track_id = TrackId::new();

        ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: ProjectMeta {
                name: "Test Project".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![TrackEdit {
                    id: track_id,
                    name: "Audio 1".to_string(),
                    kind: TrackKind::Audio,
                    mute: false,
                    solo: false,
                    gain_milli_db: 0,
                    pan_permille: 0,
                    fx_chain: vec![],
                    routing: TrackRoutingEdit {
                        output: BusTarget::Master,
                        sends: vec![],
                    },
                }],
                media: vec![MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 2,
                    src_sample_rate: 44100,
                    length_src_frames: 44100,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![ContentEdit::Audio(AudioContentEdit {
                    id: content_id,
                    media_id,
                    analysis_refs: vec![],
                })],
                clips: vec![ClipEdit {
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
                }],
                routing: RoutingEdit { schema_hint: None },
                automation: vec![],
                pitch_links: vec![],
            },
        }
    }

    #[test]
    fn compile_minimal_project() {
        let doc = make_minimal_project();
        let rt = Compiler::compile(&doc).expect("compile should succeed");

        assert_eq!(rt.sample_rate, 44100);
        assert_eq!(rt.tracks.len(), 1);
        assert_eq!(rt.tracks[0].clips.len(), 1);

        match &rt.tracks[0].clips[0] {
            ClipRuntime::Audio(a) => {
                assert_eq!(a.start.0, 0);
                assert!(a.end.0 > 0);
                assert_eq!(a.src_in, SrcFrame(0));
                assert_eq!(a.src_out, SrcFrame(44100));
            }
            _ => panic!("expected audio clip"),
        }
    }

    #[test]
    fn schema_v4_accepts_time_pitch_modes_and_rejects_v3() {
        let mut voice_source = serde_json::to_value(make_minimal_project()).unwrap();
        voice_source["schema_version"] = serde_json::json!(4);
        let audio = &mut voice_source["edit"]["clips"][0]["kind"]["audio"];
        audio["time_pitch"] = serde_json::json!({
            "mode": "Voice",
            "analysis": "Source",
            "preserve_formant": true
        });

        let voice_doc: ProjectDocument = serde_json::from_value(voice_source.clone()).unwrap();
        Compiler::compile(&voice_doc).expect("schema v4 Voice/Source should compile");

        let mut local = voice_source.clone();
        local["edit"]["clips"][0]["kind"]["audio"]["time_pitch"] = serde_json::json!({
            "mode": "Voice",
            "analysis": "Local",
            "preserve_formant": false
        });
        let local_doc: ProjectDocument = serde_json::from_value(local).unwrap();
        Compiler::compile(&local_doc).expect("schema v4 Voice/Local should compile");

        let mut music = voice_source.clone();
        music["edit"]["clips"][0]["kind"]["audio"]["time_pitch"] =
            serde_json::json!({ "mode": "Music" });
        let music_doc: ProjectDocument = serde_json::from_value(music.clone()).unwrap();
        Compiler::compile(&music_doc).expect("schema v4 Music should compile");

        let mut previous = voice_source;
        previous["schema_version"] = serde_json::json!(3);
        let previous_doc: ProjectDocument = serde_json::from_value(previous).unwrap();
        assert!(matches!(
            Compiler::compile(&previous_doc),
            Err(CompileError::UnsupportedSchema(3))
        ));

        music["edit"]["clips"][0]["kind"]["audio"]["time_pitch"] = serde_json::json!({
            "mode": "Music",
            "analysis": "Source",
            "preserve_formant": true
        });
        assert!(serde_json::from_value::<ProjectDocument>(music).is_err());
    }

    #[test]
    fn compile_rejects_previous_project_schema_v3() {
        let mut doc = make_minimal_project();
        doc.schema_version = 3;

        assert!(matches!(
            Compiler::compile(&doc),
            Err(CompileError::UnsupportedSchema(3))
        ));
    }

    #[test]
    fn compile_rejects_invalid_bpm() {
        let mut doc = make_minimal_project();
        doc.edit.tempo.points[0].micro_bpm = 0;
        assert!(Compiler::compile(&doc).is_err());
    }

    #[test]
    fn json_roundtrip() {
        let doc = make_minimal_project();
        let json = doc.to_json_pretty().expect("serialize");
        let doc2 = ProjectDocument::from_json_str(&json).expect("deserialize");

        assert_eq!(doc.meta.name, doc2.meta.name);
        assert_eq!(doc.edit.tracks.len(), doc2.edit.tracks.len());
        assert_eq!(doc.edit.clips.len(), doc2.edit.clips.len());
    }

    #[test]
    fn schema_v4_rejects_midi_clip_json_without_transpose() {
        let json = r#"
        {
          "schema_version": 4,
          "meta": {
            "name": "missing-transpose",
            "created_at": "2026-01-01",
            "app_version": "0.1.0",
            "project_sample_rate": 44100,
            "ppq": 960
          },
          "edit": {
            "tempo": {
              "ppq": 960,
              "points": [{ "at": 0, "micro_bpm": 120000000, "time_sig": { "num": 4, "den": 4 } }]
            },
            "grid": {
              "snap_enabled": true,
              "division": "Beat",
              "swing_permille": 0,
              "magnet_range_permille": 250,
              "snap_strength_permille": 1000
            },
            "tracks": [{
              "id": "00000000-0000-0000-0000-000000000001",
              "name": "MIDI",
              "kind": { "track_type": "midi", "audition_instrument": null, "render_enabled": false },
              "mute": false,
              "solo": false,
              "gain_milli_db": 0,
              "pan_permille": 0,
              "fx_chain": [],
              "routing": { "output": { "bus": "master" }, "sends": [] }
            }],
            "media": [],
            "contents": [{
              "type": "midi",
              "id": "00000000-0000-0000-0000-000000000002",
              "notes": [],
              "ccs": []
            }],
            "clips": [{
              "id": "00000000-0000-0000-0000-000000000003",
              "track_id": "00000000-0000-0000-0000-000000000001",
              "start": 0,
              "length": 960,
              "lane": 0,
              "muted": false,
              "gain_milli_db": 0,
              "kind": {
                "clip_type": "midi",
                "content_id": "00000000-0000-0000-0000-000000000002",
                "midi": { "content_in": 0, "content_out": 960 }
              }
            }],
            "routing": { "schema_hint": null },
            "automation": [],
            "pitch_links": []
          }
        }
        "#;

        let error = ProjectDocument::from_json_str(json).unwrap_err();
        assert!(error.to_string().contains("transpose_semitones"));
    }

    #[test]
    fn schema_v4_rejects_audio_clip_json_without_time_pitch() {
        let json = r#"
        {
          "schema_version": 4,
          "meta": {
            "name": "missing-algorithm",
            "created_at": "2026-01-01",
            "app_version": "0.1.0",
            "project_sample_rate": 44100,
            "ppq": 960
          },
          "edit": {
            "tempo": {
              "ppq": 960,
              "points": [{ "at": 0, "micro_bpm": 120000000, "time_sig": { "num": 4, "den": 4 } }]
            },
            "grid": {
              "snap_enabled": true,
              "division": "Beat",
              "swing_permille": 0,
              "magnet_range_permille": 250,
              "snap_strength_permille": 1000
            },
            "tracks": [{
              "id": "00000000-0000-0000-0000-000000000001",
              "name": "Audio",
              "kind": { "track_type": "audio" },
              "mute": false,
              "solo": false,
              "gain_milli_db": 0,
              "pan_permille": 0,
              "fx_chain": [],
              "routing": { "output": { "bus": "master" }, "sends": [] }
            }],
            "media": [{
              "id": "00000000-0000-0000-0000-000000000002",
              "in_zip_path": "media/test.wav",
              "channels": 1,
              "src_sample_rate": 44100,
              "length_src_frames": 44100,
              "hash": null,
              "original_name": null
            }],
            "contents": [{
              "type": "audio",
              "id": "00000000-0000-0000-0000-000000000003",
              "media_id": "00000000-0000-0000-0000-000000000002",
              "analysis_refs": []
            }],
            "clips": [{
              "id": "00000000-0000-0000-0000-000000000004",
              "track_id": "00000000-0000-0000-0000-000000000001",
              "start": 0,
              "length": 960,
              "lane": 0,
              "muted": false,
              "gain_milli_db": 0,
              "kind": {
                "clip_type": "audio",
                "content_id": "00000000-0000-0000-0000-000000000003",
                "audio": {
                  "src_in": 0,
                  "src_out": 44100,
                  "warp": { "warp_type": "none" },
                  "pitch": {
                    "mode": "ManualOnly",
                    "manual_coarse_semitones": 0,
                    "manual_fine_cents": 0
                  },
                  "fades": { "fade_in": 0, "fade_out": 0 }
                }
              }
            }],
            "routing": { "schema_hint": null },
            "automation": [],
            "pitch_links": []
          }
        }
        "#;

        let error = ProjectDocument::from_json_str(json).unwrap_err();
        assert!(error.to_string().contains("time_pitch"));
    }

    #[test]
    fn tick_to_frame_120bpm() {
        // At 120 BPM, 44100 Hz, ppq=960:
        // N = 44100 * 60_000_000 = 2_646_000_000_000
        // D = 120_000_000 * 960 = 115_200_000_000
        // 960 ticks = 960 * N / D = 960 * 2_646_000_000_000 / 115_200_000_000 = 22050
        let doc = make_minimal_project();
        let rt = Compiler::compile(&doc).expect("compile");

        let frame = rt.tempo.tick_to_frame(Tick(960), rt.sample_rate);
        assert_eq!(frame.0, 22050); // 0.5s * 44100
    }

    #[test]
    fn compile_midi_track() {
        let midi_content_id = ContentId::new();
        let midi_clip_id = ClipId::new();
        let midi_track_id = TrackId::new();

        let mut doc = make_minimal_project();

        doc.edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: midi_content_id,
            notes: vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(480),
                key: 60,
                vel: 100,
            }],
            ccs: vec![],
        }));

        doc.edit.clips.push(ClipEdit {
            id: midi_clip_id,
            track_id: midi_track_id,
            start: Tick(0),
            length: Tick(1920),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: midi_content_id,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(1920),
                    transpose_semitones: 0,
                },
            },
        });

        doc.edit.tracks.push(TrackEdit {
            id: midi_track_id,
            name: "MIDI 1".to_string(),
            kind: TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
            mute: false,
            solo: false,
            gain_milli_db: 0,
            pan_permille: 0,
            fx_chain: vec![],
            routing: TrackRoutingEdit {
                output: BusTarget::Master,
                sends: vec![],
            },
        });

        let rt = Compiler::compile(&doc).expect("compile with MIDI track");
        assert_eq!(rt.tracks.len(), 2);
    }

    #[test]
    fn compile_rejects_duplicate_midi_note_ids() {
        let mut doc = make_minimal_project();
        let note_id = NoteId::new();
        doc.edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: ContentId::new(),
            notes: vec![
                MidiNote {
                    id: note_id,
                    start: Tick(0),
                    length: Tick(120),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: note_id,
                    start: Tick(240),
                    length: Tick(120),
                    key: 64,
                    vel: 100,
                },
            ],
            ccs: vec![],
        }));

        assert!(matches!(
            Compiler::compile(&doc),
            Err(CompileError::DuplicateMidiNoteId(id)) if id == note_id
        ));
    }

    #[test]
    fn compile_rejects_invalid_midi_note_values() {
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
            let mut doc = make_minimal_project();
            doc.edit.contents.push(ContentEdit::Midi(MidiContentEdit {
                id: ContentId::new(),
                notes: vec![note],
                ccs: vec![],
            }));

            let error = Compiler::compile(&doc).expect_err("invalid MIDI note must not compile");
            assert_eq!(error.code(), "INVALID_MIDI_NOTE");
        }
    }

    #[test]
    fn compile_rejects_track_kind_mismatch() {
        let midi_content_id = ContentId::new();
        let clip_id = ClipId::new();

        let mut doc = make_minimal_project();

        doc.edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: midi_content_id,
            notes: vec![],
            ccs: vec![],
        }));

        // Create MIDI clip on Audio track -> should fail
        doc.edit.clips.push(ClipEdit {
            id: clip_id,
            track_id: doc.edit.tracks[0].id, // Audio track
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: midi_content_id,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(960),
                    transpose_semitones: 0,
                },
            },
        });

        assert!(Compiler::compile(&doc).is_err());
    }

    #[test]
    fn compile_rejects_duplicate_pitch_link() {
        let mut doc = make_minimal_project();

        let midi_track_id = TrackId::new();
        doc.edit.tracks.push(TrackEdit {
            id: midi_track_id,
            name: "MIDI".to_string(),
            kind: TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
            mute: false,
            solo: false,
            gain_milli_db: 0,
            pan_permille: 0,
            fx_chain: vec![],
            routing: TrackRoutingEdit {
                output: BusTarget::Master,
                sends: vec![],
            },
        });

        let audio_track_id = doc.edit.tracks[0].id;

        doc.edit.pitch_links.push(MidiToAudioPitchLink {
            id: PitchLinkId::new(),
            midi_track: midi_track_id,
            audio_track: audio_track_id,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        });
        doc.edit.pitch_links.push(MidiToAudioPitchLink {
            id: PitchLinkId::new(),
            midi_track: midi_track_id,
            audio_track: audio_track_id,
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        });

        match Compiler::compile(&doc) {
            Err(CompileError::DuplicatePitchLinkForAudioTrack(_)) => {}
            other => panic!("expected DuplicatePitchLinkForAudioTrack, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_midi_window_length_mismatch() {
        let mut doc = make_minimal_project();
        let midi_track_id = TrackId::new();
        let midi_content_id = ContentId::new();
        let midi_clip_id = ClipId::new();

        doc.edit.tracks.push(TrackEdit {
            id: midi_track_id,
            name: "MIDI".to_string(),
            kind: TrackKind::Midi {
                audition_instrument: None,
                render_enabled: false,
            },
            mute: false,
            solo: false,
            gain_milli_db: 0,
            pan_permille: 0,
            fx_chain: vec![],
            routing: TrackRoutingEdit {
                output: BusTarget::Master,
                sends: vec![],
            },
        });
        doc.edit.contents.push(ContentEdit::Midi(MidiContentEdit {
            id: midi_content_id,
            notes: vec![],
            ccs: vec![],
        }));
        doc.edit.clips.push(ClipEdit {
            id: midi_clip_id,
            track_id: midi_track_id,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id: midi_content_id,
                midi: MidiClipEdit {
                    content_in: Tick(0),
                    content_out: Tick(480),
                    transpose_semitones: 0,
                },
            },
        });

        match Compiler::compile(&doc) {
            Err(CompileError::InvalidMidiWindow { clip }) => assert_eq!(clip, midi_clip_id),
            other => panic!("expected InvalidMidiWindow, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_audio_source_range_exceeding_media_length() {
        let mut doc = make_minimal_project();
        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.src_out = SrcFrame(44_101);
        } else {
            unreachable!("expected audio clip");
        }

        match Compiler::compile(&doc) {
            Err(CompileError::InvalidAudioSourceRange { clip }) => {
                assert_eq!(clip, doc.edit.clips[0].id)
            }
            other => panic!("expected InvalidAudioSourceRange, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_warp_anchor_outside_clip_bounds() {
        let mut doc = make_minimal_project();
        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(1_200),
                    src_frame: SrcFrame(22_050),
                }],
            };
        } else {
            unreachable!("expected audio clip");
        }

        match Compiler::compile(&doc) {
            Err(CompileError::InvalidWarpAnchors { clip }) => {
                assert_eq!(clip, doc.edit.clips[0].id)
            }
            other => panic!("expected InvalidWarpAnchors, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_warp_anchor_duplicate_tick() {
        let mut doc = make_minimal_project();
        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(10_000),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(20_000),
                    },
                ],
            };
        } else {
            unreachable!("expected audio clip");
        }

        match Compiler::compile(&doc) {
            Err(CompileError::InvalidWarpAnchors { clip }) => {
                assert_eq!(clip, doc.edit.clips[0].id)
            }
            other => panic!("expected InvalidWarpAnchors, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_warp_anchor_descending_src() {
        let mut doc = make_minimal_project();
        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![
                    WarpAnchorEdit {
                        at_in_clip: Tick(240),
                        src_frame: SrcFrame(20_000),
                    },
                    WarpAnchorEdit {
                        at_in_clip: Tick(720),
                        src_frame: SrcFrame(15_000),
                    },
                ],
            };
        } else {
            unreachable!("expected audio clip");
        }

        match Compiler::compile(&doc) {
            Err(CompileError::InvalidWarpAnchors { clip }) => {
                assert_eq!(clip, doc.edit.clips[0].id)
            }
            other => panic!("expected InvalidWarpAnchors, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_automation_targeting_missing_fx() {
        let mut doc = make_minimal_project();
        doc.edit.automation.push(AutomationLane {
            id: AutomationId::new(),
            target: AutomationTarget::FxParam {
                track: doc.edit.tracks[0].id,
                fx_id: FxId::new(),
                param: "mix".to_string(),
            },
            points: vec![AutomationPoint {
                at: Tick(0),
                value: 0,
                curve: CurveShape::Linear,
            }],
        });

        match Compiler::compile(&doc) {
            Err(CompileError::FxNotFound { track, .. }) => {
                assert_eq!(track, doc.edit.tracks[0].id)
            }
            other => panic!("expected FxNotFound, got {:?}", other),
        }
    }

    #[test]
    fn compile_rejects_automation_targeting_missing_track() {
        let mut doc = make_minimal_project();
        doc.edit.automation.push(AutomationLane {
            id: AutomationId::new(),
            target: AutomationTarget::TrackParam {
                track: TrackId::new(),
                param: TrackParam::Gain,
            },
            points: vec![AutomationPoint {
                at: Tick(0),
                value: 0,
                curve: CurveShape::Linear,
            }],
        });

        assert!(Compiler::compile(&doc).is_err());
    }

    #[test]
    fn compile_rejects_routing_targeting_missing_track() {
        let mut doc = make_minimal_project();
        doc.edit.tracks[0].routing.output = BusTarget::Track {
            track: TrackId::new(),
        };

        assert!(Compiler::compile(&doc).is_err());
    }

    #[test]
    fn compile_rejects_fades_longer_than_clip() {
        let mut doc = make_minimal_project();
        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.fades.fade_in = Tick(700);
            audio.fades.fade_out = Tick(400);
        } else {
            unreachable!("expected audio clip");
        }

        assert!(Compiler::compile(&doc).is_err());
    }

    // ---- Pitch plan tests ----

    /// Helper: build a project with audio track, MIDI track, pitch link, and return IDs.
    fn make_pitch_link_project(
        priority: NotePriority,
        no_note_behavior: NoNoteBehavior,
        notes: Vec<MidiNote>,
    ) -> (ProjectDocument, TrackId, TrackId, MediaId, AnalysisId) {
        let media_id = MediaId::new();
        let f0_analysis_id = AnalysisId::new();
        let audio_content_id = ContentId::new();
        let midi_content_id = ContentId::new();
        let audio_clip_id = ClipId::new();
        let midi_clip_id = ClipId::new();
        let audio_track_id = TrackId::new();
        let midi_track_id = TrackId::new();

        let note_max_end = notes
            .iter()
            .map(|n| n.start.0 + n.length.0)
            .max()
            .unwrap_or(1920);
        let midi_length = note_max_end.max(1920);

        let doc = ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: ProjectMeta {
                name: "Pitch Test".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![
                    TrackEdit {
                        id: audio_track_id,
                        name: "Audio".to_string(),
                        kind: TrackKind::Audio,
                        mute: false,
                        solo: false,
                        gain_milli_db: 0,
                        pan_permille: 0,
                        fx_chain: vec![],
                        routing: TrackRoutingEdit {
                            output: BusTarget::Master,
                            sends: vec![],
                        },
                    },
                    TrackEdit {
                        id: midi_track_id,
                        name: "MIDI".to_string(),
                        kind: TrackKind::Midi {
                            audition_instrument: None,
                            render_enabled: false,
                        },
                        mute: false,
                        solo: false,
                        gain_milli_db: 0,
                        pan_permille: 0,
                        fx_chain: vec![],
                        routing: TrackRoutingEdit {
                            output: BusTarget::Master,
                            sends: vec![],
                        },
                    },
                ],
                media: vec![MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 2,
                    src_sample_rate: 44100,
                    length_src_frames: 88200,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![
                    ContentEdit::Audio(AudioContentEdit {
                        id: audio_content_id,
                        media_id,
                        analysis_refs: vec![f0_analysis_id],
                    }),
                    ContentEdit::Midi(MidiContentEdit {
                        id: midi_content_id,
                        notes,
                        ccs: vec![],
                    }),
                ],
                clips: vec![
                    ClipEdit {
                        id: audio_clip_id,
                        track_id: audio_track_id,
                        start: Tick(0),
                        length: Tick(3840), // 2 bars
                        lane: 0,
                        muted: false,
                        gain_milli_db: 0,
                        kind: ClipKind::Audio {
                            content_id: audio_content_id,
                            audio: AudioClipEdit {
                                src_in: SrcFrame(0),
                                src_out: SrcFrame(88200),
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
                    },
                    ClipEdit {
                        id: midi_clip_id,
                        track_id: midi_track_id,
                        start: Tick(0),
                        length: Tick(midi_length),
                        lane: 0,
                        muted: false,
                        gain_milli_db: 0,
                        kind: ClipKind::Midi {
                            content_id: midi_content_id,
                            midi: MidiClipEdit {
                                content_in: Tick(0),
                                content_out: Tick(midi_length),
                                transpose_semitones: 0,
                            },
                        },
                    },
                ],
                routing: RoutingEdit { schema_hint: None },
                automation: vec![],
                pitch_links: vec![MidiToAudioPitchLink {
                    id: PitchLinkId::new(),
                    midi_track: midi_track_id,
                    audio_track: audio_track_id,
                    no_note_behavior,
                    no_pitch_behavior: NoPitchBehavior::Bypass,
                    priority,
                }],
            },
        };
        (doc, audio_track_id, midi_track_id, media_id, f0_analysis_id)
    }

    fn make_test_f0_artifact(
        media_id: MediaId,
        hop_src_frames: u32,
        voiced_hz_x100: Vec<i32>,
    ) -> F0TrackArtifact {
        F0TrackArtifact {
            schema_version: 1,
            media_id,
            src_sample_rate: 44100,
            created_by: crate::analysis::CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames,
            f0_hz_x100: voiced_hz_x100,
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        }
    }

    fn insert_test_f0(
        analysis: &mut AnalysisStore,
        analysis_id: AnalysisId,
        artifact: F0TrackArtifact,
    ) {
        analysis.insert(analysis_id, AnalysisArtifact::F0Track(artifact));
    }

    #[test]
    fn pitch_plan_single_note_without_f0() {
        // Without F0 data and NoPitchBehavior::Bypass, follow becomes a true no-op.
        let (doc, audio_track_id, _, _, _) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(960),
                key: 72, // C5 = key 72, shift = (72-69)*100 = 300 cents
                vel: 100,
            }],
        );

        let rt = Compiler::compile(&doc).expect("compile");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert!(
            segs.is_empty(),
            "Bypass should emit no follow segments without F0"
        );
    }

    #[test]
    fn pitch_plan_with_f0_analysis() {
        // With F0 data: source ref = 220 Hz (A3), target = A4 (key 69, 440 Hz)
        // shift = 1200 * log2(440/220) = 1200 * 1.0 = 1200 cents
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(960),
                key: 69, // A4
                vel: 100,
            }],
        );

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            F0TrackArtifact {
                schema_version: 1,
                media_id,
                src_sample_rate: 44100,
                created_by: crate::analysis::CreatedBy {
                    app_version: "test".into(),
                    algo_version: "test".into(),
                    params_hash: "test".into(),
                },
                hop_src_frames: 512,
                // All frames at 220 Hz = 22000 in f0_hz_x100
                f0_hz_x100: vec![22000; 172], // 88200 / 512 ~= 172 frames
                voiced_prob_permille: None,
                method: "test".into(),
                params: String::new(),
            },
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert!(!segs.is_empty());
        // shift = 1200 * log2(440 / 220) = 1200 cents
        assert_eq!(segs[0].shift_cents, 1200);
    }

    #[test]
    fn rename_project_updates_meta_and_returns_inverse() {
        let mut doc = make_minimal_project();
        assert_eq!(doc.meta.name, "Test Project");

        let inverse = crate::api::apply_project_command(
            &mut doc,
            &crate::commands::Command::RenameProject {
                name: "  Renamed  ".to_string(),
            },
        )
        .expect("rename_project should succeed");

        assert_eq!(doc.meta.name, "Renamed");
        match inverse {
            crate::commands::Command::RenameProject { name } => assert_eq!(name, "Test Project"),
            other => panic!("expected RenameProject inverse, got {other:?}"),
        }

        // Applying the inverse restores the original name (round-trip).
        crate::api::apply_project_command(
            &mut doc,
            &crate::commands::Command::RenameProject {
                name: "Test Project".to_string(),
            },
        )
        .expect("inverse should apply");
        assert_eq!(doc.meta.name, "Test Project");
    }

    #[test]
    fn rename_project_rejects_empty_or_whitespace_name() {
        let mut doc = make_minimal_project();
        let original = doc.meta.name.clone();

        for bad in ["", "   ", "\t\n"] {
            let err = crate::api::apply_project_command(
                &mut doc,
                &crate::commands::Command::RenameProject {
                    name: bad.to_string(),
                },
            )
            .unwrap_err();
            assert!(err.to_string().contains("invalid project name"), "{err}");
        }
        assert_eq!(doc.meta.name, original);
    }

    #[test]
    fn rename_project_via_apply_command_errors() {
        let mut doc = make_minimal_project();
        let err = crate::commands::apply_command(
            &mut doc.edit,
            &crate::commands::Command::RenameProject {
                name: "Renamed".to_string(),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("apply_project_command"), "{err}");
    }

    #[test]
    fn pitch_plan_note_priority_highest() {
        // Two overlapping notes: key 60 (C4) and key 72 (C5)
        // Highest should pick key 72
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 72,
                    vel: 100,
                },
            ],
        );

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![44000; 172]),
        );
        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert!(!segs.is_empty());
        // Highest: key 72, shift = (72-69)*100 = 300
        assert_eq!(segs[0].shift_cents, 300);
    }

    #[test]
    fn pitch_plan_note_priority_lowest() {
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Lowest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 60,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 72,
                    vel: 100,
                },
            ],
        );

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![44000; 172]),
        );
        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert!(!segs.is_empty());
        // Lowest: key 60, shift = (60-69)*100 = -900
        assert_eq!(segs[0].shift_cents, -900);
    }

    #[test]
    fn pitch_plan_note_priority_latest_is_stable_across_save_normalization() {
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Latest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 72,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(960),
                    key: 60,
                    vel: 100,
                },
            ],
        );
        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![44000; 172]),
        );

        let before_save = Compiler::compile_with_analysis(&doc, Some(&analysis))
            .expect("compile before save normalization");
        let saved_json = crate::api::serialize_project_document_for_save(&doc)
            .expect("serialize normalized project");
        let reopened = ProjectDocument::from_json_str(&saved_json).expect("reopen saved project");
        let after_reopen = Compiler::compile_with_analysis(&reopened, Some(&analysis))
            .expect("compile reopened project");

        let before_shift = before_save
            .pitch_plan
            .iter()
            .find(|segment| segment.audio_track == audio_track_id)
            .map(|segment| segment.shift_cents);
        let after_shift = after_reopen
            .pitch_plan
            .iter()
            .find(|segment| segment.audio_track == audio_track_id)
            .map(|segment| segment.shift_cents);

        assert_eq!(before_shift, Some(300));
        assert_eq!(after_shift, before_shift);
    }

    #[test]
    fn pitch_plan_no_note_keep_original() {
        // One note from tick 0..480, then gap 480..960, then another 960..1440
        // KeepOriginal: gap should have no pitch segment
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(480),
                    key: 69,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(960),
                    length: Tick(480),
                    key: 72,
                    vel: 100,
                },
            ],
        );

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![44000; 172]),
        );
        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        // Should have segments for note regions but NOT for the gap
        assert!(segs.len() >= 2);
        // Check no segment covers the gap region (tick 480..960)
        let gap_start_frame = rt.tempo.tick_to_frame(Tick(480), rt.sample_rate).0;
        let gap_end_frame = rt.tempo.tick_to_frame(Tick(960), rt.sample_rate).0;
        for seg in &segs {
            // No segment should start in the gap
            assert!(
                !(seg.start.0 >= gap_start_frame && seg.start.0 < gap_end_frame),
                "found segment in gap region: {:?}",
                seg
            );
        }
    }

    #[test]
    fn pitch_plan_no_note_hold_last() {
        // One note from tick 0..480 (key=72), then gap 480..960
        // HoldLast: gap should still have key=72's pitch
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::HoldLast,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(480),
                key: 72,
                vel: 100,
            }],
        );

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![44000; 172]),
        );
        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        // HoldLast: should have pitch segment continuing after note ends
        // The expected shift for key 72 without F0 = (72-69)*100 = 300
        let held_segs: Vec<&&PitchSegmentRt> = segs
            .iter()
            .filter(|s| {
                let note_end_frame = rt.tempo.tick_to_frame(Tick(480), rt.sample_rate).0;
                s.start.0 >= note_end_frame
            })
            .collect();

        assert!(
            !held_segs.is_empty(),
            "HoldLast should produce segments after note ends"
        );
        for seg in &held_segs {
            assert_eq!(seg.shift_cents, 300);
        }
    }

    #[test]
    fn pitch_plan_uses_segment_specific_source_f0_ranges() {
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(1920),
                    key: 69,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(1920),
                    length: Tick(1920),
                    key: 69,
                    vel: 100,
                },
            ],
        );

        let mut analysis = AnalysisStore::new();
        let mut f0 = vec![22000; 172];
        for value in f0.iter_mut().skip(86) {
            *value = 44000;
        }
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, f0),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].shift_cents, 1200);
        assert_eq!(segs[1].shift_cents, 0);
    }

    #[test]
    fn pitch_plan_splits_sustained_notes_at_warp_anchor_boundaries() {
        let (mut doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(3840),
                key: 69,
                vel: 100,
            }],
        );

        if let ClipKind::Audio { audio, .. } = &mut doc.edit.clips[0].kind {
            audio.warp = WarpMapEdit::Anchors {
                anchors: vec![WarpAnchorEdit {
                    at_in_clip: Tick(1920),
                    src_frame: SrcFrame(22050),
                }],
            };
        } else {
            unreachable!("expected audio clip");
        }

        let mut analysis = AnalysisStore::new();
        let mut f0 = vec![22000; 172];
        for value in f0.iter_mut().skip(43) {
            *value = 44000;
        }
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, f0),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].shift_cents, 1200);
        assert_eq!(segs[1].shift_cents, 0);
    }

    #[test]
    fn pitch_plan_no_pitch_bypass_skips_unvoiced_segments() {
        let (doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(3840),
                key: 69,
                vel: 100,
            }],
        );

        let mut analysis = AnalysisStore::new();
        let mut f0 = vec![22000; 172];
        for value in f0.iter_mut().skip(86) {
            *value = -1;
        }
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, f0),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].shift_cents, 1200);
    }

    #[test]
    fn pitch_plan_no_pitch_hold_last_reuses_last_valid_shift() {
        let (mut doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(1920),
                    key: 69,
                    vel: 100,
                },
                MidiNote {
                    id: NoteId::new(),
                    start: Tick(1920),
                    length: Tick(1920),
                    key: 72,
                    vel: 100,
                },
            ],
        );
        doc.edit.pitch_links[0].no_pitch_behavior = NoPitchBehavior::HoldLast;

        let mut analysis = AnalysisStore::new();
        let mut f0 = vec![22000; 172];
        for value in f0.iter_mut().skip(86) {
            *value = -1;
        }
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, f0),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].shift_cents, 1200);
        assert_eq!(segs[1].shift_cents, 1200);
    }

    #[test]
    fn pitch_plan_no_pitch_hold_last_is_scoped_per_audio_clip() {
        let (mut doc, audio_track_id, midi_track_id, media_id_a, analysis_id_a) =
            make_pitch_link_project(
                NotePriority::Highest,
                NoNoteBehavior::KeepOriginal,
                vec![MidiNote {
                    id: NoteId::new(),
                    start: Tick(0),
                    length: Tick(3840),
                    key: 69,
                    vel: 100,
                }],
            );
        doc.edit.pitch_links[0].no_pitch_behavior = NoPitchBehavior::HoldLast;

        let audio_content_id_a = match &doc.edit.contents[0] {
            ContentEdit::Audio(audio) => audio.id,
            _ => unreachable!("expected audio content"),
        };
        let midi_content_id = match &doc.edit.contents[1] {
            ContentEdit::Midi(midi) => midi.id,
            _ => unreachable!("expected midi content"),
        };

        let media_id_b = MediaId::new();
        let audio_content_id_b = ContentId::new();
        doc.edit.media.push(MediaAsset {
            id: media_id_b,
            in_zip_path: "media/test-b.wav".to_string(),
            channels: 2,
            src_sample_rate: 44100,
            length_src_frames: 44100,
            hash: None,
            original_name: None,
        });
        doc.edit.contents.push(ContentEdit::Audio(AudioContentEdit {
            id: audio_content_id_b,
            media_id: media_id_b,
            analysis_refs: vec![],
        }));

        doc.edit.clips = vec![
            ClipEdit {
                id: ClipId::new(),
                track_id: audio_track_id,
                start: Tick(0),
                length: Tick(1920),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Audio {
                    content_id: audio_content_id_a,
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
            },
            ClipEdit {
                id: ClipId::new(),
                track_id: audio_track_id,
                start: Tick(1920),
                length: Tick(1920),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Audio {
                    content_id: audio_content_id_b,
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
            },
            ClipEdit {
                id: ClipId::new(),
                track_id: midi_track_id,
                start: Tick(0),
                length: Tick(3840),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Midi {
                    content_id: midi_content_id,
                    midi: MidiClipEdit {
                        content_in: Tick(0),
                        content_out: Tick(3840),
                        transpose_semitones: 0,
                    },
                },
            },
        ];

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id_a,
            make_test_f0_artifact(media_id_a, 512, vec![22000; 86]),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].shift_cents, 1200);
    }

    #[test]
    fn pitch_plan_no_pitch_hold_last_is_noop_without_prior_valid_shift() {
        let (mut doc, audio_track_id, _, media_id, analysis_id) = make_pitch_link_project(
            NotePriority::Highest,
            NoNoteBehavior::KeepOriginal,
            vec![MidiNote {
                id: NoteId::new(),
                start: Tick(0),
                length: Tick(3840),
                key: 72,
                vel: 100,
            }],
        );
        doc.edit.pitch_links[0].no_pitch_behavior = NoPitchBehavior::HoldLast;

        let mut analysis = AnalysisStore::new();
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, vec![-1; 172]),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert!(
            segs.is_empty(),
            "HoldLast should no-op until a valid shift exists"
        );
    }

    #[test]
    fn split_like_audio_clips_reuse_media_analysis_but_recompute_segment_summary() {
        let (mut doc, audio_track_id, midi_track_id, media_id, analysis_id) =
            make_pitch_link_project(
                NotePriority::Highest,
                NoNoteBehavior::KeepOriginal,
                vec![
                    MidiNote {
                        id: NoteId::new(),
                        start: Tick(0),
                        length: Tick(1920),
                        key: 69,
                        vel: 100,
                    },
                    MidiNote {
                        id: NoteId::new(),
                        start: Tick(1920),
                        length: Tick(1920),
                        key: 69,
                        vel: 100,
                    },
                ],
            );

        let audio_content_id = match &doc.edit.clips[0].kind {
            ClipKind::Audio { content_id, .. } => *content_id,
            _ => unreachable!("expected audio clip"),
        };
        doc.edit.clips.retain(|clip| clip.track_id != midi_track_id);
        let left_clip_id = ClipId::new();
        let right_clip_id = ClipId::new();
        doc.edit.clips = vec![
            ClipEdit {
                id: left_clip_id,
                track_id: audio_track_id,
                start: Tick(0),
                length: Tick(1920),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Audio {
                    content_id: audio_content_id,
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
            },
            ClipEdit {
                id: right_clip_id,
                track_id: audio_track_id,
                start: Tick(1920),
                length: Tick(1920),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Audio {
                    content_id: audio_content_id,
                    audio: AudioClipEdit {
                        src_in: SrcFrame(44100),
                        src_out: SrcFrame(88200),
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
            },
            ClipEdit {
                id: ClipId::new(),
                track_id: midi_track_id,
                start: Tick(0),
                length: Tick(3840),
                lane: 0,
                muted: false,
                gain_milli_db: 0,
                kind: ClipKind::Midi {
                    content_id: match &doc.edit.contents[1] {
                        ContentEdit::Midi(midi) => midi.id,
                        _ => unreachable!("expected midi content"),
                    },
                    midi: MidiClipEdit {
                        content_in: Tick(0),
                        content_out: Tick(3840),
                        transpose_semitones: 0,
                    },
                },
            },
        ];

        let mut analysis = AnalysisStore::new();
        let mut f0 = vec![22000; 172];
        for value in f0.iter_mut().skip(86) {
            *value = 44000;
        }
        insert_test_f0(
            &mut analysis,
            analysis_id,
            make_test_f0_artifact(media_id, 512, f0),
        );

        let rt =
            Compiler::compile_with_analysis(&doc, Some(&analysis)).expect("compile with analysis");
        let segs: Vec<&PitchSegmentRt> = rt
            .pitch_plan
            .iter()
            .filter(|s| s.audio_track == audio_track_id)
            .collect();

        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].shift_cents, 1200);
        assert_eq!(segs[1].shift_cents, 0);
    }
}
