import type { MidiNote, WarpAnchorEdit } from "@/types";
import type { WaveformTile } from "./useClipWaveformPreview";
import { clipSurfaceStyles } from "./surfaceStyles";

interface ClipPreviewLayerProps {
  clipId: string;
  clipType: "audio" | "midi";
  clipHeight: number;
  mediaId?: string;
  waveformTiles: WaveformTile[];
  waveformCanvasRefs: React.RefObject<Map<number, HTMLCanvasElement>>;
  midiPreview: Array<{ startInClip: number; lengthInClip: number; key: MidiNote["key"] }>;
  displayLength: number;
  warpAnchors: WarpAnchorEdit[];
  pixelsPerTick: number;
}

export function ClipPreviewLayer({
  clipId,
  clipType,
  clipHeight,
  mediaId,
  waveformTiles,
  waveformCanvasRefs,
  midiPreview,
  displayLength,
  warpAnchors,
  pixelsPerTick,
}: ClipPreviewLayerProps) {
  return (
    <div data-testid={`clip-preview-${clipId}`} className={clipSurfaceStyles.previewLayer}>
      {clipType === "audio" && mediaId && (
        waveformTiles.map((tile) => (
          <canvas
            key={tile.index}
            ref={(canvas) => {
              if (canvas) {
                waveformCanvasRefs.current.set(tile.index, canvas);
              } else {
                waveformCanvasRefs.current.delete(tile.index);
              }
            }}
            data-testid={`clip-waveform-${clipId}-${tile.index}`}
            width={tile.width}
            height={clipHeight}
            className={clipSurfaceStyles.previewCanvas}
            style={{
              left: tile.left,
              width: tile.width,
            }}
          />
        ))
      )}
      {clipType === "audio" && !mediaId && (
        <span className={clipSurfaceStyles.previewLabel}>
          Audio
        </span>
      )}

      {clipType === "midi" && midiPreview.length > 0 ? (
        <svg
          className={clipSurfaceStyles.midiPreviewSvg}
          viewBox={`0 0 ${displayLength} 128`}
          preserveAspectRatio="none"
        >
          {midiPreview.map((segment, i) => (
            <rect
              key={i}
              x={segment.startInClip}
              y={127 - segment.key}
              width={Math.max(segment.lengthInClip, displayLength * 0.005)}
              height={1}
              fill="rgba(255,255,255,0.5)"
            />
          ))}
        </svg>
      ) : clipType === "midi" ? (
        <span className={clipSurfaceStyles.previewLabel}>
          MIDI
        </span>
      ) : null}

      {warpAnchors.map((anchor, i) => {
        const anchorX = anchor.at_in_clip * pixelsPerTick;
        return (
          <div
            key={i}
            className={clipSurfaceStyles.warpAnchor}
            style={{ left: anchorX - 4 }}
            title={`Warp @ tick ${anchor.at_in_clip}`}
          />
        );
      })}
    </div>
  );
}
