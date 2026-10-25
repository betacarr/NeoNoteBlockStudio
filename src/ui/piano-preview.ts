import type { Note } from '../core/types';
import { editedVelocity, type VelocityMode } from '../core/note-velocity';
import type { PianoNoteIndex, PianoNoteQuery, PianoNoteQueryStats } from './piano-note-index';

export interface PianoPreviewActive {
  kind: 'draw' | 'move' | 'resize' | 'select' | 'erase' | 'velocity' | 'seek' | 'pan' | 'trim-start' | 'trim-end';
  ids: ReadonlySet<string>;
  /** Movement has already been constrained for the entire selection. */
  deltaTick: number;
  deltaPitch: number;
  value: number;
  /** Relative values are already constrained against the full selection. */
  velocityMode?: VelocityMode;
  /** The caller applies its preset's dragPlacedNote semantics once. */
  addedPreview?: Note;
}

export interface PianoPreviewStats extends PianoNoteQueryStats {
  baseCandidates: number;
  selectedCandidates: number;
  transformedNotes: number;
}

/** Query conservatively around rounded inverse arithmetic. Geometry is culled
 * exactly by the caller after applying the original forward transformation.
 */
function inverseMargin(query: PianoNoteQuery, delta: number): number {
  return 8 * Number.EPSILON * Math.max(1, Math.abs(query.start), Math.abs(query.end), Math.abs(delta));
}

/** Visible candidates only; never scan all source or selected notes per frame.
 * A move/resize with selected IDs requires an index cached at gesture start.
 * That index must retain the base source order (base.forIds provides this).
 * Results preserve paint order, with a newly placed note always the last layer.
 */
export function previewPianoNotes(
  base: PianoNoteIndex,
  selected: PianoNoteIndex | undefined,
  active: PianoPreviewActive | null,
  query: PianoNoteQuery,
  mode: 'body' | 'velocity',
  stats?: PianoPreviewStats,
): Note[] {
  if (stats) Object.assign(stats, { visitedNodes: 0, testedNotes: 0, baseCandidates: 0, selectedCandidates: 0, transformedNotes: 0 });
  const candidates = (index: PianoNoteIndex, window: PianoNoteQuery): Note[] => {
    const work = stats ? { visitedNodes: 0, testedNotes: 0 } : undefined;
    const notes = mode === 'velocity' ? index.starts(window.start, window.end, work) : index.query(window, work);
    if (stats && work) { stats.visitedNodes += work.visitedNodes; stats.testedNotes += work.testedNotes; }
    return notes;
  };
  const visible = candidates(base, query);
  if (stats) stats.baseCandidates = visible.length;
  if (!active) return visible;
  if (active.kind === 'move' || active.kind === 'resize') {
    if (!active.ids.size) return visible;
    if (!selected) throw new Error('A move or resize preview requires its cached selection index.');
    const margin = inverseMargin(query, active.deltaTick);
    let window: PianoNoteQuery;
    if (active.kind === 'move') {
      window = { ...query, start: query.start - active.deltaTick - margin, end: query.end - active.deltaTick + margin,
        low: query.low === undefined ? undefined : query.low - active.deltaPitch,
        high: query.high === undefined ? undefined : query.high - active.deltaPitch };
    } else {
      window = mode === 'velocity' ? query : { ...query, start: query.start - Math.max(0, active.deltaTick) - margin,
        end: query.end + margin, minimumDuration: Math.max(1, query.minimumDuration ?? 0) };
    }
    const selectedCandidates = candidates(selected, window);
    if (stats) stats.selectedCandidates = selectedCandidates.length;
    const moved: Note[] = [];
    for (const note of selectedCandidates) if (active.ids.has(note.id)) {
      moved.push(active.kind === 'move' ? { ...note, tick: note.tick + active.deltaTick, midi: note.midi + active.deltaPitch }
        : { ...note, duration: Math.max(1, note.duration + active.deltaTick) });
    }
    if (stats) stats.transformedNotes = moved.length;
    const unchanged = visible.filter(note => !active.ids.has(note.id)), output: Note[] = [];
    let left = 0, right = 0;
    while (left < unchanged.length && right < moved.length) {
      if (base.orderOf(unchanged[left].id) < base.orderOf(moved[right].id)) output.push(unchanged[left++]);
      else output.push(moved[right++]);
    }
    while (left < unchanged.length) output.push(unchanged[left++]);
    while (right < moved.length) output.push(moved[right++]);
    return output;
  }
  if (active.kind === 'erase') return visible.filter(note => !active.ids.has(note.id));
  if (active.kind === 'velocity') return visible.map(note => {
    if (!active.ids.has(note.id)) return note;
    const velocity = editedVelocity(note.velocity, active.value, active.velocityMode);
    if (velocity === note.velocity) return note;
    if (stats) stats.transformedNotes++;
    return { ...note, velocity };
  });
  if (active.kind === 'draw' && active.addedPreview) return [...visible, active.addedPreview];
  return visible;
}
