use serde::{Deserialize, Serialize};

/// Ticks per quarter note (PPQ). Default value; can be overridden per project.
pub const DEFAULT_PPQ: i32 = 960;

// =============================================================================
// Time domain types (must never be mixed)
// =============================================================================

/// Musical time unit (tick). All edit-domain time is expressed in ticks.
/// PPQ-based. This is the edit-time authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Tick(pub i64);

/// Audio frame at project sample rate. Runtime-only unit.
/// Never persisted as canonical project state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TimelineFrame(pub i64);

/// Audio frame at media source sample rate.
/// Used for source window (src_in/src_out), warp anchors, and analysis artifacts.
/// Type-distinct from TimelineFrame: mixing these two is a compile-time error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SrcFrame(pub u64);

// =============================================================================
// Time signature
// =============================================================================

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeSignature {
    pub num: u8,
    pub den: u8,
}

// =============================================================================
// Tempo map (edit domain)
// =============================================================================

/// A single tempo change point on the tempo map.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TempoPointEdit {
    pub at: Tick,
    /// BPM in micro-BPM (e.g. 120 BPM = 120_000_000).
    /// Fixed-point integer avoids float diff noise in JSON.
    pub micro_bpm: i64,
    pub time_sig: TimeSignature,
}

/// Tempo map: sequence of tempo points.
/// v1 expects exactly one point at tick 0.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TempoMapEdit {
    pub ppq: i32,
    pub points: Vec<TempoPointEdit>,
}

impl TempoMapEdit {
    /// Create a simple fixed-BPM tempo map.
    /// `bpm` is a human-readable value (e.g. 120.0).
    pub fn fixed(bpm: f64, time_sig: TimeSignature) -> Self {
        let micro_bpm = (bpm * 1_000_000.0).round() as i64;
        Self {
            ppq: DEFAULT_PPQ,
            points: vec![TempoPointEdit {
                at: Tick(0),
                micro_bpm,
                time_sig,
            }],
        }
    }

    /// Human-readable BPM from the first tempo point.
    pub fn bpm(&self) -> f64 {
        if self.points.is_empty() {
            120.0
        } else {
            self.points[0].micro_bpm as f64 / 1_000_000.0
        }
    }
}

// =============================================================================
// Tick -> TimelineFrame conversion (integer arithmetic, deterministic)
// =============================================================================

/// Convert a tick position to a timeline frame using deterministic integer arithmetic.
///
/// Formula (v1, fixed BPM):
///   N = project_sample_rate * 60_000_000
///   D = micro_bpm * ppq
///   frame = floor(tick * N / D)
///
/// Uses i128 intermediate to avoid overflow.
pub fn tick_to_frame_floor(
    tick: Tick,
    project_sample_rate: u32,
    micro_bpm: i64,
    ppq: i32,
) -> TimelineFrame {
    let n = project_sample_rate as i128 * 60_000_000_i128;
    let d = micro_bpm as i128 * ppq as i128;
    debug_assert!(d > 0, "micro_bpm * ppq must be positive");
    // Integer floor division for non-negative tick values
    let frame = (tick.0 as i128 * n) / d;
    TimelineFrame(frame as i64)
}

// =============================================================================
// Grid settings (edit domain)
// =============================================================================

/// Grid snap division options.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum GridDivision {
    Beat,
    Half,
    Quarter,
    Eighth,
    Sixteenth,
    ThirtySecond,
    Triplet { base: u8 },
    Dotted { base: u8 },
}

/// Grid settings for snap behaviour.
/// All values are fixed-point integers for Git diff stability.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridSettings {
    pub snap_enabled: bool,
    pub division: GridDivision,
    /// Swing amount in permille (0..1000). 0 = no swing.
    pub swing_permille: u16,
    /// Magnet range in permille of the grid unit (e.g. 100 = +/-10%).
    /// Required by spec for the +/-10% snap attraction behavior.
    pub magnet_range_permille: u16,
    /// Snap strength in permille (0..1000). 1000 = full snap.
    pub snap_strength_permille: u16,
}

impl Default for GridSettings {
    fn default() -> Self {
        Self {
            snap_enabled: true,
            division: GridDivision::Beat,
            swing_permille: 0,
            magnet_range_permille: 250, // +/-25%
            snap_strength_permille: 1000,
        }
    }
}
