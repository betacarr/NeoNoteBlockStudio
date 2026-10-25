import type { Project } from './types';

export const MAX_PROJECT_TICK = 1e12;
const MAX_EVENTS = 2000000;
const finite = (value: number, minimum = 0) => Number.isFinite(value) && value >= minimum && value <= MAX_PROJECT_TICK;

/** A read-only candidate view used by inspector preflight, never stored. */
export interface ExpansionTimingOverlay {
  patternId?: string;
  patternLength?: number;
  noteIds?: ReadonlySet<string>;
  noteTick?: number;
  regionId?: string;
  regionLength?: number;
}

/** Inclusive nonnegative cycles whose actual floating-point onset lies in [0, length). */
export function loopNoteCycles(noteTick: number, period: number, offset: number, length: number): { first: number; last: number } {
  if (!finite(noteTick) || !finite(period, 1) || !finite(offset) || !finite(length, 1)) throw new RangeError('循环音符时间范围无效。');
  const empty = { first: 0, last: -1 }, local = (cycle: number) => noteTick + cycle * period - offset;
  if (local(0) >= length) return empty;
  let first = Math.max(0, Math.ceil((offset - noteTick) / period));
  let last = Math.ceil((offset + length - noteTick) / period) - 1;
  // In the schema's 0..1e12 domain, rounding is less than one period (period >= 1).
  // Correct the neighbouring integer against the exact expression used by playback.
  for (let correction = 0; correction < 2; correction++) {
    if (first > 0 && local(first - 1) >= 0) first--;
    else if (local(first) < 0) first++;
    else break;
  }
  if (local(first) >= length) return empty;
  for (let correction = 0; correction < 2; correction++) {
    if (last >= first && local(last) >= length) last--;
    else if (local(last + 1) < length) last++;
    else break;
  }
  return { first, last };
}

/** Count playable occurrences without visiting silent cycles or allocating events. */
export function expansionError(project: Project, includeMuted = true, overlay?: ExpansionTimingOverlay): string | undefined {
  const patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]));
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const solo = project.tracks.some(track => track.solo);
  let total = 0;
  for (const region of project.regions) {
    const pattern = patterns.get(region.patternId), track = tracks.get(region.trackId);
    if (!pattern || !track || !includeMuted && (track.muted || solo && !track.solo)) continue;
    const length = region.id === overlay?.regionId && overlay.regionLength !== undefined ? overlay.regionLength : region.length;
    const sourceLength = pattern.id === overlay?.patternId && overlay.patternLength !== undefined ? overlay.patternLength : pattern.length;
    if (!finite(length, 1) || !finite(region.offset) || !finite(sourceLength, 1)) return '片段长度、源长度或偏移超过工程范围。';
    const period = Math.max(1, sourceLength);
    for (const note of pattern.notes) {
      const tick = pattern.id === overlay?.patternId && overlay.noteTick !== undefined && overlay.noteIds?.has(note.id) ? overlay.noteTick : note.tick;
      if (!finite(tick)) return '音符开始时间超过工程范围。';
      if (region.loop) {
        const { first, last } = loopNoteCycles(tick, period, region.offset, length);
        total += Math.max(0, last - first + 1);
      } else if (tick - region.offset >= 0 && tick - region.offset < length) total++;
      if (total > MAX_EVENTS) return '展开后的音符超过 200 万个，请缩短循环范围。';
    }
  }
  return undefined;
}
