import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { nbsExportTiming, type NbsTempoPreset } from '../src/core/nbs-export-timing';
import { exportNbs } from '../src/core/nbs';
import { createProject, newNote } from '../src/core/project';
import type { Tempo } from '../src/core/types';

const versions = [4, 5, 6] as const;
function fixture(bpm = 120) {
  const project = createProject('Automatic NBS grid'); project.ppq = 480; project.tempos = [{ tick: 0, bpm }];
  project.patterns[0].notes = [0, 240, 480, 720].map((tick, index) => ({ ...newNote(tick, [60, 64, 67, 72][index], 37.125), velocity: .73, pan: -.2, detune: -7.25 }));
  return project;
}
function read(bytes: Uint8Array) {
  const song = fromArrayBuffer(Uint8Array.from(bytes).buffer);
  const ticks = Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks).sort((a, b) => a - b);
  return { song, ticks };
}

describe('automatic NBS tempo presets through actual export and independent readback', () => {
  it.each(versions.flatMap(version => [
    { version, bpm: 150, preset: undefined, tps: 20, ticks: [0, 4, 8, 12] },
    { version, bpm: 100, preset: 'bpm-5' as const, tps: 20, ticks: [0, 6, 12, 18] },
    { version, bpm: 120, preset: 'bpm-7.5' as const, tps: 16, ticks: [0, 4, 8, 12] },
    { version, bpm: 120, preset: 'bpm-5' as const, tps: 24, ticks: [0, 6, 12, 18] },
  ]))('writes v$version BPM $bpm / $preset as $tps TPS with literal half-beat note positions', ({ version, bpm, preset, tps, ticks }) => {
    const project = fixture(bpm), before = structuredClone(project), timing = nbsExportTiming(project, preset);
    expect(timing).toEqual({ bpm, ticksPerSecond: tps });
    const { bytes } = exportNbs(project, version, timing.ticksPerSecond), actual = read(bytes);
    expect(bytes[2]).toBe(version); expect(actual.song.getTempo()).toBe(tps); expect(actual.ticks).toEqual(ticks); expect(project).toEqual(before);
  });

  it.each([
    { bpm: 123.456, preset: 'bpm-7.5' as const, tps: 16.46 },
    { bpm: 123.456, preset: 'bpm-5' as const, tps: 24.69 },
    { bpm: 150.04, preset: 'bpm-7.5' as const, tps: 20.01 },
    { bpm: 100.024, preset: 'bpm-5' as const, tps: 20 },
  ])('rounds BPM $bpm / $preset to the format hundredth $tps', ({ bpm, preset, tps }) => {
    const project = fixture(bpm), timing = nbsExportTiming(project, preset);
    expect(timing).toEqual({ bpm, ticksPerSecond: tps }); expect(read(exportNbs(project, 5, timing.ticksPerSecond).bytes).song.getTempo()).toBe(tps);
  });

  it.each(versions.flatMap(version => [
    { version, preset: 'bpm-7.5' as const, tps: 16, ticks: [0, 4, 8, 10, 12, 20] },
    { version, preset: 'bpm-5' as const, tps: 24, ticks: [0, 6, 12, 15, 18, 30] },
  ]))('uses sorted last-wins starting tempo and preserves changing-tempo seconds in v$version / $preset', ({ version, preset, tps, ticks }) => {
    const project = fixture(); project.tempos = [{ tick: 960, bpm: 60 }, { tick: 0, bpm: 150 }, { tick: 480, bpm: 240 }, { tick: 0, bpm: 120 }];
    project.patterns[0].notes = [0, 240, 480, 720, 960, 1200].map(tick => newNote(tick, 66, 0));
    const before = structuredClone(project), timing = nbsExportTiming(project, preset);
    expect(timing).toEqual({ bpm: 120, ticksPerSecond: tps }); const actual = read(exportNbs(project, version, timing.ticksPerSecond).bytes);
    expect(actual.song.getTempo()).toBe(tps); expect(actual.ticks).toEqual(ticks);
    expect(actual.ticks.map(tick => tick / actual.song.getTempo())).toEqual([0, .25, .5, .625, .75, 1.25]); expect(project).toEqual(before);
  });

  it('uses the existing tick-zero 120 fallback without moving or sorting input events', () => {
    const project = fixture(); project.tempos = [{ tick: 960, bpm: 150 }, { tick: 480, bpm: 240 }];
    const before = structuredClone(project); Object.freeze(project.tempos); project.tempos.forEach(Object.freeze);
    expect(nbsExportTiming(project)).toEqual({ bpm: 120, ticksPerSecond: 16 }); expect(project).toEqual(before);
    expect(nbsExportTiming({ tempos: [] }, 'bpm-5')).toEqual({ bpm: 120, ticksPerSecond: 24 });
  });

  it('keeps the old exportNbs default at 20 when no caller supplies the new grid', () => {
    const project = fixture(), actual = read(exportNbs(project).bytes);
    expect(nbsExportTiming(project).ticksPerSecond).toBe(16); expect(actual.song.getTempo()).toBe(20); expect(actual.ticks).toEqual([0, 5, 10, 15]);
  });
});

describe('NBS preset validation and exact format limits', () => {
  it.each([
    { bpm: .075, preset: 'bpm-7.5' as const, tps: .01 }, { bpm: .05, preset: 'bpm-5' as const, tps: .01 },
    { bpm: 2457.525, preset: 'bpm-7.5' as const, tps: 327.67 }, { bpm: 1638.35, preset: 'bpm-5' as const, tps: 327.67 },
  ])('accepts representable BPM $bpm / $preset exactly at $tps TPS', ({ bpm, preset, tps }) => {
    const project = fixture(bpm); project.patterns[0].notes = [newNote(0, 66)];
    const timing = nbsExportTiming(project, preset); expect(timing).toEqual({ bpm, ticksPerSecond: tps }); expect(read(exportNbs(project, 6, timing.ticksPerSecond).bytes).song.getTempo()).toBe(tps);
  });

  it.each([
    { bpm: .0749, preset: 'bpm-7.5' as const }, { bpm: .0499, preset: 'bpm-5' as const },
    { bpm: 2457.5250001, preset: 'bpm-7.5' as const }, { bpm: 1638.3500001, preset: 'bpm-5' as const },
  ])('rejects out-of-range BPM $bpm / $preset before rounding can hide the overflow', ({ bpm, preset }) => {
    expect(() => nbsExportTiming({ tempos: [{ tick: 0, bpm }] }, preset)).toThrow('0.01～327.67');
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid effective BPM %s clearly', bpm => {
    expect(() => nbsExportTiming({ tempos: [{ tick: 0, bpm }] })).toThrow('BPM');
    expect(() => nbsExportTiming({ tempos: [{ tick: 0, bpm: 120 }, { tick: 480, bpm }] })).toThrow('BPM');
  });

  it('validates the effective last-wins BPM rather than an overwritten earlier duplicate', () => {
    expect(nbsExportTiming({ tempos: [{ tick: 0, bpm: NaN }, { tick: 0, bpm: 150 }] })).toEqual({ bpm: 150, ticksPerSecond: 20 });
    expect(() => nbsExportTiming({ tempos: [{ tick: 0, bpm: 150 }, { tick: 0, bpm: NaN }] })).toThrow('BPM');
  });

  it.each(['manual', '', null, 20])('rejects unknown preset %s without substituting a default', preset => {
    expect(() => nbsExportTiming({ tempos: [{ tick: 0, bpm: 120 }] }, preset as NbsTempoPreset)).toThrow('预设');
  });

  it.each([-1, NaN, Infinity])('rejects invalid tempo position %s', tick => {
    expect(() => nbsExportTiming({ tempos: [{ tick, bpm: 120 }] })).toThrow('速度事件位置');
  });

  it('rejects a malformed tempo list with a clear error', () => {
    expect(() => nbsExportTiming({ tempos: null as unknown as Tempo[] })).toThrow('速度事件位置');
  });
});
