import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/types';
import { noteAt, notesAlongStroke } from '../src/ui/piano-hit-test';
import { PianoNoteIndex, type PianoNoteQuery, type PianoNoteQueryStats } from '../src/ui/piano-note-index';

const note = (id: string, tick: number, duration = 1, midi = 60): Note => ({
  id, tick, duration, midi, velocity: .75, pan: -.125, detune: 1.5, height: .25,
  midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 47, offSourceTrack: 1 },
});
const stats = (): PianoNoteQueryStats => ({ visitedNodes: 999999, testedNotes: 999999 });
const naive = (notes: readonly Note[], query: PianoNoteQuery) => notes.filter(item =>
  item.tick <= query.end && item.tick + Math.max(item.duration, query.minimumDuration ?? 0) >= query.start
  && item.midi >= (query.low ?? 0) && item.midi <= (query.high ?? 127));
const refsEqual = (actual: readonly Note[], expected: readonly Note[]) => {
  expect(actual.map(item => item.id)).toEqual(expected.map(item => item.id));
  actual.forEach((item, index) => expect(item).toBe(expected[index]));
};
function seededRandom(seed: number) {
  let state = seed;
  return (bound: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % bound; };
}

describe('immutable piano note index', () => {
  it('has useful empty metadata and returns empty results with fresh statistics', () => {
    const source: readonly Note[] = Object.freeze([]), index = new PianoNoteIndex(source), work = stats();
    expect(index.notes).toBe(source);
    expect([index.minTick, index.maxEnd, index.lowPitch, index.highPitch]).toEqual([0, 0, 60, 60]);
    expect(index.query({ start: 0, end: 100 }, work)).toEqual([]);
    expect(work).toEqual({ visitedNodes: 0, testedNotes: 0 });
    expect(index.starts(0, 100, work)).toEqual([]);
    expect(work).toEqual({ visitedNodes: 0, testedNotes: 0 });
    expect(index.forIds(new Set(['missing']))).toEqual([]);
    expect(index.orderOf('missing')).toBe(-1);
  });

  it('returns unsorted overlapping notes in source order, preserving topmost hits and stroke order', () => {
    const source = [note('painted-first', 5, 10), note('painted-last', 4, 20), note('other-row', 6, 10, 61)];
    const index = new PianoNoteIndex(source), visible = index.query({ start: 7, end: 8, low: 60, high: 60 });
    refsEqual(visible, source.slice(0, 2));
    const rect = (item: Note) => ({ x: item.tick, y: 0, width: item.duration, height: 1 });
    expect(noteAt(visible, 7, .5, rect)).toBe(source[1]);
    refsEqual(notesAlongStroke(visible, { x: 7, y: .5 }, { x: 8, y: .5 }, rect,
      { x: 0, y: 0, width: 100, height: 1 }, new Set()), source.slice(0, 2));
    refsEqual(index.query({ start: 4, end: 30 }), source);
    expect(source.map(item => item.id)).toEqual(['painted-first', 'painted-last', 'other-row']);
    const tied = [note('unison-first', 10, 5), note('unison-last', 10, 5)];
    const unisons = new PianoNoteIndex(tied).query({ start: 10, end: 15 });
    refsEqual(unisons, tied);
    expect(noteAt(unisons, 12, .5, rect)).toBe(tied[1]);
  });

  it('includes tails from arbitrarily early starts rather than only searching the onset window', () => {
    const source = [note('old-short', 0, 1), note('long-tail', 0, 1e12), note('inside', 5e8, 0), note('future', 5e8 + 100, 1)];
    const index = new PianoNoteIndex(source);
    refsEqual(index.query({ start: 5e8, end: 5e8 + 10 }), [source[1], source[2]]);
    refsEqual(index.starts(5e8, 5e8 + 10), [source[2]]);
  });

  it('uses a dynamic minimum duration for zero-length and shorter visual note bodies', () => {
    const source = [note('zero', 6, 0), note('short', 8, .25), note('real-tail', 0, 10), note('too-old', 5.999, 0)];
    const index = new PianoNoteIndex(source);
    refsEqual(index.query({ start: 10, end: 10 }), [source[2]]);
    refsEqual(index.query({ start: 10, end: 10, minimumDuration: 4 }), [source[0], source[1], source[2]]);
    refsEqual(index.query({ start: 10, end: 10, minimumDuration: 0 }), [source[2]]);
    refsEqual(index.query({ start: 10, end: 10, minimumDuration: 5 }), source);
  });

  it('uses closed intersections at fractional starts and ends, including zero-length onsets', () => {
    const source = [note('ending-here', 1.25, 4), note('zero-here', 5.25, 0), note('after', 5.2500000001, 0), note('before', 0, 5.2499999999)];
    const index = new PianoNoteIndex(source);
    refsEqual(index.query({ start: 5.25, end: 5.25 }), source.slice(0, 2));
    refsEqual(index.starts(5.25, 5.25), [source[1]]);
  });

  it('handles every legal MIDI pitch and fractional or out-of-range pitch windows', () => {
    const source = Array.from({ length: 128 }, (_, index) => note(`pitch-${127 - index}`, 1, 2, 127 - index));
    const index = new PianoNoteIndex(source);
    expect([index.lowPitch, index.highPitch]).toEqual([0, 127]);
    for (let pitch = 0; pitch < 128; pitch++) refsEqual(index.query({ start: 1, end: 1, low: pitch, high: pitch }), [source[127 - pitch]]);
    refsEqual(index.query({ start: 1, end: 1, low: .1, high: 126.9 }), source.slice(1, -1));
    refsEqual(index.query({ start: 1, end: 1, low: -100, high: 1000 }), source);
    for (const query of [{ start: 4, end: 3 }, { start: NaN, end: 3 }, { start: 0, end: NaN },
      { start: 0, end: 3, low: 128 }, { start: 0, end: 3, high: -1 }, { start: 0, end: 3, low: 70, high: 60 }]) {
      expect(index.query(query)).toEqual([]);
    }
  });

  it('keeps onset-only windows closed and restores source order for velocity and hover', () => {
    const source = [note('right-edge', 10.125), note('long-body-only', 0, 100), note('left-edge', 9.875), note('center-a', 10), note('center-b', 10), note('outside', 10.126)];
    const index = new PianoNoteIndex(source), work = stats();
    refsEqual(index.starts(10 - .125, 10 + .125, work), [source[0], source[2], source[3], source[4]]);
    expect(work.testedNotes).toBe(4);
    refsEqual(index.starts(10, 10), [source[3], source[4]]);
    expect(index.starts(11, 10, work)).toEqual([]);
    expect(work).toEqual({ visitedNodes: 0, testedNotes: 0 });
    refsEqual(index.starts(-Infinity, Infinity), source);
  });

  it('resolves selected IDs by map lookup without scanning the source on each request', () => {
    const source = Array.from({ length: 1000 }, (_, index) => note(`id-${index}`, 1000 - index));
    let sourceReads = 0;
    const observed = new Proxy(source, { get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) sourceReads++;
      return Reflect.get(target, property, receiver);
    } });
    const index = new PianoNoteIndex(observed); sourceReads = 0;
    refsEqual(index.forIds(new Set(['id-900', 'missing', 'id-2', 'id-500'])), [source[2], source[500], source[900]]);
    expect(sourceReads).toBe(3);
    expect(index.orderOf('id-900')).toBe(900);
    expect(index.orderOf('missing')).toBe(-1);
    expect(index.forIds(new Set())).toEqual([]);
  });

  it('accepts frozen sources and full legal tick-plus-duration coordinates without truncation', () => {
    const source = [note('maximum-tail', 1e12, 1e12, 127), note('fraction', .125, .0625, 0), note('middle', 4.5, 0, 64)];
    const before = structuredClone(source);
    for (const item of source) { Object.freeze(item.midiSource); Object.freeze(item); }
    Object.freeze(source);
    const index = new PianoNoteIndex(source);
    expect(index.notes).toBe(source);
    expect([index.minTick, index.maxEnd, index.lowPitch, index.highPitch]).toEqual([.125, 2e12, 0, 127]);
    refsEqual(index.query({ start: 2e12, end: 2e12 }), [source[0]]);
    expect(index.query({ start: 2e12 + 1, end: 2e12 + 2 })).toEqual([]);
    refsEqual(index.forIds(new Set(source.map(item => item.id).reverse())), source);
    expect(source).toEqual(before);
  });

  it('matches independent naive filtering for 400 deterministic mixed windows on an unsorted source', () => {
    const random = seededRandom(0x9140bc51);
    const source = Array.from({ length: 2048 }, (_, index) => ({
      ...note(`random-${index}`, random(80000) / 8, index % 17 === 0 ? 50000 : random(4000) / 8, random(128)),
      ...(index % 11 === 0 ? { instrumentId: 'custom-preserved' } : {}),
    }));
    const before = structuredClone(source), index = new PianoNoteIndex(source);
    for (let trial = 0; trial < 400; trial++) {
      const start = random(100000) / 8 - 1000, end = start + random(3000) / 8;
      const low = random(128), high = low + random(129 - low);
      const query = { start, end, low: low - .25, high: high + .25, minimumDuration: [0, .125, 4, 1024][random(4)] };
      refsEqual(index.query(query), naive(source, query));
      refsEqual(index.starts(start, end), source.filter(item => item.tick >= start && item.tick <= end));
      const ids = new Set([source[random(source.length)].id, source[random(source.length)].id, 'stale']);
      refsEqual(index.forIds(ids), source.filter(item => ids.has(item.id)));
    }
    expect(source).toEqual(before);
  });

  it('prunes a localized 100000-note window while retaining one very old long note', () => {
    const source = Array.from({ length: 100000 }, (_, index) => note(`large-${index}`, (99999 - index) * 1000, 1, 64));
    source[99999] = note('old-long-note', 0, 1e12, 64);
    const index = new PianoNoteIndex(source), work = stats(), query = { start: 50000000, end: 50002000, low: 64, high: 64, minimumDuration: 6 };
    refsEqual(index.query(query, work), naive(source, query));
    expect(work.testedNotes).toBe(4);
    expect(work.visitedNodes).toBeLessThan(160);
    const firstWork = { ...work };
    refsEqual(index.query(query, work), naive(source, query));
    expect(work).toEqual(firstWork); // Work counters describe this call, not accumulated history.
    refsEqual(index.starts(query.start, query.end, work), source.filter(item => item.tick >= query.start && item.tick <= query.end));
    expect(work.testedNotes).toBe(3);
    expect(work.visitedNodes).toBeLessThan(40);
  });

  it('bounds localized work across all 128 pitches in a 100000-note unsorted source', () => {
    const source = Array.from({ length: 100000 }, (_, index) => {
      const position = index * 7919 % 100000;
      return note(`spread-${index}`, position * 1000, 1, position % 128);
    });
    const index = new PianoNoteIndex(source), work = stats(), query = { start: 50000000, end: 50002000 };
    refsEqual(index.query(query, work), naive(source, query));
    expect(work.testedNotes).toBe(3);
    expect(work.visitedNodes).toBeLessThan(5000);
    refsEqual(index.starts(query.start, query.end, work), source.filter(item => item.tick >= query.start && item.tick <= query.end));
    expect(work.testedNotes).toBe(3);
    expect(work.visitedNodes).toBeLessThan(40);
  });
});
