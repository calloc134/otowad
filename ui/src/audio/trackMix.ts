export function gainMilliDbToLinear(gainMilliDb: number): number {
  return Math.pow(10, gainMilliDb / 20000);
}

export function panPermilleToUnit(panPermille: number): number {
  return Math.max(-1, Math.min(1, panPermille / 1000));
}

export interface StereoPannerCoefficients {
  leftFromLeft: number;
  leftFromRight: number;
  rightFromLeft: number;
  rightFromRight: number;
}

/**
 * Return the Web Audio StereoPannerNode equal-power matrix for a static pan.
 * Mono and stereo inputs intentionally use different matrices: stereo input
 * is identity at center and cross-mixes the far channel toward either edge.
 */
export function getStereoPannerCoefficients(
  pan: number,
  inputChannels: 1 | 2,
): StereoPannerCoefficients {
  const clampedPan = Math.max(-1, Math.min(1, pan));
  if (inputChannels === 1) {
    const angle = (clampedPan + 1) * Math.PI * 0.25;
    return {
      leftFromLeft: Math.cos(angle),
      leftFromRight: 0,
      rightFromLeft: Math.sin(angle),
      rightFromRight: 0,
    };
  }

  const angle = (clampedPan <= 0 ? clampedPan + 1 : clampedPan) * Math.PI * 0.5;
  const gainLeft = Math.cos(angle);
  const gainRight = Math.sin(angle);
  return clampedPan <= 0
    ? {
        leftFromLeft: 1,
        leftFromRight: gainLeft,
        rightFromLeft: 0,
        rightFromRight: gainRight,
      }
    : {
        leftFromLeft: gainLeft,
        leftFromRight: 0,
        rightFromLeft: gainRight,
        rightFromRight: 1,
      };
}
