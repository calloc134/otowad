export interface MonophonicPitchTrack {
  pitchTrack: Float32Array;
  voicedProbabilities: Float32Array;
  timestamps: Float32Array;
}

export interface MonophonicPitchRangePolicyDiagnostics {
  rejectedUnvoicedFrames: number;
  rejectedBelowMinimumFrames: number;
  rejectedAboveMaximumFrames: number;
  acceptedVoicedFrames: number;
}

export interface ApplyMonophonicPitchRangePolicyArgs {
  track: MonophonicPitchTrack;
  minimumF0Hz: number;
  maximumF0Hz: number;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

/**
 * Reassert the versioned F0 range after timestamp-grid interpolation.
 *
 * Interpolation across a 0 Hz boundary can create a tiny positive pitch while
 * the independently interpolated voicing probability remains high. Such a
 * frame implies a multi-thousand-sample period and must not enter mark
 * generation as voiced data.
 */
export function applyMonophonicPitchRangePolicy({
  track,
  minimumF0Hz,
  maximumF0Hz,
}: ApplyMonophonicPitchRangePolicyArgs): {
  track: MonophonicPitchTrack;
  diagnostics: MonophonicPitchRangePolicyDiagnostics;
} {
  assertFinitePositive(minimumF0Hz, "minimumF0Hz");
  assertFinitePositive(maximumF0Hz, "maximumF0Hz");
  if (maximumF0Hz <= minimumF0Hz) {
    throw new RangeError("maximumF0Hz must be greater than minimumF0Hz");
  }
  if (
    track.pitchTrack.length !== track.voicedProbabilities.length ||
    track.pitchTrack.length !== track.timestamps.length
  ) {
    throw new RangeError("monophonic pitch-track arrays must have equal lengths");
  }

  const pitchTrack = Float32Array.from(track.pitchTrack);
  const voicedProbabilities = Float32Array.from(track.voicedProbabilities);
  const diagnostics: MonophonicPitchRangePolicyDiagnostics = {
    rejectedUnvoicedFrames: 0,
    rejectedBelowMinimumFrames: 0,
    rejectedAboveMaximumFrames: 0,
    acceptedVoicedFrames: 0,
  };

  for (let index = 0; index < pitchTrack.length; index++) {
    const pitch = pitchTrack[index] ?? 0;
    if (!Number.isFinite(pitch) || pitch <= 0) {
      pitchTrack[index] = 0;
      voicedProbabilities[index] = 0;
      diagnostics.rejectedUnvoicedFrames++;
    } else if (pitch < minimumF0Hz) {
      pitchTrack[index] = 0;
      voicedProbabilities[index] = 0;
      diagnostics.rejectedBelowMinimumFrames++;
    } else if (pitch > maximumF0Hz) {
      pitchTrack[index] = 0;
      voicedProbabilities[index] = 0;
      diagnostics.rejectedAboveMaximumFrames++;
    } else {
      voicedProbabilities[index] = Math.max(
        0,
        Math.min(1, voicedProbabilities[index] ?? 0),
      );
      diagnostics.acceptedVoicedFrames++;
    }
  }

  return {
    track: {
      pitchTrack,
      voicedProbabilities,
      timestamps: Float32Array.from(track.timestamps),
    },
    diagnostics,
  };
}
