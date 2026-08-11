import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACK_NAME_EMPTY_ERROR,
  coerceTrackName,
  getTrackNameValidationError,
  normalizeTrackName,
  sanitizeTrackNameDraft,
} from "./trackName.ts";

test("sanitizeTrackNameDraft preserves Unicode while applying the max length", () => {
  assert.equal(sanitizeTrackNameDraft(" Lead@Vox! ボーカル "), " Lead@Vox! ボーカル ");
  assert.equal(
    sanitizeTrackNameDraft("a".repeat(60)),
    "a".repeat(48),
  );
});

test("normalizeTrackName trims and collapses spaces", () => {
  assert.equal(normalizeTrackName("  Lead   Vox  "), "Lead Vox");
});

test("getTrackNameValidationError rejects empty normalized names", () => {
  assert.equal(getTrackNameValidationError("   "), TRACK_NAME_EMPTY_ERROR);
  assert.equal(getTrackNameValidationError("%%%"), null);
  assert.equal(getTrackNameValidationError("ボーカル"), null);
  assert.equal(getTrackNameValidationError("Lead Vox"), null);
});

test("coerceTrackName falls back to prior track name", () => {
  assert.equal(coerceTrackName("   ", "Track 1"), "Track 1");
});
