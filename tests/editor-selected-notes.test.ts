import { describe, expect, it, vi } from 'vitest';
import { produce } from 'immer';
import { canEditSelectedNotes, changeSelectedNotes, notePropertiesEqual, notesUnchanged } from '../src/core/editor-commands';
import { newNote } from '../src/core/project';
import type { Note } from '../src/core/types';

function fixture() {
  const notes = [newNote(0, 60, 120), newNote(120, 127, 120), newNote(240, 64, 120)];
  notes[0].midiSource = { onOrder: 3, offOrder: 4, releaseVelocity: 50 };
  return { notes, pattern: { notes }, track: { locked: false }, ids: new Set([notes[0].id]) };
}

describe('selected note edit eligibility', () => {
  it('requires a real unlocked target and at least one live selection ID', () => {
    const { track, pattern, ids } = fixture();
    expect(canEditSelectedNotes(track, pattern, ids)).toBe(true);
    expect(canEditSelectedNotes(undefined, pattern, ids)).toBe(false);
    expect(canEditSelectedNotes({ locked: true }, pattern, ids)).toBe(false);
    expect(canEditSelectedNotes(track, undefined, ids)).toBe(false);
    expect(canEditSelectedNotes(track, pattern, new Set())).toBe(false);
    expect(canEditSelectedNotes(track, pattern, new Set(['removed']))).toBe(false);
    expect(canEditSelectedNotes(track, pattern, new Set(['removed', ...ids]))).toBe(true);
  });
});

describe('semantic selected note changes', () => {
  it('compares array length, order and cloned note values without requiring object identity', () => {
    const { notes } = fixture(), clones = structuredClone(notes);
    expect(notesUnchanged(notes, notes)).toBe(true);
    expect(notesUnchanged(notes, clones)).toBe(true);
    expect(notesUnchanged(notes, notes.slice(1))).toBe(false);
    expect(notesUnchanged(notes, [...notes, newNote(360, 65, 120)])).toBe(false);
    expect(notesUnchanged(notes, [notes[1], notes[0], notes[2]])).toBe(false);
    clones[0].midiSource!.releaseVelocity++;
    expect(notesUnchanged(notes, clones)).toBe(false);
  });

  it.each(['empty', 'stale'] as const)('keeps %s selections unchanged without calling the edit', selection => {
    const { notes } = fixture(), edit = vi.fn((note: Readonly<Note>) => ({ ...note, midi: note.midi + 1 }));
    expect(changeSelectedNotes(notes, new Set(selection === 'empty' ? [] : ['removed']), edit)).toBe(notes);
    expect(edit).not.toHaveBeenCalled();
  });

  it('retains the original array when transposition is clamped at the top pitch', () => {
    const { notes } = fixture();
    expect(changeSelectedNotes(notes, new Set([notes[1].id]), note => ({ ...note, midi: Math.min(127, note.midi + 12) }))).toBe(notes);
  });

  it('retains the original array for already-quantized positions and identical property patches', () => {
    const { notes, ids } = fixture();
    expect(changeSelectedNotes(notes, ids, note => ({ ...note, tick: Math.round(note.tick / 120) * 120 }))).toBe(notes);
    expect(changeSelectedNotes(notes, ids, note => ({ ...note, velocity: notes[0].velocity }))).toBe(notes);
    expect(changeSelectedNotes(notes, ids, note => ({ ...note, instrumentId: undefined, midiSource: { ...note.midiSource!, offSourceTrack: undefined } }))).toBe(notes);
  });

  it('changes only the notes with different data, including mixed clamped selections', () => {
    const { notes } = fixture(), before = structuredClone(notes), ids = new Set([notes[0].id, notes[1].id]);
    const changed = changeSelectedNotes(notes, ids, note => ({ ...note, midi: Math.min(127, note.midi + 1) }));
    expect(changed).not.toBe(notes);
    expect(changed[0]).not.toBe(notes[0]); expect(changed[0].midi).toBe(61);
    expect(changed[1]).toBe(notes[1]); expect(changed[2]).toBe(notes[2]);
    expect(notes).toEqual(before);
  });

  it('supports a real deletion while preserving the remaining note references', () => {
    const { notes, ids } = fixture(), before = [...notes];
    const changed = changeSelectedNotes(notes, ids, () => undefined);
    expect(changed).toEqual([notes[1], notes[2]]);
    expect(changed[0]).toBe(notes[1]); expect(changed[1]).toBe(notes[2]);
    expect(notes).toEqual(before);
  });

  it('detects instrument override addition and removal', () => {
    const { notes, ids } = fixture();
    const overridden = changeSelectedNotes(notes, ids, note => ({ ...note, instrumentId: 'bell' }));
    expect(overridden[0].instrumentId).toBe('bell'); expect(overridden[0]).not.toBe(notes[0]);
    const cleared = changeSelectedNotes(overridden, ids, note => ({ ...note, instrumentId: undefined }));
    expect(cleared[0].instrumentId).toBeUndefined(); expect(cleared).not.toBe(overridden);
    expect(notePropertiesEqual(cleared[0], notes[0])).toBe(true);
  });

  it.each(['id', 'tick', 'duration', 'midi', 'velocity', 'pan', 'detune', 'height'] as const)('recognizes a changed %s property', field => {
    const note = newNote(0, 60, 120), changed = field === 'id' ? { ...note, id: 'another-id' } : { ...note, [field]: note[field] + 1 };
    expect(notePropertiesEqual(note, changed)).toBe(false);
  });

  it.each(['onOrder', 'offOrder', 'releaseVelocity', 'offSourceTrack'] as const)('recognizes a changed MIDI provenance %s', field => {
    const { notes } = fixture(), note = notes[0];
    const changed = { ...note, midiSource: { ...note.midiSource!, [field]: (note.midiSource![field] ?? 0) + 1 } };
    expect(notePropertiesEqual(note, changed)).toBe(false);
  });

  it('retains an Immer project snapshot for no-op edits but produces a snapshot for real edits', () => {
    const { notes, ids } = fixture(), project = { notes };
    const same = produce(project, draft => { draft.notes = changeSelectedNotes(draft.notes, ids, note => ({ ...note, midi: note.midi })); });
    expect(same).toBe(project);
    const edited = produce(project, draft => { draft.notes = changeSelectedNotes(draft.notes, ids, note => ({ ...note, midi: note.midi + 1 })); });
    expect(edited).not.toBe(project); expect(edited.notes[1]).toBe(project.notes[1]);
  });
});
