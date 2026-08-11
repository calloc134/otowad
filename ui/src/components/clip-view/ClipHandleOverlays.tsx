import { CLIP_HANDLE_WIDTH } from "@/utils/timelineInteractions";
import { TRIM_HANDLE_STRETCH, TRIM_HANDLE_TRIM } from "@/design-system/trackKindColors";
import { clipSurfaceStyles } from "./surfaceStyles";

interface ClipHandleOverlaysProps {
  disableGroupEdit: boolean;
  isAudio: boolean;
  isSelected: boolean;
}

function ClipHandle({
  side,
  top,
  height,
  isSelected,
  color,
}: {
  side: "left" | "right";
  top: number | string;
  height: number | string;
  isSelected: boolean;
  color: string;
}) {
  return (
    <div
      className={clipSurfaceStyles.handle}
      style={{
        [side]: 0,
        top,
        width: CLIP_HANDLE_WIDTH,
        height,
        backgroundColor: isSelected ? color : "transparent",
      }}
    />
  );
}

export function ClipHandleOverlays({
  disableGroupEdit,
  isAudio,
  isSelected,
}: ClipHandleOverlaysProps) {
  if (disableGroupEdit) {
    return null;
  }

  return (
    <>
      {isAudio && (
        <>
          <ClipHandle
            side="left"
            top={0}
            height="50%"
            isSelected={isSelected}
            color={TRIM_HANDLE_STRETCH}
          />
          <ClipHandle
            side="right"
            top={0}
            height="50%"
            isSelected={isSelected}
            color={TRIM_HANDLE_STRETCH}
          />
        </>
      )}
      <ClipHandle
        side="left"
        top={isAudio ? "50%" : 0}
        height={isAudio ? "50%" : "100%"}
        isSelected={isSelected}
        color={TRIM_HANDLE_TRIM}
      />
      <ClipHandle
        side="right"
        top={isAudio ? "50%" : 0}
        height={isAudio ? "50%" : "100%"}
        isSelected={isSelected}
        color={TRIM_HANDLE_TRIM}
      />
    </>
  );
}
