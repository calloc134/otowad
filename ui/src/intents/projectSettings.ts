import { buildGridSettings, normalizeTimeSignature } from "../grid.ts";
import type {
  Command,
  GridDivision,
  GridSettings,
  ProjectDocument,
  TimeSignature,
} from "../types/index.ts";

function isSameGridDivision(left: GridDivision, right: GridDivision): boolean {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }

  if ("Triplet" in left && "Triplet" in right) {
    return left.Triplet.base === right.Triplet.base;
  }

  if ("Dotted" in left && "Dotted" in right) {
    return left.Dotted.base === right.Dotted.base;
  }

  return false;
}

function isSameGridSettings(left: GridSettings, right: GridSettings): boolean {
  return (
    left.snap_enabled === right.snap_enabled &&
    isSameGridDivision(left.division, right.division) &&
    left.swing_permille === right.swing_permille &&
    left.magnet_range_permille === right.magnet_range_permille &&
    left.snap_strength_permille === right.snap_strength_permille
  );
}

export function buildSetGridSettingsCommand(
  document: ProjectDocument,
  patch: Partial<GridSettings>,
): Command | null {
  const nextGrid = buildGridSettings(document.edit.grid, patch);
  if (isSameGridSettings(document.edit.grid, nextGrid)) {
    return null;
  }

  return {
    command: "set_grid_settings",
    grid: nextGrid,
  };
}

export function buildToggleGridCommand(
  document: ProjectDocument,
): Command | null {
  return buildSetGridSettingsCommand(document, {
    snap_enabled: !document.edit.grid.snap_enabled,
  });
}

export function buildSetBpmCommand(
  document: ProjectDocument,
  microBpm: number,
  options?: { preserveSeconds?: boolean },
): Command | null {
  const currentMicroBpm = document.edit.tempo.points[0]?.micro_bpm;
  if (currentMicroBpm === undefined) {
    return null;
  }

  const normalizedMicroBpm = Math.round(microBpm);
  if (normalizedMicroBpm === currentMicroBpm) {
    return null;
  }

  return {
    command: options?.preserveSeconds ? "set_bpm_preserve_seconds" : "set_bpm",
    micro_bpm: normalizedMicroBpm,
  };
}

export function buildSetTimeSignatureCommand(
  document: ProjectDocument,
  timeSig: TimeSignature,
): Command | null {
  const currentTimeSig = document.edit.tempo.points[0]?.time_sig;
  if (!currentTimeSig) {
    return null;
  }

  const normalized = normalizeTimeSignature(timeSig);
  if (
    normalized.num === currentTimeSig.num &&
    normalized.den === currentTimeSig.den
  ) {
    return null;
  }

  return {
    command: "set_time_signature",
    time_sig: normalized,
  };
}
