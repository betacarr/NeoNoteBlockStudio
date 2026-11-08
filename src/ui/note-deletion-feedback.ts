import type { Note } from '../core/types';

export const NOTE_DELETION_DURATION = 160;
export const NOTE_DELETION_LIMIT = 256;
export interface DeletedNoteGhost { note: Note; color: string; startedAt: number }
export interface DeletionGhostFrame extends DeletedNoteGhost { progress: number; opacity: number; scale: number }

/** Prefer the user's edit targets when a dense viewport exceeds the ghost cap. */
export function deletionFeedbackCandidates(notes: readonly Note[], selected: ReadonlySet<string>, color: string): { note: Note; color: string }[] {
  const output: { note: Note; color: string }[] = [];
  for (const note of notes) if (selected.has(note.id)) {
    output.push({ note, color: '#e3f5eb' });
    if (output.length === NOTE_DELETION_LIMIT) return output;
  }
  for (const note of notes) if (!selected.has(note.id)) {
    output.push({ note, color });
    if (output.length === NOTE_DELETION_LIMIT) break;
  }
  return output;
}

/** Visual-only bounded queue. No source events, scheduling or hit indexes live here. */
export class NoteDeletionFeedback {
  private ghosts = new Map<string, DeletedNoteGhost>();
  get size() { return this.ghosts.size; }
  clear() { this.ghosts.clear(); }
  remove(ids: ReadonlySet<string>) { for (const id of ids) this.ghosts.delete(id); }
  restore(ids: ReadonlySet<string>) { this.remove(ids); }
  enqueue(notes: readonly { note: Note; color: string }[], now: number, reducedMotion: boolean) {
    if (reducedMotion) { this.clear(); return; }
    for (const candidate of notes) {
      if (this.ghosts.has(candidate.note.id)) continue;
      if (this.ghosts.size >= NOTE_DELETION_LIMIT) this.ghosts.delete(this.ghosts.keys().next().value!);
      this.ghosts.set(candidate.note.id, { note: { ...candidate.note }, color: candidate.color, startedAt: now });
    }
  }
  frame(now: number): DeletionGhostFrame[] {
    const output: DeletionGhostFrame[] = [];
    for (const [id, ghost] of this.ghosts) {
      const progress = Math.max(0, Math.min(1, (now - ghost.startedAt) / NOTE_DELETION_DURATION));
      if (progress >= 1) { this.ghosts.delete(id); continue; }
      output.push({ ...ghost, progress, opacity: (1-progress) ** 2, scale: 1-.12*progress });
    }
    return output;
  }
}
