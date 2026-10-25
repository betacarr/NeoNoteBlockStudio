import type { Pattern, Project, Region, TimeSignature } from './types';

export type MeterProject = Pick<Project, 'ppq' | 'timeSignatures'>;
export interface MeterSegment { tick: number; endTick: number; bar: number; numerator: number; denominator: number; beatTicks: number; barTicks: number }
export interface MusicalPosition { bar: number; beat: number; fraction: number; barStart: number; barEnd: number; beatTicks: number; numerator: number; denominator: number }
export interface GridMark { tick: number; kind: 'bar' | 'beat' | 'division'; bar: number; beat: number; label?: string; signature?: string }
const upperIndex = (values: readonly MeterSegment[], tick: number) => {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle].tick <= tick) low = middle + 1; else high = middle; }
  return Math.max(0, low - 1);
};
const wholeBars = (value: number) => { const nearest = Math.round(value); return Math.abs(value - nearest) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4 ? nearest : Math.ceil(value); };
const stride = (pixels: number, minimum: number) => pixels >= minimum ? 1 : 2 ** Math.ceil(Math.log2(minimum / pixels));

export class MeterMap {
  readonly segments: readonly MeterSegment[];
  constructor(readonly ppq: number, signatures: readonly TimeSignature[]) {
    const changes = new Map<number, TimeSignature>(signatures.map(signature => [signature.tick, signature]));
    if (!changes.has(0)) changes.set(0, { tick: 0, numerator: 4, denominator: 4 });
    const segments: MeterSegment[] = [];
    for (const signature of [...changes.values()].sort((a, b) => a.tick - b.tick)) {
      const previous = segments.at(-1);
      if (previous?.numerator === signature.numerator && previous.denominator === signature.denominator) continue;
      const beatTicks = ppq * 4 / signature.denominator;
      const bar = previous ? previous.bar + wholeBars((signature.tick - previous.tick) / previous.barTicks) : 1;
      if (previous) previous.endTick = signature.tick;
      segments.push({ tick: signature.tick, endTick: Infinity, bar, numerator: signature.numerator, denominator: signature.denominator, beatTicks, barTicks: beatTicks * signature.numerator });
    }
    this.segments = segments;
  }
  at(tick: number): MusicalPosition {
    const segment = this.segments[upperIndex(this.segments, tick)], relative = tick - segment.tick;
    const offset = Math.floor(relative / segment.barTicks), barStart = segment.tick + offset * segment.barTicks;
    const beatPosition = (tick - barStart) / segment.beatTicks, beat = Math.floor(beatPosition);
    return { bar: segment.bar + offset, beat: beat + 1, fraction: beatPosition - beat, barStart, barEnd: Math.min(barStart + segment.barTicks, segment.endTick), beatTicks: segment.beatTicks, numerator: segment.numerator, denominator: segment.denominator };
  }
  format(tick: number): string {
    const position = this.at(tick);
    return `${position.bar}.${position.beat}.${String(Math.min(99, Math.floor(position.fraction * 100 + 1e-9))).padStart(2, '0')}`;
  }
  barTick(bar: number): number {
    let low = 0, high = this.segments.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.segments[middle].bar <= bar) low = middle + 1; else high = middle; }
    const segment = this.segments[Math.max(0, low - 1)];
    return segment.tick + (bar - segment.bar) * segment.barTicks;
  }
  barSnap(tick: number, mode: 'floor' | 'ceil' | 'nearest' = 'nearest'): number {
    const position = this.at(tick);
    if (mode === 'floor' || tick === position.barStart) return position.barStart;
    if (mode === 'ceil') return position.barEnd;
    return tick - position.barStart < position.barEnd - tick ? position.barStart : position.barEnd;
  }
  snap(tick: number, step: number): number {
    if (step <= 0) return tick;
    const { barStart, barEnd } = this.at(tick), lower = barStart + Math.floor((tick - barStart) / step) * step;
    const upper = Math.min(barEnd, lower + step);
    return tick - lower < upper - tick ? lower : upper;
  }
  grid(start: number, end: number, pixelsPerTick: number, division = 0): GridMark[] {
    if (!(end > start) || !(pixelsPerTick > 0)) return [];
    const marks = new Map<number, GridMark>(), rank = { division: 0, beat: 1, bar: 2 };
    const add = (tick: number, kind: GridMark['kind'], label?: string, signature?: string) => {
      if (tick < Math.max(0, start) || tick > end || marks.size >= 4096) return;
      const previous = marks.get(tick); if (previous && rank[previous.kind] > rank[kind]) return;
      const position = this.at(tick); marks.set(tick, { tick, kind, bar: position.bar, beat: position.beat, label, signature });
    };
    for (let i = upperIndex(this.segments, Math.max(0, start)); i < this.segments.length; i++) {
      const segment = this.segments[i]; if (segment.tick > end || marks.size >= 4096) break;
      const from = Math.max(0, start, segment.tick), until = Math.min(end, segment.endTick);
      const barPixels = segment.barTicks * pixelsPerTick, labelStride = stride(barPixels, 46);
      let firstBar = Math.max(0, Math.floor((from - segment.tick) / segment.barTicks));
      const skip = barPixels < 7 ? labelStride : 1;
      if (skip > 1) firstBar += (skip - (segment.bar - 1 + firstBar) % skip) % skip;
      for (let n = firstBar; ; n += skip) {
        const barStart = segment.tick + n * segment.barTicks;
        if (barStart > until || barStart >= segment.endTick || marks.size >= 4096) break;
        const barEnd = Math.min(barStart + segment.barTicks, segment.endTick), bar = segment.bar + n;
        add(barStart, 'bar', (bar - 1) % labelStride === 0 ? String(bar) : undefined);
        if (barPixels < 7) continue;
        const beatStep = segment.beatTicks * stride(segment.beatTicks * pixelsPerTick, 28);
        for (let tick = barStart + Math.max(1, Math.ceil((from - barStart) / beatStep)) * beatStep; tick < Math.min(barEnd, end + .0000001); tick += beatStep) {
          const position = this.at(tick); add(tick, 'beat', `${position.bar}.${position.beat}`);
        }
        if (division > 0) {
          const step = division * stride(division * pixelsPerTick, 7);
          for (let tick = barStart + Math.max(1, Math.ceil((from - barStart) / step)) * step; tick < Math.min(barEnd, end + .0000001); tick += step) add(tick, 'division');
        }
      }
      if (segment.tick > 0) add(segment.tick, 'bar', String(segment.bar), `${segment.numerator}/${segment.denominator}`);
    }
    return [...marks.values()].sort((a, b) => a.tick - b.tick);
  }
}
export const createMeterMap = (project: MeterProject): MeterMap => new MeterMap(project.ppq, project.timeSignatures);
export const patternOrigin = (region: Region, pattern: Pattern): number => region.start - (region.loop ? region.offset % Math.max(1, pattern.length) : region.offset);
export function patternTickAt(tick: number, region: Region, pattern: Pattern): number {
  const source = Math.max(tick, region.start) - region.start + region.offset;
  return region.loop ? source % Math.max(1, pattern.length) : source;
}
export function grownPatternLength(project: MeterProject, region: Region, pattern: Pattern, required: number): number {
  if (required <= pattern.length) return pattern.length;
  const origin = patternOrigin(region, pattern);
  return Math.max(required, createMeterMap(project).barSnap(origin + required, 'ceil') - origin);
}
export function patternPlayhead(tick: number, region: Region, pattern: Pattern): number {
  if (tick < region.start || tick >= region.start + region.length) return -1;
  return patternTickAt(tick, region, pattern);
}
