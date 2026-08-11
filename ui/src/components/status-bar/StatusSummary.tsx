import { css } from "../../../styled-system/css";
import { Button, StatusPill } from "@/design-system/index.ts";
import type { BusyTask } from "@/store";

interface StatusSummaryProps {
  busyTask: BusyTask | null;
  error: string | null;
  playbackPreparing: boolean;
  playbackOverlayVisible: boolean;
  hasDocument: boolean;
  unavailableMediaLabel: string | null;
  onRelinkMedia: () => void;
}

export function StatusSummary({
  busyTask,
  error,
  playbackPreparing,
  playbackOverlayVisible,
  hasDocument,
  unavailableMediaLabel,
  onRelinkMedia,
}: StatusSummaryProps) {
  if (busyTask) {
    return (
      <StatusPill tone="info" className={statusPillClass}>
        {busyTask.title}
        {busyTask.detail ? ` - ${busyTask.detail}` : ""}
      </StatusPill>
    );
  }

  if (playbackPreparing && !playbackOverlayVisible) {
    return (
      <StatusPill tone="info" className={statusPillClass}>
        Preparing playback...
      </StatusPill>
    );
  }

  if (unavailableMediaLabel) {
    return (
      <div className={mediaIssueClass}>
        <StatusPill tone="danger" className={statusPillClass}>
          {error || unavailableMediaLabel}
        </StatusPill>
        <Button onClick={onRelinkMedia} title="Choose the source audio file for this media asset">
          Relink
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <StatusPill tone="danger" className={statusPillClass}>
        {error}
      </StatusPill>
    );
  }

  return (
    <StatusPill tone="neutral" className={statusPillClass}>
      {hasDocument ? "Ready" : "No project loaded"}
    </StatusPill>
  );
}

const statusPillClass = css({
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const mediaIssueClass = css({
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minWidth: 0,
});
