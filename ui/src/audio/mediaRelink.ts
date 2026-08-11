import type { MediaAsset } from "../types/index.ts";

export function validateRelinkCandidate(
  asset: MediaAsset,
  buffer: Pick<AudioBuffer, "numberOfChannels" | "sampleRate" | "length">,
): string | null {
  if (buffer.numberOfChannels !== asset.channels) {
    return `Expected ${asset.channels} channel(s), but the selected file has ${buffer.numberOfChannels}.`;
  }
  if (buffer.sampleRate !== asset.src_sample_rate) {
    return `Expected ${asset.src_sample_rate} Hz, but the selected file is ${buffer.sampleRate} Hz.`;
  }
  if (buffer.length !== asset.length_src_frames) {
    return `Expected ${asset.length_src_frames} source frames, but the selected file has ${buffer.length}.`;
  }
  return null;
}
