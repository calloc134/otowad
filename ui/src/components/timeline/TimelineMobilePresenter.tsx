import type { ReactNode, Ref } from "react";
import type { MobileTransientActionBadge } from "@/app/interaction-contracts/mobile.ts";
import { TransientActionBadge } from "@/design-system/index.ts";
import { timelinePresenterStyles } from "./surfaceStyles";

interface TimelineMobilePresenterProps {
  rootRef?: Ref<HTMLDivElement>;
  emptyState?: ReactNode;
  ruler?: ReactNode;
  lanes?: ReactNode;
  mobileTransientActionBadge?: MobileTransientActionBadge;
}

export function TimelineMobilePresenter({
  rootRef,
  emptyState,
  ruler,
  lanes,
  mobileTransientActionBadge,
}: TimelineMobilePresenterProps) {
  return (
    <div
      ref={rootRef}
      data-testid="timeline-root"
      data-timeline-variant="mobile"
      className={timelinePresenterStyles.mobileRoot}
    >
      {emptyState ?? (
        <div className={timelinePresenterStyles.mobileFrame}>
          {/* Gestures are implicit — one finger pans, two fingers zoom — so
              there is no mode to pick. Only the badge, which reports what the
              current gesture is doing, takes vertical space. */}
          {mobileTransientActionBadge?.visible ? (
            <div className={timelinePresenterStyles.mobileChromeRail}>
              <TransientActionBadge tone={mobileTransientActionBadge.tone}>
                {mobileTransientActionBadge.label}
              </TransientActionBadge>
            </div>
          ) : null}
          {ruler}
          {lanes}
        </div>
      )}
    </div>
  );
}
