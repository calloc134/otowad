import { clipSurfaceStyles } from "./surfaceStyles";

interface ClipHeaderOverlayProps {
  clipId: string;
  headerColor: string;
  headerPaddingRight: number;
  clipName: string;
  visible: boolean;
  pitchSemitones: number;
  pitchFineCents: number;
  midiTransposeSemitones: number;
  gainMilliDb: number;
  isAudioLabelBadge: boolean;
}

export function ClipHeaderOverlay({
  clipId,
  headerColor,
  headerPaddingRight,
  clipName,
  visible,
  pitchSemitones,
  pitchFineCents,
  midiTransposeSemitones,
  gainMilliDb,
  isAudioLabelBadge,
}: ClipHeaderOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid={`clip-header-${clipId}`}
      className={clipSurfaceStyles.headerOverlay}
      style={{
        background: `linear-gradient(180deg, ${headerColor} 0%, rgba(0,0,0,0) 100%)`,
        padding: `0 ${headerPaddingRight}px 0 4px`,
      }}
    >
      <span
        className={isAudioLabelBadge ? clipSurfaceStyles.headerTitleWithBadge : clipSurfaceStyles.headerTitle}
        title={clipName}
      >
        {clipName}
        {pitchSemitones !== 0 && (
          <span className={clipSurfaceStyles.pitchSuffix}>
            {pitchSemitones > 0 ? "+" : ""}
            {pitchSemitones.toFixed(0)}
            st
          </span>
        )}
        {pitchFineCents !== 0 && (
          <span className={clipSurfaceStyles.finePitchSuffix}>
            {pitchFineCents > 0 ? "+" : ""}
            {pitchFineCents}
            ¢
          </span>
        )}
        {midiTransposeSemitones !== 0 && (
          <span className={clipSurfaceStyles.pitchSuffix}>
            {midiTransposeSemitones > 0 ? "+" : ""}
            {midiTransposeSemitones}
            st
          </span>
        )}
      </span>
      {gainMilliDb !== 0 && (
        <span className={clipSurfaceStyles.gainLabel}>
          {(gainMilliDb / 1000).toFixed(1)}dB
        </span>
      )}
    </div>
  );
}
