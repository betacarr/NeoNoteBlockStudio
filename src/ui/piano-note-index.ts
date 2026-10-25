import type { Note } from '../core/types';

export interface PianoNoteQuery {
  start: number;
  end: number;
  low?: number;
  high?: number;
  minimumDuration?: number;
}
export interface PianoNoteQueryStats {
  /** Tree nodes and binary-search positions examined, including pruned nodes. */
  visitedNodes: number;
  /** Source-note candidates examined after index pruning. */
  testedNotes: number;
}
interface PitchIndex {
  order: Uint32Array;
  starts: Float64Array;
  ends: Float64Array;
  leafBase: number;
}

const resetStats = (stats?: PianoNoteQueryStats) => { if (stats) { stats.visitedNodes = 0; stats.testedNotes = 0; } };

/** Rebuild when the immutable source array changes; this class holds no global cache. */
export class PianoNoteIndex {
  readonly maxEnd: number;
  readonly minTick: number;
  readonly lowPitch: number;
  readonly highPitch: number;
  private readonly onsetOrder: Uint32Array;
  private readonly pitches: (PitchIndex | undefined)[];
  private readonly sourceOrder = new Map<string, number>();

  constructor(readonly notes: readonly Note[]) {
    const counts = new Uint32Array(128);
    let minTick = Infinity, maxEnd = 0, lowPitch = 127, highPitch = 0;
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      counts[note.midi]++;
      this.sourceOrder.set(note.id, index);
      minTick = Math.min(minTick, note.tick); maxEnd = Math.max(maxEnd, note.tick + note.duration);
      lowPitch = Math.min(lowPitch, note.midi); highPitch = Math.max(highPitch, note.midi);
    }
    this.minTick = notes.length ? minTick : 0; this.maxEnd = maxEnd;
    this.lowPitch = notes.length ? lowPitch : 60; this.highPitch = notes.length ? highPitch : 60;
    this.onsetOrder = Uint32Array.from({ length: notes.length }, (_, index) => index);
    this.onsetOrder.sort((left, right) => notes[left].tick - notes[right].tick || left - right);
    this.pitches = Array.from(counts, count => {
      if (!count) return undefined;
      let leafBase = 1;
      while (leafBase < count) leafBase *= 2;
      const ends = new Float64Array(leafBase * 2); ends.fill(-Infinity);
      return { order: new Uint32Array(count), starts: new Float64Array(count), ends, leafBase };
    });
    const positions = new Uint32Array(128);
    for (const source of this.onsetOrder) {
      const note = notes[source], pitch = this.pitches[note.midi]!, position = positions[note.midi]++;
      pitch.order[position] = source; pitch.starts[position] = note.tick;
      pitch.ends[pitch.leafBase + position] = note.tick + note.duration;
    }
    for (const pitch of this.pitches) if (pitch) {
      for (let node = pitch.leafBase - 1; node > 0; node--) pitch.ends[node] = Math.max(pitch.ends[node * 2], pitch.ends[node * 2 + 1]);
    }
  }

  /** Closed body intersection, including the zoom-dependent minimum visual width. */
  query(query: PianoNoteQuery, stats?: PianoNoteQueryStats): Note[] {
    resetStats(stats);
    const { start, end } = query, minimumDuration = Math.max(0, query.minimumDuration ?? 0);
    const low = Math.max(0, Math.ceil(query.low ?? 0)), high = Math.min(127, Math.floor(query.high ?? 127));
    if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(minimumDuration) || Number.isNaN(low) || Number.isNaN(high) || end < start || low > high) return [];
    const result: number[] = [];
    for (let midi = low; midi <= high; midi++) {
      const pitch = this.pitches[midi]; if (!pitch) continue;
      let lower = 0, upper = pitch.starts.length;
      while (lower < upper) {
        if (stats) stats.visitedNodes++;
        const middle = Math.floor((lower + upper) / 2);
        if (pitch.starts[middle] <= end) lower = middle + 1; else upper = middle;
      }
      const until = lower; if (!until) continue;
      const visit = (node: number, left: number, right: number): void => {
        if (stats) stats.visitedNodes++;
        if (left >= until) return;
        const latest = pitch.starts[Math.min(right, until) - 1];
        if (Math.max(pitch.ends[node], latest + minimumDuration) < start) return;
        if (right - left === 1) {
          if (stats) stats.testedNotes++;
          result.push(pitch.order[left]);
          return;
        }
        const middle = (left + right) / 2;
        visit(node * 2, left, middle); visit(node * 2 + 1, middle, right);
      };
      visit(1, 0, pitch.leafBase);
    }
    return this.inSourceOrder(result);
  }

  /** Closed onset window for velocity stems and onset hover. */
  starts(start: number, end: number, stats?: PianoNoteQueryStats): Note[] {
    resetStats(stats);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
    const boundary = (value: number, afterEqual: boolean): number => {
      let low = 0, high = this.onsetOrder.length;
      while (low < high) {
        if (stats) stats.visitedNodes++;
        const middle = Math.floor((low + high) / 2), tick = this.notes[this.onsetOrder[middle]].tick;
        if (tick < value || afterEqual && tick === value) low = middle + 1; else high = middle;
      }
      return low;
    };
    const first = boundary(start, false), last = boundary(end, true), result: number[] = [];
    for (let index = first; index < last; index++) {
      if (stats) stats.testedNotes++;
      result.push(this.onsetOrder[index]);
    }
    return this.inSourceOrder(result);
  }

  /** Match requested IDs without scanning the source array on each pointer frame. */
  forIds(ids: ReadonlySet<string>): Note[] {
    const result: number[] = [];
    for (const id of ids) {
      const order = this.sourceOrder.get(id);
      if (order !== undefined) result.push(order);
    }
    return this.inSourceOrder(result);
  }

  orderOf(id: string): number { return this.sourceOrder.get(id) ?? -1; }

  private inSourceOrder(orders: number[]): Note[] {
    orders.sort((left, right) => left - right);
    return orders.map(order => this.notes[order]);
  }
}
