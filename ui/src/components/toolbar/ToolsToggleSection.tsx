import { SlidersHorizontal } from "lucide-react";
import { css } from "../../../styled-system/css";
import { Button, ToolbarGroup } from "@/design-system/index.ts";

interface ToolsToggleSectionProps {
  toolsOpen: boolean;
  onToggle: () => void;
}

export function ToolsToggleSection({
  toolsOpen,
  onToggle,
}: ToolsToggleSectionProps) {
  return (
    <ToolbarGroup className={sectionClass}>
      <Button
        onClick={onToggle}
        className={pillButtonClass}
        title="Toggle secondary tools"
        aria-expanded={toolsOpen}
        variant="secondary"
      >
        <SlidersHorizontal size={14} />
        <span>{toolsOpen ? "Hide Tools" : "More Tools"}</span>
      </Button>
    </ToolbarGroup>
  );
}

const sectionClass = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  flexWrap: "wrap",
  justifyContent: "flex-start",
});

const pillButtonClass = css({
  minHeight: "36px",
});
