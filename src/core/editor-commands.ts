import type { Note, Pattern, Track } from './types';
import { constrainNoteMovement } from './editor-interaction';

/** Stale selection IDs and missing/locked targets cannot start a note edit. */
export function canEditSelectedNotes(track: Pick<Track, 'locked'> | undefined, pattern: Pick<Pattern, 'notes'> | undefined, selectedIDs: ReadonlySet<string>): boolean {
  return !!track && !track.locked && !!pattern && selectedIDs.size > 0 && pattern.notes.some(note => selectedIDs.has(note.id));
}

// Keep these records exhaustive when Note or its MIDI provenance gains a field.
const noteFields = { id: true, tick: true, duration: true, midi: true, velocity: true, pan: true, detune: true, height: true, instrumentId: true } satisfies Record<Exclude<keyof Note, 'midiSource'>, true>;
const midiFields = { onOrder: true, offOrder: true, releaseVelocity: true, offSourceTrack: true } satisfies Record<keyof NonNullable<Note['midiSource']>, true>;
const noteKeys = Object.keys(noteFields) as (keyof typeof noteFields)[];
const midiKeys = Object.keys(midiFields) as (keyof typeof midiFields)[];

/** Compare defined note data; absent and explicitly undefined optional values agree. */
export function notePropertiesEqual(a: Readonly<Note>, b: Readonly<Note>): boolean {
  if (a === b) return true;
  if (!noteKeys.every(key => a[key] === b[key])) return false;
  const left = a.midiSource, right = b.midiSource;
  return left === right || !!left && !!right && midiKeys.every(key => left[key] === right[key]);
}

/** Ordered pattern-local comparison, including independently cloned note data. */
export function notesUnchanged(previous: readonly Note[], next: readonly Note[]): boolean {
  return previous === next || previous.length === next.length && previous.every((note, index) => notePropertiesEqual(note, next[index]));
}

/** Pure callbacks return an edited note, or undefined to delete it.
 * No semantic change preserves the input array and every unchanged note reference.
 */
export function changeSelectedNotes(notes: Note[], selectedIDs: ReadonlySet<string>, changeNote: (note: Readonly<Note>) => Note | undefined): Note[] {
  if (!selectedIDs.size) return notes;
  let result: Note[] | undefined;
  for (let i = 0; i < notes.length; i++) {
    const original = notes[i], changed = selectedIDs.has(original.id) ? changeNote(original) : original;
    const next = changed && notePropertiesEqual(original, changed) ? original : changed;
    if (!result) {
      if (next === original) continue;
      result = notes.slice(0, i);
    }
    if (next !== undefined) result.push(next);
  }
  return result ?? notes;
}

/** Apply one constrained delta to the live selection, retaining chord spacing. */
export function moveSelectedNotes(notes: Note[], selectedIDs: ReadonlySet<string>, tick: number, pitch = 0): Note[] {
  if (!selectedIDs.size) return notes;
  const selected = notes.filter(note => selectedIDs.has(note.id));
  if (!selected.length) return notes;
  const movement = constrainNoteMovement(selected, tick, pitch);
  if (!movement.tick && !movement.pitch) return notes;
  return changeSelectedNotes(notes, selectedIDs, note => ({ ...note, tick: note.tick + movement.tick, midi: note.midi + movement.pitch }));
}

/** Copy/cut currently operate on piano notes; region copying is a separate command. */
export function canCopyNotes(focus: 'piano' | 'arrangement', track: Pick<Track, 'locked'> | undefined, selected: readonly Note[]): boolean {
  return focus === 'piano' && !!track && selected.length > 0;
}

export function canCutNotes(focus: 'piano' | 'arrangement', track: Pick<Track, 'locked'> | undefined, selected: readonly Note[]): boolean {
  return !!track && !track.locked && canCopyNotes(focus, track, selected);
}

/** The command and menu reject a paste before creating IDs or changing selection. */
export function canPasteNotes(track: Pick<Track, 'locked'> | undefined, pattern: Pick<Pattern, 'id'> | undefined, notes: readonly Note[]): boolean {
  return !!track && !track.locked && !!pattern && notes.length > 0;
}
