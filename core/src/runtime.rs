use crate::ids::*;
use crate::time::*;

/// Runtime model: never persisted. Derived from Edit via Compiler::compile().
/// All timeline time values are in TimelineFrame (project sample rate).
/// Source positions remain in SrcFrame.
#[derive(Debug)]
pub struct ProjectRuntime {
    pub sample_rate: u32,
    pub tempo: TempoMapRt,
    pub tracks: Vec<TrackRuntime>,
    pub pitch_plan: Vec<PitchSegmentRt>,
    pub automation: Vec<AutomationLaneRt>,
}

#[derive(Debug)]
pub struct TempoMapRt {
    pub ppq: i32,
    pub points: Vec<TempoPointRt>,
    /// micro_bpm from the first (v1: only) tempo point, for tick_to_frame.
    pub micro_bpm: i64,
}

#[derive(Debug)]
pub struct TempoPointRt {
    pub at_tick: Tick,
    pub micro_bpm: i64,
    pub time_sig: TimeSignature,
}

impl TempoMapRt {
    /// Convert a tick position to a timeline frame using deterministic integer arithmetic.
    pub fn tick_to_frame(&self, t: Tick, sample_rate: u32) -> TimelineFrame {
        tick_to_frame_floor(t, sample_rate, self.micro_bpm, self.ppq)
    }
}

#[derive(Debug)]
pub struct TrackRuntime {
    pub id: TrackId,
    pub kind: TrackKindRt,
    /// Clips sorted by start frame.
    pub clips: Vec<ClipRuntime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackKindRt {
    Audio,
    Midi,
}

#[derive(Debug)]
pub enum ClipRuntime {
    Audio(AudioClipRt),
    Midi(MidiClipRt),
}

#[derive(Debug)]
pub struct AudioClipRt {
    pub clip_id: ClipId,
    pub content_id: ContentId,
    pub start: TimelineFrame,
    pub end: TimelineFrame,

    pub media_id: MediaId,
    pub src_in: SrcFrame,
    pub src_out: SrcFrame,

    /// Expanded warp mapping.
    pub warp_plan: WarpPlanRt,

    /// Manual pitch offset in cents (coarse*100 + fine).
    pub manual_pitch_cents: i32,
    /// Pitch control mode from edit.
    pub pitch_mode: PitchModeRt,
}

#[derive(Debug)]
pub struct MidiClipRt {
    pub clip_id: ClipId,
    pub content_id: ContentId,
    pub start: TimelineFrame,
    pub end: TimelineFrame,
}

#[derive(Debug)]
pub enum WarpPlanRt {
    Linear,
    Piecewise { segments: Vec<WarpSegmentRt> },
}

#[derive(Debug)]
pub struct WarpSegmentRt {
    pub dst_start: TimelineFrame,
    pub dst_end: TimelineFrame,
    pub src_start: SrcFrame,
    pub src_end: SrcFrame,
}

/// Pitch segment for MIDI follow pitch shifting.
/// Represents a contiguous time range with a constant pitch shift.
#[derive(Debug)]
pub struct PitchSegmentRt {
    pub clip_id: ClipId,
    pub audio_track: TrackId,
    pub start: TimelineFrame,
    pub end: TimelineFrame,
    /// Shift amount in cents (e.g. +200 = up 2 semitones).
    pub shift_cents: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PitchModeRt {
    ManualOnly,
    FollowMidiOnly,
    ManualPlusFollow,
}

#[derive(Debug)]
pub struct AutomationLaneRt {
    pub target: AutomationTargetRt,
    /// Points converted to frame positions.
    pub points: Vec<AutomationPointRt>,
}

#[derive(Debug)]
pub struct AutomationPointRt {
    pub at: TimelineFrame,
    pub value: i64,
}

#[derive(Debug)]
pub enum AutomationTargetRt {
    TrackGain {
        track: TrackId,
    },
    TrackPan {
        track: TrackId,
    },
    FxParam {
        track: TrackId,
        fx_id: FxId,
        param: String,
    },
    ClipGain {
        clip: ClipId,
    },
    TrackMute {
        track: TrackId,
    },
    ClipMute {
        clip: ClipId,
    },
    ClipPitchCents {
        clip: ClipId,
    },
}
