use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::ids::*;

// =============================================================================
// Analysis artifact types (spec section 10)
// =============================================================================

/// Common metadata for all analysis artifacts.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreatedBy {
    pub app_version: String,
    pub algo_version: String,
    pub params_hash: String,
}

/// Top-level analysis artifact envelope.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AnalysisArtifact {
    WaveformPeaks(WaveformPeaksArtifact),
    F0Track(F0TrackArtifact),
    PitchMarks(PitchMarksArtifact),
}

#[derive(Clone, Debug)]
pub struct AnalysisResolver<'a> {
    artifacts: &'a BTreeMap<AnalysisId, AnalysisArtifact>,
}

impl<'a> AnalysisResolver<'a> {
    pub fn new(artifacts: &'a BTreeMap<AnalysisId, AnalysisArtifact>) -> Self {
        Self { artifacts }
    }

    pub fn resolve_f0_for_content(
        &self,
        content: &crate::edit::AudioContentEdit,
    ) -> Option<&'a F0TrackArtifact> {
        content
            .analysis_refs
            .iter()
            .find_map(|analysis_id| match self.artifacts.get(analysis_id) {
                Some(AnalysisArtifact::F0Track(artifact)) => Some(artifact),
                _ => None,
            })
    }

    pub fn resolve_pitch_marks_for_content(
        &self,
        content: &crate::edit::AudioContentEdit,
    ) -> Option<&'a PitchMarksArtifact> {
        content
            .analysis_refs
            .iter()
            .find_map(|analysis_id| match self.artifacts.get(analysis_id) {
                Some(AnalysisArtifact::PitchMarks(artifact)) => Some(artifact),
                _ => None,
            })
    }
}

// ---------------------------------------------------------------------------
// Waveform Peaks (spec sec 10.2)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WaveformPeaksArtifact {
    pub schema_version: u32,
    pub media_id: MediaId,
    pub src_sample_rate: u32,
    pub created_by: CreatedBy,
    pub channels: u16,
    pub levels: Vec<WaveformLevel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WaveformLevel {
    pub window_size_src_frames: u32,
    /// For each channel: Vec of (min, max) peak pairs.
    pub peaks_per_channel: Vec<Vec<PeakPair>>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PeakPair {
    pub min: f32,
    pub max: f32,
}

// ---------------------------------------------------------------------------
// F0 Track (spec sec 10.3)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct F0TrackArtifact {
    pub schema_version: u32,
    pub media_id: MediaId,
    pub src_sample_rate: u32,
    pub created_by: CreatedBy,
    /// Hop size in source frames between consecutive F0 estimates.
    pub hop_src_frames: u32,
    /// F0 in Hz * 100 (fixed-point). Unvoiced frames = -1.
    pub f0_hz_x100: Vec<i32>,
    /// Voiced probability in permille [0..1000]. Optional.
    pub voiced_prob_permille: Option<Vec<u16>>,
    /// Analysis method name (e.g. "pyin").
    pub method: String,
    /// Serialized analysis parameters for reproducibility.
    pub params: String,
}

// ---------------------------------------------------------------------------
// Pitch Marks (spec sec 10.4)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PitchMarkFeature {
    pub transient_value: f32,
    pub onset_value: f32,
    pub cycle_energy: f32,
    pub tonality: f32,
    pub confidence: f32,
    #[serde(default)]
    pub local_pitch_hz_x100: Option<i32>,
    #[serde(default)]
    pub epoch_strength: Option<f32>,
    #[serde(default)]
    pub gci_quality: Option<f32>,
    #[serde(default)]
    pub left_period_samples: Option<u32>,
    #[serde(default)]
    pub right_period_samples: Option<u32>,
    #[serde(default)]
    pub excitation_balance: Option<f32>,
    #[serde(default)]
    pub expression_baseline_hz_x100: Option<i32>,
    #[serde(default)]
    pub expression_deviation_cents: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PitchMarksArtifact {
    pub schema_version: u32,
    pub media_id: MediaId,
    pub src_sample_rate: u32,
    pub created_by: CreatedBy,
    /// Pitch mark positions in source frames.
    pub marks_src_frames: Vec<u32>,
    /// Optional per-mark synthesis hints. Empty for artifacts without feature analysis.
    #[serde(default)]
    pub mark_features: Vec<PitchMarkFeature>,
    /// Policy used to generate pitch marks.
    pub mark_policy: String,
    /// Serialized parameters.
    pub params: String,
}

// =============================================================================
// F0 analysis backends
// =============================================================================

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum F0Backend {
    LegacyLoqa,
    InternalAutocorr,
}

/// Versioned analysis profiles used by persisted source-domain F0 artifacts.
///
/// `LegacyDefault` preserves the historical 500 Hz analysis contract. The v2
/// profile is explicit so higher-range monophonic material can be re-analyzed
/// without silently changing the meaning of existing artifacts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum F0AnalysisProfile {
    LegacyDefault,
    TdPsolaMonophonicV2,
}

impl F0AnalysisProfile {
    fn as_public_str(self) -> &'static str {
        match self {
            F0AnalysisProfile::LegacyDefault => "legacy_default",
            F0AnalysisProfile::TdPsolaMonophonicV2 => "tdpsola_monophonic_v2",
        }
    }

    fn from_public_str(value: &str) -> Option<Self> {
        match value {
            "legacy_default" => Some(F0AnalysisProfile::LegacyDefault),
            "tdpsola_monophonic_v2" => Some(F0AnalysisProfile::TdPsolaMonophonicV2),
            _ => None,
        }
    }
}

impl F0Backend {
    fn as_public_str(self) -> &'static str {
        match self {
            F0Backend::LegacyLoqa => "legacy_loqa",
            F0Backend::InternalAutocorr => "internal_autocorr",
        }
    }

    fn from_public_str(value: &str) -> Option<Self> {
        match value {
            "legacy_loqa" => Some(F0Backend::LegacyLoqa),
            "internal_autocorr" => Some(F0Backend::InternalAutocorr),
            _ => None,
        }
    }
}

/// Configuration for F0 analysis.
#[derive(Clone, Debug)]
pub struct F0AnalysisConfig {
    pub min_f0: f32,
    pub max_f0: f32,
    pub frame_size: usize,
    pub hop_size: usize,
    pub voiced_threshold: f32,
    backend: F0Backend,
    profile: F0AnalysisProfile,
}

impl Default for F0AnalysisConfig {
    fn default() -> Self {
        Self::for_profile(F0AnalysisProfile::LegacyDefault)
    }
}

impl F0AnalysisConfig {
    fn for_profile(profile: F0AnalysisProfile) -> Self {
        Self {
            min_f0: 60.0,
            max_f0: match profile {
                F0AnalysisProfile::LegacyDefault => 500.0,
                F0AnalysisProfile::TdPsolaMonophonicV2 => 1_200.0,
            },
            frame_size: 2048,
            hop_size: 512,
            voiced_threshold: 0.6,
            backend: F0Backend::LegacyLoqa,
            profile,
        }
    }

    pub fn with_profile_name(profile: &str) -> Result<Self, String> {
        let profile = F0AnalysisProfile::from_public_str(profile)
            .ok_or_else(|| format!("unknown f0 analysis profile: {profile}"))?;
        Ok(Self::for_profile(profile))
    }

    pub fn profile_name(&self) -> &'static str {
        self.profile.as_public_str()
    }

    pub fn with_backend_name(mut self, backend: &str) -> Result<Self, String> {
        self.backend = F0Backend::from_public_str(backend)
            .ok_or_else(|| format!("unknown f0 backend: {backend}"))?;
        Ok(self)
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.as_public_str()
    }
}

/// Analyze F0 using the configured backend.
///
/// Returns an F0TrackArtifact with fixed-point F0 values.
/// Unvoiced frames have f0_hz_x100 = -1.
pub fn analyze_f0(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
    config: &F0AnalysisConfig,
) -> Result<F0TrackArtifact, String> {
    match config.backend {
        F0Backend::LegacyLoqa => analyze_f0_with_loqa(samples, sample_rate, media_id, config),
        F0Backend::InternalAutocorr => {
            analyze_f0_with_internal_autocorr(samples, sample_rate, media_id, config)
        }
    }
}

fn analyze_f0_with_internal_autocorr(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
    config: &F0AnalysisConfig,
) -> Result<F0TrackArtifact, String> {
    const MIN_RMS: f32 = 0.005;

    if config.frame_size == 0 || config.hop_size == 0 {
        return Err("frame_size and hop_size must be positive".to_string());
    }
    if samples.len() < config.frame_size {
        return Err("input shorter than frame_size".to_string());
    }

    let max_frame_start = samples.len().saturating_sub(config.frame_size);
    let frame_count = std::cmp::max(1, max_frame_start / config.hop_size + 1);
    let min_lag = std::cmp::max(1, (sample_rate as f32 / config.max_f0).floor() as usize);
    let max_lag = std::cmp::max(
        min_lag + 1,
        (sample_rate as f32 / config.min_f0).floor() as usize,
    );

    let mut f0_hz_x100 = Vec::with_capacity(frame_count);
    let mut voiced_prob_permille = Vec::with_capacity(frame_count);

    for frame in 0..frame_count {
        let start = frame * config.hop_size;
        let end = std::cmp::min(start + config.frame_size, samples.len());
        let len = end.saturating_sub(start);
        if len <= max_lag + 2 {
            f0_hz_x100.push(-1);
            voiced_prob_permille.push(0);
            continue;
        }

        let frame_samples = &samples[start..end];
        let rms = (frame_samples
            .iter()
            .map(|sample| sample * sample)
            .sum::<f32>()
            / len as f32)
            .sqrt();
        if rms < MIN_RMS {
            f0_hz_x100.push(-1);
            voiced_prob_permille.push(0);
            continue;
        }

        let mut best_lag = 0usize;
        let mut best_corr = -1.0f32;

        for lag in min_lag..=std::cmp::min(max_lag, len - 2) {
            let upper = len - lag;
            let mut corr = 0.0f32;
            let mut norm_a = 0.0f32;
            let mut norm_b = 0.0f32;

            for i in 0..upper {
                let a = frame_samples[i];
                let b = frame_samples[i + lag];
                corr += a * b;
                norm_a += a * a;
                norm_b += b * b;
            }

            let denom = (norm_a * norm_b).sqrt() + 1e-12;
            let ncc = corr / denom;
            if ncc > best_corr {
                best_corr = ncc;
                best_lag = lag;
            }
        }

        let confidence = ((best_corr - 0.2) / 0.8).clamp(0.0, 1.0);
        voiced_prob_permille.push((confidence * 1000.0).round() as u16);

        if best_lag > 0 && confidence >= config.voiced_threshold {
            let f0 = sample_rate as f32 / best_lag as f32;
            if f0 >= config.min_f0 && f0 <= config.max_f0 {
                f0_hz_x100.push((f0 * 100.0).round() as i32);
                continue;
            }
        }

        f0_hz_x100.push(-1);
    }

    let params_str = format!(
        "backend=internal_autocorr,min_f0={},max_f0={},frame_size={},hop_size={},voiced_threshold={},min_rms={}",
        config.min_f0,
        config.max_f0,
        config.frame_size,
        config.hop_size,
        config.voiced_threshold,
        MIN_RMS,
    );

    Ok(F0TrackArtifact {
        schema_version: 1,
        media_id,
        src_sample_rate: sample_rate,
        created_by: CreatedBy {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            algo_version: "internal-autocorr-v1".to_string(),
            params_hash: params_str.clone(),
        },
        hop_src_frames: config.hop_size as u32,
        f0_hz_x100,
        voiced_prob_permille: Some(voiced_prob_permille),
        method: "internal_autocorr".to_string(),
        params: params_str,
    })
}

fn analyze_f0_with_loqa(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
    config: &F0AnalysisConfig,
) -> Result<F0TrackArtifact, String> {
    use loqa_voice_dsp::{AnalysisConfig, PitchAlgorithm, VoiceAnalyzer};

    let loqa_config = AnalysisConfig::new()
        .with_sample_rate(sample_rate)
        .with_frame_size(config.frame_size)
        .with_hop_size(config.hop_size)
        .with_min_frequency(config.min_f0)
        .with_max_frequency(config.max_f0)
        .with_min_confidence(config.voiced_threshold)
        .with_algorithm(PitchAlgorithm::PYIN);

    let mut analyzer = VoiceAnalyzer::new(loqa_config)?;
    let track = analyzer.process_buffer(samples)?;

    let frame_count = track.pitch_track.len();
    let mut f0_hz_x100 = Vec::with_capacity(frame_count);
    let mut voiced_prob_permille = Vec::with_capacity(frame_count);

    for i in 0..frame_count {
        let f0 = track.pitch_track[i];
        if f0 > 0.0 && track.voiced_probabilities[i] >= config.voiced_threshold {
            f0_hz_x100.push((f0 * 100.0).round() as i32);
        } else {
            f0_hz_x100.push(-1);
        }
        voiced_prob_permille.push((track.voiced_probabilities[i] * 1000.0).round() as u16);
    }

    let params_str = match config.profile {
        F0AnalysisProfile::LegacyDefault => format!(
            "min_f0={},max_f0={},frame_size={},hop_size={},voiced_threshold={}",
            config.min_f0,
            config.max_f0,
            config.frame_size,
            config.hop_size,
            config.voiced_threshold,
        ),
        F0AnalysisProfile::TdPsolaMonophonicV2 => format!(
            "profile={},min_f0={},max_f0={},frame_size={},hop_size={},voiced_threshold={}",
            config.profile_name(),
            config.min_f0,
            config.max_f0,
            config.frame_size,
            config.hop_size,
            config.voiced_threshold,
        ),
    };
    let algo_version = match config.profile {
        F0AnalysisProfile::LegacyDefault => "loqa-voice-dsp-0.5.0-pyin",
        F0AnalysisProfile::TdPsolaMonophonicV2 => "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2",
    };

    Ok(F0TrackArtifact {
        schema_version: 1,
        media_id,
        src_sample_rate: sample_rate,
        created_by: CreatedBy {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            algo_version: algo_version.to_string(),
            params_hash: params_str.clone(),
        },
        hop_src_frames: config.hop_size as u32,
        f0_hz_x100,
        voiced_prob_permille: Some(voiced_prob_permille),
        method: "pyin".to_string(),
        params: params_str,
    })
}

/// Compute the median F0 (in Hz) over a source frame range from an F0Track.
///
/// Only voiced frames (f0_hz_x100 > 0) within [src_start, src_end) are considered.
/// Returns None if no voiced frames exist in the range.
pub fn median_f0_in_range(f0_track: &F0TrackArtifact, src_start: u64, src_end: u64) -> Option<f64> {
    let hop = f0_track.hop_src_frames as u64;
    if hop == 0 {
        return None;
    }

    // Determine frame index range
    let start_idx = (src_start / hop) as usize;
    let end_idx = src_end.div_ceil(hop) as usize;
    let end_idx = end_idx.min(f0_track.f0_hz_x100.len());

    let mut voiced_hz: Vec<f64> = Vec::new();
    for i in start_idx..end_idx {
        let val = f0_track.f0_hz_x100[i];
        if val > 0 {
            voiced_hz.push(val as f64 / 100.0);
        }
    }

    if voiced_hz.is_empty() {
        return None;
    }

    voiced_hz.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = voiced_hz.len() / 2;
    if voiced_hz.len().is_multiple_of(2) {
        Some((voiced_hz[mid - 1] + voiced_hz[mid]) / 2.0)
    } else {
        Some(voiced_hz[mid])
    }
}

/// Generate pitch marks from an F0 track for TD-PSOLA processing.
///
/// Marks are placed at pitch period intervals through voiced regions,
/// refined to nearest peak in the waveform.
pub fn generate_pitch_marks(
    samples: &[f32],
    f0_track: &F0TrackArtifact,
    sample_rate: u32,
    media_id: MediaId,
) -> PitchMarksArtifact {
    let hop = f0_track.hop_src_frames as usize;
    let len = samples.len();
    let mut marks: Vec<u32> = Vec::new();
    let monophonic_v2 = f0_track
        .created_by
        .algo_version
        .contains("tdpsola-monophonic-v2");
    let pitch_mark_algo_version = if monophonic_v2 {
        "peak-refinement-v3-monophonic-gap-repair"
    } else {
        "peak-refinement-v2"
    };
    let params_str = format!(
        "f0_algo_version={};f0_params_hash={}",
        f0_track.created_by.algo_version, f0_track.created_by.params_hash,
    );

    let make_artifact = |marks_src_frames: Vec<u32>| PitchMarksArtifact {
        schema_version: 1,
        media_id,
        src_sample_rate: sample_rate,
        created_by: CreatedBy {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            algo_version: pitch_mark_algo_version.to_string(),
            params_hash: params_str.clone(),
        },
        marks_src_frames,
        mark_features: vec![],
        mark_policy: "peak_refinement".to_string(),
        params: params_str.clone(),
    };

    if len == 0 || hop == 0 || f0_track.f0_hz_x100.is_empty() {
        return make_artifact(marks);
    }

    let mut effective_f0_hz_x100 = f0_track.f0_hz_x100.clone();
    if monophonic_v2 {
        let max_gap_frames = ((0.06 * sample_rate as f64) / hop as f64).round().max(1.0) as usize;
        let mut index = 0usize;
        while index < effective_f0_hz_x100.len() {
            while index < effective_f0_hz_x100.len() && effective_f0_hz_x100[index] > 0 {
                index += 1;
            }
            let gap_start = index;
            while index < effective_f0_hz_x100.len() && effective_f0_hz_x100[index] <= 0 {
                index += 1;
            }
            let gap_end = index;
            let gap_length = gap_end.saturating_sub(gap_start);
            if gap_length == 0
                || gap_length > max_gap_frames
                || gap_start == 0
                || gap_end >= effective_f0_hz_x100.len()
            {
                continue;
            }
            let left = effective_f0_hz_x100[gap_start - 1];
            let right = effective_f0_hz_x100[gap_end];
            if left <= 0 || right <= 0 {
                continue;
            }
            for offset in 0..gap_length {
                let numerator = (offset + 1) as f64;
                let denominator = (gap_length + 1) as f64;
                effective_f0_hz_x100[gap_start + offset] =
                    (left as f64 + (right - left) as f64 * numerator / denominator).round() as i32;
            }
        }
    }

    // Interpolate F0 at a given sample position.
    let interp_f0_at = |pos: f64| -> f64 {
        let frame_idx = pos / hop as f64;
        let i0 = frame_idx.floor() as usize;
        let i1 = (i0 + 1).min(effective_f0_hz_x100.len().saturating_sub(1));
        let f0_0 = effective_f0_hz_x100.get(i0).copied().unwrap_or(-1);
        let f0_1 = effective_f0_hz_x100.get(i1).copied().unwrap_or(-1);
        if f0_0 <= 0 {
            return 0.0;
        }
        if f0_1 <= 0 || i0 == i1 {
            return f0_0 as f64 / 100.0;
        }
        let frac = frame_idx - i0 as f64;
        let hz0 = f0_0 as f64 / 100.0;
        let hz1 = f0_1 as f64 / 100.0;
        hz0 + (hz1 - hz0) * frac
    };

    // Refine mark position to nearest amplitude peak.
    let refine_peak = |center: usize, period: f64| -> usize {
        let search = (period * 0.25).max(2.0) as usize;
        let start = center.saturating_sub(search);
        let end = (center + search).min(len - 1);
        let mut best = center;
        let mut best_amp: f32 = -1.0;
        // take/skip rather than slicing: `start > end` must stay a no-op, and
        // `samples[start..=end]` would panic in that case.
        for (i, sample) in samples.iter().enumerate().take(end + 1).skip(start) {
            let amp = sample.abs();
            if amp > best_amp {
                best_amp = amp;
                best = i;
            }
        }
        best
    };

    let mut frame_index = 0usize;
    while frame_index < effective_f0_hz_x100.len() {
        while frame_index < effective_f0_hz_x100.len() && effective_f0_hz_x100[frame_index] <= 0 {
            frame_index += 1;
        }
        if frame_index >= effective_f0_hz_x100.len() {
            break;
        }

        let island_start_frame = frame_index;
        while frame_index < effective_f0_hz_x100.len() && effective_f0_hz_x100[frame_index] > 0 {
            frame_index += 1;
        }
        let island_end_frame = frame_index.saturating_sub(1);
        let island_end_sample = ((island_end_frame + 1) * hop)
            .saturating_sub(1)
            .min(len - 1);

        let start_sample = (island_start_frame * hop).min(len - 1);
        let first_f0 = interp_f0_at(start_sample as f64);
        if first_f0 <= 0.0 {
            continue;
        }

        let first_period = (sample_rate as f64 / first_f0).max(1.0);
        let first_mark =
            refine_peak(start_sample, first_period).clamp(start_sample, island_end_sample);
        if marks.last().is_some_and(|last| *last >= first_mark as u32) {
            continue;
        }
        marks.push(first_mark as u32);
        let mut pos = first_mark as f64;

        loop {
            let f0 = interp_f0_at(pos);
            if f0 <= 0.0 {
                break;
            }
            let period = (sample_rate as f64 / f0).max(1.0);
            let predicted = (pos + period).round() as usize;
            if predicted > island_end_sample || predicted >= len {
                break;
            }
            let mut next = refine_peak(predicted, period).min(island_end_sample);
            if next <= pos as usize {
                next = predicted;
            }
            if next <= pos as usize || next >= len {
                break;
            }
            if marks.last().is_some_and(|last| *last >= next as u32) {
                break;
            }
            marks.push(next as u32);
            pos = next as f64;
        }
    }

    make_artifact(marks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    use crate::edit::AudioContentEdit;

    #[test]
    fn median_f0_empty_track() {
        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: 44100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames: 512,
            f0_hz_x100: vec![],
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };

        assert!(median_f0_in_range(&artifact, 0, 44100).is_none());
    }

    #[test]
    fn median_f0_all_unvoiced() {
        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: 44100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames: 512,
            f0_hz_x100: vec![-1, -1, -1, -1],
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };

        assert!(median_f0_in_range(&artifact, 0, 2048).is_none());
    }

    #[test]
    fn median_f0_voiced_frames() {
        // 3 voiced frames at 100Hz, 200Hz, 300Hz
        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: 44100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames: 512,
            f0_hz_x100: vec![10000, 20000, 30000], // 100Hz, 200Hz, 300Hz
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };

        let median = median_f0_in_range(&artifact, 0, 2048).unwrap();
        assert!((median - 200.0).abs() < 0.01); // median of {100, 200, 300} = 200
    }

    #[test]
    fn median_f0_partial_range() {
        // Only select frames within the range
        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: 44100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames: 512,
            f0_hz_x100: vec![10000, 20000, 30000, 40000], // 100, 200, 300, 400 Hz
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };

        // Range covers frames 1 and 2 (512..1536)
        let median = median_f0_in_range(&artifact, 512, 1536).unwrap();
        assert!((median - 250.0).abs() < 0.01); // median of {200, 300} = 250
    }

    #[test]
    fn f0_analysis_too_short_input() {
        let samples = vec![0.0f32; 100]; // too short
        let config = F0AnalysisConfig::default();
        let result = analyze_f0(&samples, 44100, MediaId::new(), &config);
        // loqa-voice-dsp returns error for input shorter than frame_size
        assert!(result.is_err());
    }

    #[test]
    fn f0_analysis_default_uses_legacy_loqa_backend() {
        let config = F0AnalysisConfig::default();
        assert_eq!(config.backend, F0Backend::LegacyLoqa);
        assert_eq!(config.backend_name(), "legacy_loqa");
        assert_eq!(config.profile_name(), "legacy_default");
        assert_eq!(config.max_f0, 500.0);
    }

    #[test]
    fn monophonic_v2_profile_has_versioned_high_f0_contract() {
        let config = F0AnalysisConfig::with_profile_name("tdpsola_monophonic_v2")
            .expect("resolve monophonic v2 profile");

        assert_eq!(config.backend, F0Backend::LegacyLoqa);
        assert_eq!(config.profile_name(), "tdpsola_monophonic_v2");
        assert_eq!(config.min_f0, 60.0);
        assert_eq!(config.max_f0, 1_200.0);
        assert!(F0AnalysisConfig::with_profile_name("unknown_profile").is_err());
    }

    #[test]
    fn monophonic_v2_artifact_records_profile_and_algorithm_version() {
        let sample_rate = 48_000u32;
        let frequency = 700.0f32;
        let samples: Vec<f32> = (0..8_192usize)
            .map(|index| {
                ((2.0 * std::f32::consts::PI * frequency * index as f32) / sample_rate as f32).sin()
            })
            .collect();
        let config = F0AnalysisConfig::with_profile_name("tdpsola_monophonic_v2")
            .expect("resolve monophonic v2 profile");
        let artifact = analyze_f0(&samples, sample_rate, MediaId::new(), &config)
            .expect("analyze high-f0 monophonic fixture");

        assert!(artifact.params.contains("profile=tdpsola_monophonic_v2"));
        assert!(artifact.params.contains("max_f0=1200"));
        assert_eq!(
            artifact.created_by.algo_version,
            "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2"
        );
        assert!(artifact.f0_hz_x100.iter().any(|value| *value > 50_000));
    }

    #[test]
    fn f0_analysis_backend_name_roundtrip() {
        let config = F0AnalysisConfig::default()
            .with_backend_name("internal_autocorr")
            .expect("resolve internal backend");
        assert_eq!(config.backend, F0Backend::InternalAutocorr);
        assert_eq!(config.backend_name(), "internal_autocorr");
        assert!(F0AnalysisConfig::default()
            .with_backend_name("unknown_backend")
            .is_err());
    }

    #[test]
    fn internal_autocorr_analysis_produces_f0_artifact_without_schema_changes() {
        let sample_rate = 48_000u32;
        let frequency = 220.0f32;
        let len = 4_096usize;
        let samples: Vec<f32> = (0..len)
            .map(|index| {
                ((2.0 * std::f32::consts::PI * frequency * index as f32) / sample_rate as f32).sin()
            })
            .collect();

        let config = F0AnalysisConfig {
            backend: F0Backend::InternalAutocorr,
            ..F0AnalysisConfig::default()
        };
        let artifact = analyze_f0(&samples, sample_rate, MediaId::new(), &config)
            .expect("internal autocorr analysis should succeed");

        assert_eq!(artifact.schema_version, 1);
        assert_eq!(artifact.hop_src_frames, config.hop_size as u32);
        assert_eq!(artifact.method, "internal_autocorr");
        assert!(artifact.params.contains("backend=internal_autocorr"));
        assert_eq!(
            artifact
                .voiced_prob_permille
                .as_ref()
                .map(|values| values.len()),
            Some(5)
        );
        assert!(artifact.f0_hz_x100.iter().any(|value| *value > 0));
    }

    #[test]
    fn generate_pitch_marks_restarts_after_unvoiced_gap() {
        let sample_rate = 48_000u32;
        let hop = 128u32;
        let len = 4_096usize;
        let freq = 200.0f32;
        let samples: Vec<f32> = (0..len)
            .map(|i| ((2.0 * std::f32::consts::PI * freq * i as f32) / sample_rate as f32).sin())
            .collect();

        let frame_count = len.div_ceil(hop as usize) + 1;
        let mut f0_hz_x100 = vec![-1; frame_count];
        for value in &mut f0_hz_x100[0..6] {
            *value = 20_000;
        }
        for value in &mut f0_hz_x100[12..18] {
            *value = 20_000;
        }

        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: sample_rate,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "test".into(),
            },
            hop_src_frames: hop,
            f0_hz_x100,
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };

        let pitch_marks = generate_pitch_marks(&samples, &artifact, sample_rate, artifact.media_id);
        assert_eq!(pitch_marks.created_by.algo_version, "peak-refinement-v2");
        assert_eq!(
            pitch_marks.params,
            "f0_algo_version=test;f0_params_hash=test"
        );
        let restart_threshold = 11 * hop;
        assert!(pitch_marks
            .marks_src_frames
            .iter()
            .any(|mark| *mark >= restart_threshold));
        assert!(pitch_marks
            .marks_src_frames
            .windows(2)
            .all(|window| window[0] < window[1]));
        assert!(pitch_marks
            .marks_src_frames
            .iter()
            .all(|mark| (*mark as usize) < len));
    }

    #[test]
    fn monophonic_v2_pitch_marks_clamp_island_start_and_bridge_short_gap() {
        let sample_rate = 48_000u32;
        let hop = 128u32;
        let len = 4_096usize;
        let mut samples = vec![0.0f32; len];
        for peak in (127..len).step_by(240) {
            samples[peak] = 1.0;
        }

        let frame_count = len.div_ceil(hop as usize) + 1;
        let mut f0_hz_x100 = vec![-1; frame_count];
        for value in &mut f0_hz_x100[1..13] {
            *value = 20_000;
        }
        // A one-frame pYIN dropout remains inside the 60 ms monophonic
        // history window and must not split the accepted mark sequence.
        f0_hz_x100[5] = -1;
        let artifact = F0TrackArtifact {
            schema_version: 1,
            media_id: MediaId::new(),
            src_sample_rate: sample_rate,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "loqa-voice-dsp-0.5.0-pyin-tdpsola-monophonic-v2".into(),
                params_hash: "profile=tdpsola_monophonic_v2".into(),
            },
            hop_src_frames: hop,
            f0_hz_x100,
            voiced_prob_permille: None,
            method: "pyin".into(),
            params: "profile=tdpsola_monophonic_v2".into(),
        };

        let pitch_marks = generate_pitch_marks(&samples, &artifact, sample_rate, artifact.media_id);
        assert_eq!(
            pitch_marks.created_by.algo_version,
            "peak-refinement-v3-monophonic-gap-repair"
        );
        assert!(pitch_marks.marks_src_frames.len() >= 5);
        assert!((pitch_marks.marks_src_frames[0] as usize) >= hop as usize);
        assert!(pitch_marks
            .marks_src_frames
            .windows(2)
            .all(|window| window[1] - window[0] <= 300));
    }

    #[test]
    fn pitch_mark_v2_features_round_trip_without_loss() {
        let artifact_json = serde_json::json!({
            "kind": "pitch_marks",
            "schema_version": 1,
            "media_id": MediaId::new(),
            "src_sample_rate": 48_000,
            "created_by": {
                "app_version": "test",
                "algo_version": "epoch-fusion-v1",
                "params_hash": "feature-contract",
            },
            "marks_src_frames": [120],
            "mark_features": [{
                "transient_value": 0.1,
                "onset_value": 0.2,
                "cycle_energy": 0.3,
                "tonality": 0.4,
                "confidence": 0.5,
                "local_pitch_hz_x100": 22_100,
                "epoch_strength": 0.6,
                "gci_quality": 0.7,
                "left_period_samples": 100,
                "right_period_samples": 101,
                "excitation_balance": 0.8,
                "expression_baseline_hz_x100": 22_000,
                "expression_deviation_cents": 12,
            }],
            "mark_policy": "epoch_fusion",
            "params": "{}",
        });

        let artifact: AnalysisArtifact =
            serde_json::from_value(artifact_json).expect("deserialize v2 pitch-mark features");
        let serialized = serde_json::to_value(artifact).expect("serialize v2 pitch-mark features");
        let feature = &serialized["mark_features"][0];
        let assert_close = |field: &str, expected: f64| {
            let actual = feature[field].as_f64().expect("feature number");
            assert!((actual - expected).abs() < 1e-6, "{field}: {actual}");
        };

        assert_close("epoch_strength", 0.6);
        assert_close("gci_quality", 0.7);
        assert_eq!(feature["left_period_samples"], 100);
        assert_eq!(feature["right_period_samples"], 101);
        assert_close("excitation_balance", 0.8);
        assert_eq!(feature["expression_baseline_hz_x100"], 22_000);
        assert_eq!(feature["expression_deviation_cents"], 12);
    }

    #[test]
    fn analysis_resolver_resolves_artifacts_from_content_refs() {
        let media_id = MediaId::new();
        let f0_id = AnalysisId::new();
        let pitch_marks_id = AnalysisId::new();
        let f0 = F0TrackArtifact {
            schema_version: 1,
            media_id,
            src_sample_rate: 44_100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "f0".into(),
            },
            hop_src_frames: 512,
            f0_hz_x100: vec![22_000],
            voiced_prob_permille: None,
            method: "test".into(),
            params: String::new(),
        };
        let pitch_marks = PitchMarksArtifact {
            schema_version: 1,
            media_id,
            src_sample_rate: 44_100,
            created_by: CreatedBy {
                app_version: "test".into(),
                algo_version: "test".into(),
                params_hash: "marks".into(),
            },
            marks_src_frames: vec![0, 120, 240],
            mark_features: vec![],
            mark_policy: "test".into(),
            params: String::new(),
        };
        let mut registry = BTreeMap::new();
        registry.insert(f0_id, AnalysisArtifact::F0Track(f0.clone()));
        registry.insert(
            pitch_marks_id,
            AnalysisArtifact::PitchMarks(pitch_marks.clone()),
        );

        let content = AudioContentEdit {
            id: ContentId::new(),
            media_id,
            analysis_refs: vec![pitch_marks_id, f0_id],
        };

        let resolver = AnalysisResolver::new(&registry);
        assert_eq!(
            resolver
                .resolve_f0_for_content(&content)
                .map(|artifact| artifact.media_id),
            Some(media_id)
        );
        assert_eq!(
            resolver
                .resolve_pitch_marks_for_content(&content)
                .map(|artifact| artifact.marks_src_frames.clone()),
            Some(vec![0, 120, 240])
        );
    }
}
