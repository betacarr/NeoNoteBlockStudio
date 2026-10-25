import { describe, expect, it } from 'vitest';
import { newNote } from '../src/core/project';
import { clampPianoZoom, PIANO_MAX_ZOOM, PIANO_MIN_ZOOM, planPianoView, clampPianoRowHeight, planPianoRowZoom } from '../src/ui/piano-view';

const grid = { ppq: 480, width: 768, height: 360, zoom: 96 };

describe('independent pitch-row zoom', () => {
  it('keeps the viewport center pitch fixed without touching horizontal coordinates', () => {
    const plan = planPianoRowZoom(18, 30, 900, 280);
    expect(plan.rowHeight).toBe(30);
    expect((plan.y + 140) / 30).toBeCloseTo((900 + 140) / 18, 12);
  });
  it('anchors wheel zoom at the supplied pitch rather than the center', () => {
    const plan = planPianoRowZoom(2, 12, 30, 160, 20);
    expect(plan.y).toBe(280); expect((plan.y + 20) / 12).toBe(25);
  });
  it('clamps to the top/bottom and gives a fully visible keyboard zero scroll', () => {
    expect(planPianoRowZoom(18, 36, 0, 280, 0).y).toBe(0);
    expect(planPianoRowZoom(18, 36, 2024, 280, 280).y).toBe(4328);
    expect(planPianoRowZoom(18, .25, 1000, 280).y).toBe(0);
  });
  it('bounds manual row sizes and recovers from invalid input', () => {
    expect(clampPianoRowHeight(-Infinity)).toBe(.25);
    expect(clampPianoRowHeight(Infinity)).toBe(48);
    expect(clampPianoRowHeight(NaN)).toBe(18);
    expect(planPianoRowZoom(0, NaN, NaN, NaN)).toEqual({ rowHeight: 18, y: 0 });
  });
});

describe('piano view planning', () => {
  it('clamps zoom at both declared bounds and gives NaN a useful default', () => {
    expect(clampPianoZoom(-1)).toBe(PIANO_MIN_ZOOM);
    expect(clampPianoZoom(0)).toBe(PIANO_MIN_ZOOM);
    expect(clampPianoZoom(PIANO_MIN_ZOOM)).toBe(PIANO_MIN_ZOOM);
    expect(clampPianoZoom(72)).toBe(72);
    expect(clampPianoZoom(PIANO_MAX_ZOOM)).toBe(PIANO_MAX_ZOOM);
    expect(clampPianoZoom(Infinity)).toBe(PIANO_MAX_ZOOM);
    expect(clampPianoZoom(-Infinity)).toBe(PIANO_MIN_ZOOM);
    expect(clampPianoZoom(NaN)).toBe(72);
  });

  it('locates the first note with 24 pixels of padding while retaining normal zoom', () => {
    const notes = [newNote(2400, 60, 120), newNote(1920, 64, 120)], before = structuredClone(notes);
    const plan = planPianoView({ ...grid, notes, mode: 'locate' });
    expect(plan.x).toBe(360); expect(plan.zoom).toBe(96); expect(plan.rowHeight).toBe(18);
    expect(plan.y).toBe((127 - 62 + .5) * 18 - grid.height / 2);
    expect(notes).toEqual(before);
  });

  it('restores a readable locate zoom after fitting a long timeline and honors startTick', () => {
    const notes = [newNote(1920, 60, 120)];
    const plan = planPianoView({ ...grid, notes, mode: 'locate', zoom: 1e-6, startTick: 4800 });
    expect(plan.zoom).toBe(72); expect(plan.x).toBe(696);
    expect(planPianoView({ ...grid, notes, mode: 'locate', zoom: 24 }).zoom).toBe(24);
  });

  it('fits a short single note with at least four quarters of time context', () => {
    const plan = planPianoView({ ...grid, notes: [newNote(0, 60, 120)], mode: 'fit' });
    expect(plan.zoom).toBe(180); expect(plan.x).toBe(0); expect(plan.rowHeight).toBe(18);
  });

  it('uses note ends and a delayed first tick for fitting, without letting a locate hint hide notes', () => {
    const notes = [newNote(14400, 65, 960), newNote(9600, 60, 480)];
    const plan = planPianoView({ ...grid, width: 1008, notes, mode: 'fit', startTick: 50000 });
    expect(plan.zoom).toBe(80); expect(plan.x).toBe(1576);
    expect(9600 * plan.zoom / grid.ppq - plan.x).toBe(24);
    expect(15360 * plan.zoom / grid.ppq - plan.x).toBe(984);
  });

  it('keeps single notes at both pitch boundaries visible by clamping vertical scroll', () => {
    const high = planPianoView({ ...grid, notes: [newNote(0, 127, 120)], mode: 'locate' });
    const low = planPianoView({ ...grid, notes: [newNote(0, 0, 120)], mode: 'locate' });
    expect(high.y).toBe(0); expect(high.rowHeight).toBe(18);
    expect(low.y).toBe(128 * 18 - grid.height);
  });

  it('fits a 100000-note long timeline and all 128 pitches without array spreading', () => {
    const base = newNote(0, 60, 48000);
    const notes = Object.freeze(Array.from({ length: 100000 }, (_, i) => ({ ...base, id: String(i), tick: i * 48000000, midi: i % 128 })));
    const plan = planPianoView({ ...grid, notes, mode: 'fit' });
    expect(plan.rowHeight).toBeCloseTo(grid.height / 132);
    expect(plan.zoom).toBeLessThan(24); expect(plan.zoom).toBeGreaterThanOrEqual(PIANO_MIN_ZOOM);
    expect(plan.y).toBe(0);
    expect(128 * plan.rowHeight).toBeLessThanOrEqual(grid.height);
    expect((notes[99999].tick + notes[99999].duration) * plan.zoom / grid.ppq - plan.x).toBeLessThanOrEqual(grid.width - 24);
    expect(notes[0]).toMatchObject({ tick: 0, midi: 0 });
    expect(notes[99999]).toMatchObject({ tick: 99999 * 48000000, midi: 31 });
  });

  it('frames only the supplied selected subset, leaving unrelated notes out of the envelope', () => {
    const notes = [newNote(0, 0, 120), newNote(9600, 72, 120), newNote(10000000, 127, 120)];
    const plan = planPianoView({ ...grid, notes: [notes[1]], mode: 'fit' });
    expect(plan.zoom).toBe(180); expect(plan.x).toBe(3576); expect(plan.rowHeight).toBe(18);
    expect(plan.y).toBe((127 - 72 + .5) * 18 - grid.height / 2);
    expect(notes).toHaveLength(3);
  });

  it('fits the longest valid note envelope even with the minimum project PPQ', () => {
    const notes = [newNote(0, 0, 1e12), newNote(1e12, 127, 1e12)];
    const plan = planPianoView({ ...grid, ppq: 1, notes, mode: 'fit' });
    expect(plan.zoom).toBeGreaterThan(PIANO_MIN_ZOOM);
    expect((2e12 * plan.zoom) - plan.x).toBeLessThanOrEqual(grid.width - 24);
  });

  it('uses middle C, default row height and zoom for an empty project', () => {
    const empty = planPianoView({ ...grid, notes: [], mode: 'fit' });
    expect(empty).toEqual({ x: 0, y: (127 - 60 + .5) * 18 - grid.height / 2, rowHeight: 18, zoom: 72 });
    expect(planPianoView({ ...grid, notes: [], mode: 'locate', zoom: 220, startTick: 4800 }).x).toBe(696);
  });

  it('respects minimum and maximum fit zoom with unusually narrow or wide grids', () => {
    const notes = [newNote(0, 60, 120)];
    expect(planPianoView({ ...grid, notes, mode: 'fit', width: 24 }).zoom).toBe(PIANO_MIN_ZOOM);
    expect(planPianoView({ ...grid, notes, mode: 'fit', width: 10000, height: 4000 })).toMatchObject({ zoom: PIANO_MAX_ZOOM, rowHeight: 18, y: 0 });
  });
});
