import type { GridDivision, GridSettings, TimeSignature } from "./types/index.ts";
import { DEFAULT_PPQ } from "./types/index.ts";

export const DEFAULT_GRID_MAGNET_RANGE_PERMILLE = 250;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { num: 4, den: 4 };

export const GRID_LINE_COLORS = {
  barMajor: "rgba(255,255,255,0.14)",
  barMinor: "rgba(255,255,255,0.065)",
  beat: "rgba(255,255,255,0.055)",
  subdivision: "rgba(255,255,255,0.034)",
} as const;

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(Math.round(a));
  let right = Math.abs(Math.round(b));
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.round(value)
    : fallback;
}

export function normalizeTimeSignature(
  timeSig: TimeSignature | null | undefined,
): TimeSignature {
  return {
    num: normalizePositiveInt(timeSig?.num, DEFAULT_TIME_SIGNATURE.num),
    den: normalizePositiveInt(timeSig?.den, DEFAULT_TIME_SIGNATURE.den),
  };
}

export function effectiveBeatTicks(
  ppq: number,
  timeSig: TimeSignature = DEFAULT_TIME_SIGNATURE,
): number {
  const safePpq = normalizePositiveInt(ppq, DEFAULT_PPQ);
  const safeTimeSig = normalizeTimeSignature(timeSig);
  return Math.max(1, Math.round((safePpq * 4) / safeTimeSig.den));
}

export function ticksPerBar(
  ppq: number,
  timeSig: TimeSignature = DEFAULT_TIME_SIGNATURE,
): number {
  const safeTimeSig = normalizeTimeSignature(timeSig);
  return Math.max(1, effectiveBeatTicks(ppq, safeTimeSig) * safeTimeSig.num);
}

export function tickToBarBeatTick(
  tick: number,
  ppq: number,
  timeSig: TimeSignature = DEFAULT_TIME_SIGNATURE,
): { bar: number; beat: number; tick: number } {
  const beatTicks = effectiveBeatTicks(ppq, timeSig);
  const barTicks = ticksPerBar(ppq, timeSig);
  const normalizedTick = Math.max(0, Math.round(tick));
  const bar = Math.floor(normalizedTick / barTicks) + 1;
  const remainAfterBar = normalizedTick % barTicks;
  const beat = Math.floor(remainAfterBar / beatTicks) + 1;
  return {
    bar,
    beat,
    tick: remainAfterBar % beatTicks,
  };
}

export function getMagnetRangeTicks(
  gridTickSize: number,
  magnetRangePermille: number,
): number {
  if (!Number.isFinite(gridTickSize) || gridTickSize <= 0) {
    return 0;
  }
  return gridTickSize * (magnetRangePermille / 1000);
}

export function snapTickToGrid(
  tick: number,
  gridTickSize: number,
  magnetRangeTicks: number,
  snapEnabled = true,
): number {
  if (!snapEnabled || gridTickSize <= 0) {
    return Math.round(tick);
  }

  const nearest = Math.round(tick / gridTickSize) * gridTickSize;
  if (Math.abs(tick - nearest) <= Math.max(0, magnetRangeTicks)) {
    return nearest;
  }
  return Math.round(tick);
}

export function findClosestSnapCandidate(
  rawTick: number,
  threshold: number,
  candidates: readonly number[],
): number | null {
  if (!Number.isFinite(rawTick) || threshold < 0) {
    return null;
  }

  let closest: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(rawTick - candidate);
    if (distance <= threshold && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest;
}

export function divisionToTicks(
  division: GridDivision,
  ppq: number,
  timeSig: TimeSignature = DEFAULT_TIME_SIGNATURE,
): number {
  const beatTicks = effectiveBeatTicks(ppq, timeSig);
  const wholeNoteTicks = normalizePositiveInt(ppq, DEFAULT_PPQ) * 4;

  if (typeof division === "string") {
    switch (division) {
      case "Beat":
        return beatTicks;
      case "Half":
        return Math.max(1, Math.round(beatTicks / 2));
      case "Quarter":
        return Math.max(1, Math.round(beatTicks / 4));
      case "Eighth":
        return Math.max(1, Math.round(beatTicks / 8));
      case "Sixteenth":
        return Math.max(1, Math.round(beatTicks / 16));
      case "ThirtySecond":
        return Math.max(1, Math.round(beatTicks / 32));
    }
  }

  if ("Triplet" in division) {
    const baseTicks = wholeNoteTicks / division.Triplet.base;
    return Math.max(1, Math.round(baseTicks * (2 / 3)));
  }

  if ("Dotted" in division) {
    const baseTicks = wholeNoteTicks / division.Dotted.base;
    return Math.max(1, Math.round(baseTicks * 1.5));
  }

  return beatTicks;
}

export function gridDivisionLabel(division: GridDivision): string {
  if (typeof division === "string") {
    switch (division) {
      case "Beat":
        return "Beat";
      case "Half":
        return "Half beat";
      case "Quarter":
        return "Quarter beat";
      case "Eighth":
        return "1/8 beat";
      case "Sixteenth":
        return "1/16 beat";
      case "ThirtySecond":
        return "1/32 beat";
    }
  }

  if ("Triplet" in division) {
    return `Triplet ${division.Triplet.base}th`;
  }
  if ("Dotted" in division) {
    return `Dotted ${division.Dotted.base}th`;
  }
  return "Beat";
}

export function formatNoteValueFromTicks(ticks: number, ppq: number): string {
  const wholeNoteTicks = normalizePositiveInt(ppq, DEFAULT_PPQ) * 4;
  const safeTicks = Math.max(1, Math.round(ticks));
  const divisor = greatestCommonDivisor(safeTicks, wholeNoteTicks);
  const numerator = safeTicks / divisor;
  const denominator = wholeNoteTicks / divisor;
  return numerator === 1
    ? `1/${denominator} note`
    : `${numerator}/${denominator} note`;
}

export function describeGridDivision(
  division: GridDivision,
  ppq: number,
  timeSig: TimeSignature = DEFAULT_TIME_SIGNATURE,
): string {
  const safeTimeSig = normalizeTimeSignature(timeSig);
  const label = gridDivisionLabel(division);
  const noteValue = formatNoteValueFromTicks(
    divisionToTicks(division, ppq, safeTimeSig),
    ppq,
  );

  if (typeof division === "string") {
    return `${label} (${noteValue} in ${safeTimeSig.num}/${safeTimeSig.den})`;
  }

  return `${label} (${noteValue})`;
}

export function buildGridSettings(
  current: GridSettings | undefined,
  patch: Partial<GridSettings>,
): GridSettings {
  const base: GridSettings = current ?? {
    snap_enabled: true,
    division: "Beat",
    swing_permille: 0,
    magnet_range_permille: DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
    snap_strength_permille: 1000,
  };

  return {
    ...base,
    ...patch,
    magnet_range_permille:
      patch.magnet_range_permille ?? base.magnet_range_permille,
  };
}
