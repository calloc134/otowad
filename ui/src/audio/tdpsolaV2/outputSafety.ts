export function applyFinalSafetyLimiter(channels: Float32Array[]): void {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  if (peak <= 1) return;

  const scale = 0.98 / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      channel[index] = (channel[index] ?? 0) * scale;
    }
  }
}
