import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { moveSelectedNotes } from '../src/core/editor-commands';
import { newNote } from '../src/core/project';

describe('whole-selection keyboard movement', () => {
  it('applies a fractional time delta without quantizing existing offsets or changing pitch by default', () => {
    const notes = [newNote(17.25, 60, 95.5), newNote(137.25, 64, 70)];
    const moved = moveSelectedNotes(notes, new Set(notes.map(note => note.id)), 30.5);
    expect(moved.map(note => [note.tick, note.midi])).toEqual([[47.75, 60], [167.75, 64]]);
    expect(notes.map(note => note.tick)).toEqual([17.25, 137.25]);
  });

  it('uses a common time delta when the first selected note reaches zero', () => {
    const notes = [newNote(15.25, 60), newNote(35.25, 64)];
    const moved = moveSelectedNotes(notes, new Set(notes.map(note => note.id)), -120);
    expect(moved.map(note => note.tick)).toEqual([0, 20]);
    expect(moved.map(note => note.midi)).toEqual([60, 64]);
  });

  it.each([
    { pitches: [120, 126], delta: 12, expected: [121, 127] },
    { pitches: [2, 9], delta: -12, expected: [0, 7] },
    { pitches: [60, 64], delta: 12, expected: [72, 76] },
  ])('preserves chord intervals for pitches $pitches shifted by $delta', ({ pitches, delta, expected }) => {
    const notes = pitches.map(midi => newNote(240, midi));
    const moved = moveSelectedNotes(notes, new Set(notes.map(note => note.id)), 0, delta);
    expect(moved.map(note => note.midi)).toEqual(expected);
    expect(moved.map(note => note.tick)).toEqual([240, 240]);
  });

  it('does not let unselected time or pitch boundaries restrict the selected group', () => {
    const notes = [newNote(0, 0), newNote(240, 60), newNote(360, 64), newNote(0, 127)];
    const moved = moveSelectedNotes(notes, new Set(['removed', notes[1].id, notes[2].id]), -120, 12);
    expect(moved.map(note => [note.tick, note.midi])).toEqual([[0, 0], [120, 72], [240, 76], [0, 127]]);
    expect(moved[0]).toBe(notes[0]); expect(moved[3]).toBe(notes[3]);
  });

  it('can still move in time when the requested pitch delta is blocked by the top note', () => {
    const notes = [newNote(240, 120), newNote(480, 127)];
    const moved = moveSelectedNotes(notes, new Set(notes.map(note => note.id)), 60, 12);
    expect(moved.map(note => [note.tick, note.midi])).toEqual([[300, 120], [540, 127]]);
  });

  it('can still transpose when a requested backwards time delta is blocked at zero', () => {
    const notes = [newNote(0, 60), newNote(120, 64)];
    const moved = moveSelectedNotes(notes, new Set(notes.map(note => note.id)), -60, 1);
    expect(moved.map(note => [note.tick, note.midi])).toEqual([[0, 61], [120, 65]]);
  });

  it('retains the original array for empty, stale and entirely blocked selections', () => {
    const notes = [newNote(0, 0), newNote(120, 127)];
    expect(moveSelectedNotes(notes, new Set(), 120, 1)).toBe(notes);
    expect(moveSelectedNotes(notes, new Set(['removed']), -120, 12)).toBe(notes);
    const all = new Set(notes.map(note => note.id));
    expect(moveSelectedNotes(notes, all, 0)).toBe(notes);
    expect(moveSelectedNotes(notes, all, -120, 12)).toBe(notes);
    expect(moveSelectedNotes(notes, all, -120, -12)).toBe(notes);
  });

  it('preserves all other note data and input references without mutating frozen sources', () => {
    const selected = { ...newNote(45.5, 64, 97.75), velocity: .35, pan: -.2, detune: 17, height: 3.5, instrumentId: 'bell', midiSource: { onOrder: 7, offOrder: 11, releaseVelocity: 52, offSourceTrack: 3 } };
    const unselected = newNote(90, 70), notes = [selected, unselected], before = structuredClone(notes);
    Object.freeze(selected.midiSource); Object.freeze(selected); Object.freeze(unselected); Object.freeze(notes);
    const moved = moveSelectedNotes(notes, new Set([selected.id]), 15.25, -2);
    expect(moved).not.toBe(notes); expect(moved[0]).not.toBe(selected); expect(moved[1]).toBe(unselected);
    expect(moved[0]).toEqual({ ...before[0], tick: 60.75, midi: 62 });
    expect(moved[0].midiSource).toBe(selected.midiSource);
    expect(notes).toEqual(before);
  });

  it('keeps an Immer snapshot unchanged for a blocked group and changes only moved notes otherwise', () => {
    const notes = [newNote(0, 126), newNote(240, 127), newNote(0, 60)], project = { notes };
    const ids = new Set(notes.slice(0, 2).map(note => note.id));
    expect(produce(project, draft => { draft.notes = moveSelectedNotes(draft.notes, ids, -120, 12); })).toBe(project);
    const moved = produce(project, draft => { draft.notes = moveSelectedNotes(draft.notes, ids, 120, -1); });
    expect(moved).not.toBe(project); expect(moved.notes[2]).toBe(notes[2]);
    expect(moved.notes.slice(0, 2).map(note => [note.tick, note.midi])).toEqual([[120, 125], [360, 126]]);
  });
});
