import { describe, expect, it } from 'vitest';
import { newNote } from '../src/core/project';
import { noteAt, notesAlongStroke, type Rect } from '../src/ui/piano-hit-test';

const bounds: Rect = { x: 58, y: 42, width: 242, height: 180 };
const note = (id: string, rect: Rect) => ({ ...newNote(0, 60, 120), id, rect });
const rectFor = (item: ReturnType<typeof note>) => item.rect;
const none = new Set<string>();

describe('piano note point and stroke geometry', () => {
  it('returns only the top painted note without reversing or changing the input', () => {
    const lower = note('lower', { x: 80, y: 60, width: 30, height: 16 });
    const upper = note('upper', { ...lower.rect }), notes = Object.freeze([lower, upper]);
    expect(noteAt(notes, 90, 65, rectFor)).toBe(upper);
    expect(noteAt(notes, 200, 65, rectFor)).toBeUndefined();
    expect(notes[0]).toBe(lower); expect(notes[1]).toBe(upper);
  });

  it('sweeps every overlapped layer except IDs already erased, retaining source references', () => {
    const rect = { x: 100, y: 60, width: 10, height: 16 };
    const notes = Object.freeze([note('lower', rect), note('erased', rect), note('upper', rect)]);
    const ignored = new Set(['erased']), before = structuredClone(notes);
    const result = notesAlongStroke(notes, { x: 80, y: 65 }, { x: 130, y: 65 }, rectFor, bounds, ignored);
    expect(result).toEqual([notes[0], notes[2]]);
    expect(result[0]).toBe(notes[0]); expect(result[1]).toBe(notes[2]);
    expect(notes).toEqual(before); expect([...ignored]).toEqual(['erased']);
  });

  it('finds narrow notes between sparse pointer events in either direction', () => {
    const notes = [note('narrow', { x: 140, y: 70, width: 6, height: 16 })];
    expect(notesAlongStroke(notes, { x: 60, y: 75 }, { x: 290, y: 75 }, rectFor, bounds, none)).toEqual(notes);
    expect(notesAlongStroke(notes, { x: 290, y: 75 }, { x: 60, y: 75 }, rectFor, bounds, none)).toEqual(notes);
  });

  it('uses the actual diagonal segment instead of erasing its entire bounding rectangle', () => {
    const onLine = note('on-line', { x: 140, y: 110, width: 10, height: 10 });
    const away = note('away', { x: 140, y: 60, width: 10, height: 10 });
    expect(notesAlongStroke([onLine, away], { x: 80, y: 50 }, { x: 240, y: 210 }, rectFor, bounds, none)).toEqual([onLine]);
  });

  it('clips traversal at the keyboard, ruler, right edge and velocity lane', () => {
    const inside = note('inside', { x: 80, y: 60, width: 10, height: 16 });
    const notes = [note('keyboard', { x: 20, y: 0, width: 10, height: 16 }), note('ruler', { x: 45, y: 25, width: 10, height: 10 }), inside, note('velocity', { x: 250, y: 230, width: 10, height: 16 }), note('beyond-right', { x: 320, y: 300, width: 10, height: 16 })];
    expect(notesAlongStroke(notes, { x: 0, y: -20 }, { x: 400, y: 380 }, rectFor, bounds, none)).toEqual([inside]);
    const keyboard = note('left-only', { x: 20, y: 70, width: 10, height: 16 });
    expect(notesAlongStroke([keyboard], { x: 0, y: 75 }, { x: 400, y: 75 }, rectFor, bounds, none)).toEqual([]);
    const right = note('right-only', { x: 320, y: 70, width: 10, height: 16 });
    expect(notesAlongStroke([right], { x: 0, y: 75 }, { x: 400, y: 75 }, rectFor, bounds, none)).toEqual([]);
  });

  it('does not erase anything while a stroke remains outside the grid', () => {
    const notes = [note('ruler', { x: 100, y: 10, width: 10, height: 16 }), note('velocity', { x: 100, y: 240, width: 10, height: 16 })];
    expect(notesAlongStroke(notes, { x: 60, y: 15 }, { x: 290, y: 15 }, rectFor, bounds, none)).toEqual([]);
    expect(notesAlongStroke(notes, { x: 60, y: 245 }, { x: 290, y: 245 }, rectFor, bounds, none)).toEqual([]);
  });

  it('treats rectangle edges and corners as contact, including a vertical stroke', () => {
    const notes = [note('corner', { x: 100, y: 100, width: 20, height: 16 })];
    expect(notesAlongStroke(notes, { x: 80, y: 80 }, { x: 100, y: 100 }, rectFor, bounds, none)).toEqual(notes);
    expect(notesAlongStroke(notes, { x: 100, y: 80 }, { x: 100, y: 140 }, rectFor, bounds, none)).toEqual(notes);
    expect(notesAlongStroke(notes, { x: 99, y: 80 }, { x: 99, y: 140 }, rectFor, bounds, none)).toEqual([]);
  });

  it('keeps stationary pointerup separate from the topmost initial point click', () => {
    const rect = { x: 100, y: 70, width: 20, height: 16 }, notes = [note('lower', rect), note('upper', rect)];
    expect(noteAt(notes, 105, 75, rectFor)).toBe(notes[1]);
    expect(notesAlongStroke(notes, { x: 105, y: 75 }, { x: 105, y: 75 }, rectFor, bounds, new Set(['upper']))).toEqual([]);
  });

  it('rejects nonfinite points and invalid bounds without accidental hits', () => {
    const notes = [note('note', { x: 100, y: 70, width: 20, height: 16 })];
    expect(noteAt(notes, NaN, 75, rectFor)).toBeUndefined();
    expect(notesAlongStroke(notes, { x: Infinity, y: 75 }, { x: 105, y: 75 }, rectFor, bounds, none)).toEqual([]);
    expect(notesAlongStroke(notes, { x: 80, y: 75 }, { x: 130, y: 75 }, rectFor, { ...bounds, width: -1 }, none)).toEqual([]);
  });
});
