import type {
  ClipEdit,
  Command,
  ProjectDocument,
} from "../types/index.ts";
import {
  apply_command_json,
  apply_internal_command_json,
  create_project,
  load_project,
} from "../wasm/otomad_core.js";

import type { AudioClipEdit } from "../types/index.ts";

function normalizeTick(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function normalizeAudioClipEdit(audio: AudioClipEdit): AudioClipEdit {
  return {
    ...audio,
    src_in: normalizeTick(audio.src_in),
    src_out: Math.max(normalizeTick(audio.src_in) + 1, normalizeTick(audio.src_out)),
    fades: {
      ...audio.fades,
      fade_in: normalizeTick(audio.fades.fade_in),
      fade_out: normalizeTick(audio.fades.fade_out),
    },
    warp:
      audio.warp.warp_type === "anchors"
        ? {
            ...audio.warp,
            anchors: audio.warp.anchors.map((anchor) => ({
              ...anchor,
              at_in_clip: normalizeTick(anchor.at_in_clip),
              src_frame: normalizeTick(anchor.src_frame),
            })),
          }
        : audio.warp,
  };
}

export function normalizeClipTick(clip: ClipEdit): ClipEdit {
  const normalized = {
    ...clip,
    start: normalizeTick(clip.start),
    length: Math.max(1, normalizeTick(clip.length)),
  };
  const kind = normalized.kind;
  if (kind.clip_type === "audio") {
    return {
      ...normalized,
      kind: {
        ...kind,
        audio: normalizeAudioClipEdit(kind.audio),
      },
    };
  }
  return normalized;
}

export function normalizeProjectDocument(document: ProjectDocument): ProjectDocument {
  return {
    ...document,
    edit: {
      ...document.edit,
      clips: document.edit.clips.map((clip) => normalizeClipTick(clip)),
    },
  };
}

export function parseProjectDocumentJson(projectJson: string): ProjectDocument {
  return normalizeProjectDocument(JSON.parse(projectJson) as ProjectDocument);
}

export function loadProjectDocument(projectJson: string): ProjectDocument {
  return parseProjectDocumentJson(load_project(projectJson));
}

export const parseProjectDocumentJsonForTests = parseProjectDocumentJson;

export interface AppliedProjectCommandResult {
  project: ProjectDocument;
  inverseCommandJson: string;
}

function parseAppliedProjectCommandResult(resultJson: string): AppliedProjectCommandResult {
  const parsed = JSON.parse(resultJson) as {
    project: ProjectDocument;
    inverse: unknown;
  };
  return {
    project: normalizeProjectDocument(parsed.project),
    inverseCommandJson: JSON.stringify(parsed.inverse),
  };
}

function applyProjectCommandJson(
  document: ProjectDocument,
  commandJson: string,
  options?: { internal?: boolean },
): AppliedProjectCommandResult {
  const projectJson = JSON.stringify(document);
  const apply = options?.internal ? apply_internal_command_json : apply_command_json;
  return parseAppliedProjectCommandResult(apply(projectJson, commandJson));
}

export function createProjectDocument(
  name: string,
  bpm: number,
  sampleRate: number,
): ProjectDocument {
  return parseProjectDocumentJson(create_project(name, bpm, sampleRate));
}

export function applyProjectCommand(
  document: ProjectDocument,
  command: Command,
): AppliedProjectCommandResult {
  return applyProjectCommandJson(
    document,
    JSON.stringify(command),
  );
}

export function applyProjectInverseCommand(
  document: ProjectDocument,
  inverseCommandJson: string,
): AppliedProjectCommandResult {
  return applyProjectCommandJson(document, inverseCommandJson, { internal: true });
}
