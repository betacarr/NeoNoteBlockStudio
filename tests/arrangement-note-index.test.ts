import { describe, expect, it } from 'vitest';
import type { Note, Region } from '../src/core/types';
import type { PreviewWindow } from '../src/ui/arrangement-preview';
import { ArrangementNoteIndex, type ArrangementNoteQueryStats } from '../src/ui/arrangement-note-index';

type PreviewRegion = Pick<Region, 'offset' | 'length' | 'loop'>;
const note = (id: string, tick: number, duration = 0, midi = 60): Note => ({ id, tick, duration, midi, velocity: .625, pan: -.25, detune: 7.5, height: 1.25 });
const stats = (): ArrangementNoteQueryStats => ({ visitedNodes: 999999, testedNotes: 999999, candidates: 999999 });

/** Literal forward onset/pixel arithmetic and exhaustive small cycle window;
 * no production index, cycle-range helper or preview geometry supplies expected IDs.
 */
function naiveVisible(notes: readonly Note[], period: number, region: PreviewRegion, view: PreviewWindow): Note[] {
  const pixels = view.regionWidth / region.length;
  return notes.filter(source => {
    for (let cycle = 0; cycle < (region.loop ? 256 : 1); cycle++) {
      const local = source.tick + cycle * period - region.offset;
      if (local < 0 || local >= region.length) continue;
      const start = local * pixels, width = Math.max(2, source.duration * pixels);
      const left = Math.max(0, start - view.offset), right = Math.min(view.width, start + width - view.offset);
      if (right > left) return true;
    }
    return false;
  });
}
function expectCandidates(index: ArrangementNoteIndex, region: PreviewRegion, view: PreviewWindow, expected: readonly Note[], work?: ArrangementNoteQueryStats): Note[] {
  const result = index.candidates(region, view, work), positions = new Map(index.notes.map((source, order) => [source, order]));
  const orders = result.map(source => positions.get(source));
  expect(orders.every(order => order !== undefined)).toBe(true);
  expect(orders).toEqual([...new Set(orders)].sort((left, right) => left! - right!));
  for (const source of expected) expect(result.includes(source), `Missing visible source ${source.id}`).toBe(true);
  if (work) expect(work.candidates).toBe(result.length);
  return result;
}
function seededRandom(seed: number) {
  let state = seed;
  return (bound: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % bound; };
}

describe('arrangement source-note candidates', () => {
  it('has useful empty metadata and clears counters for empty or invalid windows', () => {
    const source: readonly Note[] = Object.freeze([]), index = new ArrangementNoteIndex(source, 100), work = stats();
    expect(index.notes).toBe(source); expect(index.period).toBe(100);
    expect([index.lowPitch, index.highPitch]).toEqual([60, 60]);
    expect(index.candidates({ offset: 0, length: 100, loop: true }, { offset: 0, width: 100, regionWidth: 100 }, work)).toEqual([]);
    expect(work).toEqual({ visitedNodes: 0, testedNotes: 0, candidates: 0 });
    const nonempty = new ArrangementNoteIndex([note('a', 0)], 100);
    for (const view of [{ offset: 0, width: 0, regionWidth: 100 }, { offset: 0, width: 100, regionWidth: 0 }, { offset: NaN, width: 100, regionWidth: 100 }]) {
      expect(nonempty.candidates({ offset: 0, length: 100, loop: false }, view, work)).toEqual([]);
      expect(work).toEqual({ visitedNodes: 0, testedNotes: 0, candidates: 0 });
    }
  });

  it('finds long left-crossing non-loop bodies and the dynamic two-pixel minimum in original order', () => {
    const source = [note('later', 550, 20), note('long', 100, 450), note('minimum', 398.5), note('outside', 20, 1)];
    const region = { offset: 0, length: 1000, loop: false }, view = { offset: 400, width: 100, regionWidth: 1000 };
    const index = new ArrangementNoteIndex(source, 1000), result = expectCandidates(index, region, view, [source[1], source[2]]);
    expect(result).toEqual([source[1], source[2]]);
    expect(index.candidates(region, { ...view, regionWidth: 2000, offset: 800 }).includes(source[2])).toBe(false);
  });

  it('supports negative effective non-loop offsets during left-prepend previews', () => {
    const source = [note('middle', 50, 20), note('original-start', 0), note('far', 500)];
    const region = { offset: -100, length: 200, loop: false }, view = { offset: 90, width: 20, regionWidth: 200 };
    const result = expectCandidates(new ArrangementNoteIndex(source, 100), region, view, [source[1]]);
    expect(result).toEqual([source[1]]);
    expect(source[1].tick).toBe(0); expect(region.offset).toBe(-100);
  });

  it('retains long ink beyond the last valid onset while excluding cropped-out onsets', () => {
    const source = [note('valid-long-tail', 0, 50), note('outside-onset', 10, 50)];
    const region = { offset: 0, length: 10, loop: false }, view = { offset: 20, width: 10, regionWidth: 10 };
    expect(expectCandidates(new ArrangementNoteIndex(source, 100), region, view, [source[0]])).toEqual([source[0]]);
  });

  it('folds wrapped phase windows and includes tails crossing the phase seam', () => {
    const source = [note('seam-tail', 90, 30), note('near-start', 0), note('after-window', 40), note('left-edge-tail', 3, 5)];
    const index = new ArrangementNoteIndex(source, 100), region = { offset: 0, length: 400, loop: true };
    for (const view of [{ offset: 105, width: 5, regionWidth: 400 }, { offset: 95, width: 10, regionWidth: 400 }, { offset: 398, width: 4, regionWidth: 400 }]) {
      expectCandidates(index, region, view, naiveVisible(source, 100, region, view));
    }
    expect(index.candidates(region, { offset: 105, width: 5, regionWidth: 400 })).toContain(source[0]);
  });

  it('keeps whole-period offsets and legacy cycle-zero notes while rejecting future originals', () => {
    const source = [note('legacy-cycle-zero', 500), note('ordinary', 0), note('future-original', 600), note('wrong-phase', 250)];
    const index = new ArrangementNoteIndex(source, 100), region = { offset: 500, length: 100, loop: true }, view = { offset: 0, width: 10, regionWidth: 100 };
    expect(expectCandidates(index, region, view, source.slice(0, 2))).toEqual(source.slice(0, 2));
    expect(index.candidates({ ...region, offset: 0 }, view)).toEqual([source[1]]);
  });

  it('rejects a phase tail whose only preceding onset was cropped out of the region', () => {
    const source = [note('pre-region-long', 0, 1000), note('actual-onset', 50)];
    const region = { offset: 50, length: 1, loop: true }, view = { offset: 0, width: 100, regionWidth: 100 };
    expect(expectCandidates(new ArrangementNoteIndex(source, 100), region, view, [source[1]])).toEqual([source[1]]);
  });

  it('preserves the literal 1e12-scale decimal last cycle and exact original source reference', () => {
    const source = [note('literal-last-cycle', 999999999999.9, 0, 127)];
    const region = { offset: 999999999999.9, length: 1.1, loop: true }, view = { offset: 109.9, width: .1, regionWidth: 110 };
    const start = (source[0].tick + 1 * 1.1 - region.offset) * (view.regionWidth / region.length);
    expect(start).toBe(109.99755859374999);
    expect(start).toBeLessThan(view.offset + view.width);
    expect(expectCandidates(new ArrangementNoteIndex(source, 1.1), region, view, source)[0]).toBe(source[0]);
  });

  it('supports 1e12 whole-period offsets and maximum legal note tails without integer truncation', () => {
    const source = [note('ordinary', 0, 0, 0), note('legacy', 1e12, 1e12, 127)];
    const index = new ArrangementNoteIndex(source, 1), region = { offset: 1e12, length: 1, loop: true }, view = { offset: 0, width: 100, regionWidth: 100 };
    expect(expectCandidates(index, region, view, source)).toEqual(source);
    const large = new ArrangementNoteIndex(source, 1e12), longRegion = { offset: 1e12, length: 1e12, loop: true };
    expectCandidates(large, longRegion, { offset: 5e11, width: 100, regionWidth: 1e12 }, [source[1]]);
    expect([large.lowPitch, large.highPitch]).toEqual([0, 127]);
  });

  it('returns complete eligible candidates when a viewport or two-pixel body covers a period', () => {
    const source = [note('b', 80), note('a', 0), note('c', 40), note('future', 500)];
    const index = new ArrangementNoteIndex(source, 100), region = { offset: 0, length: 100, loop: true };
    expect(index.candidates(region, { offset: 0, width: 100, regionWidth: 100 })).toEqual(source.slice(0, 3));
    // The 80-tick original starts at .8px, after this .5..6px view; a wide
    // minimum body extends right only and must not invent a negative cycle.
    expect(index.candidates(region, { offset: .5, width: .1, regionWidth: 1 })).toEqual([source[1], source[2]]);
  });

  it('matches an independent exhaustive cycle/pixel oracle for 300 deterministic small windows', () => {
    const random = seededRandom(0x24a45109), periods = [1, 1.1, 2.2, 3.3, 25, 100];
    for (let trial = 0; trial < 300; trial++) {
      const period = periods[random(periods.length)];
      const source = Array.from({ length: 36 }, (_, order) => note(`source-${trial}-${order}`, random(40) * period / 8, random(200) * period / 16, random(128)));
      const region = { offset: random(80) * period / 4, length: (1 + random(80)) * period / 4, loop: random(4) !== 0 };
      if (!region.loop && trial % 3 === 0) region.offset *= -1;
      const regionWidth = 5 + random(4000), view = { offset: random(regionWidth + 100) - 50, width: .125 + random(500), regionWidth };
      const before = structuredClone(source), index = new ArrangementNoteIndex(source, period);
      expectCandidates(index, region, view, naiveVisible(source, period, region, view));
      expect(source).toEqual(before);
    }
  });

  it('covers original-scale modulo and cancellation error with independent 1e12-neighbourhood cycle probes', () => {
    const random = seededRandom(0x94b5a0e1);
    for (const period of [1, 1.1, 1.2, 2.2, 3.3]) for (let trial = 0; trial < 20; trial++) {
      const source = Array.from({ length: 24 }, (_, order) => note(`large-${order}`, 1e12 - random(800) / 8, random(20) / 8, random(128)));
      const region = { offset: 1e12 - 50, length: 1 + random(160) / 8, loop: true };
      const regionWidth = region.length * 100, view = { offset: random(Math.floor(regionWidth)), width: .01 + random(50) / 8, regionWidth };
      expectCandidates(new ArrangementNoteIndex(source, period), region, view, naiveVisible(source, period, region, view));
    }
  });

  it('does not mutate or clone returned source notes, including all optional metadata', () => {
    const source = [note('last', 80, 30, 127), { ...note('first', 5, 10, 0), instrumentId: 'custom', midiSource: { onOrder: 7, offOrder: 9, releaseVelocity: 83, offSourceTrack: 4 } }];
    const before = structuredClone(source);
    for (const item of source) { Object.freeze(item.midiSource); Object.freeze(item); } Object.freeze(source);
    const index = new ArrangementNoteIndex(source, 100), region = { offset: 0, length: 100, loop: true };
    expect(index.notes).toBe(source);
    expectCandidates(index, region, { offset: 0, width: 100, regionWidth: 100 }, source);
    expectCandidates(index, { ...region, loop: false }, { offset: 0, width: 100, regionWidth: 100 }, source);
    expect(index.candidates(region, { offset: 5, width: 1, regionWidth: 100 })[0]).toBe(source[1]);
    expect(source).toEqual(before);
  });

  it('bounds warm non-loop and loop local queries on 100000 sources without per-query full reads', () => {
    let reads = 0, measuring = false;
    const source = Array.from({ length: 100000 }, (_, order) => {
      const tick = (99999 - order) * 1000, item = note(`dense-${order}`, tick, 1, order % 128);
      Object.defineProperty(item, 'tick', { enumerable: true, get: () => { if (measuring) reads++; return tick; } });
      return item;
    });
    const index = new ArrangementNoteIndex(source, 1e8), work = stats();
    const view = { offset: 5e7, width: 2000, regionWidth: 1e8 };
    for (const loop of [false, true]) {
      const region = { offset: 0, length: 1e8, loop };
      index.candidates(region, view); // Construct only the index used by this mode.
      reads = 0; measuring = true;
      const result = index.candidates(region, view, work); measuring = false;
      expect(reads).toBeLessThan(100);
      expect(work.testedNotes).toBeLessThan(16); expect(work.visitedNodes).toBeLessThan(5000);
      expect(work.candidates).toBe(result.length);
      expectCandidates(index, region, view, source.filter(item => item.tick >= 5e7 && item.tick < 5e7 + 2000));
    }
  });

  it('prunes 100000 same-phase future originals in both the local and full-period paths', () => {
    const source = Array.from({ length: 100000 }, (_, order) => note(`legacy-${order}`, (99999 - order) * 100));
    const index = new ArrangementNoteIndex(source, 100), work = stats(), region = { offset: 0, length: 100, loop: true };
    const views = [{ offset: 0, width: 1, regionWidth: 1000 }, { offset: 0, width: 100, regionWidth: 100 }, { offset: 0, width: .1, regionWidth: 1 }];
    for (const view of views) {
      index.candidates(region, view); // Lazy construction is separate from query counters.
      expect(index.candidates(region, view, work)).toEqual([source.at(-1)]);
      expect(work.candidates).toBe(1); expect(work.testedNotes).toBeLessThan(5); expect(work.visitedNodes).toBeLessThan(200);
      const first = { ...work }; index.candidates(region, view, work); expect(work).toEqual(first);
    }
  });
});
