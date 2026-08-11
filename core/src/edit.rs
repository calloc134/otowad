use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::ids::*;
use crate::time::*;

// =============================================================================
// Project document (top-level serialization unit)
// =============================================================================

pub const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectDocument {
    pub schema_version: u32,
    pub meta: ProjectMeta,
    pub edit: ProjectEdit,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectMeta {
    pub name: String,
    pub created_at: String,
    pub app_version: String,
    /// Project-wide sample rate (Hz).
    pub project_sample_rate: u32,
    /// PPQ. Must match `edit.tempo.ppq`.
    pub ppq: i32,
}

// =============================================================================
// Edit aggregate root
//
// Main collections use Vec (ordered). Order is semantic:
//   tracks: UI top-to-bottom order
//   clips: creation order
//   contents: creation order
//   media: creation order
//   automation: creation order
//   pitch_links: creation order
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectEdit {
    pub tempo: TempoMapEdit,
    pub grid: GridSettings,

    /// Track definitions. Order = UI top-to-bottom.
    pub tracks: Vec<TrackEdit>,

    /// Media assets (wav files etc.). Order = creation order.
    pub media: Vec<MediaAsset>,

    /// Content pool (MIDI note sequences / Audio media references). Order = creation order.
    pub contents: Vec<ContentEdit>,

    /// Clip pool (timeline placements). Order = creation order.
    /// Ownership is determined by `clip.track_id`, not by track-side lists.
    pub clips: Vec<ClipEdit>,

    pub routing: RoutingEdit,

    /// Automation lanes. Order = creation order.
    pub automation: Vec<AutomationLane>,

    /// MIDI -> Audio pitch follow links. Order = creation order.
    pub pitch_links: Vec<MidiToAudioPitchLink>,
}

// =============================================================================
// Media
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaAsset {
    pub id: MediaId,
    /// Relative path inside the zip archive (e.g. "media/<id>.wav").
    pub in_zip_path: String,
    pub channels: u16,
    /// Source sample rate of the media file (may differ from project sample rate).
    pub src_sample_rate: u32,
    /// Length in source frames.
    pub length_src_frames: u64,
    /// File hash for integrity (optional).
    pub hash: Option<String>,
    /// Original file name before import (optional).
    pub original_name: Option<String>,
}

// =============================================================================
// Content (clip inner data)
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ContentEdit {
    Audio(AudioContentEdit),
    Midi(MidiContentEdit),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioContentEdit {
    pub id: ContentId,
    pub media_id: MediaId,
    /// References to analysis artifacts (F0, waveform peaks, pitch marks, etc.)
    pub analysis_refs: Vec<AnalysisId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiContentEdit {
    pub id: ContentId,
    /// Notes sorted by: start asc -> key asc -> length asc (normalized before save).
    pub notes: Vec<MidiNote>,
    pub ccs: Vec<MidiCc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiNote {
    /// Stable identity used by edit commands. Array position is not identity.
    pub id: NoteId,
    /// Start position relative to content origin.
    pub start: Tick,
    /// Duration.
    pub length: Tick,
    /// MIDI key (0..127).
    pub key: u8,
    /// Velocity (0..127).
    pub vel: u8,
}

pub(crate) fn invalid_midi_note_value(note: &MidiNote) -> Option<(&'static str, i64)> {
    if note.start.0 < 0 {
        Some(("start", note.start.0))
    } else if note.length.0 <= 0 {
        Some(("length", note.length.0))
    } else if note.key > 127 {
        Some(("key", i64::from(note.key)))
    } else if note.vel > 127 {
        Some(("vel", i64::from(note.vel)))
    } else {
        None
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiCc {
    pub at: Tick,
    pub cc: u8,
    pub value: u8,
}

// =============================================================================
// Track
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackEdit {
    pub id: TrackId,
    pub name: String,
    pub kind: TrackKind,
    pub mute: bool,
    pub solo: bool,
    /// Gain in milli-dB (e.g. 0 = unity, 6000 = +6dB).
    pub gain_milli_db: i32,
    /// Pan in permille (-1000 = full left, 0 = center, 1000 = full right).
    pub pan_permille: i32,
    /// FX chain applied top-to-bottom.
    pub fx_chain: Vec<FxSlotEdit>,
    /// Audio routing (v1: Master + Sends).
    pub routing: TrackRoutingEdit,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "track_type", rename_all = "snake_case", deny_unknown_fields)]
pub enum TrackKind {
    Audio,
    Midi {
        /// Audition instrument (not rendered in final output).
        audition_instrument: Option<InstrumentRef>,
        /// v1: normally false. MIDI track is not rendered.
        render_enabled: bool,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstrumentRef {
    pub plugin_id: String,
    pub preset: Option<String>,
}

// =============================================================================
// Clip (timeline placement)
//
// Ownership: `clip.track_id` is the sole ownership field.
// Track does NOT store clip_ids.
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipEdit {
    pub id: ClipId,
    /// The owning track. This is the single source of truth for clip-to-track membership.
    pub track_id: TrackId,
    /// Absolute position on the timeline (tick).
    pub start: Tick,
    /// Duration on the timeline (tick).
    pub length: Tick,
    /// Lane for overlapping clips. v1: usually 0.
    pub lane: u16,
    pub muted: bool,
    /// Clip gain in milli-dB.
    pub gain_milli_db: i32,
    pub kind: ClipKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "clip_type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClipKind {
    Audio {
        content_id: ContentId,
        audio: AudioClipEdit,
    },
    Midi {
        content_id: ContentId,
        midi: MidiClipEdit,
    },
}

/// Audio clip specific edit data.
/// - Red handle: src_in / src_out (source clipping, preserves speed)
/// - Blue handle: length on ClipEdit (time stretch, preserves source bounds)
/// - Internal markers: warp anchors (clip tick <-> source frame)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioClipEdit {
    /// Source start frame (SrcFrame basis).
    pub src_in: SrcFrame,
    /// Source end frame (SrcFrame basis). Must be > src_in.
    pub src_out: SrcFrame,

    pub warp: WarpMapEdit,
    pub pitch: PitchControlEdit,
    pub fades: FadesEdit,
    pub time_pitch: TimePitchModeEdit,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", deny_unknown_fields)]
pub enum TimePitchModeEdit {
    Voice {
        analysis: VoiceAnalysisModeEdit,
        preserve_formant: bool,
    },
    Music {},
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum VoiceAnalysisModeEdit {
    Local,
    Source,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "warp_type", rename_all = "snake_case", deny_unknown_fields)]
pub enum WarpMapEdit {
    None,
    Anchors { anchors: Vec<WarpAnchorEdit> },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarpAnchorEdit {
    /// Relative tick from clip start.
    pub at_in_clip: Tick,
    /// Absolute frame position in media (SrcFrame basis).
    pub src_frame: SrcFrame,
}

/// MIDI clip specific edit data.
/// `content_in` and `content_out` define the visible window into the content.
/// Invariant: `clip.length == content_out - content_in`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiClipEdit {
    /// Start of the visible window in content coordinates.
    pub content_in: Tick,
    /// End of the visible window in content coordinates.
    pub content_out: Tick,
    /// Clip-local transpose in semitones. Does not mutate shared MIDI content.
    pub transpose_semitones: i16,
}

// =============================================================================
// Pitch control
// =============================================================================

/// Pitch control combines automatic MIDI follow with manual adjustment.
/// All values are fixed-point integers for Git diff stability.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PitchControlEdit {
    pub mode: PitchControlMode,
    /// Manual coarse adjustment in semitones.
    pub manual_coarse_semitones: i16,
    /// Manual fine adjustment in cents (-99..99).
    /// Normalized before persistence: overflow rolls into coarse.
    pub manual_fine_cents: i16,
}

impl Default for PitchControlEdit {
    fn default() -> Self {
        Self {
            mode: PitchControlMode::ManualOnly,
            manual_coarse_semitones: 0,
            manual_fine_cents: 0,
        }
    }
}

impl PitchControlEdit {
    /// Normalize fine cents into -99..99 range, rolling excess into coarse semitones.
    /// The sign of fine always matches the sign of the total (or is zero).
    pub fn normalize(&mut self) {
        let total_cents = self.manual_coarse_semitones as i32 * 100 + self.manual_fine_cents as i32;
        // Truncating division toward zero (Rust default for i32)
        let coarse = total_cents / 100;
        let fine = total_cents % 100; // same sign as total_cents (or zero)
        self.manual_coarse_semitones = coarse as i16;
        self.manual_fine_cents = fine as i16;
    }

    /// Total manual pitch offset in cents.
    pub fn manual_cents(&self) -> i32 {
        self.manual_coarse_semitones as i32 * 100 + self.manual_fine_cents as i32
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum PitchControlMode {
    ManualOnly,
    FollowMidiOnly,
    ManualPlusFollow,
}

/// Fade durations in ticks.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FadesEdit {
    pub fade_in: Tick,
    pub fade_out: Tick,
}

// =============================================================================
// FX / Routing
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FxSlotEdit {
    pub id: FxId,
    pub plugin_id: String,
    pub enabled: bool,
    /// Parameters stored as BTreeMap for JSON diff stability.
    /// Values are fixed-point integers (interpretation is plugin-defined).
    pub params: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackRoutingEdit {
    pub output: BusTarget,
    pub sends: Vec<SendEdit>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "bus", rename_all = "snake_case", deny_unknown_fields)]
pub enum BusTarget {
    Master,
    Track { track: TrackId },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendEdit {
    pub target: BusTarget,
    /// Send level in milli-dB.
    pub level_milli_db: i32,
    pub pre_fader: bool,
}

/// v1: thin placeholder, resolved during compile into runtime DAG.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoutingEdit {
    pub schema_hint: Option<String>,
}

// =============================================================================
// Automation
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutomationLane {
    pub id: AutomationId,
    pub target: AutomationTarget,
    /// Points sorted by `at` ascending (normalized before save).
    pub points: Vec<AutomationPoint>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutomationPoint {
    pub at: Tick,
    /// Value as fixed-point integer. Interpretation depends on target type.
    pub value: i64,
    pub curve: CurveShape,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum CurveShape {
    Hold,
    Linear,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "target", rename_all = "snake_case", deny_unknown_fields)]
pub enum AutomationTarget {
    TrackParam {
        track: TrackId,
        param: TrackParam,
    },
    FxParam {
        track: TrackId,
        fx_id: FxId,
        param: String,
    },
    ClipParam {
        clip: ClipId,
        param: ClipParam,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum TrackParam {
    Gain,
    Pan,
    Mute,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ClipParam {
    Gain,
    Mute,
    PitchCents,
}

// =============================================================================
// MIDI -> Audio pitch follow
// =============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MidiToAudioPitchLink {
    pub id: PitchLinkId,
    pub midi_track: TrackId,
    pub audio_track: TrackId,
    pub no_note_behavior: NoNoteBehavior,
    pub no_pitch_behavior: NoPitchBehavior,
    pub priority: NotePriority,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum NoNoteBehavior {
    KeepOriginal,
    HoldLast,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum NoPitchBehavior {
    Bypass,
    HoldLast,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum NotePriority {
    Highest,
    Lowest,
    Latest,
}

// =============================================================================
// JSON I/O helpers
// =============================================================================

impl ProjectDocument {
    /// Pretty-printed JSON for saved artifacts, where stable Git diffs matter.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Compact JSON for the WASM bridge hot path, where payload size matters.
    pub fn to_json_compact(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json_str(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

impl ProjectEdit {
    /// Normalize collections for save-time consistency.
    /// - MidiContent.notes: sort by start asc, key asc, length asc, id asc
    /// - AutomationLane.points: sort by at asc
    /// - WarpAnchors: sort by at_in_clip asc
    pub fn normalize_for_save(&mut self) {
        // Normalize MIDI content notes
        for content in &mut self.contents {
            if let ContentEdit::Midi(midi) = content {
                midi.notes.sort_by(|a, b| {
                    a.start
                        .0
                        .cmp(&b.start.0)
                        .then(a.key.cmp(&b.key))
                        .then(a.length.0.cmp(&b.length.0))
                        .then(a.id.cmp(&b.id))
                });
            }
        }

        // Normalize automation points
        for lane in &mut self.automation {
            lane.points.sort_by_key(|point| point.at.0);
        }

        // Normalize warp anchors in audio clips
        for clip in &mut self.clips {
            if let ClipKind::Audio { audio, .. } = &mut clip.kind {
                if let WarpMapEdit::Anchors { anchors } = &mut audio.warp {
                    anchors.sort_by_key(|anchor| anchor.at_in_clip.0);
                }
            }
        }
    }
}

#[cfg(test)]
mod strict_schema_tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::json;

    #[test]
    fn current_project_schema_is_v4() {
        assert_eq!(CURRENT_PROJECT_SCHEMA_VERSION, 4);
    }

    fn assert_rejects_unknown_field<T>(value: &T)
    where
        T: Serialize + DeserializeOwned,
    {
        let mut json = serde_json::to_value(value).expect("serialize strict-schema fixture");
        json.as_object_mut()
            .expect("strict-schema fixture must serialize as an object")
            .insert("unexpected_field".to_string(), json!(true));

        assert!(
            serde_json::from_value::<T>(json).is_err(),
            "{} accepted an unknown field",
            std::any::type_name::<T>()
        );
    }

    #[test]
    fn persisted_schema_rejects_unknown_fields_at_every_object_boundary() {
        let track_id = TrackId::new();
        let content_id = ContentId::new();
        let media_id = MediaId::new();
        let clip_id = ClipId::new();
        let fx_id = FxId::new();
        let note = MidiNote {
            id: NoteId::new(),
            start: Tick(0),
            length: Tick(480),
            key: 60,
            vel: 100,
        };
        let time_signature = TimeSignature { num: 4, den: 4 };
        let tempo_point = TempoPointEdit {
            at: Tick(0),
            micro_bpm: 120_000_000,
            time_sig: time_signature,
        };
        let tempo = TempoMapEdit {
            ppq: 960,
            points: vec![tempo_point.clone()],
        };
        let grid = GridSettings::default();
        let routing_target = BusTarget::Track { track: track_id };
        let send = SendEdit {
            target: BusTarget::Master,
            level_milli_db: -6_000,
            pre_fader: false,
        };
        let track_routing = TrackRoutingEdit {
            output: routing_target.clone(),
            sends: vec![send.clone()],
        };
        let instrument = InstrumentRef {
            plugin_id: "audition".to_string(),
            preset: Some("default".to_string()),
        };
        let track_kind = TrackKind::Midi {
            audition_instrument: Some(instrument.clone()),
            render_enabled: false,
        };
        let fx = FxSlotEdit {
            id: fx_id,
            plugin_id: "gain".to_string(),
            enabled: true,
            params: BTreeMap::from([("gain".to_string(), 0)]),
        };
        let track = TrackEdit {
            id: track_id,
            name: "MIDI".to_string(),
            kind: track_kind.clone(),
            mute: false,
            solo: false,
            gain_milli_db: 0,
            pan_permille: 0,
            fx_chain: vec![fx.clone()],
            routing: track_routing.clone(),
        };
        let media = MediaAsset {
            id: media_id,
            in_zip_path: "media/test.wav".to_string(),
            channels: 1,
            src_sample_rate: 44_100,
            length_src_frames: 44_100,
            hash: None,
            original_name: Some("test.wav".to_string()),
        };
        let audio_content = AudioContentEdit {
            id: content_id,
            media_id,
            analysis_refs: vec![],
        };
        let midi_cc = MidiCc {
            at: Tick(0),
            cc: 1,
            value: 64,
        };
        let midi_content = MidiContentEdit {
            id: content_id,
            notes: vec![note.clone()],
            ccs: vec![midi_cc.clone()],
        };
        let warp_anchor = WarpAnchorEdit {
            at_in_clip: Tick(0),
            src_frame: SrcFrame(0),
        };
        let warp = WarpMapEdit::Anchors {
            anchors: vec![warp_anchor.clone()],
        };
        let pitch = PitchControlEdit::default();
        let fades = FadesEdit {
            fade_in: Tick(0),
            fade_out: Tick(0),
        };
        let time_pitch = TimePitchModeEdit::Voice {
            analysis: VoiceAnalysisModeEdit::Source,
            preserve_formant: true,
        };
        let audio_clip = AudioClipEdit {
            src_in: SrcFrame(0),
            src_out: SrcFrame(44_100),
            warp: warp.clone(),
            pitch: pitch.clone(),
            fades: fades.clone(),
            time_pitch: time_pitch.clone(),
        };
        let midi_clip = MidiClipEdit {
            content_in: Tick(0),
            content_out: Tick(960),
            transpose_semitones: 0,
        };
        let clip = ClipEdit {
            id: clip_id,
            track_id,
            start: Tick(0),
            length: Tick(960),
            lane: 0,
            muted: false,
            gain_milli_db: 0,
            kind: ClipKind::Midi {
                content_id,
                midi: midi_clip.clone(),
            },
        };
        let routing = RoutingEdit { schema_hint: None };
        let automation_target = AutomationTarget::FxParam {
            track: track_id,
            fx_id,
            param: "gain".to_string(),
        };
        let automation_point = AutomationPoint {
            at: Tick(0),
            value: 0,
            curve: CurveShape::Linear,
        };
        let automation = AutomationLane {
            id: AutomationId::new(),
            target: automation_target.clone(),
            points: vec![automation_point.clone()],
        };
        let pitch_link = MidiToAudioPitchLink {
            id: PitchLinkId::new(),
            midi_track: track_id,
            audio_track: TrackId::new(),
            no_note_behavior: NoNoteBehavior::KeepOriginal,
            no_pitch_behavior: NoPitchBehavior::Bypass,
            priority: NotePriority::Highest,
        };
        let edit = ProjectEdit {
            tempo: tempo.clone(),
            grid: grid.clone(),
            tracks: vec![track.clone()],
            media: vec![media.clone()],
            contents: vec![ContentEdit::Midi(midi_content.clone())],
            clips: vec![clip.clone()],
            routing: routing.clone(),
            automation: vec![automation.clone()],
            pitch_links: vec![pitch_link.clone()],
        };
        let meta = ProjectMeta {
            name: "strict".to_string(),
            created_at: "2026-08-09".to_string(),
            app_version: "0.1.0".to_string(),
            project_sample_rate: 44_100,
            ppq: 960,
        };
        let document = ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: meta.clone(),
            edit: edit.clone(),
        };

        assert_rejects_unknown_field(&document);
        assert_rejects_unknown_field(&meta);
        assert_rejects_unknown_field(&edit);
        assert_rejects_unknown_field(&tempo);
        assert_rejects_unknown_field(&tempo_point);
        assert_rejects_unknown_field(&time_signature);
        assert_rejects_unknown_field(&grid);
        assert_rejects_unknown_field(&media);
        assert_rejects_unknown_field(&ContentEdit::Audio(audio_content.clone()));
        assert_rejects_unknown_field(&audio_content);
        assert_rejects_unknown_field(&ContentEdit::Midi(midi_content.clone()));
        assert_rejects_unknown_field(&midi_content);
        assert_rejects_unknown_field(&note);
        assert_rejects_unknown_field(&midi_cc);
        assert_rejects_unknown_field(&track);
        assert_rejects_unknown_field(&track_kind);
        assert_rejects_unknown_field(&instrument);
        assert_rejects_unknown_field(&clip);
        assert_rejects_unknown_field(&ClipKind::Audio {
            content_id,
            audio: audio_clip.clone(),
        });
        assert_rejects_unknown_field(&ClipKind::Midi {
            content_id,
            midi: midi_clip.clone(),
        });
        assert_rejects_unknown_field(&audio_clip);
        assert_rejects_unknown_field(&time_pitch);
        assert_rejects_unknown_field(&warp);
        assert_rejects_unknown_field(&warp_anchor);
        assert_rejects_unknown_field(&midi_clip);
        assert_rejects_unknown_field(&pitch);
        assert_rejects_unknown_field(&fades);
        assert_rejects_unknown_field(&fx);
        assert_rejects_unknown_field(&track_routing);
        assert_rejects_unknown_field(&routing_target);
        assert_rejects_unknown_field(&send);
        assert_rejects_unknown_field(&routing);
        assert_rejects_unknown_field(&automation);
        assert_rejects_unknown_field(&automation_point);
        assert_rejects_unknown_field(&automation_target);
        assert_rejects_unknown_field(&pitch_link);
    }
}
