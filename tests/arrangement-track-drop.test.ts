import { describe, expect, it } from 'vitest';
import type { Track } from '../src/core/types';
import { arrangementTrackAt } from '../src/ui/arrangement-track-drop';

const tracks: readonly Track[] = Object.freeze(['z-source', 'a-second', 'locked', 'last'].map((id, index) => Object.freeze({
  id, name: id, color: '#abc', instrumentId: 'harp', volume: 1, pan: 0, muted: false, solo: false, locked: index === 2,
})));
const viewport = { top: 100, height: 300, scrollTop: 0, trackTop: 26 };

describe('Arrangement track drop literal viewport boundaries', () => {
  it('uses supplied track order and half-open 52px row intervals', () => {
    expect(arrangementTrackAt(tracks, 126, viewport)).toBe(tracks[0]);
    expect(arrangementTrackAt(tracks, 177.999, viewport)).toBe(tracks[0]);
    expect(arrangementTrackAt(tracks, 178, viewport)).toBe(tracks[1]);
    expect(arrangementTrackAt(tracks, 229.999, viewport)).toBe(tracks[1]);
    expect(arrangementTrackAt(tracks, 230, viewport)).toBe(tracks[2]);
    expect(arrangementTrackAt(tracks, 333.999, viewport)).toBe(tracks[3]);
    expect(arrangementTrackAt(tracks, 334, viewport)).toBeUndefined();
  });

  it('excludes the viewport and fixed ruler while resolving partially scrolled rows', () => {
    const view = { ...viewport, height: 100, scrollTop: 52 };
    for (const y of [99, 100, 125.999, 200, 201]) expect(arrangementTrackAt(tracks, y, view)).toBeUndefined();
    expect(arrangementTrackAt(tracks, 126, view)).toBe(tracks[1]);
    expect(arrangementTrackAt(tracks, 199.999, view)).toBe(tracks[2]);
  });

  it('accounts for the reference lane and fresh scrollTop without using original project row IDs', () => {
    const filtered = [tracks[3], tracks[0]], view = { ...viewport, trackTop: 78 };
    for (const y of [126, 150, 177.999]) expect(arrangementTrackAt(filtered, y, view)).toBeUndefined();
    expect(arrangementTrackAt(filtered, 178, view)).toBe(tracks[3]);
    expect(arrangementTrackAt(filtered, 230, view)).toBe(tracks[0]);
    expect(arrangementTrackAt(filtered, 178, { ...view, scrollTop: 52 })).toBe(tracks[0]);
    expect(arrangementTrackAt(filtered, 281.999, view)).toBe(tracks[0]);
    expect(arrangementTrackAt(filtered, 282, view)).toBeUndefined();
  });

  it('returns a locked track reference for visible rejection feedback without mutating tracks', () => {
    const before = structuredClone(tracks);
    expect(arrangementTrackAt(tracks, 250, viewport)).toBe(tracks[2]);
    expect(arrangementTrackAt(tracks, 250, viewport)?.locked).toBe(true);
    expect(tracks).toEqual(before);
  });

  it('handles fractional placement and a viewport fully covered by its ruler', () => {
    const view = { top: -20.5, height: 160.25, scrollTop: 13.25, trackTop: 78 };
    expect(arrangementTrackAt(tracks, 44.249, view)).toBeUndefined();
    expect(arrangementTrackAt(tracks, 44.25, view)).toBe(tracks[0]);
    expect(arrangementTrackAt(tracks, 96.25, view)).toBe(tracks[1]);
    expect(arrangementTrackAt(tracks, 139.75, view)).toBeUndefined();
    for (const height of [.5, 25, 26]) expect(arrangementTrackAt(tracks, 100 + height / 2, { ...viewport, height })).toBeUndefined();
  });

  it('rejects empty content, nonfinite coordinates and invalid viewport geometry', () => {
    expect(arrangementTrackAt([], 150, viewport)).toBeUndefined();
    expect(arrangementTrackAt(tracks, 150, { ...viewport, scrollTop: 1000 })).toBeUndefined();
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(arrangementTrackAt(tracks, invalid, viewport)).toBeUndefined();
      for (const field of ['top', 'height', 'scrollTop', 'trackTop'] as const) expect(arrangementTrackAt(tracks, 150, { ...viewport, [field]: invalid })).toBeUndefined();
    }
    for (const height of [0, -0, -1]) expect(arrangementTrackAt(tracks, 150, { ...viewport, height })).toBeUndefined();
  });
});
