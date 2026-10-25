import { changeSelectedNotes } from './editor-commands';
import type { Note } from './types';

export type VelocityMode = 'absolute' | 'relative';
export interface VelocityBounds { minimum: number; maximum: number }

function assertVelocity(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('音符力度必须是 0～1 范围内的有限数值。');
}
function assertEdit(value: number, mode: VelocityMode): void {
  if (!Number.isFinite(value)) throw new RangeError('力度目标或增量必须是有限数值。');
  if (mode !== 'absolute' && mode !== 'relative') throw new RangeError('未知的力度编辑方式。');
}

/** Compute once at gesture start; source objects and their order remain untouched. */
export function velocityBounds(notes: readonly Pick<Note, 'velocity'>[]): VelocityBounds | undefined {
  if (!notes.length) return;
  let minimum = 1, maximum = 0;
  for (const note of notes) { assertVelocity(note.velocity); minimum = Math.min(minimum, note.velocity); maximum = Math.max(maximum, note.velocity); }
  return { minimum, maximum };
}

/** One shared constrained delta keeps every pair's velocity difference intact. */
export function constrainVelocityDelta(bounds: VelocityBounds, requested: number): number {
  assertVelocity(bounds.minimum); assertVelocity(bounds.maximum);
  if (bounds.minimum > bounds.maximum) throw new RangeError('力度范围的最小值不能大于最大值。');
  if (!Number.isFinite(requested)) throw new RangeError('力度增量必须是有限数值。');
  const delta = Math.max(-bounds.minimum, Math.min(1 - bounds.maximum, requested));
  return delta === 0 ? 0 : delta;
}

/** Relative values are already shared deltas; final clamp protects float edges. */
export function editedVelocity(original: number, value: number, mode: VelocityMode = 'absolute'): number {
  assertVelocity(original); assertEdit(value, mode);
  if (mode === 'relative' && value === 0 || mode === 'absolute' && value === original) return original;
  return Math.max(0, Math.min(1, mode === 'relative' ? original + value : value));
}

/** Pure pattern edit. Stale IDs never participate in the bounds or create notes. */
export function changeNoteVelocities(notes: Note[], ids: ReadonlySet<string>, value: number, mode: VelocityMode = 'absolute'): Note[] {
  assertEdit(value, mode);
  if (!ids.size) return notes;
  const selected = notes.filter(note => ids.has(note.id)), bounds = velocityBounds(selected);
  if (!bounds) return notes;
  const change = mode === 'relative' ? constrainVelocityDelta(bounds, value) : value;
  if (mode === 'relative' && change === 0) return notes;
  return changeSelectedNotes(notes, ids, note => ({ ...note, velocity: editedVelocity(note.velocity, change, mode) }));
}
