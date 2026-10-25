import { describe, expect, it } from 'vitest';
import type { Note, Pattern, Region } from '../src/core/types';
import { regionPreviewGeometry, type PreviewStroke, type PreviewWindow } from '../src/ui/arrangement-preview';
import { ArrangementNoteIndex, type ArrangementNoteQueryStats } from '../src/ui/arrangement-note-index';

type Source = Pick<Pattern, 'length' | 'notes'>;
type Clip = Pick<Region, 'offset' | 'length' | 'loop'>;
const note = (id: string, tick: number, duration = 0, midi = 66): Note => ({ id, tick, duration, midi, velocity: .75, pan: -.125, height: .5, detune: -7.25 });
const smallCycles = Array.from({ length: 256 }, (_, cycle) => cycle);

// Independent cycle-major enumeration of small, explicitly bounded fixtures.
// No production range, index, flattenNotes or geometry function supplies the
// expected onsets, two-pixel ink, clipping or union.
function bruteInk(source: Source, region: Clip, view: PreviewWindow, cycles = smallCycles): PreviewStroke[] {
  const output: PreviewStroke[] = [], scale = view.regionWidth / region.length;
  for (const cycle of region.loop ? cycles : [0]) {
    for (const item of source.notes) {
      const local = item.tick + cycle * Math.max(1, source.length) - region.offset;
      if (local < 0 || local >= region.length) continue;
      const pixel = local * scale, left = Math.max(0, pixel - view.offset);
      const right = Math.min(view.width, pixel + Math.max(2, item.duration * scale) - view.offset);
      if (right > left) output.push({ x: left, width: right - left, midi: item.midi });
    }
  }
  return output;
}
function inkUnion(strokes: readonly PreviewStroke[]): number[][] {
  const rows = new Map<number, [number, number][]>();
  for (const stroke of strokes) {
    const row = rows.get(stroke.midi) ?? [];
    row.push([stroke.x, stroke.x + stroke.width]); rows.set(stroke.midi, row);
  }
  const output: number[][] = [];
  for (const [midi, row] of [...rows].sort((left, right) => left[0] - right[0])) {
    row.sort((left, right) => left[0] - right[0]);
    const merged: [number, number][] = [];
    for (const span of row) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    for (const [left, right] of merged) output.push([midi, left, right]);
  }
  return output;
}
function compare(source: Source, region: Clip, view: PreviewWindow, cycles?: number[]) {
  const before = structuredClone({ source, region, view });
  const expected = inkUnion(bruteInk(source, region, view, cycles));
  const plain = regionPreviewGeometry(source, region, view);
  const indexed = regionPreviewGeometry(source, region, view, new ArrangementNoteIndex(source.notes, source.length));
  for (const geometry of [plain, indexed]) {
    const actual = inkUnion(geometry.notes);
    expect(actual).toHaveLength(expected.length);
    for (let index = 0; index < expected.length; index++) {
      expect(actual[index][0]).toBe(expected[index][0]);
      expect(actual[index][1]).toBeCloseTo(expected[index][1], 9);
      expect(actual[index][2]).toBeCloseTo(expected[index][2], 9);
    }
    expect(geometry.notes.every(stroke => stroke.x >= 0 && stroke.width > 0 && stroke.x + stroke.width <= view.width + 1e-9)).toBe(true);
  }
  expect(indexed).toEqual(plain);
  expect({ source, region, view }).toEqual(before);
  return indexed;
}

describe('indexed arrangement thumbnail ink', () => {
  it('keeps whole-period offsets and legacy source ticks at or beyond the period, including cycle zero', () => {
    const source = { length: 10, notes: [note('ordinary', 0, .5), note('cycle-zero', 20, 0, 70), note('half-open-end', 25, 10, 72), note('far-future', 100, 0, 74)] };
    const actual = compare(source, { offset: 20, length: 5, loop: true }, { offset: 0, width: 100, regionWidth: 100 });
    expect(actual.notes.map(stroke => stroke.midi)).toEqual([66, 70]);
    expect(actual.notes.map(stroke => stroke.x)).toEqual([0, 0]);
  });

  it('includes long left-crossing tails and zero-duration two-pixel ink but excludes cropped onsets before the region', () => {
    const source = { length: 100, notes: [note('long', 10, 80), note('zero-left', 49, 0, 67), note('inside', 60, 4, 68), note('cropped-onset', 0, 100, 69)] };
    const actual = compare(source, { offset: 5, length: 90, loop: false }, { offset: 44, width: 20, regionWidth: 90 });
    expect(actual.notes.map(stroke => stroke.midi)).toEqual([66, 67, 68]);
    expect(actual.notes[0]).toEqual({ x: 0, width: 20, midi: 66 });
    expect(actual.notes[1]).toEqual({ x: 0, width: 2, midi: 67 });
  });

  it.each([-3.5, 3.5])('preserves non-loop offset %s, including virtual left-prepend silence', offset => {
    compare({ length: 20, notes: [note('a', 0, 12), note('b', 2, 0, 67), note('c', 10, 3, 68)] },
      { offset, length: 14, loop: false }, { offset: 0, width: 140, regionWidth: 140 });
  });

  it('unions dense subpixel repetitions without losing visible ink', () => {
    const source = { length: 1, notes: [note('tiny', 0, 0), note('long', .25, 4, 70)] };
    const actual = compare(source, { offset: 3.3, length: 200, loop: true }, { offset: 5, width: 10, regionWidth: 20 });
    expect(actual.notes).toHaveLength(2);
    expect(inkUnion(actual.notes)).toEqual([[66, 0, 10], [70, 0, 10]]);
  });

  it('uses actual half-open floating-point onsets at a 1e12 source coordinate', () => {
    const tick = 999999999999.9, source = { length: 1.1, notes: [note('rounding-edge', tick)] };
    const actual = compare(source, { offset: tick, length: 1.1, loop: true }, { offset: 0, width: 110, regionWidth: 110 }, [0, 1, 2, 3]);
    expect(actual.notes).toHaveLength(2);
    expect(actual.notes[1].x).toBeCloseTo(109.99755859375, 9);
    expect(actual.notes[1].width).toBeGreaterThan(0);
    expect(actual.notes[1].width).toBeLessThan(.003);
  });

  it('does not fill a real rounded gap when nominal repeated spacing equals the minimum ink width', () => {
    const tick = 999999999999.9, source = { length: 1.1, notes: [note('almost-touching', tick)] };
    const actual = compare(source, { offset: tick, length: 4.4, loop: true }, { offset: 0, width: 8, regionWidth: 8 }, [0, 1, 2, 3, 4, 5]);
    expect(inkUnion(actual.notes)).toHaveLength(2);
  });

  it('keeps literal 1e12 offsets and a distant 1e12-tick loop window bounded', () => {
    compare({ length: 1, notes: [note('ordinary', 0), note('legacy-cycle-zero', 1e12, 0, 70)] },
      { offset: 1e12, length: 1, loop: true }, { offset: 0, width: 100, regionWidth: 100 }, [0, 1, 1e12 - 1, 1e12, 1e12 + 1]);
    // Only these explicitly known cycles can reach the final eight-pixel window.
    // No production helper chooses the brute oracle's cycle ranges.
    const cycles = [...Array.from({ length: 15 }, (_, index) => 1e12 - 12 + index), ...Array.from({ length: 15 }, (_, index) => 2e12 - 12 + index)];
    const actual = compare({ length: 1, notes: [note('ordinary', 0), note('legacy-cycle-zero', 1e12, 4, 70)] },
      { offset: 1e12, length: 1e12, loop: true }, { offset: 1e12 - 8, width: 8, regionWidth: 1e12 }, cycles);
    expect(inkUnion(actual.notes)).toEqual([[66, 0, 8], [70, 0, 8]]);
    expect(actual.notes).toHaveLength(2);
    expect(actual.dividers.length).toBeLessThanOrEqual(3);
  });

  it('matches independent cycle-major ink unions for 180 decimal and binary source/window fixtures', () => {
    let seed = 0xa4319e27;
    const random = (bound: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound; };
    for (let index = 0; index < 180; index++) {
      const period = [1, 1.1, 1.25, 2.2, 3.3, 7, 12][random(7)];
      const source = { length: period, notes: Array.from({ length: random(10) }, (_, entry) => note(`note-${entry}`, random(80) / 4 + [.1, .3, 0][random(3)], random(100) / 4, 60 + random(7))) };
      const loop = index % 3 !== 0;
      const region = { offset: loop ? random(8) * period + [.1, .3, 0][random(3)] : random(48) / 4 - 4, length: 1 + random(100) / 4, loop };
      const regionWidth = 2 + random(400), width = Math.min(regionWidth, 1 + random(180)), offset = random(101) / 100 * (regionWidth - width);
      compare(source, region, { offset, width, regionWidth });
    }
  });

  it('uses the supplied cached index instead of rescanning 100k source entries on a localized frame', () => {
    const notes = Array.from({ length: 100000 }, (_, index) => note(`large-${index}`, index * 12, 1, 60 + index % 12));
    let reads = 0;
    const sourceNotes = new Proxy(notes, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    const source = { length: 1200000, notes: sourceNotes }, region = { offset: 0, length: 1200000, loop: false };
    const view = { offset: 600000, width: 120, regionWidth: 1200000 }, index = new ArrangementNoteIndex(sourceNotes, source.length);
    // Lazy index construction is a one-time cache cost, outside pointer frames.
    index.candidates(region, view); reads = 0;
    const stats: ArrangementNoteQueryStats = { visitedNodes: 0, testedNotes: 0, candidates: 0 };
    const result = regionPreviewGeometry(source, region, view, index, stats);
    const frameReads = reads;
    expect(inkUnion(result.notes)).toEqual(inkUnion(bruteInk({ length: source.length, notes }, region, view)));
    expect(result.notes).toHaveLength(10);
    expect(stats.candidates).toBeLessThanOrEqual(12);
    expect(stats.testedNotes).toBeLessThan(1000);
    expect(frameReads).toBeLessThan(1000);
    console.info(JSON.stringify({ scope: 'Offline cached geometry work counters, not UI FPS.', sourceNotes: notes.length, frameSourceReads: frameReads, ...stats, emittedStrokes: result.notes.length }));
  });
});
