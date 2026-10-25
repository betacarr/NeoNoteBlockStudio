// Original librarylwjglopenal:20100824 SourceLWJGLOpenAL computes distance in
// double from float positions, then calculates the linear gain in Java float.
export function legacyLinearAttenuation(x: number, y: number, z: number, maxDistance: number): number {
  const dx = Math.fround(x), dy = Math.fround(y), dz = Math.fround(z), range = Math.fround(maxDistance);
  const distance = Math.fround(Math.sqrt(dx * dx + dy * dy + dz * dz));
  if (distance <= 0) return 1;
  if (distance >= range) return 0;
  return Math.max(0, Math.min(1, Math.fround(1 - Math.fround(distance / range))));
}
export const legacySourceGain = (gain: number, x: number, y: number, z: number, maxDistance: number) => Math.fround(legacyLinearAttenuation(x, y, z, maxDistance) * Math.fround(gain));
