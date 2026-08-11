import { css } from "../../../../styled-system/css";
import {
  Panel,
  StatusPill,
} from "@/design-system/index.ts";

interface ProjectManagementSummaryCardProps {
  hasUnsavedChanges: boolean;
}

export function ProjectManagementSummaryCard({
  hasUnsavedChanges,
}: ProjectManagementSummaryCardProps) {
  return (
    <Panel variant="accent" className={summaryCardClass}>
      <div className={summaryEyebrowClass}>Browser project flow</div>
      <div className={summaryTitleClass}>Save locally, download only when you need a zip.</div>
      <div className={summaryTextClass}>
        Save writes the current project into browser storage. Import and ZIP download stay here as explicit management actions.
      </div>
      <StatusPill tone={hasUnsavedChanges ? "warning" : "success"} className={summaryStatusClass}>
        <span className={summaryStatusLabelClass}>Current status</span>
        <span className={summaryStatusValueClass}>
          {hasUnsavedChanges ? "Unsaved edits" : "Browser save up to date"}
        </span>
      </StatusPill>
    </Panel>
  );
}

const summaryCardClass = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "18px 18px 16px",
  borderRadius: "18px",
  background:
    "radial-gradient(circle at top right, rgba(97, 164, 255, 0.18), transparent 36%), linear-gradient(180deg, rgba(18, 28, 58, 0.98), rgba(10, 16, 31, 0.98))",
  border: "1px solid rgba(109, 162, 244, 0.24)",
});

const summaryEyebrowClass = css({
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.8px",
  textTransform: "uppercase",
  color: "var(--accent-blue)",
});

const summaryTitleClass = css({
  fontSize: "20px",
  fontWeight: 800,
  color: "var(--text-primary)",
  lineHeight: 1.2,
});

const summaryTextClass = css({
  fontSize: "13px",
  lineHeight: 1.5,
  color: "var(--text-secondary)",
});

const summaryStatusClass = css({
  marginTop: "4px",
  gap: "10px",
  alignSelf: "flex-start",
});

const summaryStatusLabelClass = css({
  fontSize: "11px",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
});

const summaryStatusValueClass = css({
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--text-primary)",
});
