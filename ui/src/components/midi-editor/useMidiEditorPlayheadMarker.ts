import { useLivePlayheadElement } from "@/hooks/usePlayheadMarker.ts";
import { contentTickFromProjectTick } from "@/utils/midiTimeMapping.ts";

interface MidiEditorPlayheadMarkerArgs {
  /** Null while the clip being edited has no resolved timing. */
  clipTiming: { clipStart: number; contentIn: number; contentOut: number } | null;
  pxPerTick: number;
}

/**
 * Position a MIDI editor playhead marker from the live playback tick.
 *
 * The editor works in content ticks while the transport reports project
 * ticks, so the marker converts on each update. It reads the same per-frame
 * store the main timeline marker uses — deriving the position from
 * `transportState` left it parked wherever playback started.
 *
 * Hidden rather than clamped when the playhead sits before the clip, so it
 * does not pile up against the left edge while the audio plays elsewhere.
 */
export function useMidiEditorPlayheadMarker({
  clipTiming,
  pxPerTick,
}: MidiEditorPlayheadMarkerArgs) {
  return useLivePlayheadElement<HTMLDivElement>(
    (element, projectTick) => {
      if (!clipTiming) {
        element.style.display = "none";
        return;
      }

      const contentTick = contentTickFromProjectTick({
        projectTick,
        clipStart: clipTiming.clipStart,
        contentIn: clipTiming.contentIn,
      });

      if (contentTick < clipTiming.contentIn || contentTick >= clipTiming.contentOut) {
        element.style.display = "none";
        return;
      }

      element.style.display = "";
      element.style.left = `${contentTick * pxPerTick}px`;
    },
    [clipTiming?.clipStart, clipTiming?.contentIn, clipTiming?.contentOut, pxPerTick],
  );
}
