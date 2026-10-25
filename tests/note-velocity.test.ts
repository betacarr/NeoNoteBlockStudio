import { produce } from 'immer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeNoteVelocities, constrainVelocityDelta, editedVelocity, velocityBounds, type VelocityMode } from '../src/core/note-velocity';
import type { Note } from '../src/core/types';

const note = (id: string, velocity: number): Note => ({ id, tick: 17.25, duration: 91.5, midi: 64, velocity, pan: -.3, detune: 12.125, height: 3.75,
  instrumentId: 'bell', midiSource: { onOrder: 7, offOrder: 19, releaseVelocity: 43, offSourceTrack: 9 } });
afterEach(() => vi.restoreAllMocks());

describe('gesture velocity bounds and one common delta', () => {
  it('returns no bounds for no notes and finds extrema without reordering or mutating a frozen source', () => {
    const notes = [{ velocity: .75 }, { velocity: .25 }, { velocity: .5 }]; notes.forEach(Object.freeze); Object.freeze(notes);
    expect(velocityBounds([])).toBeUndefined(); expect(velocityBounds(notes)).toEqual({ minimum: .25, maximum: .75 });
    expect(notes.map(item => item.velocity)).toEqual([.75, .25, .5]); expect(velocityBounds([{ velocity: .625 }])).toEqual({ minimum: .625, maximum: .625 });
  });

  it.each([
    { requested: .125, expected: .125 }, { requested: -.125, expected: -.125 },
    { requested: 2, expected: .25 }, { requested: -2, expected: -.25 },
  ])('constrains requested $requested to literal shared delta $expected', ({ requested, expected }) => {
    expect(constrainVelocityDelta({ minimum: .25, maximum: .75 }, requested)).toBe(expected);
  });

  it('stops a full-range group in either direction, returning an ordinary zero', () => {
    const bounds = { minimum: 0, maximum: 1 };
    expect(constrainVelocityDelta(bounds, .25)).toBe(0); expect(constrainVelocityDelta(bounds, -.25)).toBe(0);
    expect(constrainVelocityDelta({ minimum: 0, maximum: 0 }, -1)).toBe(0);
  });

  it('keeps fractional velocity precision rather than quantizing to MIDI integer steps', () => {
    expect(editedVelocity(.25000000000000006, .125, 'relative')).toBe(.37500000000000006);
    expect(editedVelocity(.75, .3333333333333333)).toBe(.3333333333333333);
  });
});

describe('relative pattern edits versus explicit absolute targets', () => {
  it.each([
    { delta: .125, expected: [.375, .875] }, { delta: -.125, expected: [.125, .625] },
    { delta: 2, expected: [.5, 1] }, { delta: -2, expected: [0, .5] },
  ])('applies shared delta $delta without flattening the selected dynamic difference', ({ delta, expected }) => {
    const notes = [note('quiet', .25), note('loud', .75)], ids = new Set(['quiet', 'loud']);
    const changed = changeNoteVelocities(notes, ids, delta, 'relative');
    expect(changed.map(item => item.velocity)).toEqual(expected); expect(changed[1].velocity - changed[0].velocity).toBe(.5);
    expect(notes.map(item => item.velocity)).toEqual([.25, .75]);
  });

  it('uses an absolute single-note target and preserves unselected references', () => {
    const notes = [note('quiet', .25), note('loud', .75)];
    const changed = changeNoteVelocities(notes, new Set(['quiet']), .875);
    expect(changed.map(item => item.velocity)).toEqual([.875, .75]); expect(changed[1]).toBe(notes[1]);
  });

  it('keeps the inspector-style absolute default as a deliberate uniform target', () => {
    const notes = [note('a', .25), note('b', .75)], ids = new Set(['a', 'b']);
    expect(changeNoteVelocities(notes, ids, .5).map(item => item.velocity)).toEqual([.5, .5]);
    expect(changeNoteVelocities(notes, ids, .5, 'absolute')).toEqual(changeNoteVelocities(notes, ids, .5));
  });

  it('ignores stale IDs and does not let unselected boundary notes restrict the group', () => {
    const notes = [note('zero', 0), note('quiet', .25), note('loud', .75), note('full', 1)];
    const changed = changeNoteVelocities(notes, new Set(['quiet', 'loud', 'deleted']), .125, 'relative');
    expect(changed.map(item => item.velocity)).toEqual([0, .375, .875, 1]); expect(changed[0]).toBe(notes[0]); expect(changed[3]).toBe(notes[3]);
  });

  it('keeps the original array for empty, stale, blocked, equal-target and zero-delta edits', () => {
    const notes = [note('zero', 0), note('full', 1)], ids = new Set(['zero', 'full']);
    expect(changeNoteVelocities(notes, new Set(), .5)).toBe(notes);
    expect(changeNoteVelocities(notes, new Set(['deleted']), .125, 'relative')).toBe(notes);
    expect(changeNoteVelocities(notes, ids, .125, 'relative')).toBe(notes);
    expect(changeNoteVelocities(notes, ids, -.125, 'relative')).toBe(notes);
    expect(changeNoteVelocities(notes, ids, 0, 'relative')).toBe(notes);
    expect(changeNoteVelocities(notes, new Set(['full']), 1)).toBe(notes);
  });

  it('keeps unchanged selected references within an otherwise changed absolute edit', () => {
    const notes = [note('already', .5), note('change', .25)], changed = changeNoteVelocities(notes, new Set(['already', 'change']), .5);
    expect(changed[0]).toBe(notes[0]); expect(changed[1]).not.toBe(notes[1]); expect(changed[1].velocity).toBe(.5);
  });

  it('preserves every note and MIDI field, note order, source identity and immutable input', () => {
    const notes = [note('one', .25), note('two', .75), note('untouched', .625)], before = structuredClone(notes), allocate = vi.spyOn(crypto, 'randomUUID');
    for (const item of notes) { Object.freeze(item.midiSource); Object.freeze(item); } Object.freeze(notes);
    const changed = changeNoteVelocities(notes, new Set(['two', 'one']), .125, 'relative');
    expect(changed).toEqual([{ ...before[0], velocity: .375 }, { ...before[1], velocity: .875 }, before[2]]);
    expect(changed[0].midiSource).toBe(notes[0].midiSource); expect(changed[1].midiSource).toBe(notes[1].midiSource); expect(changed[2]).toBe(notes[2]);
    expect(notes).toEqual(before); expect(allocate).not.toHaveBeenCalled();
  });

  it('preserves an Immer project reference for a blocked group and shares every other field after an edit', () => {
    const project = { notes: [note('zero', 0), note('full', 1), note('middle', .5)], metadata: { source: 'unchanged' } };
    expect(produce(project, draft => { draft.notes = changeNoteVelocities(draft.notes, new Set(['zero', 'full']), .25, 'relative'); })).toBe(project);
    const changed = produce(project, draft => { draft.notes = changeNoteVelocities(draft.notes, new Set(['middle']), .125, 'relative'); });
    expect(changed.notes.map(item => item.velocity)).toEqual([0, 1, .625]); expect(changed.metadata).toBe(project.metadata); expect(changed.notes[0]).toBe(project.notes[0]);
  });

  it('protects floating-point boundaries and preserves signed zero on semantic no-ops', () => {
    expect(editedVelocity(.9, .10000000000000003, 'relative')).toBe(1); expect(editedVelocity(.1, -.10000000000000002, 'relative')).toBe(0);
    expect(editedVelocity(.5, 1 + Number.EPSILON)).toBe(1); expect(editedVelocity(.5, -Number.EPSILON)).toBe(0);
    expect(Object.is(editedVelocity(-0, 0, 'relative'), -0)).toBe(true);
    const notes = [note('zero', -0)]; expect(changeNoteVelocities(notes, new Set(['zero']), 0)).toBe(notes); expect(Object.is(notes[0].velocity, -0)).toBe(true);
  });
});

describe('invalid velocity input never creates a partially edited source', () => {
  it.each([-1, 1.01, NaN, Infinity])('rejects invalid original velocity %s', velocity => {
    expect(() => velocityBounds([{ velocity }])).toThrow('力度'); expect(() => editedVelocity(velocity, .5)).toThrow('力度');
    const notes = [note('valid', .25), note('invalid', velocity)], before = notes.slice();
    expect(() => changeNoteVelocities(notes, new Set(['valid', 'invalid']), .125, 'relative')).toThrow('力度');
    expect(notes[0]).toBe(before[0]); expect(notes[0].velocity).toBe(.25); expect(notes[1]).toBe(before[1]);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite edit value %s in both modes', value => {
    const notes = [note('one', .25)];
    for (const mode of ['absolute', 'relative'] as const) {
      expect(() => editedVelocity(.25, value, mode)).toThrow('有限'); expect(() => changeNoteVelocities(notes, new Set(['one']), value, mode)).toThrow('有限');
    }
    expect(() => constrainVelocityDelta({ minimum: .25, maximum: .75 }, value)).toThrow('有限'); expect(notes[0].velocity).toBe(.25);
  });

  it('rejects inverted bounds and an unsupported mode explicitly', () => {
    expect(() => constrainVelocityDelta({ minimum: .75, maximum: .25 }, .125)).toThrow('最小值');
    expect(() => constrainVelocityDelta({ minimum: NaN, maximum: 1 }, .125)).toThrow('力度');
    expect(() => editedVelocity(.5, .25, 'ratio' as VelocityMode)).toThrow('方式');
  });
});
