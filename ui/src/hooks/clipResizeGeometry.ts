import { findClosestSnapCandidate } from "../grid.ts";

export type ResizeEdge = "start-blue" | "end-blue" | "start-red" | "end-red";

export interface ResizeSession {
  pointerId: number;
  edge: ResizeEdge;
  startMouseX: number;
  origStart: number;
  origLength: number;
  origSrcIn: number;
  origSrcOut: number;
  origContentIn: number;
  origContentOut: number;
  pixelsPerTick: number;
  maxSourceFrame: number;
  isAudio: boolean;
  isSnapEnabled: boolean;
  magnetRangeTicks: number;
  otherClipStarts: number[];
  otherClipEnds: number[];
}

export interface AudioRedTrimPlan {
  newStart: number;
  newLength: number;
  newSrcIn: number;
  newSrcOut: number;
}

export interface MidiRedTrimPlan {
  newStart: number;
  newLength: number;
  newContentIn: number;
  newContentOut: number;
}

export interface ResizePreviewState {
  length: number;
  start: number;
  sourceIn: number | null;
  sourceOut: number | null;
  contentIn: number | null;
  contentOut: number | null;
}

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) return 0;

  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const floor = Math.floor(abs);
  const fraction = abs - floor;

  if (fraction < 0.5) return sign * floor;
  if (fraction > 0.5) return sign * (floor + 1);
  return sign * (floor % 2 === 0 ? floor : floor + 1);
}

export function planAudioRedTrim(
  session: ResizeSession,
  edge: "start" | "end",
  requestedLength: number,
): AudioRedTrimPlan {
  const originalSourceLength = session.origSrcOut - session.origSrcIn;
  if (session.origLength <= 0 || originalSourceLength <= 0) {
    return {
      newStart: session.origStart,
      newLength: session.origLength,
      newSrcIn: session.origSrcIn,
      newSrcOut: session.origSrcOut,
    };
  }

  let newLength = Math.max(1, Math.round(requestedLength));
  let newSourceLength = Math.max(
    1,
    roundHalfEven((newLength * originalSourceLength) / session.origLength),
  );

  const maxSourceLength =
    edge === "end"
      ? Number.isFinite(session.maxSourceFrame)
        ? Math.max(1, Math.round(session.maxSourceFrame - session.origSrcIn))
        : Number.POSITIVE_INFINITY
      : Math.max(1, session.origSrcOut);

  if (Number.isFinite(maxSourceLength) && newSourceLength > maxSourceLength) {
    newSourceLength = maxSourceLength;
    newLength = Math.max(
      1,
      roundHalfEven((newSourceLength * session.origLength) / originalSourceLength),
    );
  }

  if (edge === "end") {
    return {
      newStart: session.origStart,
      newLength,
      newSrcIn: session.origSrcIn,
      newSrcOut: session.origSrcIn + newSourceLength,
    };
  }

  const origEnd = session.origStart + session.origLength;
  return {
    newStart: origEnd - newLength,
    newLength,
    newSrcIn: session.origSrcOut - newSourceLength,
    newSrcOut: session.origSrcOut,
  };
}

export function planMidiRedTrim(
  session: ResizeSession,
  edge: "start" | "end",
  requestedLength: number,
): MidiRedTrimPlan {
  const safeRequestedLength = Math.max(1, Math.round(requestedLength));

  if (edge === "end") {
    return {
      newStart: session.origStart,
      newLength: safeRequestedLength,
      newContentIn: Math.max(0, session.origContentIn),
      newContentOut: Math.max(1, session.origContentIn + safeRequestedLength),
    };
  }

  const newContentOut = Math.max(1, session.origContentOut);
  const newContentIn = Math.max(0, newContentOut - safeRequestedLength);
  const newLength = newContentOut - newContentIn;
  const origEnd = session.origStart + session.origLength;
  return {
    newStart: origEnd - newLength,
    newLength,
    newContentIn,
    newContentOut,
  };
}

export function resolveSnappedEdgeTick(
  rawTick: number,
  movingEdge: "start" | "end",
  session: ResizeSession,
  snapTick: (tick: number) => number,
): number {
  const normalizedRawTick = Math.max(0, rawTick);
  let bestTick = snapTick(normalizedRawTick);
  let bestAdjustment = Math.abs(bestTick - normalizedRawTick);

  if (session.isSnapEnabled && session.magnetRangeTicks > 0) {
    const itemSnap = findClosestSnapCandidate(
      normalizedRawTick,
      session.magnetRangeTicks,
      movingEdge === "start" ? session.otherClipEnds : session.otherClipStarts,
    );
    if (itemSnap !== null && Math.abs(itemSnap - normalizedRawTick) < bestAdjustment) {
      bestTick = itemSnap;
      bestAdjustment = Math.abs(itemSnap - normalizedRawTick);
    }
  }

  return Math.round(bestTick);
}

export function resolveResizePreviewState(
  session: ResizeSession,
  clientX: number,
  snapTick: (tick: number) => number,
): ResizePreviewState {
  const dx = clientX - session.startMouseX;
  const deltaTicks = dx / session.pixelsPerTick;

  switch (session.edge) {
    case "end-blue": {
      const rawLength = session.origLength + deltaTicks;
      const newEnd = resolveSnappedEdgeTick(
        session.origStart + rawLength,
        "end",
        session,
        snapTick,
      );
      const snappedLength = Math.max(1, newEnd - session.origStart);
      return {
        length: snappedLength,
        start: session.origStart,
        sourceIn: session.isAudio ? session.origSrcIn : null,
        sourceOut: session.isAudio ? session.origSrcOut : null,
        contentIn: !session.isAudio ? session.origContentIn : null,
        contentOut: !session.isAudio ? session.origContentOut : null,
      };
    }
    case "start-blue": {
      const origEnd = session.origStart + session.origLength;
      const rawStart = session.origStart + deltaTicks;
      const snappedStart = resolveSnappedEdgeTick(rawStart, "start", session, snapTick);
      let newLength = origEnd - snappedStart;
      if (newLength < 1) newLength = 1;
      return {
        start: origEnd - newLength,
        length: newLength,
        sourceIn: session.isAudio ? session.origSrcIn : null,
        sourceOut: session.isAudio ? session.origSrcOut : null,
        contentIn: !session.isAudio ? session.origContentIn : null,
        contentOut: !session.isAudio ? session.origContentOut : null,
      };
    }
    case "end-red": {
      const rawLength = session.origLength + deltaTicks;
      const newEnd = resolveSnappedEdgeTick(
        session.origStart + rawLength,
        "end",
        session,
        snapTick,
      );
      const snappedLength = Math.max(1, newEnd - session.origStart);
      if (session.isAudio) {
        const trimPlan = planAudioRedTrim(session, "end", snappedLength);
        return {
          length: trimPlan.newLength,
          start: trimPlan.newStart,
          sourceIn: trimPlan.newSrcIn,
          sourceOut: trimPlan.newSrcOut,
          contentIn: null,
          contentOut: null,
        };
      }
      const trimPlan = planMidiRedTrim(session, "end", snappedLength);
      return {
        length: trimPlan.newLength,
        start: trimPlan.newStart,
        sourceIn: null,
        sourceOut: null,
        contentIn: trimPlan.newContentIn,
        contentOut: trimPlan.newContentOut,
      };
    }
    case "start-red": {
      const origEnd = session.origStart + session.origLength;
      const rawStart = session.origStart + deltaTicks;
      const snappedStart = resolveSnappedEdgeTick(rawStart, "start", session, snapTick);
      const requestedLength = Math.max(1, origEnd - snappedStart);
      if (session.isAudio) {
        const trimPlan = planAudioRedTrim(session, "start", requestedLength);
        return {
          start: trimPlan.newStart,
          length: trimPlan.newLength,
          sourceIn: trimPlan.newSrcIn,
          sourceOut: trimPlan.newSrcOut,
          contentIn: null,
          contentOut: null,
        };
      }
      const trimPlan = planMidiRedTrim(session, "start", requestedLength);
      return {
        start: trimPlan.newStart,
        length: trimPlan.newLength,
        sourceIn: null,
        sourceOut: null,
        contentIn: trimPlan.newContentIn,
        contentOut: trimPlan.newContentOut,
      };
    }
  }
}
