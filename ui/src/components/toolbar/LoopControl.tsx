import { Repeat } from "lucide-react";
import { css } from "../../../styled-system/css";
import { Button } from "@/design-system/index.ts";

interface LoopControlProps {
  hasTimeSelection: boolean;
  loopEnabled: boolean;
  onToggleLoop: () => void;
}

export function LoopControl({
  hasTimeSelection,
  loopEnabled,
  onToggleLoop,
}: LoopControlProps) {
  return (
    <Button
      onClick={onToggleLoop}
      disabled={!hasTimeSelection}
      className={loopButtonClass}
      style={{
        color: loopEnabled ? "var(--accent-amber)" : "var(--text-secondary)",
        borderColor: loopEnabled
          ? "rgba(246, 197, 108, 0.42)"
          : "var(--border-subtle)",
        background: loopEnabled
          ? "rgba(246, 197, 108, 0.16)"
          : "var(--bg-button)",
      }}
      title={
        hasTimeSelection
          ? "Loop the selected time range"
          : "Create a time selection on the ruler to enable loop"
      }
      variant="secondary"
    >
      <Repeat size={14} />
      <span>Loop</span>
    </Button>
  );
}

const loopButtonClass = css({
  minHeight: "36px",
});
