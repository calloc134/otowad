use crate::analysis::{
    analyze_f0, generate_pitch_marks, F0AnalysisConfig, F0TrackArtifact, PitchMarksArtifact,
};
use crate::commands::{apply_command, Command, CommandError};
use crate::compiler::{AnalysisStore, CompileError, Compiler};
use crate::edit::{
    ProjectDocument, ProjectEdit, ProjectMeta, RoutingEdit, CURRENT_PROJECT_SCHEMA_VERSION,
};
use crate::ids::MediaId;
use crate::runtime::ProjectRuntime;
use crate::time::{GridSettings, TempoMapEdit, TimeSignature, DEFAULT_PPQ};

fn ensure_supported_schema_version(doc: &ProjectDocument) -> Result<(), CompileError> {
    if doc.schema_version != CURRENT_PROJECT_SCHEMA_VERSION {
        return Err(CompileError::UnsupportedSchema(doc.schema_version));
    }

    Ok(())
}

pub fn create_project_document(name: &str, bpm: f64, sample_rate: u32) -> ProjectDocument {
    let ppq = DEFAULT_PPQ;
    ProjectDocument {
        schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
        meta: ProjectMeta {
            name: name.to_string(),
            project_sample_rate: sample_rate,
            ppq,
            created_at: String::new(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        },
        edit: ProjectEdit {
            tempo: TempoMapEdit::fixed(bpm, TimeSignature { num: 4, den: 4 }),
            grid: GridSettings::default(),
            tracks: vec![],
            media: vec![],
            contents: vec![],
            clips: vec![],
            routing: RoutingEdit { schema_hint: None },
            automation: vec![],
            pitch_links: vec![],
        },
    }
}

pub fn parse_project_document(json: &str) -> Result<ProjectDocument, serde_json::Error> {
    ProjectDocument::from_json_str(json)
}

/// Serialize for the bridge round-trip (command application, normalization).
/// Compact on purpose: this runs per edit operation, and pretty-printing is
/// only needed on the save path (`serialize_project_document_for_save`).
pub fn serialize_project_document(doc: &ProjectDocument) -> Result<String, serde_json::Error> {
    doc.to_json_compact()
}

pub fn serialize_project_document_for_save(doc: &ProjectDocument) -> Result<String, CompileError> {
    ensure_supported_schema_version(doc)?;
    let mut normalized = doc.clone();
    normalized.edit.normalize_for_save();
    normalized
        .to_json_pretty()
        .map_err(|error| CompileError::Serialize(error.to_string()))
}

pub fn validate_project_document(doc: &ProjectDocument) -> Result<(), CompileError> {
    ensure_supported_schema_version(doc)?;
    Compiler::compile(doc).map(|_| ())
}

pub fn compile_project_runtime(
    doc: &ProjectDocument,
    analysis: Option<&AnalysisStore>,
) -> Result<ProjectRuntime, CompileError> {
    Compiler::compile_with_analysis(doc, analysis)
}

pub fn apply_project_command(
    doc: &mut ProjectDocument,
    command: &Command,
) -> Result<Command, CommandError> {
    if doc.schema_version != CURRENT_PROJECT_SCHEMA_VERSION {
        return Err(CommandError::UnsupportedSchemaVersion(doc.schema_version));
    }

    if let Command::RenameProject { name } = command {
        return apply_rename_project(doc, name);
    }

    apply_command(&mut doc.edit, command)
}

fn apply_rename_project(doc: &mut ProjectDocument, name: &str) -> Result<Command, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(CommandError::InvalidProjectName {
            reason: "empty or whitespace-only",
        });
    }
    if trimmed.chars().count() > 200 {
        return Err(CommandError::InvalidProjectName {
            reason: "exceeds 200 characters",
        });
    }
    let old = std::mem::replace(&mut doc.meta.name, trimmed.to_string());
    Ok(Command::RenameProject { name: old })
}

pub fn analyze_f0_samples(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
) -> Result<F0TrackArtifact, String> {
    analyze_f0(samples, sample_rate, media_id, &F0AnalysisConfig::default())
}

pub fn analyze_f0_samples_with_backend(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
    backend: &str,
) -> Result<F0TrackArtifact, String> {
    let config = F0AnalysisConfig::default().with_backend_name(backend)?;
    analyze_f0(samples, sample_rate, media_id, &config)
}

pub fn analyze_f0_samples_with_profile(
    samples: &[f32],
    sample_rate: u32,
    media_id: MediaId,
    profile: &str,
) -> Result<F0TrackArtifact, String> {
    let config = F0AnalysisConfig::with_profile_name(profile)?;
    analyze_f0(samples, sample_rate, media_id, &config)
}

pub fn generate_pitch_marks_from_samples(
    samples: &[f32],
    f0_track: &F0TrackArtifact,
) -> PitchMarksArtifact {
    generate_pitch_marks(
        samples,
        f0_track,
        f0_track.src_sample_rate,
        f0_track.media_id,
    )
}
