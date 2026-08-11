import { useCallback } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useDocumentState, useProjectActions, useViewportState } from "@/store";
import { clampZoomX, zoomInX, zoomOutX, zoomXToSliderRatio } from "@/state/zoomLimits.ts";
import { clampTrackHeight } from "@/components/editorGeometry.ts";
import { useInteractionMode } from "@/app/interactionMode.tsx";

const TRACK_HEIGHT_STEP = 20;

export function ZoomControls() {
  const actions = useProjectActions();
  const { document: doc } = useDocumentState();
  const { zoom } = useViewportState();

  const hZoom = zoom.x;
  const vZoom = zoom.y;
  // The floor depends on how much a row has to fit, which the control size
  // changes.
  const usesTouchControls = useInteractionMode() === "touch-like";

  const handleHZoomIn = useCallback(() => {
    actions.setZoom(zoomInX(hZoom), vZoom);
  }, [hZoom, vZoom, actions]);

  const handleHZoomOut = useCallback(() => {
    actions.setZoom(zoomOutX(hZoom), vZoom);
  }, [hZoom, vZoom, actions]);

  const handleVZoomIn = useCallback(() => {
    actions.setZoom(hZoom, clampTrackHeight(vZoom + TRACK_HEIGHT_STEP, usesTouchControls));
  }, [hZoom, vZoom, actions, usesTouchControls]);

  const handleVZoomOut = useCallback(() => {
    actions.setZoom(hZoom, clampTrackHeight(vZoom - TRACK_HEIGHT_STEP, usesTouchControls));
  }, [hZoom, vZoom, actions, usesTouchControls]);

  const handleFit = useCallback(() => {
    if (!doc) return;
    const clips = Object.values(doc.edit.clips);
    if (clips.length === 0) return;
    const maxEnd = clips.reduce(
      (max, c) => Math.max(max, c.start + c.length),
      0,
    );
    if (maxEnd <= 0) return;
    // Estimate the available width (rough: viewport minus track list width)
    const availableWidth = Math.max(400, window.innerWidth - 200);
    actions.setZoom(clampZoomX(availableWidth / maxEnd), vZoom);
  }, [doc, vZoom, actions]);

  const hPercent = zoomXToSliderRatio(hZoom) * 100;

  return (
    <div style={styles.container}>
      <div style={styles.group}>
        <span style={styles.label}>H</span>
        <button
          style={styles.zoomBtn}
          onClick={handleHZoomOut}
          title="Zoom out horizontal"
          aria-label="Zoom out horizontal"
        >
          <Minus size={12} />
        </button>
        <div style={styles.barOuter}>
          <div
            style={{
              ...styles.barInner,
              width: `${Math.max(4, hPercent)}%`,
            }}
          />
        </div>
        <button
          style={styles.zoomBtn}
          onClick={handleHZoomIn}
          title="Zoom in horizontal"
          aria-label="Zoom in horizontal"
        >
          <Plus size={12} />
        </button>
      </div>

      <div style={styles.group}>
        <span style={styles.label}>V</span>
        <button
          style={styles.zoomBtn}
          onClick={handleVZoomOut}
          title="Zoom out vertical"
          aria-label="Zoom out vertical"
        >
          <Minus size={12} />
        </button>
        <span style={styles.value}>{vZoom}px</span>
        <button
          style={styles.zoomBtn}
          onClick={handleVZoomIn}
          title="Zoom in vertical"
          aria-label="Zoom in vertical"
        >
          <Plus size={12} />
        </button>
      </div>

      <button
        style={styles.fitBtn}
        onClick={handleFit}
        title="Fit all content to window"
      >
        <Maximize2 size={12} />
        <span>Fit</span>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-dim)",
    width: 10,
    textAlign: "center",
  },
  zoomBtn: {
    width: 24,
    height: 24,
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    background: "var(--bg-button-muted)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: "var(--panel-shadow-soft)",
  },
  barOuter: {
    width: 52,
    height: 8,
    backgroundColor: "rgba(9, 14, 29, 0.96)",
    borderRadius: 999,
    overflow: "hidden",
    border: "1px solid var(--border-subtle)",
  },
  barInner: {
    height: "100%",
    background:
      "linear-gradient(90deg, rgba(105,184,255,0.88), rgba(127,229,165,0.88))",
    borderRadius: 999,
    transition: "width 0.1s",
  },
  value: {
    fontSize: 10,
    color: "var(--text-muted)",
    fontFamily: "monospace",
    minWidth: 34,
    textAlign: "center",
  },
  fitBtn: {
    padding: "5px 10px",
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-button-muted)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    boxShadow: "var(--panel-shadow-soft)",
  },
};
