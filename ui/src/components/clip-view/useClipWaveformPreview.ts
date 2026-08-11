import { useEffect, useMemo, useRef } from "react";
import type { ClipEdit } from "@/types";
import { mediaCache } from "@/audio";

const MAX_WAVEFORM_CANVAS_WIDTH = 2048;

export interface WaveformTile {
  index: number;
  left: number;
  width: number;
}

function buildWaveformTiles(totalWidth: number): WaveformTile[] {
  const pixelWidth = Math.max(1, Math.ceil(totalWidth));
  const tiles: WaveformTile[] = [];

  for (let left = 0; left < pixelWidth; left += MAX_WAVEFORM_CANVAS_WIDTH) {
    tiles.push({
      index: tiles.length,
      left,
      width: Math.min(MAX_WAVEFORM_CANVAS_WIDTH, pixelWidth - left),
    });
  }

  return tiles;
}

interface UseClipWaveformPreviewArgs {
  clip: ClipEdit;
  clipHeight: number;
  width: number;
  mediaId?: string;
  displaySourceIn: number | null;
  displaySourceOut: number | null;
}

export function useClipWaveformPreview({
  clip,
  clipHeight,
  width,
  mediaId,
  displaySourceIn,
  displaySourceOut,
}: UseClipWaveformPreviewArgs) {
  const waveformTiles = useMemo(
    () => (clip.kind.clip_type === "audio" && mediaId ? buildWaveformTiles(width) : []),
    [clip.kind.clip_type, mediaId, width],
  );
  const waveformCanvasRefs = useRef(new Map<number, HTMLCanvasElement>());

  useEffect(() => {
    if (clip.kind.clip_type !== "audio" || !mediaId) {
      return;
    }

    const buffer = mediaCache.get(mediaId);
    if (!buffer) {
      return;
    }

    const data = buffer.getChannelData(0);
    const sourceIn = Math.max(
      0,
      Math.min(Math.round(displaySourceIn ?? clip.kind.audio.src_in), data.length - 1),
    );
    const sourceOut = Math.max(
      sourceIn + 1,
      Math.min(Math.round(displaySourceOut ?? clip.kind.audio.src_out), data.length),
    );
    const sampleCount = sourceOut - sourceIn;
    const pixelWidth = Math.max(1, Math.ceil(width));
    const pixelHeight = clipHeight;

    if (sampleCount <= 0 || pixelWidth <= 0 || pixelHeight <= 0) {
      return;
    }

    let peakAmp = 0;
    for (let i = sourceIn; i < sourceOut; i++) {
      const abs = Math.abs(data[i] ?? 0);
      if (abs > peakAmp) {
        peakAmp = abs;
      }
    }

    const centerY = pixelHeight * 0.5;
    const scale = peakAmp > 0.0001 ? (pixelHeight * 0.5) / peakAmp : 0;

    for (const tile of waveformTiles) {
      const canvas = waveformCanvasRefs.current.get(tile.index);
      if (!canvas) {
        continue;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        continue;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.45)";

      for (let x = 0; x < w; x++) {
        const globalX = tile.left + x;
        const s0 = Math.floor(sourceIn + (globalX / pixelWidth) * sampleCount);
        const s1 = Math.max(
          s0 + 1,
          Math.min(
            Math.floor(sourceIn + ((globalX + 1) / pixelWidth) * sampleCount),
            data.length,
          ),
        );

        let lo = 0;
        let hi = 0;
        for (let i = s0; i < s1; i++) {
          const v = data[i] ?? 0;
          if (v < lo) {
            lo = v;
          }
          if (v > hi) {
            hi = v;
          }
        }

        const top = Math.max(0, centerY - hi * scale);
        const bottom = Math.min(h, centerY - lo * scale);
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }

      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(0, centerY, w, 1);
    }
  }, [
    clip,
    clipHeight,
    displaySourceIn,
    displaySourceOut,
    mediaId,
    waveformTiles,
    width,
  ]);

  return {
    waveformTiles,
    waveformCanvasRefs,
  };
}
