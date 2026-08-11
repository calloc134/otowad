import type { TrackEdit, TrackId } from "@/types";

export function selectTracksForOfflineRender(
  tracks: readonly TrackEdit[],
  trackIds?: readonly TrackId[],
): TrackEdit[] {
  const requestedTrackIds = trackIds === undefined ? null : new Set(trackIds);
  const scopedTracks = requestedTrackIds === null
    ? tracks
    : tracks.filter((track) => requestedTrackIds.has(track.id));
  const anySolo = scopedTracks.some((track) => track.solo);

  return scopedTracks.filter((track) =>
    track.kind.track_type === "audio" &&
    !track.mute &&
    (!anySolo || track.solo)
  );
}
