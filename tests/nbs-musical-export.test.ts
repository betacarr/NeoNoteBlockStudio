import { fromArrayBuffer } from '@nbsjs/core';
import { writeMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { createDefaultDelay } from '../src/core/delay';
import { exportNbs, importNbs } from '../src/core/nbs';
import { importMidi } from '../src/core/midi';
import { createProject, flattenNotes, newNote, validateProject } from '../src/core/project';
import { splitRegionGroup } from '../src/core/region-split';
import { createTempoMap } from '../src/core/time';
import type { NbsTempoPreset } from '../src/core/nbs-export-timing';

const versions = [4, 5, 6] as const;
function fixture(bpm = 120, ticks = [0, 240, 480, 720, 960]) {
  const project = createProject('Musical NBS grid'); project.ppq = 480; project.tempos = [{ tick: 0, bpm }];
  project.patterns[0].length = 600000; project.regions[0].length = 600000;
  project.patterns[0].notes = ticks.map((tick, index) => ({ ...newNote(tick, 60 + index, 23.125), velocity: .8 }));
  return project;
}
function read(bytes: Uint8Array) {
  const song = fromArrayBuffer(Uint8Array.from(bytes).buffer);
  const layers = song.layers.all.map(layer => ({ name: layer.name, notes: layer.notes.getTicks.map(tick => ({ tick, ...layer.notes.all[tick] })) }));
  return { song, layers, music: layers.filter(layer => layer.name !== 'Tempo Changer').flatMap(layer => layer.notes).sort((a, b) => a.tick - b.tick),
    functional: layers.filter(layer => layer.name === 'Tempo Changer').flatMap(layer => layer.notes) };
}

describe('fixed musical NBS placement, independently read from v4/v5/v6 bytes', () => {
  it.each(versions.flatMap(version => [
    { version, preset: 'bpm-7.5' as const, tempo: 18.27, ticks: [0, 4, 8, 8000] },
    { version, preset: 'bpm-5' as const, tempo: 27.4, ticks: [0, 6, 12, 12000] },
  ]))('keeps BPM137 far note at literal musical tick in v$version/$preset', ({ version, preset, tempo, ticks }) => {
    const project = fixture(137, [0, 240, 480, 480000]), before = structuredClone(project);
    const result = exportNbs(project, version, preset), actual = read(result.bytes);
    expect(actual.music.map(note => note.tick)).toEqual(ticks); expect(actual.song.getTempo()).toBe(tempo);
    expect(actual.functional).toEqual([]); expect(result.diagnostics.some(item => item.code === 'nbs-quantization')).toBe(false);
    if (preset === 'bpm-7.5') {
      expect(read(exportNbs(project, version, 18.27).bytes).music.at(-1)!.tick).toBe(8001);
      expect(result.diagnostics.some(item => item.code === 'nbs-header-tempo-precision')).toBe(true);
    }
    expect(project).toEqual(before);
  });

  it.each([
    { preset: 'bpm-7.5' as const, ticks: [0, 4, 8, 8000], tempo: 18.28 },
    { preset: 'bpm-5' as const, ticks: [0, 6, 12, 12000], tempo: 27.42 },
  ])('does not use rounded TPS to place decimal BPM notes for $preset', ({ preset, ticks, tempo }) => {
    const result = exportNbs(fixture(137.123, [0, 240, 480, 480000]), 6, preset), actual = read(result.bytes);
    expect(actual.music.map(note => note.tick)).toEqual(ticks); expect(actual.song.getTempo()).toBe(tempo);
    expect(result.diagnostics.some(item => item.code === 'nbs-header-tempo-precision')).toBe(true);
    expect(result.diagnostics.some(item => item.code === 'nbs-quantization')).toBe(false);
  });

  it.each([21, 27, 480, 960, 32767])('uses PPQ %s as a ratio, preserving fractional half beats', ppq => {
    const project = fixture(); project.ppq = ppq; project.patterns[0].notes = [0, ppq / 2, ppq, ppq * 1.5].map(tick => newNote(tick, 66));
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).music.map(note => note.tick)).toEqual([0, 4, 8, 12]);
  });

  it('floors a true off-grid onset without rounding or inventing fractional NBS ticks', () => {
    const project = fixture(120, [0, 59, 60, 119, 120, 121]);
    const result = exportNbs(project, 5, 'bpm-7.5');
    expect(read(result.bytes).music.map(note => note.tick)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(result.diagnostics.find(item => item.code === 'nbs-quantization')?.message).toContain('3 个音符');
  });

  it('keeps direct near-boundary and tiny decimal values strictly below the next grid', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].notes = [.49999999999999994, .5, .5 - 1e-10, 5e-324].map(tick => newNote(tick, 66));
    const actual = read(exportNbs(project, 5, 'bpm-7.5').bytes);
    expect(actual.music.map(note => note.tick)).toEqual([0, 3, 3, 4]);
  });
});

describe('musical source arithmetic at split and cancellation boundaries', () => {
  it('keeps original and fractionally split source on the same literal grid', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].length = 10;
    project.patterns[0].notes = [newNote(4.4, 66, .2)];
    Object.assign(project.regions[0], { start: .2, offset: .1, length: 7 });
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).music.map(note => note.tick)).toEqual([36]);
    expect(splitRegionGroup(project, new Set([project.regions[0].id]), 1.3)?.pairs).toHaveLength(1);
    expect(project.regions[1].offset).toBe(1.2000000000000002);
    const result = exportNbs(project, 5, 'bpm-7.5');
    expect(read(result.bytes).music.map(note => note.tick)).toEqual([36]);
    expect(result.diagnostics.some(item => item.code === 'nbs-source-roundoff')).toBe(true);
    expect(result.diagnostics.some(item => item.code === 'nbs-quantization')).toBe(false);
  });

  it('subtracts large original offsets before scaling without losing a fractional onset', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].length = 1e12;
    project.patterns[0].notes = [newNote(1e12, 60), newNote(1e12 - .125, 64)];
    Object.assign(project.regions[0], { start: .125, offset: 1e12 - .125, length: 2 });
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).music.map(note => note.tick)).toEqual([1, 2]);
  });

  it('does not absorb a genuine off-grid value outside the geometry ULP bound', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].notes = [newNote(4.4 - 1e-9, 66)];
    Object.assign(project.regions[0], { start: .2, offset: .1, length: 7 });
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).music.map(note => note.tick)).toEqual([35]);
  });

  it('retains original loop cycles and legacy far-source onsets', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].length = 1.25; project.patterns[0].notes = [newNote(1000.125, 66)];
    Object.assign(project.regions[0], { start: .125, offset: 1000.125, length: 4, loop: true });
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).music.map(note => note.tick)).toEqual([1, 11, 21, 31]);
  });

  it('keeps same-column notes on distinct layers even when corrected mapping briefly reverses order', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].notes = [newNote(.12499999999999997, 66)];
    Object.assign(project.regions[0], { start: .1, offset: .1, length: 1 });
    project.patterns.push({ id: 'direct', name: 'Direct positions', length: 1, notes: [newNote(.12499999999999999, 66), newNote(.125, 66)] });
    project.regions.push({ ...project.regions[0], id: 'direct-region', patternId: 'direct', start: 0, offset: 0 });
    const actual = read(exportNbs(project, 5, 'bpm-7.5').bytes);
    expect(actual.music.map(note => note.tick)).toEqual([0, 1, 1]); expect(actual.layers).toHaveLength(2);
    expect(actual.layers.flatMap(layer => layer.notes).length).toBe(3);
  });
});

describe('official Tempo Changer fields, timing and limits', () => {
  it.each(versions.flatMap(version => [
    { version, preset: 'bpm-7.5' as const, ticks: [0, 4, 8, 12, 16], tc: [[0, 240], [8, 120]], header: 16 },
    { version, preset: 'bpm-5' as const, ticks: [0, 6, 12, 18, 24], tc: [[0, 360], [12, 180]], header: 24 },
  ]))('writes v$version/$preset musical positions and functional tempo instead of seconds baking', ({ version, preset, ticks, tc, header }) => {
    const project = fixture(); project.tempos = [{ tick: 480, bpm: 60 }, { tick: 0, bpm: 150 }, { tick: 0, bpm: 120 }];
    const before = structuredClone(project), result = exportNbs(project, version, preset), actual = read(result.bytes);
    expect(actual.music.map(note => note.tick)).toEqual(ticks); expect(actual.song.getTempo()).toBe(header);
    expect(actual.functional.map(note => [note.tick, note.pitch])).toEqual(tc);
    expect(actual.functional.every(note => note.key === 39 && note.instrument === (version === 6 ? 20 : 16))).toBe(true);
    const custom = Object.values(actual.song.instruments.all).find(instrument => instrument.name === 'Tempo Changer')!;
    expect(custom.soundFile).toBe(''); expect(custom.key).toBe(39);
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-changer')).toBe(true);
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-baked')).toBe(false);
    const imported = importNbs(result.bytes, 'musical.nbs').project, tempoMap = createTempoMap(imported);
    expect(flattenNotes(imported).map(note => tempoMap.seconds(note.absoluteTick))).toEqual([0, .25, .5, 1, 1.5]);
    expect(validateProject(imported)).toBe(imported); expect(project).toEqual(before);
  });

  it('keeps the final tempo when several changes floor into the same column', () => {
    const project = fixture(); project.tempos = [{ tick: 0, bpm: 120 }, { tick: 1, bpm: .1 }, { tick: 2, bpm: 60 }, { tick: 480, bpm: 150 }];
    const result = exportNbs(project, 5, 'bpm-7.5');
    expect(read(result.bytes).functional.map(note => [note.tick, note.pitch])).toEqual([[0, 120], [8, 300]]);
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-position-quantization')).toBe(true);
  });

  it('floors integer functional pitch separately and reports decimal tempo-rate error', () => {
    const project = fixture(); project.tempos.push({ tick: 480, bpm: 137.123 });
    const result = exportNbs(project, 5, 'bpm-7.5');
    expect(read(result.bytes).functional.map(note => [note.tick, note.pitch])).toEqual([[0, 240], [8, 274]]);
    expect(read(result.bytes).music.map(note => note.tick)).toEqual([0, 4, 8, 12, 16]);
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-changer-precision')).toBe(true);
  });

  it.each([.1, 1.5, 6000, 20000])('rejects effective functional BPM %s that cannot play or reopen correctly', bpm => {
    const project = fixture(); project.tempos.push({ tick: 480, bpm });
    expect(() => exportNbs(project, 5, 'bpm-7.5')).toThrow(/Tempo Changer/);
  });

  it('accepts exact canonical upper bound and actual minimum functional rate', () => {
    const project = fixture(); project.tempos.push({ tick: 480, bpm: 2 }, { tick: 960, bpm: 5000 });
    const result = exportNbs(project, 5, 'bpm-7.5'); expect(read(result.bytes).functional.map(note => note.pitch)).toEqual([240, 4, 10000]);
    expect(validateProject(importNbs(result.bytes, 'limits.nbs').project).tempos.at(-1)!.bpm).toBe(10000);
  });

  it('keeps format-only numeric low speeds while rejecting musical playback below .25 TPS', () => {
    const project = fixture(1.8749, [0]); expect(() => exportNbs(project, 5, 'bpm-7.5')).toThrow('0.25');
    project.tempos[0].bpm = 1.875; expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).song.getTempo()).toBe(.25);
    expect(read(exportNbs(project, 5, .01).bytes).song.getTempo()).toBe(.01);
  });

  it.each([false, true])('does not misreport real MIDI tempo/meter as lost controllers (variable=%s)', variable => {
    const bytes = Uint8Array.from(writeMidi({ header: { format: 1, numTracks: 2, ticksPerBeat: 480 }, tracks: [
      [{ deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: 500000 },
        { deltaTime: 0, meta: true, type: 'timeSignature', numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8 },
        ...(variable ? [{ deltaTime: 480, meta: true as const, type: 'setTempo' as const, microsecondsPerBeat: 1000000 }] : []),
        { deltaTime: 0, meta: true, type: 'endOfTrack' }],
      [{ deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 66, velocity: 100 },
        { deltaTime: 960, type: 'noteOff', channel: 0, noteNumber: 66, velocity: 0 }, { deltaTime: 0, meta: true, type: 'endOfTrack' }],
    ] }));
    const project = importMidi(bytes, 'tempo-meter.mid').project, result = exportNbs(project, 5, 'bpm-7.5');
    expect(result.diagnostics.some(item => item.code === 'nbs-midi-messages')).toBe(false);
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-changer')).toBe(variable);
    project.patterns[0].midiEvents!.push({ id: 'real-controller', tick: 0, order: 10, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 1, value: 12 } });
    expect(exportNbs(project, 5, 'bpm-7.5').diagnostics.some(item => item.code === 'nbs-midi-messages')).toBe(true);
  });
});

describe('musical Delay, collisions, resources and signed-short boundaries', () => {
  it.each(['beats', 'seconds'] as const)('writes actual %s echoes without mutating the dry source', timeUnit => {
    const project = fixture(120, [0]); project.patterns[0].notes[0].duration = 0;
    project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit, interval: timeUnit === 'beats' ? .5 : 1, tail: timeUnit === 'beats' ? 1 : 2, wet: 1, feedback: .5 };
    const before = structuredClone(project), result = exportNbs(project, 5, 'bpm-7.5');
    expect(read(result.bytes).music.map(note => [note.tick, note.velocity])).toEqual(timeUnit === 'beats' ? [[0, 80], [4, 40], [8, 20]] : [[0, 80], [16, 40], [32, 20]]);
    expect(result.diagnostics.some(item => item.code === 'nbs-quantization')).toBe(false); expect(project).toEqual(before);
  });

  it('reports a real off-grid seconds echo instead of moving the dry note', () => {
    const project = fixture(120, [0]); project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .1, tail: .1 };
    const result = exportNbs(project, 5, 'bpm-7.5'); expect(read(result.bytes).music.map(note => note.tick)).toEqual([0, 1]);
    expect(result.diagnostics.some(item => item.code === 'nbs-quantization')).toBe(true);
  });

  it('retains collisions on independent layers and existing key/gain/pan/custom conversions', () => {
    const project = fixture(120, [0, 1, 60]); project.tracks[0].volume = .5; project.tracks[0].pan = .2;
    project.patterns[0].notes[0].midi = 0; project.patterns[0].notes[1].midi = 127;
    const custom = { ...project.instruments[0], id: 'audio-custom', name: 'Custom', assetId: 'sample', rootMidi: 66 }; project.instruments.push(custom);
    project.assets.push({ id: 'sample', name: 'portable.ogg', mime: 'audio/ogg', data: 'AQID' });
    Object.assign(project.patterns[0].notes[2], { instrumentId: custom.id, pan: .3, detune: -7.25 });
    const before = structuredClone(project), result = exportNbs(project, 5, 'bpm-7.5'), actual = read(result.bytes);
    expect(actual.music.map(note => [note.tick, note.key, note.velocity, note.panning, note.pitch])).toEqual([[0, 0, 40, 20, 0], [0, 87, 40, 20, 0], [1, 41, 40, 50, -7]]);
    expect(actual.layers).toHaveLength(2); expect(actual.music[2].instrument).toBe(16);
    expect(result.diagnostics.some(item => item.code === 'nbs-key-range')).toBe(true); expect(project).toEqual(before);
  });

  it('reserves a custom slot for tempo and rejects only used audio names that conflict', () => {
    const project = fixture(120, Array.from({ length: 18 }, (_, index) => index * 60)); project.tempos.push({ tick: 480, bpm: 60 });
    for (let index = 0; index < 18; index++) {
      project.instruments.push({ ...project.instruments[0], id: `c${index}`, name: `Sound ${index}` }); project.patterns[0].notes[index].instrumentId = `c${index}`;
    }
    expect(() => exportNbs(project, 4, 'bpm-7.5')).toThrow('含 Tempo Changer');
    expect(read(exportNbs(project, 5, 'bpm-7.5').bytes).functional).toHaveLength(2);
    project.instruments.find(instrument => instrument.id === 'c0')!.name = 'Tempo Changer'; expect(() => exportNbs(project, 5, 'bpm-7.5')).toThrow('冲突');
    delete project.patterns[0].notes[0].instrumentId; expect(() => exportNbs(project, 5, 'bpm-7.5')).not.toThrow();
  });

  it.each([20, 'bpm-7.5'] as const)('guards true signed-short song length for %s mode', mode => {
    const project = fixture(); project.ppq = 8; project.tempos[0].bpm = 150;
    const sourceTick = typeof mode === 'number' ? 32766 * 480 / 8 : 32766;
    if (typeof mode === 'number') project.ppq = 480;
    project.patterns[0].length = 1e7; project.regions[0].length = 1e7; project.patterns[0].notes = [newNote(sourceTick, 66)];
    expect(read(exportNbs(project, 5, mode).bytes).music[0].tick).toBe(32766);
    project.patterns[0].notes[0].tick += typeof mode === 'number' ? 60 : 1;
    expect(() => exportNbs(project, 5, mode)).toThrow('32767');
  });

  it.each([0, -1, .5, 32768, NaN, Infinity])('rejects invalid PPQ %s clearly', ppq => {
    const project = fixture(); project.ppq = ppq; expect(() => exportNbs(project, 5, 'bpm-7.5')).toThrow('PPQ');
  });

  it('rejects unknown presets without altering the legacy numeric default', () => {
    const project = fixture(); expect(() => exportNbs(project, 5, 'unknown' as NbsTempoPreset)).toThrow('预设');
    expect(read(exportNbs(project).bytes).music.map(note => note.tick)).toEqual([0, 5, 10, 15, 20]);
  });
});
