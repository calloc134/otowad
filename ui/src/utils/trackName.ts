export const TRACK_NAME_MAX_LENGTH = 48;
export const TRACK_NAME_RULE_HINT =
  "Track names can use normal Unicode text; leading/trailing space is trimmed (max 48 chars).";
export const TRACK_NAME_EMPTY_ERROR = "Track name cannot be empty.";

export function sanitizeTrackNameDraft(value: string): string {
  return value.slice(0, TRACK_NAME_MAX_LENGTH);
}

export function normalizeTrackName(value: string): string {
  return sanitizeTrackNameDraft(value).replace(/\s+/g, " ").trim();
}

export function getTrackNameValidationError(value: string): string | null {
  const normalized = normalizeTrackName(value);
  if (!normalized) {
    return TRACK_NAME_EMPTY_ERROR;
  }
  return null;
}

export function coerceTrackName(value: string, fallback: string): string {
  return normalizeTrackName(value) || normalizeTrackName(fallback) || "Track";
}
