import { Download, LoaderCircle } from "lucide-react";
import { css } from "../../../styled-system/css";
import { Button, ToolbarGroup } from "@/design-system/index.ts";

interface ExportSectionProps {
  isBusy: boolean;
  isRendering: boolean;
  renderProgressPhase: string | null;
  onExport: () => void;
}

export function ExportSection({
  isBusy,
  isRendering,
  renderProgressPhase,
  onExport,
}: ExportSectionProps) {
  return (
    <ToolbarGroup>
      <Button
        onClick={onExport}
        disabled={isRendering || isBusy}
        className={exportButtonClass}
        style={{
          borderColor: "rgba(105, 184, 255, 0.36)",
          background: "rgba(105, 184, 255, 0.12)",
          color: "var(--accent-blue)",
        }}
        title="Export project as WAV"
        variant="primary"
      >
        {isRendering ? (
          <LoaderCircle size={14} className={spinningIconClass} />
        ) : (
          <Download size={14} />
        )}
        <span>
          {isRendering
            ? `Rendering${renderProgressPhase ? ` ${renderProgressPhase}` : ""}`
            : "Export WAV"}
        </span>
      </Button>
    </ToolbarGroup>
  );
}

const exportButtonClass = css({
  minHeight: "36px",
});

const spinningIconClass = css({
  animation: "toolbar-spin 1s linear infinite",
});
