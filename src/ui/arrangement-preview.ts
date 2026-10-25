import type { Pattern, Region } from '../core/types';
import { loopNoteCycles } from '../core/expansion';
import type { ArrangementNoteIndex, ArrangementNoteQueryStats } from './arrangement-note-index';

export interface PreviewWindow { offset: number; width: number; regionWidth: number }
export interface PreviewStroke { x: number; width: number; midi: number }

/** Clip source-note ink to a small canvas inside the visible part of a region. */
export function regionPreviewGeometry(pattern: Pick<Pattern, 'length' | 'notes'>, region: Pick<Region, 'offset' | 'length' | 'loop'>, view: PreviewWindow, index?: ArrangementNoteIndex, stats?: ArrangementNoteQueryStats): { notes: PreviewStroke[]; dividers: number[] } {
  const notes: PreviewStroke[] = [], dividers: number[] = [];
  if (stats) Object.assign(stats, { visitedNodes: 0, testedNotes: 0, candidates: 0 });
  if (view.width <= 0 || view.regionWidth <= 0 || region.length <= 0) return { notes, dividers };
  const pixels = view.regionWidth / region.length, period = Math.max(1, pattern.length), periodPixels = period * pixels;
  if (!(pixels > 0) || !Number.isFinite(pixels)) return { notes, dividers };
  const cycles = region.loop ? Math.ceil((region.length + region.offset) / period) : 1;
  const end = Math.min(region.length, (view.offset + view.width) / pixels);
  const add = (start: number, end: number, midi: number) => {
    const left = Math.max(0, start - view.offset), right = Math.min(view.width, end - view.offset);
    if (right > left) notes.push({ x: left, width: right - left, midi });
  };
  for (const note of index ? index.candidates(region, view, stats) : pattern.notes) {
    const width = Math.max(2, note.duration * pixels);
    if (!region.loop) {
      const tick = note.tick - region.offset;
      if (tick >= 0 && tick < region.length) add(tick * pixels, tick * pixels + width, note.midi);
      continue;
    }
    const range = loopNoteCycles(note.tick, period, region.offset, region.length);
    if (range.first > range.last) continue;
    const startAt = (cycle: number) => (note.tick + cycle * period - region.offset) * pixels;
    // Inverse quotients can round past a valid half-open onset, particularly
    // for legacy source ticks and offsets near 1e12. Search the actual monotone
    // forward pixel expression, without enumerating silent preceding cycles.
    const boundary = (predicate: (cycle: number) => boolean): number => {
      let low = range.first, high = range.last + 1;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (predicate(middle)) high = middle; else low = middle + 1;
      }
      return low;
    };
    const first = boundary(cycle => startAt(cycle) + width > view.offset);
    const last = boundary(cycle => startAt(cycle) >= view.offset + view.width) - 1;
    if (first > last) continue;
    const start = startAt(first);
    const rounding = 8 * Number.EPSILON * Math.max(1, Math.abs(note.tick), Math.abs(region.offset), Math.abs(first * period), Math.abs(last * period)) * pixels;
    if (periodPixels + rounding <= width) {
      // Repeated strokes overlap: their union preserves every visible position
      // without enumerating dense sub-pixel cycles. The actual final onset,
      // rather than an assumed constant pixel step, supplies the union end.
      add(start, startAt(last) + width, note.midi);
    } else for (let cycle = first; cycle <= last; cycle++) { const x = startAt(cycle); add(x, x + width, note.midi); }
  }
  if (region.loop) {
    const stride = Math.max(1, Math.ceil(4 / periodPixels));
    let first = Math.max(1, Math.ceil((view.offset / pixels + region.offset) / period));
    first += (stride - first % stride) % stride;
    const last = Math.min(cycles - 1, Math.floor((end + region.offset) / period));
    for (let cycle = first; cycle <= last; cycle += stride) dividers.push((cycle * period - region.offset) * pixels - view.offset);
  }
  return { notes, dividers };
}
