import type { ReactNode } from "react";
import { trackListStyles } from "./trackListStyles";

interface TrackHeaderDesktopPresenterProps {
  topControl: ReactNode;
  typeBadge: ReactNode;
  nameField: ReactNode;
  statusRow: ReactNode;
  mixRow: ReactNode;
  controls: ReactNode;
}

export function TrackHeaderDesktopPresenter({
  topControl,
  typeBadge,
  nameField,
  statusRow,
  mixRow,
  controls,
}: TrackHeaderDesktopPresenterProps) {
  return (
    <>
      <div className={trackListStyles.trackTop}>
        {topControl}
        {typeBadge}
        {nameField}
      </div>
      {statusRow}
      {mixRow}
      {controls}
    </>
  );
}
