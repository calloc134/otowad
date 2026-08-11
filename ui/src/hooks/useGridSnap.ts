import { useMemo } from "react";
import { useDocumentState } from "@/store";
import { DEFAULT_PPQ } from "@/types";
import {
  DEFAULT_GRID_MAGNET_RANGE_PERMILLE,
  DEFAULT_TIME_SIGNATURE,
  getMagnetRangeTicks,
  divisionToTicks,
  snapTickToGrid,
} from "@/grid";

export interface GridSnapResult {
  /**
   * Snap a tick position to the nearest grid line.
   * Uses magnetic behavior: free movement until within the configured range,
   * then snaps to that grid line. Always returns an integer.
   */
  snapTick: (tick: number) => number;
  /**
   * Snap a tick position using a caller-provided magnetic threshold.
   * Useful for UI-local affordances that should not modify persisted grid settings.
   */
  snapTickWithThreshold: (tick: number, thresholdTicks: number) => number;
  /** Current grid division size in ticks. */
  gridTickSize: number;
  /** Current magnetic threshold in ticks. */
  magnetRangeTicks: number;
  /** Whether snapping is currently enabled. */
  isSnapEnabled: boolean;
}

export function useGridSnap(): GridSnapResult {
  const { document: doc } = useDocumentState();

  const ppq = doc?.edit.tempo.ppq ?? DEFAULT_PPQ;
  const timeSig = doc?.edit.tempo.points[0]?.time_sig ?? DEFAULT_TIME_SIGNATURE;
  const grid = doc?.edit.grid;
  const isSnapEnabled = grid?.snap_enabled ?? true;
  const division = grid?.division ?? "Beat";
  const magnetRangePermille =
    grid?.magnet_range_permille ?? DEFAULT_GRID_MAGNET_RANGE_PERMILLE;

  const gridTickSize = useMemo(
    () => divisionToTicks(division, ppq, timeSig),
    [division, ppq, timeSig],
  );
  const magnetRangeTicks = useMemo(
    () => getMagnetRangeTicks(gridTickSize, magnetRangePermille),
    [gridTickSize, magnetRangePermille],
  );

  const snapTick = useMemo(() => {
    return (tick: number): number => {
      return snapTickToGrid(tick, gridTickSize, magnetRangeTicks, isSnapEnabled);
    };
  }, [isSnapEnabled, gridTickSize, magnetRangeTicks]);

  const snapTickWithThreshold = useMemo(() => {
    return (tick: number, thresholdTicks: number): number =>
      snapTickToGrid(tick, gridTickSize, thresholdTicks, isSnapEnabled);
  }, [gridTickSize, isSnapEnabled]);

  return {
    snapTick,
    snapTickWithThreshold,
    gridTickSize,
    magnetRangeTicks,
    isSnapEnabled,
  };
}
