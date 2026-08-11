import type { ReactNode } from "react";
import { trackListStyles } from "./trackListStyles";

interface TrackHeaderMobilePresenterProps {
  topControl: ReactNode;
  typeBadge: ReactNode;
  nameField: ReactNode;
  renameAction: ReactNode;
  statusRow: ReactNode;
  mixRow: ReactNode;
  controls: ReactNode;
}

export function TrackHeaderMobilePresenter({
  topControl,
  typeBadge,
  nameField,
  renameAction,
  statusRow,
  mixRow,
  controls,
}: TrackHeaderMobilePresenterProps) {
  return (
    <>
      <div className={trackListStyles.trackTop}>
        {topControl}
        {typeBadge}
        <div className={trackListStyles.trackNameSlot}>{nameField}</div>
        {renameAction}
      </div>
      {statusRow}
      {mixRow}
      {controls}
    </>
  );
}
