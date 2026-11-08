import type { ChordRange } from './chord-track';
import { loopNoteCycles } from './expansion';
import { noteName } from './instruments';
import type { Pattern, Region } from './types';

const chordShapes: readonly [string, readonly number[]][] = [
  ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]],
  ['m(maj7)', [0, 3, 7, 11]], ['m7♭5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['add9', [0, 2, 4, 7]],
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
];
const pitchName = (pitch: number) => noteName(pitch).replace(/-?\d+$/, '');
const templates = Array.from({ length: 12 }, (_, root) => chordShapes.map(([suffix, intervals]) => ({
  root, name: pitchName(root) + suffix, mask: intervals.reduce((mask, interval) => mask | 1 << (root + interval) % 12, 0),
  count: intervals.length, fifth: intervals.includes(7),
}))).flat();

function chordName(mask: number, count: number, bass: number): string | undefined {
  let best: string | undefined, score = -Infinity;
  for (const template of templates) {
    if (template.count > count || count - template.count > 1 || (mask & template.mask) !== template.mask) continue;
    const inversion = template.root !== bass;
    // Favour a complete spelling and a root-position reading when multiple
    // names share the same notes (C6/Am7 and suspended-chord inversions).
    const rank = template.count * 3 + (inversion ? 0 : 2) + (template.fifth ? .25 : 0);
    if (rank <= score) continue;
    score = rank;
    best = template.name + (inversion ? '/' + pitchName(bass) : '');
  }
  return best;
}

interface Event { tick: number; pitch: number; delta: 1 | -1 }

/** Analyse played MIDI pitches directly, including each visible loop occurrence. */
export function analyzeMidiRegionChords(pattern: Pattern, region: Region, ppq: number): ChordRange[] {
  const events: Event[] = [];
  const period = Math.max(1, pattern.length);
  for (const note of pattern.notes) {
    if (note.velocity <= 0 || note.duration <= 0) continue;
    const { first, last } = region.loop ? loopNoteCycles(note.tick, period, region.offset, region.length) : { first: 0, last: 0 };
    for (let cycle = first; cycle <= last; cycle++) {
      const start = note.tick + cycle * period - region.offset;
      if (start < 0 || start >= region.length) continue;
      if (events.length >= 400000) throw new Error('MIDI 和弦分析超过 20 万个音符事件，请缩短片段或循环范围。');
      events.push({ tick: start, pitch: note.midi, delta: 1 }, { tick: Math.min(region.length, start + note.duration), pitch: note.midi, delta: -1 });
    }
  }
  events.sort((a, b) => a.tick - b.tick);
  const chords: ChordRange[] = [], pitches = new Int32Array(128), classes = new Int32Array(12);
  const names = new Map<number, string | undefined>();
  const arpeggios = new Map<number, { mask: number; bass: number; start: number }>();
  let mask = 0, count = 0, bass = 128;
  const identify = (mask: number, count: number, bass: number) => {
    if (count < 3 || count > 5) return;
    const key = mask * 12 + bass;
    if (!names.has(key)) names.set(key, chordName(mask, count, bass));
    return names.get(key);
  };
  for (let i = 0; i < events.length;) {
    const tick = events[i].tick;
    while (events[i]?.tick === tick) {
      const { pitch, delta } = events[i++], pc = pitch % 12;
      pitches[pitch] += delta;
      if (delta === 1) {
        if (++classes[pc] === 1) { mask |= 1 << pc; count++; }
        bass = Math.min(bass, pitch);
        const beat = Math.floor(tick / ppq), earlier = arpeggios.get(beat);
        if (earlier) { earlier.mask |= 1 << pc; earlier.bass = Math.min(earlier.bass, pitch); }
        else arpeggios.set(beat, { mask: 1 << pc, bass: pitch, start: tick });
      } else if (--classes[pc] === 0) { mask &= ~(1 << pc); count--; }
    }
    while (bass < 128 && !pitches[bass]) bass++;
    const end = events[i]?.tick;
    if (end === undefined) break;
    const name = identify(mask, count, bass % 12);
    if (!name) continue;
    const previous = chords.at(-1);
    if (previous?.name === name && previous.end === tick) previous.end = end;
    else chords.push({ name, start: tick, end });
  }
  const minimum = Math.min(ppq / 12, region.length / 2);
  const sustained = chords.filter(chord => chord.end - chord.start >= minimum);
  const broken: ChordRange[] = [];
  let index = 0;
  for (const [beat, evidence] of arpeggios) {
    const start = evidence.start, end = Math.min(region.length, (beat + 1) * ppq);
    while (sustained[index]?.end <= start) index++;
    if (sustained[index]?.start < end) continue;
    let count = 0;
    for (let bits = evidence.mask; bits; bits &= bits - 1) count++;
    const name = identify(evidence.mask, count, evidence.bass % 12);
    if (name && end - start >= minimum) broken.push({ name, start, end });
  }
  const output: ChordRange[] = [];
  for (const chord of [...sustained, ...broken].sort((a, b) => a.start - b.start)) {
    const start = chord.start + region.offset, end = chord.end + region.offset, last = output.at(-1);
    if (end <= start) continue;
    if (last?.name === chord.name && last.end === start) last.end = end;
    else output.push({ name: chord.name, start, end });
  }
  if (output.length > 100000) throw new Error('MIDI 片段产生了过多和弦标记，请缩短片段。');
  return output;
}
