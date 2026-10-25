import { describe, expect, it } from 'vitest';
import { importNbs, exportNbs } from '../src/core/nbs';
import { flattenNotes, validateProject } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import { fromArrayBuffer } from '@nbsjs/core';
import { nbsFixture, type FixtureLayer, type FixtureNote } from './fixtures/nbs-interop';

const source = (notes: FixtureNote[], layers: FixtureLayer[] = [{}, {}], version = 5) => nbsFixture({ version, builtinCount: version === 0 ? 10 : version === 6 ? 20 : 16, layers, custom: [{ name: 'Tempo Changer', soundFile: '' }], notes });
const music = [{ tick: 0, instrument: 0 }, { tick: 4, instrument: 0 }, { tick: 8, instrument: 0 }];

describe('NBS Tempo Changer source playback semantics', () => {
  it.each([4, 5, 6])('keeps v%s negative fine pitch and inactive-layer events global', version => {
    const custom = version === 6 ? 20 : 16;
    for (const layers of [[{ solo: true }, { locked: true }], [{ solo: true }, {}], [{}, { volume: 0 }]]) {
      const imported = importNbs(source([...music, { tick: 4, layer: 1, instrument: custom, detune: -300, velocity: 0 }], layers, version), 'global-tempo.nbs');
      expect(imported.project.tempos).toEqual([{ tick: 0, bpm: 150 }, { tick: 960, bpm: 300 }]);
      const timing = createTempoMap(imported.project), notes = flattenNotes(imported.project);
      expect(notes).toHaveLength(3);
      [0, .4, .6].forEach((seconds, index) => expect(timing.seconds(notes[index].absoluteTick)).toBeCloseTo(seconds, 12));
      expect(imported.project.patterns[1].notes).toHaveLength(0);
      expect(validateProject(imported.project)).toBe(imported.project);
      const exported = exportNbs(imported.project, 6, 20), oracle = fromArrayBuffer(Uint8Array.from(exported.bytes).buffer);
      expect(oracle.layers.all[0].notes.getTicks).toEqual([0, 8, 12]);
    }
  });

  it('keeps a solo functional layer global while its ordinary non-solo music stays inaudible', () => {
    const imported = importNbs(source([...music, { tick: 4, layer: 1, instrument: 16, detune: 300 }], [{}, { solo: true }]), 'solo-tempo.nbs');
    expect(imported.project.tempos[1]).toEqual({ tick: 960, bpm: 300 });
    expect(flattenNotes(imported.project)).toHaveLength(0);
    expect(flattenNotes(imported.project, true)).toHaveLength(3);
  });

  it.each([[0, 300], [600, -300], [12000, 300]])('uses the final layer event at the same tick: %s then %s', (first, last) => {
    const imported = importNbs(source([...music, { tick: 4, layer: 1, instrument: 16, detune: first }, { tick: 4, layer: 2, instrument: 16, detune: last }], [{}, {}, { locked: true }]), 'same-tick.nbs');
    expect(imported.project.tempos).toEqual([{ tick: 0, bpm: 150 }, { tick: 960, bpm: 300 }]);
    expect(createTempoMap(imported.project).seconds(1920)).toBeCloseTo(.6, 12);
  });

  it('allows a tick-zero event to replace the header tempo', () => {
    const imported = importNbs(source([...music, { tick: 0, layer: 1, instrument: 16, detune: -300 }]), 'initial-tempo.nbs');
    expect(imported.project.tempos).toEqual([{ tick: 0, bpm: 300 }]);
    expect(createTempoMap(imported.project).seconds(1920)).toBeCloseTo(.4, 12);
  });

  it.each([0, 4])('rejects effective zero BPM at tick %s instead of playing past the original stop', tick => {
    expect(() => importNbs(source([...music, { tick, layer: 1, instrument: 16, detune: 0 }]), 'stopped.nbs')).toThrow('零速度');
  });

  it('does not ignore a zero event after a positive event at the same tick', () => {
    expect(() => importNbs(source([...music, { tick: 4, layer: 1, instrument: 16, detune: 300 }, { tick: 4, layer: 2, instrument: 16, detune: 0 }], [{}, {}, {}]), 'last-zero.nbs')).toThrow('零速度');
  });

  it.each([0, 1, 2, 3])('does not invent fine-pitch data for a v%s functional event', version => {
    const custom = version === 0 ? 10 : 16;
    expect(() => importNbs(source([...music, { tick: 4, layer: 1, instrument: custom, detune: 300 }], [{}, {}], version), 'old-tempo.nbs')).toThrow('零速度');
  });

  it.each([10001, 12000, 32767, -32768])('rejects a final %s BPM event that cannot reopen as a valid NBSX', detune => {
    expect(() => importNbs(source([...music, { tick: 4, layer: 1, instrument: 16, detune }]), 'unrepresentable.nbs')).toThrow('10000');
  });

  it.each([1, -1, 10000, -10000])('keeps the representable fine-pitch boundary %s valid for NBSX', detune => {
    const imported = importNbs(source([...music, { tick: 4, layer: 1, instrument: 16, detune }]), 'boundary.nbs');
    expect(imported.project.tempos[1].bpm).toBe(Math.abs(detune));
    expect(validateProject(imported.project)).toBe(imported.project);
  });
});
