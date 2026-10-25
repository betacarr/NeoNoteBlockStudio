import type { Project, Tempo } from './types';
import { createMeterMap, type MeterProject } from './meter';

interface Fraction { numerator: bigint; denominator: bigint }
interface FrameSegment { tick: number; tickExact: Fraction; secondsPerTick: Fraction; lower: bigint; remainderBound: bigint }
const SECOND_SCALE = 10n ** 30n, MAX_SAFE_FRAME = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO_FRACTION: Fraction = { numerator: 0n, denominator: 1n };
const gcd = (a: bigint, b: bigint): bigint => { while (b) { const next = a % b; a = b; b = next; } return a; };
const fraction = (numerator: bigint, denominator: bigint): Fraction => {
  if (!numerator) return ZERO_FRACTION;
  const common = gcd(numerator, denominator);
  return { numerator: numerator / common, denominator: denominator / common };
};

/** Interpret saved numbers as their shortest round-trip decimal, not IEEE bits. */
function decimalFraction(value: number): Fraction {
  if (Number.isSafeInteger(value)) return { numerator: BigInt(value), denominator: 1n };
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, decimals = ''] = mantissa.split('.'), exponent = Number(exponentText ?? 0) - decimals.length;
  const digits = BigInt(whole + decimals);
  return exponent >= 0 ? { numerator: digits * 10n ** BigInt(exponent), denominator: 1n } : fraction(digits, 10n ** BigInt(-exponent));
}
function addFractions(a: Fraction, b: Fraction): Fraction {
  if (!a.numerator) return b; if (!b.numerator) return a;
  const common = gcd(a.denominator, b.denominator), aScale = b.denominator / common, bScale = a.denominator / common;
  // Reduced inputs mean any remaining common factor must divide `common`.
  const numerator = a.numerator * aScale + b.numerator * bScale, reduction = gcd(numerator, common);
  return { numerator: numerator / reduction, denominator: a.denominator * aScale / reduction };
}
function durationFraction(from: Fraction, to: Fraction, secondsPerTick: Fraction): Fraction {
  return fraction((to.numerator * from.denominator - from.numerator * to.denominator) * secondsPerTick.numerator,
    to.denominator * from.denominator * secondsPerTick.denominator);
}
const halfUp = (numerator: bigint, denominator: bigint): bigint => (2n * numerator + denominator) / (2n * denominator);

/**
 * Exact frame queries with a rigorously bounded fixed-point fast path.
 * Normal queries never build a common rational denominator for the timeline.
 * A true rounding-boundary fallback may still be expensive for a long prefix of
 * unrelated decimal BPMs; its exact BigInt/gcd cost is not bounded by this scale.
 */
class FrameTimeline {
  private readonly segments: FrameSegment[] = [];
  private readonly exactPrefixes = new Map<number, Fraction>([[0, ZERO_FRACTION]]);
  private furthestExactPrefix = 0;

  constructor(ppq: number, tempos: readonly Tempo[]) {
    if (!Number.isFinite(ppq) || ppq <= 0) throw new RangeError('Frame timing requires positive finite PPQ.');
    const division = decimalFraction(ppq), rates = new Map<number, Fraction>();
    let previousBpm: number | undefined;
    for (const tempo of tempos) {
      if (!Number.isFinite(tempo.tick) || tempo.tick < 0 || !Number.isFinite(tempo.bpm) || tempo.bpm <= 0) throw new RangeError('Frame timing requires finite nonnegative tempo ticks and positive finite BPM.');
      const previous = this.segments.at(-1);
      // Keep public TempoMap.events intact; identical rates need no frame boundary.
      if (previous && tempo.bpm === previousBpm) continue;
      let rate = rates.get(tempo.bpm);
      if (!rate) {
        const bpm = decimalFraction(tempo.bpm);
        rate = fraction(60n * division.denominator * bpm.denominator, division.numerator * bpm.numerator); rates.set(tempo.bpm, rate);
      }
      const tickExact = decimalFraction(tempo.tick);
      let lower = previous?.lower ?? 0n, remainderBound = previous?.remainderBound ?? 0n;
      if (previous) {
        const interval = durationFraction(previous.tickExact, tickExact, previous.secondsPerTick), scaled = interval.numerator * SECOND_SCALE;
        lower += scaled / interval.denominator;
        if (scaled % interval.denominator) remainderBound++;
      }
      this.segments.push({ tick: tempo.tick, tickExact, secondsPerTick: rate, lower, remainderBound });
      previousBpm = tempo.bpm;
    }
  }
  private index(tick: number): number {
    let low = 0, high = this.segments.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.segments[middle].tick <= tick) low = middle + 1; else high = middle; }
    return Math.max(0, low - 1);
  }
  private bounded(tick: number): { lower: bigint; remainderBound: bigint; index: number; tickExact: Fraction } {
    const index = this.index(tick), segment = this.segments[index], tickExact = decimalFraction(tick);
    const interval = durationFraction(segment.tickExact, tickExact, segment.secondsPerTick), scaled = interval.numerator * SECOND_SCALE;
    return { lower: segment.lower + scaled / interval.denominator, remainderBound: segment.remainderBound + (scaled % interval.denominator ? 1n : 0n), index, tickExact };
  }
  private exactPrefix(index: number): Fraction {
    const cached = this.exactPrefixes.get(index); if (cached) return cached;
    let first = this.furthestExactPrefix;
    if (first > index) { first = 0; for (const candidate of this.exactPrefixes.keys()) if (candidate <= index && candidate > first) first = candidate; }
    let value = this.exactPrefixes.get(first)!;
    for (let at = first; at < index; at++) value = addFractions(value, durationFraction(this.segments[at].tickExact, this.segments[at + 1].tickExact, this.segments[at].secondsPerTick));
    // Cache only requested boundaries, not every ever-growing rational prefix.
    this.exactPrefixes.set(index, value); this.furthestExactPrefix = Math.max(this.furthestExactPrefix, index); return value;
  }
  private exact(value: ReturnType<FrameTimeline['bounded']>): Fraction {
    const segment = this.segments[value.index];
    return addFractions(this.exactPrefix(value.index), durationFraction(segment.tickExact, value.tickExact, segment.secondsPerTick));
  }
  frame(tick: number, sampleRate: number, repetition?: { cycle: number; endTick: number }): number {
    if (!Number.isFinite(tick) || tick < 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('Frame queries require a finite nonnegative tick and positive safe-integer sample rate.');
    if (repetition && (!Number.isSafeInteger(repetition.cycle) || repetition.cycle < 0 || !Number.isFinite(repetition.endTick) || repetition.endTick < 0)) throw new RangeError('Frame repetition requires a nonnegative safe-integer cycle and finite nonnegative end tick.');
    const note = this.bounded(tick), period = repetition?.cycle ? this.bounded(repetition.endTick) : undefined;
    const cycle = BigInt(repetition?.cycle ?? 0), rate = BigInt(sampleRate);
    const lower = note.lower + (period ? cycle * period.lower : 0n), error = note.remainderBound + (period ? cycle * period.remainderBound : 0n);
    // Every truncated duration contributes 0 <= remainder < 1 / SECOND_SCALE.
    // With error=0 this is the closed singleton {lower / SECOND_SCALE};
    // otherwise exact seconds lie in [lower, lower + error) / SECOND_SCALE.
    // Half-up is monotone: equal rounded endpoints prove the exact answer.
    const first = halfUp(lower * rate, SECOND_SCALE), last = halfUp((lower + error) * rate, SECOND_SCALE);
    let result = first;
    if (first !== last) {
      let value = this.exact(note);
      if (period) {
        const exactPeriod = this.exact(period), reduction = gcd(cycle, exactPeriod.denominator);
        value = addFractions(value, { numerator: exactPeriod.numerator * (cycle / reduction), denominator: exactPeriod.denominator / reduction });
      }
      result = halfUp(value.numerator * rate, value.denominator);
    }
    if (result > MAX_SAFE_FRAME) throw new RangeError('Frame position exceeds Number.MAX_SAFE_INTEGER.');
    return Number(result);
  }
}

export function sortedTempos(tempos: Tempo[]): Tempo[] {
  const map = new Map(tempos.map(tempo => [tempo.tick, tempo.bpm]));
  if (!map.has(0)) map.set(0, 120);
  return [...map].sort((a, b) => a[0] - b[0]).map(([tick, bpm]) => ({ tick, bpm }));
}
export class TempoMap {
  readonly events: readonly (Tempo & { seconds: number })[];
  private frameTimeline?: FrameTimeline;
  constructor(readonly ppq: number, tempos: Tempo[]) {
    const events: (Tempo & { seconds: number })[] = [];
    for (const tempo of sortedTempos(tempos)) {
      const previous = events.at(-1);
      events.push({ ...tempo, seconds: previous ? previous.seconds + (tempo.tick - previous.tick) / ppq * 60 / previous.bpm : 0 });
    }
    this.events = events;
  }
  private index(value: number, key: 'tick' | 'seconds') {
    let low = 0, high = this.events.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.events[middle][key] <= value) low = middle + 1; else high = middle; }
    return Math.max(0, low - 1);
  }
  at(tick: number) { return this.events[this.index(tick, 'tick')]; }
  seconds(tick: number): number { const tempo = this.at(tick); return tempo.seconds + (tick - tempo.tick) / this.ppq * 60 / tempo.bpm; }
  tick(seconds: number): number { const tempo = this.events[this.index(seconds, 'seconds')]; return tempo.tick + (seconds - tempo.seconds) * this.ppq * tempo.bpm / 60; }
  /**
   * Interpret finite nonnegative ticks/BPMs by their saved decimal numbers and
   * half-up round the complete time once, including preceding cycles. Rates and
   * cycle counts are safe integers; an unsafe resulting frame throws.
   */
  frame(tick: number, sampleRate: number, repetition?: { cycle: number; endTick: number }): number { return (this.frameTimeline ??= new FrameTimeline(this.ppq, this.events)).frame(tick, sampleRate, repetition); }
}
export const createTempoMap = (project: Pick<Project, 'tempos' | 'ppq'>): TempoMap => new TempoMap(project.ppq, project.tempos);
export const tickToSeconds = (tick: number, project: Pick<Project, 'tempos' | 'ppq'>): number => createTempoMap(project).seconds(tick);
export const secondsToTick = (seconds: number, project: Pick<Project, 'tempos' | 'ppq'>): number => createTempoMap(project).tick(seconds);
export const snapTick = (tick: number, step: number): number => step > 0 ? Math.max(0, Math.round(tick / step) * step) : Math.max(0, Math.round(tick));
export const formatPosition = (tick: number, project: MeterProject): string => createMeterMap(project).format(tick);
