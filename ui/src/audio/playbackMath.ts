/**
 * Convert a tick position to seconds using micro_bpm and PPQ.
 * micro_bpm = BPM * 1_000_000 (e.g. 120 BPM = 120_000_000).
 * 1 quarter note = ppq ticks.
 * 1 tick = (60 * 1_000_000) / (microBpm * ppq) seconds.
 */
export function tickToSeconds(tick: number, microBpm: number, ppq: number): number {
  return (tick * 60 * 1_000_000) / (microBpm * ppq);
}

function normalizeLoopTick(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.round(value));
}

export function getEffectivePlaybackStartTick(
  playheadTick: number,
  loopEnabled: boolean,
  loopStartTick: number | null,
  loopEndTick: number | null,
): number {
  const startTick = normalizeLoopTick(loopStartTick);
  const endTick = normalizeLoopTick(loopEndTick);
  if (
    loopEnabled &&
    startTick !== null &&
    endTick !== null &&
    endTick > startTick
  ) {
    return startTick;
  }
  return Math.max(0, Math.round(playheadTick));
}

export function getLoopRestartTick(
  currentTick: number,
  loopEnabled: boolean,
  loopStartTick: number | null,
  loopEndTick: number | null,
): number | null {
  const startTick = normalizeLoopTick(loopStartTick);
  const endTick = normalizeLoopTick(loopEndTick);
  if (
    !loopEnabled ||
    startTick === null ||
    endTick === null ||
    endTick <= startTick
  ) {
    return null;
  }
  return currentTick >= endTick ? startTick : null;
}
