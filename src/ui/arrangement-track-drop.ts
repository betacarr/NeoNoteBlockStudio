import type { Track } from '../core/types';

export interface ArrangementTrackViewport {
  top: number; height: number; scrollTop: number;
  /** Content coordinate after the ruler and optional reference lane. */
  trackTop: number;
}

/** Resolve visible 52px rows, retaining locked targets for rejection feedback. */
export function arrangementTrackAt(tracks: readonly Track[], clientY: number, viewport: ArrangementTrackViewport): Track | undefined {
  const { top, height, scrollTop, trackTop } = viewport;
  if (![clientY, top, height, scrollTop, trackTop].every(Number.isFinite) || height <= 0) return;
  if (clientY < top + 26 || clientY >= top + height) return;
  const index = Math.floor((clientY - top + scrollTop - trackTop) / 52);
  return index >= 0 && index < tracks.length ? tracks[index] : undefined;
}
