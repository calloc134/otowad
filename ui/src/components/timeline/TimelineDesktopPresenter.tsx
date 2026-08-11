import type { ReactNode, Ref } from "react";
import type {
  MobileTransientActionBadge,
} from "@/app/interaction-contracts/mobile.ts";
import { timelinePresenterStyles } from "./surfaceStyles";

interface TimelineDesktopPresenterProps {
  rootRef?: Ref<HTMLDivElement>;
  emptyState?: ReactNode;
  ruler?: ReactNode;
  lanes?: ReactNode;
  mobileTransientActionBadge?: MobileTransientActionBadge;
}

export function TimelineDesktopPresenter({
  rootRef,
  emptyState,
  ruler,
  lanes,
  mobileTransientActionBadge: _mobileTransientActionBadge,
}: TimelineDesktopPresenterProps) {
  return (
    <div
      ref={rootRef}
      data-testid="timeline-root"
      data-timeline-variant="desktop"
      className={timelinePresenterStyles.desktopRoot}
    >
      {emptyState ?? (
        <>
          {ruler}
          {lanes}
        </>
      )}
    </div>
  );
}
