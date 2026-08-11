/**
 * Live playhead store — external (non-React) source of truth for the current
 * playhead position during playback.
 *
 * Rationale: the rAF loop in `useAudioEngine` used to dispatch
 * `actions.setPlayhead()` every frame, which caused any component subscribed
 * to `useTransportState()` (Timeline, Toolbar, MidiEditor, …) to re-render at
 * ~60 fps. In a timeline-heavy DAW this compounds with hundreds of clips.
 *
 * With this store, the rAF loop writes to a plain JS variable and only
 * subscribers that actually need per-frame updates react to changes; the React
 * store (`transportStore.playheadTick`) is written only at playback
 * *boundaries* (start / pause / stop / loop restart), so React re-renders are
 * bounded to those events.
 */

type Listener = (tick: number) => void;

let currentTick = 0;
const listeners = new Set<Listener>();

export const livePlayheadStore = {
  getSnapshot(): number {
    return currentTick;
  },

  /**
   * Update the live playhead tick and notify subscribers synchronously.
   * Called from the rAF playback loop and from playback boundaries.
   */
  set(tick: number): void {
    if (tick === currentTick) return;
    currentTick = tick;
    for (const listener of listeners) {
      listener(tick);
    }
  },

  /** Subscribe to per-frame playhead updates. Returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test hook: clear all listeners and reset the tick. */
  _reset(): void {
    listeners.clear();
    currentTick = 0;
  },
};
