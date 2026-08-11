pub mod analysis;
pub mod api;
pub mod commands;
pub mod compiler;
pub mod edit;
pub mod ids;
pub mod pitch;
pub mod runtime;
pub mod time;
pub mod warp;
mod wasm_bridge;

pub use api::{
    analyze_f0_samples, analyze_f0_samples_with_backend, analyze_f0_samples_with_profile,
    apply_project_command, compile_project_runtime, create_project_document,
    generate_pitch_marks_from_samples, parse_project_document, serialize_project_document,
    serialize_project_document_for_save, validate_project_document,
};
pub use commands::{apply_command, Command, CommandError, UndoStack};
pub use compiler::Compiler;
pub use edit::ProjectDocument;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_project(name: &str, bpm: f64, sample_rate: u32) -> Result<String, JsValue> {
    wasm_bridge::create_project(name, bpm, sample_rate)
}

#[wasm_bindgen]
pub fn validate_project(json: &str) -> Result<String, JsValue> {
    wasm_bridge::validate_project(json)
}

#[wasm_bindgen]
pub fn load_project(json: &str) -> Result<String, JsValue> {
    wasm_bridge::load_project(json)
}

#[wasm_bindgen]
pub fn serialize_project_for_save(json: &str) -> Result<String, JsValue> {
    wasm_bridge::serialize_project_for_save(json)
}

#[wasm_bindgen]
pub fn compile_pitch_plan_json(project_json: &str, analysis_json: &str) -> Result<String, JsValue> {
    wasm_bridge::compile_pitch_plan_json(project_json, analysis_json)
}

#[wasm_bindgen]
pub fn apply_command_json(project_json: &str, command_json: &str) -> Result<String, JsValue> {
    wasm_bridge::apply_command_json(project_json, command_json)
}

#[wasm_bindgen]
pub fn apply_internal_command_json(
    project_json: &str,
    command_json: &str,
) -> Result<String, JsValue> {
    wasm_bridge::apply_internal_command_json(project_json, command_json)
}

#[wasm_bindgen]
pub fn analyze_f0_json(
    samples_json: &str,
    sample_rate: u32,
    media_id: &str,
) -> Result<String, JsValue> {
    wasm_bridge::analyze_f0_json(samples_json, sample_rate, media_id)
}

#[wasm_bindgen]
pub fn analyze_f0_buffer(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
) -> Result<String, JsValue> {
    wasm_bridge::analyze_f0_buffer(samples, sample_rate, media_id)
}

#[wasm_bindgen]
pub fn analyze_f0_buffer_with_backend(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
    backend: &str,
) -> Result<String, JsValue> {
    wasm_bridge::analyze_f0_buffer_with_backend(samples, sample_rate, media_id, backend)
}

#[wasm_bindgen]
pub fn analyze_f0_buffer_with_profile(
    samples: &js_sys::Float32Array,
    sample_rate: u32,
    media_id: &str,
    profile: &str,
) -> Result<String, JsValue> {
    wasm_bridge::analyze_f0_buffer_with_profile(samples, sample_rate, media_id, profile)
}

#[wasm_bindgen]
pub fn generate_pitch_marks_buffer(
    samples: &js_sys::Float32Array,
    f0_json: &str,
) -> Result<String, JsValue> {
    wasm_bridge::generate_pitch_marks_buffer(samples, f0_json)
}
