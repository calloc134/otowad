import type { Command, ClipId } from "@/types";
import {
  buildAudioBlueStretchCommand,
  buildAudioRedTrimCommand,
  buildMidiRedTrimCommand,
} from "@/intents/clipCommands.ts";
import {
  resolveClipResizeClickOutcome,
  type ClipResizeClickOutcome,
} from "@/utils/timelineInteractions";
import {
  planAudioRedTrim,
  planMidiRedTrim,
  resolveSnappedEdgeTick,
  type ResizeSession,
} from "./clipResizeGeometry";

export interface ClipResizeCommitResult {
  clickOutcome: ClipResizeClickOutcome | null;
  command: Command | null;
}

export function resolveClipResizeCommit(
  session: ResizeSession,
  clientX: number,
  clipId: ClipId,
  snapTick: (tick: number) => number,
): ClipResizeCommitResult {
  const deltaTicks = (clientX - session.startMouseX) / session.pixelsPerTick;

  switch (session.edge) {
    case "end-blue": {
      const rawLength = session.origLength + deltaTicks;
      const newEnd = resolveSnappedEdgeTick(
        session.origStart + rawLength,
        "end",
        session,
        snapTick,
      );
      const snappedLength = Math.round(Math.max(1, newEnd - session.origStart));
      return {
        clickOutcome: resolveClipResizeClickOutcome({
          edge: session.edge,
          originalStart: session.origStart,
          originalLength: session.origLength,
          nextStart: session.origStart,
          nextLength: snappedLength,
        }),
        command: buildAudioBlueStretchCommand({
          clipId,
          originalStart: session.origStart,
          originalLength: session.origLength,
          newStart: session.origStart,
          newLength: snappedLength,
        }),
      };
    }

    case "start-blue": {
      const origEnd = session.origStart + session.origLength;
      const rawStart = session.origStart + deltaTicks;
      const snappedStart = resolveSnappedEdgeTick(rawStart, "start", session, snapTick);
      let newLength = Math.round(origEnd - snappedStart);
      if (newLength < 1) {
        newLength = 1;
      }
      const actualStart = Math.round(origEnd - newLength);
      return {
        clickOutcome: resolveClipResizeClickOutcome({
          edge: session.edge,
          originalStart: session.origStart,
          originalLength: session.origLength,
          nextStart: actualStart,
          nextLength: newLength,
        }),
        command: buildAudioBlueStretchCommand({
          clipId,
          originalStart: session.origStart,
          originalLength: session.origLength,
          newStart: actualStart,
          newLength,
        }),
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
      const snappedLength = Math.round(Math.max(1, newEnd - session.origStart));

      if (session.isAudio) {
        const trimPlan = planAudioRedTrim(session, "end", snappedLength);
        return {
          clickOutcome: resolveClipResizeClickOutcome({
            edge: session.edge,
            originalStart: session.origStart,
            originalLength: session.origLength,
            originalSourceIn: session.origSrcIn,
            originalSourceOut: session.origSrcOut,
            nextStart: trimPlan.newStart,
            nextLength: trimPlan.newLength,
            nextSourceIn: trimPlan.newSrcIn,
            nextSourceOut: trimPlan.newSrcOut,
          }),
          command: buildAudioRedTrimCommand({
            clipId,
            originalStart: session.origStart,
            originalLength: session.origLength,
            originalSrcIn: session.origSrcIn,
            originalSrcOut: session.origSrcOut,
            newStart: trimPlan.newStart,
            newLength: trimPlan.newLength,
            newSrcIn: trimPlan.newSrcIn,
            newSrcOut: trimPlan.newSrcOut,
          }),
        };
      }

      const trimPlan = planMidiRedTrim(session, "end", snappedLength);
      return {
        clickOutcome: resolveClipResizeClickOutcome({
          edge: session.edge,
          originalStart: session.origStart,
          originalLength: session.origLength,
          originalSourceIn: session.origContentIn,
          originalSourceOut: session.origContentOut,
          nextStart: trimPlan.newStart,
          nextLength: trimPlan.newLength,
          nextSourceIn: trimPlan.newContentIn,
          nextSourceOut: trimPlan.newContentOut,
        }),
        command: buildMidiRedTrimCommand({
          clipId,
          originalStart: session.origStart,
          originalLength: session.origLength,
          originalContentIn: session.origContentIn,
          originalContentOut: session.origContentOut,
          newStart: trimPlan.newStart,
          newLength: trimPlan.newLength,
          newContentIn: trimPlan.newContentIn,
          newContentOut: trimPlan.newContentOut,
        }),
      };
    }

    case "start-red": {
      const origEnd = session.origStart + session.origLength;
      const rawStart = session.origStart + deltaTicks;
      const snappedStart = resolveSnappedEdgeTick(rawStart, "start", session, snapTick);
      const requestedLength = Math.round(Math.max(1, origEnd - snappedStart));

      if (session.isAudio) {
        const trimPlan = planAudioRedTrim(session, "start", requestedLength);
        return {
          clickOutcome: resolveClipResizeClickOutcome({
            edge: session.edge,
            originalStart: session.origStart,
            originalLength: session.origLength,
            originalSourceIn: session.origSrcIn,
            originalSourceOut: session.origSrcOut,
            nextStart: trimPlan.newStart,
            nextLength: trimPlan.newLength,
            nextSourceIn: trimPlan.newSrcIn,
            nextSourceOut: trimPlan.newSrcOut,
          }),
          command: buildAudioRedTrimCommand({
            clipId,
            originalStart: session.origStart,
            originalLength: session.origLength,
            originalSrcIn: session.origSrcIn,
            originalSrcOut: session.origSrcOut,
            newStart: trimPlan.newStart,
            newLength: trimPlan.newLength,
            newSrcIn: trimPlan.newSrcIn,
            newSrcOut: trimPlan.newSrcOut,
          }),
        };
      }

      const trimPlan = planMidiRedTrim(session, "start", requestedLength);
      return {
        clickOutcome: resolveClipResizeClickOutcome({
          edge: session.edge,
          originalStart: session.origStart,
          originalLength: session.origLength,
          originalSourceIn: session.origContentIn,
          originalSourceOut: session.origContentOut,
          nextStart: trimPlan.newStart,
          nextLength: trimPlan.newLength,
          nextSourceIn: trimPlan.newContentIn,
          nextSourceOut: trimPlan.newContentOut,
        }),
        command: buildMidiRedTrimCommand({
          clipId,
          originalStart: session.origStart,
          originalLength: session.origLength,
          originalContentIn: session.origContentIn,
          originalContentOut: session.origContentOut,
          newStart: trimPlan.newStart,
          newLength: trimPlan.newLength,
          newContentIn: trimPlan.newContentIn,
          newContentOut: trimPlan.newContentOut,
        }),
      };
    }
  }
}
