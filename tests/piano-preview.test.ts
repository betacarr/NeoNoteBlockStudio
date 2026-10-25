import { describe, expect, it } from 'vitest';
import { dragPlacedNote } from '../src/core/editor-interaction';
import type { Note, ShortcutPreset } from '../src/core/types';
import { PianoNoteIndex, type PianoNoteQuery } from '../src/ui/piano-note-index';
import { previewPianoNotes, type PianoPreviewActive, type PianoPreviewStats } from '../src/ui/piano-preview';

const note = (id: string, tick: number, midi = 66, duration = 120): Note => ({
  id, tick, midi, duration, velocity: .625, pan: -.125, height: .75, detune: 9.25,
  instrumentId: 'harp', midiSource: { onOrder: 2, offOrder: 7, releaseVelocity: 53, offSourceTrack: 3 },
});
const active = (kind: PianoPreviewActive['kind'], ids: readonly string[], patch: Partial<PianoPreviewActive> = {}): PianoPreviewActive => ({
  kind, ids: new Set(ids), deltaTick: 0, deltaPitch: 0, value: .375, ...patch,
});
interface View { width: number; height: number; scale: number; row: number; scrollX: number; scrollY: number }
const view: View = { width: 800, height: 400, scale: .25, row: 18, scrollX: 400, scrollY: (127 - 72) * 18 + 3 };
const queryFor = (v: View): PianoNoteQuery => ({
  start: v.scrollX / v.scale, end: (v.scrollX + v.width - 58) / v.scale,
  low: Math.max(0, Math.ceil(127 - (v.scrollY + v.height - 78 - 42) / v.row)),
  high: Math.min(127, Math.floor(128 - v.scrollY / v.row)), minimumDuration: 6 / v.scale,
});

// Independent full-array preview and actual pixel cull. Neither expected
// transformations nor visibility use the index or the production preview helper.
function naivePreview(notes: readonly Note[], gesture: PianoPreviewActive | null): Note[] {
  if (!gesture) return [...notes];
  const output: Note[] = [];
  for (const source of notes) {
    if (gesture.kind === 'erase' && gesture.ids.has(source.id)) continue;
    if (gesture.ids.has(source.id)) {
      if (gesture.kind === 'move') { output.push({ ...source, tick: source.tick + gesture.deltaTick, midi: source.midi + gesture.deltaPitch }); continue; }
      if (gesture.kind === 'resize') { output.push({ ...source, duration: Math.max(1, source.duration + gesture.deltaTick) }); continue; }
      if (gesture.kind === 'velocity') { output.push({ ...source, velocity: Math.max(0, Math.min(1, gesture.velocityMode === 'relative' ? source.velocity + gesture.value : gesture.value)) }); continue; }
    }
    output.push(source);
  }
  if (gesture.kind === 'draw' && gesture.addedPreview) output.push(gesture.addedPreview);
  return output;
}
function pixelCull(notes: readonly Note[], v: View, mode: 'body' | 'velocity'): Note[] {
  return notes.filter(source => {
    const x = 58 + source.tick * v.scale - v.scrollX;
    if (mode === 'velocity') return x >= 58 && x <= v.width;
    const width = Math.max(6, source.duration * v.scale), y = 42 + (127 - source.midi) * v.row - v.scrollY;
    return !(x + width < 58 || x > v.width || y + v.row < 42 || y > v.height - 78);
  });
}
function compare(notes: readonly Note[], gesture: PianoPreviewActive | null, v = view) {
  const base = new PianoNoteIndex(notes);
  const selected = gesture?.kind === 'move' || gesture?.kind === 'resize' ? new PianoNoteIndex(base.forIds(gesture.ids)) : undefined;
  const result: Record<'body' | 'velocity', Note[]> = { body: [], velocity: [] };
  for (const mode of ['body', 'velocity'] as const) {
    result[mode] = pixelCull(previewPianoNotes(base, selected, gesture, queryFor(v), mode), v, mode);
    expect(result[mode], mode + ' visible preview').toEqual(pixelCull(naivePreview(notes, gesture), v, mode));
  }
  return result;
}
const statistics = (): PianoPreviewStats => ({ visitedNodes: 0, testedNotes: 0, baseCandidates: 0, selectedCandidates: 0, transformedNotes: 0 });

describe('indexed piano drag preview', () => {
  it('retains a long left-crossing body and minimum-six-pixel zero-duration note while stems use onset and all pitches', () => {
    const notes = Object.freeze([note('long', 0, 66, 2000), note('zero', 1590, 67, 0), note('ordinary', 1800, 68), note('off-pitch-stem', 1900, 5)]);
    const before = structuredClone(notes), result = compare(notes, null);
    expect(result.body.map(item => item.id)).toEqual(['long', 'zero', 'ordinary']);
    expect(result.velocity.map(item => item.id)).toEqual(['ordinary', 'off-pitch-stem']);
    expect(notes).toEqual(before);
  });

  it.each([
    { tick: 600, midi: 30, deltaTick: 1200, deltaPitch: 34 },
    { tick: 8000, midi: 100, deltaTick: -6000, deltaPitch: -34 },
  ])('finds a selected note moved from offscreen time and pitch: %j', movement => {
    const notes = [note('entering', movement.tick, movement.midi), note('existing', 1900, 66), note('away', 20000, 2)];
    const result = compare(notes, active('move', ['entering'], movement));
    expect(result.body.map(item => item.id)).toContain('entering');
    expect(result.velocity.map(item => item.id)).toContain('entering');
  });

  it.each([800, -2000, 0])('preserves exact body and stem results when resize delta is %s, including duration clamping', deltaTick => {
    const notes = [note('left-grow', 1000, 66, 100), note('zero-at-edge', 1590, 67, 0), note('long', 1500, 68, 2000), note('inside', 2000, 69, 20), note('unselected', 1900, 64, 40)];
    const before = structuredClone(notes);
    compare(notes, active('resize', ['left-grow', 'zero-at-edge', 'long', 'inside'], { deltaTick }));
    expect(notes).toEqual(before);
  });

  it('includes zero-duration notes extended by the one-tick resize clamp when six pixels is less than one tick', () => {
    const zoomed = { ...view, scale: 12, scrollX: 19200 };
    const notes = [note('selected-zero', 1599.25, 66, 0), note('unchanged-zero', 1599.25, 66, 0)];
    for (const deltaTick of [0, -100]) {
      const result = compare(notes, active('resize', ['selected-zero'], { deltaTick }), zoomed);
      expect(result.body.map(item => item.id)).toEqual(['selected-zero']);
      expect(result.body[0].duration).toBe(1);
      expect(result.velocity).toEqual([]);
    }
  });

  it('keeps selected notes in original paint order instead of lifting all selected layers above unselected notes', () => {
    const notes = [note('selected-lower', 1800), note('unselected-upper', 1900), note('selected-tail', 2000)];
    const result = compare(notes, active('move', ['selected-tail', 'selected-lower'], { deltaTick: 100 }));
    expect(result.body.map(item => item.id)).toEqual(['selected-lower', 'unselected-upper', 'selected-tail']);
    expect(result.body[0].tick).toBe(result.body[1].tick);
  });

  it('erases selected visible layers and changes velocity only on selected candidates, including off-pitch stems', () => {
    const notes = [note('lower', 1800), note('upper', 1800), note('off-pitch', 1900, 0), note('distant', 10000)];
    const before = structuredClone(notes);
    const erased = compare(notes, active('erase', ['upper', 'distant']));
    expect(erased.body.map(item => item.id)).toEqual(['lower']);
    const changed = compare(notes, active('velocity', ['upper', 'off-pitch', 'distant'], { value: .125 }));
    expect(changed.body[0]).toBe(notes[0]);
    expect(changed.velocity.find(item => item.id === 'off-pitch')?.velocity).toBe(.125);
    expect(notes).toEqual(before);
  });

  it.each([
    { delta: .125, expected: [.25, .75, 1] },
    { delta: -.125, expected: [0, .5, .75] },
  ])('applies one pre-constrained relative delta $delta to body/stem candidates without flattening their differences', ({ delta, expected }) => {
    const notes = [{ ...note('lower', 1800), velocity: .125 }, { ...note('unselected', 1900), velocity: .5 }, { ...note('off-pitch', 2000, 0), velocity: .625 }, { ...note('distant-limit', 10000), velocity: .875 }];
    const before = structuredClone(notes), gesture = active('velocity', ['lower', 'off-pitch', 'distant-limit'], { value: delta, velocityMode: 'relative' });
    const result = compare(notes, gesture);
    expect(result.body.map(n => [n.id, n.velocity])).toEqual([['lower', expected[0]], ['unselected', .5]]);
    expect(result.velocity.map(n => [n.id, n.velocity])).toEqual([['lower', expected[0]], ['unselected', .5], ['off-pitch', expected[1]]]);
    expect(result.velocity[1]).toBe(notes[1]); expect(result.velocity[0].midiSource).toBe(notes[0].midiSource);
    expect(naivePreview(notes, gesture).at(-1)!.velocity).toBe(expected[2]); expect(notes).toEqual(before);
  });

  it('keeps the original note references for a stationary relative gesture and retains the absolute-mode default', () => {
    const notes = [{ ...note('first', 1800), velocity: .25 }, { ...note('second', 1900), velocity: .75 }], base = new PianoNoteIndex(notes);
    for (const mode of ['body', 'velocity'] as const) {
      const stats = statistics(), result = previewPianoNotes(base, undefined, active('velocity', ['first', 'second'], { value: 0, velocityMode: 'relative' }), queryFor(view), mode, stats);
      expect(result).toEqual(notes); expect(result[0]).toBe(notes[0]); expect(result[1]).toBe(notes[1]); expect(stats.transformedNotes).toBe(0);
      const legacy = previewPianoNotes(base, undefined, active('velocity', ['first', 'second'], { value: .5 }), queryFor(view), mode);
      const absolute = previewPianoNotes(base, undefined, active('velocity', ['first', 'second'], { value: .5, velocityMode: 'absolute' }), queryFor(view), mode);
      expect(legacy).toEqual(absolute); expect(legacy.map(n => n.velocity)).toEqual([.5, .5]);
    }
  });

  it('leaves all non-note drag modes unchanged and does not require a selection index for an empty move', () => {
    const notes = [note('left', 0, 66, 2000), note('inside', 1800), note('outside', 10000)];
    for (const kind of ['select', 'seek', 'pan', 'trim-start', 'trim-end', 'draw'] as const) compare(notes, active(kind, ['inside'], { deltaTick: 1200, deltaPitch: 12 }));
    expect(previewPianoNotes(new PianoNoteIndex(notes), undefined, active('move', []), queryFor(view), 'body')).toEqual(new PianoNoteIndex(notes).query(queryFor(view)));
    expect(() => previewPianoNotes(new PianoNoteIndex(notes), undefined, active('move', ['inside']), queryFor(view), 'body')).toThrow('cached selection index');
  });

  it.each(['fl', 'logic', 'nbs'] as ShortcutPreset[])('appends the caller-computed %s placement once as the final paint layer', preset => {
    const v = { ...view, scrollX: 0 }, original = note('new-placement', 100, 66, 20);
    const addedPreview = dragPlacedNote(original, preset, 30, 3, 180);
    expect(addedPreview).toEqual({ ...original, tick: preset === 'fl' ? 130 : 100, midi: preset === 'fl' ? 69 : 66, duration: preset === 'fl' ? 20 : 80 });
    const notes = [note('first', 100), note('overlapping', 130, 69)];
    const result = compare(notes, active('draw', [original.id], { deltaTick: 30, deltaPitch: 3, addedPreview }), v);
    expect(result.body.at(-1)).toBe(addedPreview); expect(result.velocity.at(-1)).toBe(addedPreview);
    expect(original).toEqual(note('new-placement', 100, 66, 20));
  });

  it('queries conservatively around rounded inverse movement at a closed viewport edge', () => {
    const notes = [note('decimal-edge', .3, 66, 0)], base = new PianoNoteIndex(notes), gesture = active('move', ['decimal-edge'], { deltaTick: .6 });
    const query = { start: 0, end: .8999999999999999, low: 66, high: 66, minimumDuration: 6 };
    expect(query.end - gesture.deltaTick).toBeLessThan(notes[0].tick);
    const selected = new PianoNoteIndex(notes);
    for (const mode of ['body', 'velocity'] as const) {
      expect(previewPianoNotes(base, selected, gesture, query, mode)).toEqual([{ ...notes[0], tick: .8999999999999999 }]);
    }
  });

  it('matches the independent full-preview and pixel oracle across seeded selections, zooms and gesture modes', () => {
    let seed = 0x715ca92e;
    const random = (bound: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound; };
    for (let example = 0; example < 120; example++) {
      const notes = Array.from({ length: 40 }, (_, index) => ({ ...note(`source-${index}`, random(40000) / 4, random(128), random(12000) / 4), velocity: random(17) / 16 }));
      const ids = notes.filter(() => random(3) === 0).map(item => item.id), selected = notes.filter(item => ids.includes(item.id));
      const minimum = selected.length ? selected.reduce((value, item) => Math.min(value, item.tick), Infinity) : 0;
      const low = selected.reduce((value, item) => Math.min(value, item.midi), 127), high = selected.reduce((value, item) => Math.max(value, item.midi), 0);
      const deltaTick = Math.max(random(6000) / 4 - 750, -minimum), deltaPitch = Math.max(-low, Math.min(127 - high, random(49) - 24));
      const row = [2, 5, 18][random(3)], v = { width: 300 + random(500), height: 180 + random(400), scale: [.125, .25, .5, 1, 2][random(5)], row, scrollX: random(12000) / 4, scrollY: random(128 * row) };
      const before = structuredClone(notes);
      for (const kind of ['move', 'resize', 'erase', 'velocity', 'draw', 'select'] as const) {
        compare(notes, active(kind, ids, { deltaTick: kind === 'resize' ? random(12000) / 4 - 1500 : deltaTick, deltaPitch,
          value: random(17) / 16, ...(kind === 'draw' ? { addedPreview: note('added', random(40000) / 4, random(128), random(4000) / 4) } : {}) }), v);
      }
      const lowVelocity = selected.reduce((value, item) => Math.min(value, item.velocity), 1), highVelocity = selected.reduce((value, item) => Math.max(value, item.velocity), 0);
      const delta = Math.max(-lowVelocity, Math.min(1 - highVelocity, random(33) / 16 - 1));
      compare(notes, active('velocity', ids, { value: delta, velocityMode: 'relative' }), v);
      expect(notes).toEqual(before);
    }
  });

  it('queries localized candidates for 100k sources with both small and 100k-note cached selections', () => {
    const notes = Array.from({ length: 100000 }, (_, index) => note(`large-${index}`, index * 12, 66, 4));
    const started = performance.now(), base = new PianoNoteIndex(notes), buildMilliseconds = performance.now() - started;
    const v = { width: 178, height: 400, scale: 1, row: 18, scrollX: 600000, scrollY: (127 - 72) * 18 };
    const small = new Set(['large-49998', 'large-50000', 'large-90000']), huge = new Set(notes.map(item => item.id));
    const observations = [];
    for (const [name, ids] of [['small', small], ['all', huge]] as const) {
      // Selection construction happens once at gesture start, outside frame work.
      const selected = new PianoNoteIndex(base.forIds(ids)), gesture = active('move', [], { ids, deltaTick: 120 });
      for (const mode of ['body', 'velocity'] as const) {
        const stats = statistics(), start = performance.now();
        const result = previewPianoNotes(base, selected, gesture, queryFor(v), mode, stats), queryMilliseconds = performance.now() - start;
        expect(pixelCull(result, v, mode)).toEqual(pixelCull(naivePreview(notes, gesture), v, mode));
        expect(stats.baseCandidates).toBeLessThanOrEqual(12);
        expect(stats.selectedCandidates).toBeLessThanOrEqual(12);
        expect(stats.transformedNotes).toBeLessThanOrEqual(12);
        expect(stats.testedNotes).toBeLessThan(1000);
        expect(result.length).toBeGreaterThan(0);
        observations.push({ selection: name, selected: ids.size, mode, ...stats, queryMilliseconds });
      }
    }
    console.info(JSON.stringify({ scope: 'Offline index/preview work counters and informational timing; no UI frame-rate claim or timing threshold.', sourceNotes: notes.length, buildMilliseconds, observations }));
  });

  it('applies relative velocity only to visible candidates even when all 100k source notes are selected', () => {
    const notes = Array.from({ length: 100000 }, (_, index) => ({ ...note(`velocity-${index}`, index * 12, index % 2 ? 5 : 66, 4), velocity: index % 2 ? .875 : .125 }));
    const base = new PianoNoteIndex(notes), ids = new Set(notes.map(item => item.id)), gesture = active('velocity', [], { ids, value: .125, velocityMode: 'relative' });
    const v = { width: 178, height: 400, scale: 1, row: 18, scrollX: 600000, scrollY: (127 - 72) * 18 };
    for (const mode of ['body', 'velocity'] as const) {
      const stats = statistics(), result = previewPianoNotes(base, undefined, gesture, queryFor(v), mode, stats);
      expect(pixelCull(result, v, mode)).toEqual(pixelCull(naivePreview(notes, gesture), v, mode));
      expect(stats.baseCandidates).toBeLessThanOrEqual(11); expect(stats.transformedNotes).toBeLessThanOrEqual(11); expect(stats.testedNotes).toBeLessThan(1000); expect(stats.selectedCandidates).toBe(0);
      expect(result.every(n => n.velocity === (n.midi === 5 ? 1 : .25))).toBe(true);
    }
    expect(notes[50000].velocity).toBe(.125); expect(notes[50001].velocity).toBe(.875);
  });
});
