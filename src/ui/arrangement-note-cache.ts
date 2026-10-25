import type { Pattern } from '../core/types';
import { ArrangementNoteIndex } from './arrangement-note-index';

type PreviewSource = Pick<Pattern, 'id' | 'notes' | 'length'>;
interface Entry { notes: PreviewSource['notes']; period: number; index?: ArrangementNoteIndex }

/** Share visible copies' work, without keeping an index for each undo state. */
export class ArrangementNoteCache {
  private entries = new Map<string, Entry>();

  update(patterns: readonly PreviewSource[]): void {
    const next = new Map<string, Entry>();
    for (const pattern of patterns) {
      const previous = this.entries.get(pattern.id), period = Math.max(1, pattern.length);
      next.set(pattern.id, previous?.notes === pattern.notes && previous.period === period ? previous : { notes: pattern.notes, period });
    }
    this.entries = next;
  }

  get(patternId: string): ArrangementNoteIndex | undefined {
    const entry = this.entries.get(patternId);
    if (!entry) return undefined;
    return entry.index ??= new ArrangementNoteIndex(entry.notes, entry.period);
  }
}
