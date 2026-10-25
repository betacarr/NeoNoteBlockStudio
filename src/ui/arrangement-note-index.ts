import type { Note, Region } from '../core/types';
import { loopNoteCycles, MAX_PROJECT_TICK } from '../core/expansion';
import type { PreviewWindow } from './arrangement-preview';
import { PianoNoteIndex } from './piano-note-index';

export interface ArrangementNoteQueryStats {
  visitedNodes: number;
  /** Index leaf candidates, including repeated visits across folded windows. */
  testedNotes: number;
  candidates: number;
}
type PreviewRegion = Pick<Region, 'offset' | 'length' | 'loop'>;
interface PhaseIndex {
  order: Uint32Array;
  starts: Float64Array;
  ends: Float64Array;
  earliest: Float64Array;
  leafBase: number;
}

/** One immutable source/period pair; its two time indexes are built only as used.
 * Query counters exclude that one-time construction. There is no global cache.
 */
export class ArrangementNoteIndex {
  readonly lowPitch: number;
  readonly highPitch: number;
  readonly period: number;
  private readonly magnitude: number;
  private actual?: PianoNoteIndex;
  private phase?: PhaseIndex;

  constructor(readonly notes: readonly Note[], period: number) {
    this.period = Math.max(1, period);
    let low = 127, high = 0, magnitude = this.period;
    for (const note of notes) {
      low = Math.min(low, note.midi); high = Math.max(high, note.midi);
      magnitude = Math.max(magnitude, note.tick + note.duration);
    }
    this.lowPitch = notes.length ? low : 60; this.highPitch = notes.length ? high : 60;
    this.magnitude = magnitude;
  }

  /** A conservative, source-ordered set. The geometry caller clips actual ink. */
  candidates(region: PreviewRegion, view: PreviewWindow, stats?: ArrangementNoteQueryStats): Note[] {
    if (stats) { stats.visitedNodes = 0; stats.testedNotes = 0; stats.candidates = 0; }
    if (!this.notes.length || ![region.offset, region.length, view.offset, view.width, view.regionWidth, this.period].every(Number.isFinite)
      || region.length <= 0 || view.width <= 0 || view.regionWidth <= 0) return [];
    const pixels = view.regionWidth / region.length;
    const finish = (notes: Note[]) => { if (stats) stats.candidates = notes.length; return notes; };
    const all = (upper = Infinity) => {
      this.actual ??= new PianoNoteIndex(this.notes);
      const work = { visitedNodes: 0, testedNotes: 0 };
      const possible = this.actual.starts(-Infinity, upper, work);
      if (stats) { stats.visitedNodes += work.visitedNodes; stats.testedNotes += work.testedNotes; }
      return finish(possible.filter(note => this.canHaveInk(note, region, view, pixels)));
    };
    // An underflowed scale cannot be inverted. Preserve candidates for the
    // geometry's forward arithmetic rather than guessing an empty window.
    if (!(pixels > 0) || !Number.isFinite(pixels)) return all();
    const start = region.offset + view.offset / pixels, span = view.width / pixels, end = start + span;
    const minimum = 2 / pixels;
    if (![start, span, end, minimum].every(Number.isFinite)) return all();
    const padding = 32 * Number.EPSILON * Math.max(1, this.magnitude, Math.abs(region.offset), region.length, Math.abs(start), Math.abs(end), minimum);
    const work = { visitedNodes: 0, testedNotes: 0 };
    const query = (index: PianoNoteIndex, left: number, right: number) => {
      const result = index.query({ start: left, end: right, minimumDuration: minimum }, work);
      if (stats) { stats.visitedNodes += work.visitedNodes; stats.testedNotes += work.testedNotes; }
      return result;
    };
    if (!region.loop) {
      this.actual ??= new PianoNoteIndex(this.notes);
      return finish(query(this.actual, start - padding, end + padding).filter(note => this.canHaveInk(note, region, view, pixels)));
    }
    const upper = Math.min(region.offset + region.length, end) + padding;
    if (span + padding * 2 >= this.period || minimum + padding >= this.period) return all(upper);
    this.phase ??= this.buildPhase();
    const orders = new Set<number>();
    const collect = (left: number, right: number) => {
      for (const order of this.phaseCandidates(left, right, minimum, upper, stats)) orders.add(order);
      // Ink from the preceding phase can extend through the phase seam.
      for (const order of this.phaseCandidates(left + this.period, right + this.period, minimum, upper, stats)) orders.add(order);
    };
    const width = span + padding * 2;
    const folded = ((start - padding) % this.period + this.period) % this.period;
    const right = folded + width;
    collect(folded, Math.min(this.period, right));
    if (right > this.period) collect(0, right - this.period);
    const result: Note[] = [];
    for (const order of [...orders].sort((left, right) => left - right)) {
      const note = this.notes[order];
      if (this.canHaveInk(note, region, view, pixels)) result.push(note);
    }
    return finish(result);
  }

  private buildPhase(): PhaseIndex {
    const phases = Float64Array.from(this.notes, note => note.tick % this.period);
    const order = Uint32Array.from({ length: this.notes.length }, (_, index) => index);
    // Equal-phase legacy notes stay ordered by their original first onset,
    // allowing whole future subtrees to be rejected before testing leaves.
    order.sort((left, right) => phases[left] - phases[right] || this.notes[left].tick - this.notes[right].tick || left - right);
    let leafBase = 1;
    while (leafBase < order.length) leafBase *= 2;
    const starts = new Float64Array(order.length), ends = new Float64Array(leafBase * 2), earliest = new Float64Array(leafBase * 2);
    ends.fill(-Infinity); earliest.fill(Infinity);
    for (let index = 0; index < order.length; index++) {
      const source = order[index], note = this.notes[source];
      starts[index] = phases[source]; ends[leafBase + index] = phases[source] + note.duration;
      earliest[leafBase + index] = note.tick;
    }
    for (let node = leafBase - 1; node > 0; node--) {
      ends[node] = Math.max(ends[node * 2], ends[node * 2 + 1]);
      earliest[node] = Math.min(earliest[node * 2], earliest[node * 2 + 1]);
    }
    return { order, starts, ends, earliest, leafBase };
  }

  private phaseCandidates(start: number, end: number, minimum: number, upper: number, stats?: ArrangementNoteQueryStats): number[] {
    const phase = this.phase!;
    let low = 0, high = phase.order.length;
    while (low < high) {
      if (stats) stats.visitedNodes++;
      const middle = Math.floor((low + high) / 2);
      if (phase.starts[middle] <= end) low = middle + 1; else high = middle;
    }
    const until = low, result: number[] = [];
    if (!until) return result;
    const visit = (node: number, left: number, right: number): void => {
      if (stats) stats.visitedNodes++;
      if (left >= until || phase.earliest[node] > upper) return;
      if (Math.max(phase.ends[node], phase.starts[Math.min(right, until) - 1] + minimum) < start) return;
      if (right - left === 1) {
        if (stats) stats.testedNotes++;
        result.push(phase.order[left]); return;
      }
      const middle = (left + right) / 2;
      visit(node * 2, left, middle); visit(node * 2 + 1, middle, right);
    };
    visit(1, 0, phase.leafBase);
    return result;
  }

  /** Reject impossible original-cycle ranges without choosing visible cycles. */
  private canHaveInk(note: Note, region: PreviewRegion, view: PreviewWindow, pixels: number): boolean {
    const width = Math.max(2, note.duration * pixels);
    let first = 0, last = 0;
    if (region.loop) {
      // Only the non-loop left-prepend preview has a negative effective offset.
      // Unvalidated transient loop ranges stay conservative rather than throw.
      if (region.offset < 0 || region.offset > MAX_PROJECT_TICK || region.length < 1 || region.length > MAX_PROJECT_TICK || this.period > MAX_PROJECT_TICK) return true;
      ({ first, last } = loopNoteCycles(note.tick, this.period, region.offset, region.length));
      if (last < first) return false;
    } else {
      const local = note.tick - region.offset;
      if (local < 0 || local >= region.length) return false;
    }
    const left = (note.tick + first * this.period - region.offset) * pixels;
    const right = (note.tick + last * this.period - region.offset) * pixels + width;
    const padding = 32 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right), Math.abs(view.offset), Math.abs(view.offset + view.width));
    return left <= view.offset + view.width + padding && right >= view.offset - padding;
  }
}
