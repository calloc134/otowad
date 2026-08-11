use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

use crate::analysis::{AnalysisArtifact, F0TrackArtifact};
use crate::api::{
    analyze_f0_samples, analyze_f0_samples_with_backend, analyze_f0_samples_with_profile,
    apply_project_command, compile_project_runtime, create_project_document,
    generate_pitch_marks_from_samples, parse_project_document, serialize_project_document,
    serialize_project_document_for_save, validate_project_document,
};
use crate::commands::{Command, CommandError};
use crate::compiler::{AnalysisStore, CompileError};
use crate::edit::CURRENT_PROJECT_SCHEMA_VERSION;
use crate::ids::{AnalysisId, ClipId, MediaId, TrackId};
use crate::runtime::{ClipRuntime, ProjectRuntime, WarpPlanRt};

/// Structured error envelope sent across the WASM boundary.
///
/// Serialized as `{"code":"...","message":"..."}` when converted to a `JsValue`.
/// The `Display` impl emits just the message so existing test assertions on
/// error text keep working.
#[derive(Debug, Clone)]
pub struct WasmError {
    pub code: &'static str,
    pub message: String,
}

impl WasmError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for WasmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<CompileError> for WasmError {
    fn from(e: CompileError) -> Self {
        Self::new(e.code(), e.to_string())
    }
}

impl From<CommandError> for WasmError {
    fn from(e: CommandError) -> Self {
        Self::new(e.code(), e.to_string())
    }
}

#[derive(Serialize)]
struct WasmErrorJson<'a> {
    code: &'a str,
    message: &'a str,
}

impl WasmError {
    fn into_js(self) -> JsValue {
        let payload = WasmErrorJson {
            code: self.code,
            message: &self.message,
        };
        JsValue::from_str(
            &serde_json::to_string(&payload).unwrap_or_else(|_| {
                String::from(r#"{"code":"SERIALIZE_ERROR","message":"unknown"}"#)
            }),
        )
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum F0TrackJsonInput {
    Wrapped(AnalysisArtifact),
    Bare(F0TrackArtifact),
}

fn parse_command_json_value(command_json: &str) -> Result<Command, WasmError> {
    serde_json::from_str(command_json)
        .map_err(|e| WasmError::new("JSON_PARSE_ERROR", format!("command JSON parse error: {e}")))
}

fn is_public_command(command: &Command) -> bool {
    match command {
        Command::ResizeClip { .. }
        | Command::SetAudioSourceRange { .. }
        | Command::AddWarpAnchor { .. }
        | Command::RemoveWarpAnchor { .. }
        | Command::SetMidiContentWindow { .. }
        | Command::RemoveMediaAsset { .. }
        | Command::RestoreMediaAsset { .. }
        | Command::RemoveContent { .. }
        | Command::RestoreContent { .. }
        | Command::RestoreTrack { .. }
        | Command::RestoreTrackName { .. }
        | Command::RestoreClip { .. }
        | Command::SetClipState { .. }
        | Command::RestorePitchControl { .. }
        | Command::RestoreMidiNote { .. }
        | Command::RestoreWarpAnchor { .. }
        | Command::RestorePitchLink { .. }
        | Command::RestoreBpmPreserveSecondsState { .. }
        | Command::UnsplitClip { .. } => false,
        Command::Batch { commands } => commands.iter().all(is_public_command),
        _ => true,
    }
}

#[derive(Serialize)]
struct ApplyCommandResultJson<'a> {
    project: &'a RawValue,
    inverse: &'a RawValue,
}

fn apply_command_json_inner(
    project_json: &str,
    command_json: &str,
    allow_internal: bool,
) -> Result<String, WasmError> {
    let mut doc = parse_project_document(project_json).map_err(|e| {
        WasmError::new("JSON_PARSE_ERROR", format!("project JSON parse error: {e}"))
    })?;
    let cmd = parse_command_json_value(command_json)?;
    if !allow_internal && !is_public_command(&cmd) {
        return Err(WasmError::new(
            "PUBLIC_COMMAND_REJECTED",
            "public command bridge does not accept raw mutators or internal inverse commands",
        ));
    }
    let inverse = apply_project_command(&mut doc, &cmd).map_err(WasmError::from)?;
    let project_out = serialize_project_document(&doc)
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")))?;
    let inverse_json = serde_json::to_string(&inverse)
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize inverse error: {e}")))?;
    let project_raw = RawValue::from_string(project_out).map_err(|e| {
        WasmError::new(
            "SERIALIZE_ERROR",
            format!("serialize project as raw JSON: {e}"),
        )
    })?;
    let inverse_raw = RawValue::from_string(inverse_json).map_err(|e| {
        WasmError::new(
            "SERIALIZE_ERROR",
            format!("serialize inverse as raw JSON: {e}"),
        )
    })?;
    let payload = ApplyCommandResultJson {
        project: &project_raw,
        inverse: &inverse_raw,
    };
    serde_json::to_string(&payload)
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize apply result: {e}")))
}

fn validate_project_inner(json: &str) -> Result<String, WasmError> {
    let doc = parse_project_document(json)
        .map_err(|e| WasmError::new("JSON_PARSE_ERROR", format!("JSON parse error: {e}")))?;
    validate_project_document(&doc).map_err(WasmError::from)?;
    Ok("ok".to_string())
}

#[derive(Deserialize)]
struct ProjectSchemaEnvelope {
    schema_version: u32,
}

fn load_project_inner(json: &str) -> Result<String, WasmError> {
    let envelope: ProjectSchemaEnvelope = serde_json::from_str(json)
        .map_err(|e| WasmError::new("JSON_PARSE_ERROR", format!("JSON parse error: {e}")))?;
    if envelope.schema_version != CURRENT_PROJECT_SCHEMA_VERSION {
        return Err(WasmError::new(
            "UNSUPPORTED_SCHEMA",
            format!("unsupported schema_version: {}", envelope.schema_version),
        ));
    }
    let doc = parse_project_document(json)
        .map_err(|e| WasmError::new("JSON_PARSE_ERROR", format!("JSON parse error: {e}")))?;
    serialize_project_document(&doc).map_err(|e| WasmError::new("SERIALIZE_ERROR", e.to_string()))
}

fn serialize_project_for_save_inner(json: &str) -> Result<String, WasmError> {
    let doc = parse_project_document(json)
        .map_err(|e| WasmError::new("JSON_PARSE_ERROR", format!("JSON parse error: {e}")))?;
    serialize_project_document_for_save(&doc).map_err(WasmError::from)
}

#[derive(Serialize)]
struct CompiledPitchPlanJson {
    sample_rate: u32,
    audio_clips: Vec<CompiledAudioClipJson>,
    pitch_plan: Vec<CompiledPitchSegmentJson>,
}

#[derive(Serialize)]
struct CompiledAudioClipJson {
    clip_id: ClipId,
    track_id: TrackId,
    start_frame: i64,
    end_frame: i64,
    src_in_frame: u64,
    src_out_frame: u64,
    warp_plan: CompiledWarpPlanJson,
}

#[derive(Serialize)]
struct CompiledWarpPlanJson {
    kind: &'static str,
    segments: Vec<CompiledWarpSegmentJson>,
}

#[derive(Serialize)]
struct CompiledWarpSegmentJson {
    dst_start_frame: i64,
    dst_end_frame: i64,
    src_start_frame: u64,
    src_end_frame: u64,
}

#[derive(Serialize)]
struct CompiledPitchSegmentJson {
    clip_id: ClipId,
    audio_track: TrackId,
    start_frame: i64,
    end_frame: i64,
    shift_cents: i32,
}

fn parse_analysis_store_json(analysis_json: &str) -> Result<Option<AnalysisStore>, JsValue> {
    if analysis_json.trim().is_empty() || analysis_json.trim() == "{}" {
        return Ok(None);
    }

    let raw: BTreeMap<String, AnalysisArtifact> =
        serde_json::from_str(analysis_json).map_err(|e| {
            WasmError::new(
                "JSON_PARSE_ERROR",
                format!("analysis JSON parse error: {e}"),
            )
            .into_js()
        })?;

    let mut store = AnalysisStore::new();
    for (analysis_id, artifact) in raw {
        let parsed = AnalysisId(uuid::Uuid::parse_str(&analysis_id).map_err(|e| {
            WasmError::new(
                "INVALID_ANALYSIS_ID",
                format!("invalid analysis_id key: {e}"),
            )
            .into_js()
        })?);
        store.insert(parsed, artifact);
    }

    Ok(Some(store))
}

fn parse_f0_track_json(f0_json: &str) -> Result<F0TrackArtifact, JsValue> {
    match serde_json::from_str::<F0TrackJsonInput>(f0_json) {
        Ok(F0TrackJsonInput::Bare(track)) => Ok(track),
        Ok(F0TrackJsonInput::Wrapped(AnalysisArtifact::F0Track(track))) => Ok(track),
        Ok(F0TrackJsonInput::Wrapped(_)) => Err(WasmError::new(
            "F0_ARTIFACT_TYPE_MISMATCH",
            "f0 JSON parse error: expected an f0_track analysis artifact",
        )
        .into_js()),
        Err(e) => {
            Err(WasmError::new("JSON_PARSE_ERROR", format!("f0 JSON parse error: {e}")).into_js())
        }
    }
}

fn build_compiled_pitch_plan_json(rt: &ProjectRuntime) -> CompiledPitchPlanJson {
    let mut audio_clips = Vec::new();
    for track in &rt.tracks {
        for clip in &track.clips {
            if let ClipRuntime::Audio(audio) = clip {
                audio_clips.push(CompiledAudioClipJson {
                    clip_id: audio.clip_id,
                    track_id: track.id,
                    start_frame: audio.start.0,
                    end_frame: audio.end.0,
                    src_in_frame: audio.src_in.0,
                    src_out_frame: audio.src_out.0,
                    warp_plan: match &audio.warp_plan {
                        WarpPlanRt::Linear => CompiledWarpPlanJson {
                            kind: "linear",
                            segments: vec![CompiledWarpSegmentJson {
                                dst_start_frame: audio.start.0,
                                dst_end_frame: audio.end.0,
                                src_start_frame: audio.src_in.0,
                                src_end_frame: audio.src_out.0,
                            }],
                        },
                        WarpPlanRt::Piecewise { segments } => CompiledWarpPlanJson {
                            kind: "piecewise",
                            segments: segments
                                .iter()
                                .map(|segment| CompiledWarpSegmentJson {
                                    dst_start_frame: segment.dst_start.0,
                                    dst_end_frame: segment.dst_end.0,
                                    src_start_frame: segment.src_start.0,
                                    src_end_frame: segment.src_end.0,
                                })
                                .collect(),
                        },
                    },
                });
            }
        }
    }

    let pitch_plan = rt
        .pitch_plan
        .iter()
        .map(|segment| CompiledPitchSegmentJson {
            clip_id: segment.clip_id,
            audio_track: segment.audio_track,
            start_frame: segment.start.0,
            end_frame: segment.end.0,
            shift_cents: segment.shift_cents,
        })
        .collect();

    CompiledPitchPlanJson {
        sample_rate: rt.sample_rate,
        audio_clips,
        pitch_plan,
    }
}

pub fn create_project(name: &str, bpm: f64, sample_rate: u32) -> Result<String, JsValue> {
    serialize_project_document(&create_project_document(name, bpm, sample_rate))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", e.to_string()).into_js())
}

pub fn validate_project(json: &str) -> Result<String, JsValue> {
    validate_project_inner(json).map_err(WasmError::into_js)
}

pub fn load_project(json: &str) -> Result<String, JsValue> {
    load_project_inner(json).map_err(WasmError::into_js)
}

pub fn serialize_project_for_save(json: &str) -> Result<String, JsValue> {
    serialize_project_for_save_inner(json).map_err(WasmError::into_js)
}

pub fn compile_pitch_plan_json(project_json: &str, analysis_json: &str) -> Result<String, JsValue> {
    let doc = parse_project_document(project_json).map_err(|e| {
        WasmError::new("JSON_PARSE_ERROR", format!("project JSON parse error: {e}")).into_js()
    })?;
    let analysis = parse_analysis_store_json(analysis_json)?;
    let runtime = compile_project_runtime(&doc, analysis.as_ref())
        .map_err(|e| WasmError::from(e).into_js())?;
    let payload = build_compiled_pitch_plan_json(&runtime);
    serde_json::to_string(&payload)
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

pub fn apply_command_json(project_json: &str, command_json: &str) -> Result<String, JsValue> {
    apply_command_json_inner(project_json, command_json, false).map_err(WasmError::into_js)
}

pub fn apply_internal_command_json(
    project_json: &str,
    command_json: &str,
) -> Result<String, JsValue> {
    apply_command_json_inner(project_json, command_json, true).map_err(WasmError::into_js)
}

fn parse_media_id_inner(media_id: &str) -> Result<MediaId, WasmError> {
    Ok(MediaId(uuid::Uuid::parse_str(media_id).map_err(|e| {
        WasmError::new("INVALID_MEDIA_ID", format!("invalid media_id: {e}"))
    })?))
}

fn parse_media_id(media_id: &str) -> Result<MediaId, JsValue> {
    parse_media_id_inner(media_id).map_err(WasmError::into_js)
}

pub fn analyze_f0_json(
    samples_json: &str,
    sample_rate: u32,
    media_id: &str,
) -> Result<String, JsValue> {
    let samples: Vec<f32> = serde_json::from_str(samples_json).map_err(|e| {
        WasmError::new("JSON_PARSE_ERROR", format!("samples JSON parse error: {e}")).into_js()
    })?;
    let media_id = parse_media_id(media_id)?;
    let artifact = analyze_f0_samples(&samples, sample_rate, media_id).map_err(|e| {
        WasmError::new("F0_ANALYSIS_ERROR", format!("F0 analysis error: {e}")).into_js()
    })?;
    serde_json::to_string(&AnalysisArtifact::F0Track(artifact))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

pub fn analyze_f0_buffer(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
) -> Result<String, JsValue> {
    let media_id = parse_media_id(media_id)?;
    let artifact = analyze_f0_samples(&samples.to_vec(), sample_rate, media_id).map_err(|e| {
        WasmError::new("F0_ANALYSIS_ERROR", format!("F0 analysis error: {e}")).into_js()
    })?;
    serde_json::to_string(&AnalysisArtifact::F0Track(artifact))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

pub fn analyze_f0_buffer_with_backend(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
    backend: &str,
) -> Result<String, JsValue> {
    let media_id = parse_media_id(media_id)?;
    let artifact =
        analyze_f0_samples_with_backend(&samples.to_vec(), sample_rate, media_id, backend)
            .map_err(|e| {
                WasmError::new("F0_ANALYSIS_ERROR", format!("F0 analysis error: {e}")).into_js()
            })?;
    serde_json::to_string(&AnalysisArtifact::F0Track(artifact))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

pub fn analyze_f0_buffer_with_profile(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
    profile: &str,
) -> Result<String, JsValue> {
    let media_id = parse_media_id(media_id)?;
    let artifact =
        analyze_f0_samples_with_profile(&samples.to_vec(), sample_rate, media_id, profile)
            .map_err(|e| {
                WasmError::new("F0_ANALYSIS_ERROR", format!("F0 analysis error: {e}")).into_js()
            })?;
    serde_json::to_string(&AnalysisArtifact::F0Track(artifact))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

pub fn generate_pitch_marks_buffer(
    samples: &js_sys::Float32Array,
    f0_json: &str,
) -> Result<String, JsValue> {
    let f0_track = parse_f0_track_json(f0_json)?;
    let artifact = generate_pitch_marks_from_samples(&samples.to_vec(), &f0_track);
    serde_json::to_string(&AnalysisArtifact::PitchMarks(artifact))
        .map_err(|e| WasmError::new("SERIALIZE_ERROR", format!("serialize error: {e}")).into_js())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compiler::Compiler;
    use crate::edit::{
        AudioClipEdit, AudioContentEdit, BusTarget, ClipEdit, ClipKind, FadesEdit,
        PitchControlEdit, ProjectDocument, ProjectEdit, ProjectMeta, RoutingEdit,
        TimePitchModeEdit, TrackEdit, TrackKind, TrackRoutingEdit, VoiceAnalysisModeEdit,
        WarpAnchorEdit, WarpMapEdit,
    };
    use crate::ids::{ContentId, MediaId};
    use crate::time::{GridSettings, SrcFrame, TempoMapEdit, Tick, TimeSignature, DEFAULT_PPQ};

    fn make_minimal_audio_project(schema_version: u32) -> ProjectDocument {
        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let track_id = TrackId::new();
        let clip_id = ClipId::new();

        ProjectDocument {
            schema_version,
            meta: ProjectMeta {
                name: "Schema Test".to_string(),
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![TrackEdit {
                    id: track_id,
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
                }],
                media: vec![crate::edit::MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 1,
                    src_sample_rate: 44100,
                    length_src_frames: 44100,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![crate::edit::ContentEdit::Audio(AudioContentEdit {
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
                routing: crate::edit::RoutingEdit { schema_hint: None },
                automation: vec![],
                pitch_links: vec![],
            },
        }
    }

    #[test]
    fn compiled_pitch_plan_json_includes_explicit_warp_plan() {
        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let track_id = TrackId::new();
        let clip_id = ClipId::new();
        let doc = ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: ProjectMeta {
                name: "Warp Payload".to_string(),
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![TrackEdit {
                    id: track_id,
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
                }],
                media: vec![crate::edit::MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 1,
                    src_sample_rate: 44100,
                    length_src_frames: 88200,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![crate::edit::ContentEdit::Audio(AudioContentEdit {
                    id: content_id,
                    media_id,
                    analysis_refs: vec![],
                })],
                clips: vec![ClipEdit {
                    id: clip_id,
                    track_id,
                    start: Tick(0),
                    length: Tick(3840),
                    lane: 0,
                    muted: false,
                    gain_milli_db: 0,
                    kind: ClipKind::Audio {
                        content_id,
                        audio: AudioClipEdit {
                            src_in: SrcFrame(0),
                            src_out: SrcFrame(88200),
                            warp: WarpMapEdit::Anchors {
                                anchors: vec![WarpAnchorEdit {
                                    at_in_clip: Tick(1920),
                                    src_frame: SrcFrame(66150),
                                }],
                            },
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
        };

        let runtime = Compiler::compile(&doc).expect("compile");
        let payload = build_compiled_pitch_plan_json(&runtime);
        let json = serde_json::to_value(&payload).expect("serialize");
        let clip = &json["audio_clips"][0];
        let clip_id_str = clip_id.0.to_string();

        assert_eq!(clip["clip_id"].as_str(), Some(clip_id_str.as_str()));
        assert_eq!(clip["warp_plan"]["kind"].as_str(), Some("piecewise"));
        assert_eq!(
            clip["warp_plan"]["segments"].as_array().map(|v| v.len()),
            Some(2)
        );
        assert_eq!(
            clip["warp_plan"]["segments"][0]["src_start_frame"].as_u64(),
            Some(0)
        );
        assert_eq!(
            clip["warp_plan"]["segments"][1]["src_end_frame"].as_u64(),
            Some(88200)
        );
    }

    #[test]
    fn parse_f0_track_json_accepts_wrapped_and_legacy_payloads() {
        let media_id = MediaId::new();
        let track = F0TrackArtifact {
            schema_version: 1,
            media_id,
            src_sample_rate: 48_000,
            created_by: crate::analysis::CreatedBy {
                app_version: "test".to_string(),
                algo_version: "algo".to_string(),
                params_hash: "hash".to_string(),
            },
            hop_src_frames: 240,
            f0_hz_x100: vec![44_000, 44_100],
            voiced_prob_permille: Some(vec![900, 880]),
            method: "test".to_string(),
            params: "{}".to_string(),
        };

        let wrapped = serde_json::to_string(&AnalysisArtifact::F0Track(track.clone()))
            .expect("serialize wrapped");
        let legacy = serde_json::to_string(&track).expect("serialize legacy");

        let parsed_wrapped = parse_f0_track_json(&wrapped).expect("parse wrapped");
        let parsed_legacy = parse_f0_track_json(&legacy).expect("parse legacy");

        assert_eq!(parsed_wrapped.media_id, media_id);
        assert_eq!(parsed_legacy.media_id, media_id);
        assert_eq!(parsed_wrapped.f0_hz_x100, track.f0_hz_x100);
        assert_eq!(parsed_legacy.f0_hz_x100, track.f0_hz_x100);
    }

    #[test]
    fn public_apply_command_json_rejects_raw_mutators() {
        let clip_id = ClipId::new();
        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let track_id = TrackId::new();
        let doc = ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: ProjectMeta {
                name: "raw-reject".to_string(),
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![TrackEdit {
                    id: track_id,
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
                }],
                media: vec![crate::edit::MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 1,
                    src_sample_rate: 44100,
                    length_src_frames: 44100,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![crate::edit::ContentEdit::Audio(AudioContentEdit {
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
                routing: crate::edit::RoutingEdit { schema_hint: None },
                automation: vec![],
                pitch_links: vec![],
            },
        };

        let error = apply_command_json_inner(
            &doc.to_json_pretty().unwrap(),
            r#"{"command":"resize_clip","clip_id":"00000000-0000-0000-0000-000000000000","new_length":480}"#,
            false,
        )
        .unwrap_err();

        assert_eq!(error.code, "PUBLIC_COMMAND_REJECTED");
        assert!(error
            .message
            .contains("public command bridge does not accept raw mutators"));

        let error = apply_command_json_inner(
            &doc.to_json_pretty().unwrap(),
            &serde_json::json!({
                "command": "_restore_pitch_control",
                "clip_id": clip_id,
                "coarse": 0,
                "fine": 0,
            })
            .to_string(),
            false,
        )
        .unwrap_err();

        assert_eq!(error.code, "PUBLIC_COMMAND_REJECTED");
        assert!(error
            .message
            .contains("public command bridge does not accept raw mutators"));
    }

    #[test]
    fn internal_apply_command_json_accepts_inverse_only_commands() {
        let media_id = MediaId::new();
        let content_id = ContentId::new();
        let track_id = TrackId::new();
        let clip_id = ClipId::new();
        let doc = ProjectDocument {
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            meta: ProjectMeta {
                name: "inverse-bridge".to_string(),
                created_at: "2026-01-01".to_string(),
                app_version: "0.1.0".to_string(),
                project_sample_rate: 44100,
                ppq: DEFAULT_PPQ,
            },
            edit: ProjectEdit {
                tempo: TempoMapEdit::fixed(120.0, TimeSignature { num: 4, den: 4 }),
                grid: GridSettings::default(),
                tracks: vec![TrackEdit {
                    id: track_id,
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
                }],
                media: vec![crate::edit::MediaAsset {
                    id: media_id,
                    in_zip_path: "media/test.wav".to_string(),
                    channels: 1,
                    src_sample_rate: 44100,
                    length_src_frames: 44100,
                    hash: None,
                    original_name: None,
                }],
                contents: vec![crate::edit::ContentEdit::Audio(AudioContentEdit {
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
                routing: crate::edit::RoutingEdit { schema_hint: None },
                automation: vec![],
                pitch_links: vec![],
            },
        };

        let stretched = apply_command_json_inner(
            &doc.to_json_pretty().unwrap(),
            &serde_json::json!({
                "command": "audio_blue_stretch",
                "clip_id": clip_id,
                "new_start": 0,
                "new_length": 480,
            })
            .to_string(),
            false,
        )
        .unwrap();
        let stretched_value: serde_json::Value = serde_json::from_str(&stretched).unwrap();
        let stretched_project = stretched_value.get("project").cloned().unwrap().to_string();
        let inverse_json = stretched_value.get("inverse").cloned().unwrap().to_string();

        let restored = apply_command_json_inner(&stretched_project, &inverse_json, true).unwrap();
        let restored_value: serde_json::Value = serde_json::from_str(&restored).unwrap();
        let restored_project: ProjectDocument =
            serde_json::from_value(restored_value.get("project").cloned().unwrap()).unwrap();

        let restored_clip = restored_project.edit.clips.first().unwrap();
        assert_eq!(restored_clip.length, Tick(960));
    }

    #[test]
    fn create_project_emits_current_schema_version() {
        let json = serialize_project_document(&create_project_document("schema", 120.0, 44_100))
            .expect("create project");
        let project: ProjectDocument = serde_json::from_str(&json).expect("parse project");

        assert_eq!(project.schema_version, CURRENT_PROJECT_SCHEMA_VERSION);
    }

    #[test]
    fn parse_media_id_rejects_invalid_uuid_with_structured_error() {
        let error = parse_media_id_inner("not-a-uuid").unwrap_err();

        assert_eq!(error.code, "INVALID_MEDIA_ID");
        assert!(error.message.contains("invalid media_id"));
    }

    #[test]
    fn wasm_error_serializes_as_code_and_message() {
        let err = WasmError::new("MY_CODE", "human readable");
        let payload = WasmErrorJson {
            code: err.code,
            message: &err.message,
        };
        let text = serde_json::to_string(&payload).expect("serialize");
        assert_eq!(text, r#"{"code":"MY_CODE","message":"human readable"}"#);
    }

    #[test]
    fn load_project_roundtrips_current_schema() {
        let project = make_minimal_audio_project(CURRENT_PROJECT_SCHEMA_VERSION)
            .to_json_pretty()
            .unwrap();
        let loaded = load_project_inner(&project).expect("load project");
        let parsed: ProjectDocument = serde_json::from_str(&loaded).expect("parse loaded project");

        assert_eq!(parsed.schema_version, CURRENT_PROJECT_SCHEMA_VERSION);
    }

    #[test]
    fn load_project_rejects_schema_v3_before_parsing_its_retired_wire_shape() {
        let mut project =
            serde_json::to_value(make_minimal_audio_project(CURRENT_PROJECT_SCHEMA_VERSION))
                .unwrap();
        project["schema_version"] = serde_json::json!(3);
        let audio = project["edit"]["clips"][0]["kind"]["audio"]
            .as_object_mut()
            .unwrap();
        audio.remove("time_pitch");
        audio.insert(
            "time_pitch_algorithm".to_string(),
            serde_json::json!({
                "algorithm": "LegacyTdPsola",
                "preserve_formant": false
            }),
        );

        let error = load_project_inner(&project.to_string()).unwrap_err();

        assert_eq!(error.code, "UNSUPPORTED_SCHEMA");
        assert!(error.message.contains("schema_version: 3"));
    }

    #[test]
    fn load_project_rejects_voice_only_fields_on_music_time_pitch_mode() {
        for (field, value) in [
            ("analysis", serde_json::json!("Source")),
            ("preserve_formant", serde_json::json!(true)),
        ] {
            let mut project =
                serde_json::to_value(make_minimal_audio_project(CURRENT_PROJECT_SCHEMA_VERSION))
                    .unwrap();
            project["edit"]["clips"][0]["kind"]["audio"]["time_pitch"] =
                serde_json::json!({ "mode": "Music" });
            project["edit"]["clips"][0]["kind"]["audio"]["time_pitch"][field] = value;

            let error = load_project_inner(&project.to_string()).unwrap_err();

            assert_eq!(
                error.code, "JSON_PARSE_ERROR",
                "unexpected result for {field}"
            );
            assert!(
                error.message.contains("unknown field"),
                "unexpected message for {field}: {}",
                error.message
            );
        }
    }
}
