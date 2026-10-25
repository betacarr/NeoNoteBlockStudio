import { describe, expect, it } from 'vitest';
import { TempoMap } from '../src/core/time';
import type { Tempo } from '../src/core/types';

// Deliberately slow, independent oracle: integrate exact decimal fractions from
// scratch on every query. No production fixed-point bounds or prefix cache.
type Rational = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
const reduce = (n: bigint, d: bigint): Rational => { const g = gcd(n, d); return [n / g, d / g]; };
function decimal(value: number): Rational {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value))!;
  const places = (match[2]?.length ?? 0) - Number(match[3] ?? 0), digits = BigInt(match[1] + (match[2] ?? ''));
  return places < 0 ? [digits * 10n ** BigInt(-places), 1n] : reduce(digits, 10n ** BigInt(places));
}
const add = ([a, b]: Rational, [c, d]: Rational): Rational => reduce(a * d + c * b, b * d);
function seconds(tick: number, ppq: number, input: Tempo[]): Rational {
  const last = new Map(input.map(event => [event.tick, event.bpm])); if (!last.has(0)) last.set(0, 120);
  const tempos = [...last].sort((a, b) => a[0] - b[0]), division = decimal(ppq);
  let total: Rational = [0n, 1n];
  for (let index = 0; index < tempos.length && tempos[index][0] < tick; index++) {
    const from = decimal(tempos[index][0]), to = decimal(Math.min(tick, tempos[index + 1]?.[0] ?? tick)), bpm = decimal(tempos[index][1]);
    total = add(total, reduce((to[0] * from[1] - from[0] * to[1]) * 60n * division[1] * bpm[1], to[1] * from[1] * division[0] * bpm[0]));
  }
  return total;
}
function frame(tick: number, ppq: number, tempos: Tempo[], rate: number, repeat?: { cycle: number; endTick: number }): number {
  let exact = seconds(tick, ppq, tempos);
  if (repeat) { const period = seconds(repeat.endTick, ppq, tempos); exact = add(exact, [period[0] * BigInt(repeat.cycle), period[1]]); }
  return Number((exact[0] * BigInt(rate) * 2n + exact[1]) / (2n * exact[1]));
}

describe('exact musical event frames', () => {
  it('rounds the BPM96 half-frame counterexample upward without seconds round-tripping', () => {
    const map = new TempoMap(480, [{ tick: 0, bpm: 96 }]);
    expect(Math.round(map.seconds(123) * 48000)).toBe(7687);
    expect(map.frame(123, 48000)).toBe(7688);
    expect(map.frame(245, 48000)).toBe(15313);
    expect(map.frame(505, 48000)).toBe(31563);
  });

  it('keeps public repeated messages while preventing their prefix rounding from losing a half frame', () => {
    const tempos = Array.from({ length: 55 }, (_, tick) => ({ tick, bpm: 176 })), map = new TempoMap(960, tempos);
    expect(map.events).toHaveLength(55);
    expect(map.frame(55, 48000)).toBe(938); // 937.5 exactly
    expect(map.frame(77, 48000)).toBe(1313);
  });

  it('resolves exact half frames at and after a nonterminating tempo prefix, in either query order', () => {
    const tempos = [{ tick: 0, bpm: 96 }, { tick: 1, bpm: 128 }, { tick: 240, bpm: 96 }], map = new TempoMap(480, tempos);
    for (const tick of [653, 1, 241, 0, 1, 653, 239, 242]) expect(map.frame(tick, 48000)).toBe(frame(tick, 480, tempos, 48000));
    expect(map.frame(1, 48000)).toBe(63); // prefix=62.5 frames exactly
  });

  it('uses last-at-same-tick semantics and snapshots its input', () => {
    const tempos = [{ tick: 480, bpm: 96 }, { tick: 0, bpm: 120 }, { tick: 480, bpm: 64 }, { tick: 960, bpm: 160 }], map = new TempoMap(480, tempos);
    expect(map.events.map(({ tick, bpm }) => [tick, bpm])).toEqual([[0, 120], [480, 64], [960, 160]]);
    expect(map.frame(600, 48000)).toBe(35250);
    tempos[1].bpm = 999;
    expect(map.frame(600, 48000)).toBe(35250);
    expect(map.seconds(600)).toBe(.734375);
  });

  it.each([22050, 44100, 48000, 96000])('quantizes once at %i Hz, including a nonzero position and fractional ticks', rate => {
    const tempos = [{ tick: 0, bpm: 96.1 }, { tick: 480.5, bpm: 123.456789 }, { tick: 1000.125, bpm: 176 }], map = new TempoMap(960, tempos);
    for (const tick of [0, .1, 123, 480.5, 800.25, 1000.125, 2400.75]) expect(map.frame(tick, rate)).toBe(frame(tick, 960, tempos, rate));
  });

  it('interprets exponent-form BPM and tick values as their saved decimal numbers', () => {
    const tempos = [{ tick: 0, bpm: 1e-7 }], map = new TempoMap(960, tempos);
    expect(map.frame(1e-7, 48000)).toBe(3000);
    expect(map.frame(1e-9, 48000)).toBe(30);
  });

  it('combines an exact fractional loop period and note before rounding, without per-cycle frame drift', () => {
    const tempos = [{ tick: 0, bpm: 137 }], map = new TempoMap(960, tempos);
    for (const cycle of [0, 1, 2, 299, 300, 1000000]) expect(map.frame(768, 48000, { cycle, endTick: 960 })).toBe(frame(768, 960, tempos, 48000, { cycle, endTick: 960 }));
    expect(map.frame(768, 48000, { cycle: 300, endTick: 960 })).not.toBe(map.frame(768, 48000) + 300 * map.frame(960, 48000));
    const mixed = [{ tick: 0, bpm: 120 }, { tick: 480.5, bpm: 96 }, { tick: 1000.125, bpm: 137 }], indexed = new TempoMap(960, mixed);
    for (const rate of [22050, 44100, 48000, 96000]) for (const cycle of [0, 1, 19]) expect(indexed.frame(.125, rate, { cycle, endTick: 960.25 })).toBe(frame(.125, 960, mixed, rate, { cycle, endTick: 960.25 }));
  });

  it('matches an exact rational oracle across independent tempo/decimal/repetition fixtures', () => {
    let seed = 137;
    const random = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
    for (let fixture = 0; fixture < 160; fixture++) {
      const ppq = [96, 480, 960, 1000][random(4)], tempos = [{ tick: 0, bpm: (40 + random(261)) / 10 }];
      for (let index = 0; index < 8; index++) tempos.push({ tick: tempos.at(-1)!.tick + (1 + random(1920)) / 8, bpm: 40 + random(261) / 10 });
      const map = new TempoMap(ppq, tempos), endTick = tempos.at(-1)!.tick + 700.125;
      for (const tick of [0, .125, endTick / 2, endTick]) {
        const rate = [22050, 44100, 48000, 96000][random(4)], repetition = { cycle: random(300), endTick };
        expect(map.frame(tick, rate, repetition)).toBe(frame(tick, ppq, tempos, rate, repetition));
      }
    }
  });

  it('rejects invalid query values and unsafe output instead of returning a rounded unsafe integer', () => {
    const map = new TempoMap(480, [{ tick: 0, bpm: 120 }]);
    for (const tick of [-1, NaN, Infinity]) expect(() => map.frame(tick, 48000)).toThrow(RangeError);
    for (const rate of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => map.frame(1, rate)).toThrow(RangeError);
    for (const cycle of [-1, .5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => map.frame(1, 48000, { cycle, endTick: 960 })).toThrow(RangeError);
    expect(() => map.frame(1, 48000, { cycle: 0, endTick: NaN })).toThrow(RangeError);
    expect(() => map.frame(1e20, 96000)).toThrow(RangeError);
    expect(map.frame(0, 48000, { cycle: Number.MAX_SAFE_INTEGER, endTick: 0 })).toBe(0);
  });

  it('does not change existing seconds/tick construction semantics before an exact frame is requested', () => {
    const map = new TempoMap(480, [{ tick: 0, bpm: 0 }]);
    expect(map.seconds(1)).toBe(Infinity);
    expect(() => map.frame(1, 48000)).toThrow(RangeError);
    const valid = new TempoMap(480, [{ tick: 0, bpm: 120 }]);
    expect(valid.seconds(-480)).toBe(-.5);
    expect(valid.tick(-.5)).toBe(-480);
  });
});
