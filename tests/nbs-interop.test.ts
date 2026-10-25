import { describe, expect, it } from 'vitest';
import { fromArrayBuffer, Song, toArrayBuffer } from '@nbsjs/core';
import { exportNbs, importNbs } from '../src/core/nbs';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import { nbsFixture } from './fixtures/nbs-interop';

describe('NBS custom identities across built-in table versions', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('preserves v%s source custom instruments when exporting v4/v5/v6', sourceVersion => {
    const sourceCount = sourceVersion <= 2 ? 10 : sourceVersion >= 6 ? 20 : 16;
    const bytes = nbsFixture({ version: sourceVersion, builtinCount: sourceCount, custom: [{ name: 'Marimba', soundFile: 'marimba.ogg', key: 57 }], notes: [{ tick: 0, instrument: sourceCount }, { tick: 4, instrument: 0 }] });
    const imported = importNbs(bytes, 'source.nbs').project;
    const originalCustom = imported.instruments.find(instrument => instrument.assetId === 'external-0')!;
    expect(originalCustom.nbsIndex).toBe(sourceCount); expect(originalCustom.rootMidi).toBe(54);
    expect(imported.tracks[0].instrumentId).toBe(originalCustom.id);
    expect(flattenNotes(imported).map(note => note.effectiveInstrument)).toEqual([originalCustom.id, 'harp']);
    const before = structuredClone(imported);
    for (const target of [4, 5, 6] as const) {
      const result = exportNbs(imported, target, 10), targetCount = target === 6 ? 20 : 16;
      const oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
      expect(result.bytes[3]).toBe(targetCount);
      expect(oracle.layers.all[0].notes.all[0].instrument).toBe(targetCount);
      // This oracle ignores the source built-in count when indexing its custom
      // definitions; inspect the definitions themselves, not that faulty index.
      const definitions = Object.values(oracle.instruments.all).filter(instrument => !instrument.isBuiltIn);
      expect(definitions.map(instrument => [instrument.name, instrument.soundFile, instrument.key])).toEqual([['Marimba', 'marimba.ogg', 57]]);
      const loaded = importNbs(result.bytes, 'target.nbs').project, custom = loaded.instruments.find(instrument => instrument.assetId === 'external-0')!;
      expect(custom.name).toBe('Marimba'); expect(custom.rootMidi).toBe(54);
      expect(flattenNotes(loaded).map(note => note.effectiveInstrument)).toEqual([custom.id, 'harp']);
      expect(result.diagnostics.some(item => item.code === 'nbs-custom')).toBe(true);
    }
    expect(imported).toEqual(before);
  });

  it.each([0, 24, 45, 57, 87])('retains custom key %s, exact sampler root, detune and per-note override', key => {
    const source = importNbs(nbsFixture({ version: 5, builtinCount: 16, custom: [{ name: 'Tuned sample', soundFile: 'tuned.ogg', key }], notes: [{ tick: 0, instrument: 0 }, { tick: 1, instrument: 16, key: 38, detune: -37 }] }), 'tuned.nbs').project;
    expect(source.tracks[0].instrumentId).toBe('harp');
    const custom = source.instruments.find(instrument => instrument.assetId === 'external-0')!;
    expect(custom.rootMidi).toBe(111 - key);
    const exported = exportNbs(source, 6, 10), oracle = fromArrayBuffer(Uint8Array.from(exported.bytes).buffer);
    expect(oracle.instruments.all[20].key).toBe(key);
    expect(oracle.layers.all[0].notes.all[1]).toMatchObject({ instrument: 20, key: 38, pitch: -37 });
    const reloaded = importNbs(exported.bytes, 'again.nbs').project, notes = flattenNotes(reloaded);
    const loadedInstrument = reloaded.instruments.find(instrument => instrument.id === notes[1].effectiveInstrument)!;
    expect(notes[1].midi - loadedInstrument.rootMidi + notes[1].detune / 100).toBe(38 + key - 90 - .37);
  });

  it('keeps real v6 brass built-in identities and only converts them for older targets', () => {
    const project = createProject();
    project.patterns[0].notes = ['trumpet', 'trumpet_exposed', 'trumpet_weathered', 'trumpet_oxidized'].map((instrumentId, index) => ({ ...newNote(index * 960, 66), instrumentId }));
    const modern = exportNbs(project, 6, 10), modernOracle = fromArrayBuffer(Uint8Array.from(modern.bytes).buffer);
    expect(Object.values(modernOracle.layers.all[0].notes.all).map(note => note.instrument)).toEqual([16, 17, 18, 19]);
    expect(Object.values(modernOracle.instruments.all).filter(instrument => !instrument.isBuiltIn)).toHaveLength(0);
    for (const target of [4, 5] as const) {
      const result = exportNbs(project, target, 10), oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
      expect(Object.values(oracle.instruments.all).filter(instrument => !instrument.isBuiltIn)).toHaveLength(4);
      expect(result.diagnostics.some(item => item.code === 'nbs-custom')).toBe(true);
    }
  });
});

describe('NBS conversion timing, layers and explicit losses', () => {
  it.each([4, 5, 6] as const)('reports a used built-in sample replacement while keeping v%s built-in export semantics', version => {
    const project = createProject(); project.patterns[0].notes = [newNote(0, 66)];
    project.instruments.find(instrument => instrument.id === 'harp')!.assetId = 'replacement';
    project.assets.push({ id: 'replacement', name: 'my-harp.ogg', mime: 'audio/ogg', data: 'AQID' });
    const before = structuredClone(project), result = exportNbs(project, version, 10), oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
    expect(oracle.layers.all[0].notes.all[0].instrument).toBe(0);
    expect(Object.values(oracle.instruments.all).filter(instrument => !instrument.isBuiltIn)).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'nbs-builtin-sample', severity: 'warning', message: expect.stringContaining('接收端仍使用 NBS 内置采样') }));
    expect(project).toEqual(before);
  });

  it('only reports sampled built-ins used by exported notes, including note overrides', () => {
    const project = createProject(); project.patterns[0].notes = [{ ...newNote(0, 66), instrumentId: 'bass' }];
    const harp = project.instruments.find(instrument => instrument.id === 'harp')!, bass = project.instruments.find(instrument => instrument.id === 'bass')!;
    harp.assetId = 'unused-replacement';
    expect(exportNbs(project, 6, 10).diagnostics.some(item => item.code === 'nbs-builtin-sample')).toBe(false);
    bass.assetId = 'used-replacement';
    expect(exportNbs(project, 6, 10).diagnostics.some(item => item.code === 'nbs-builtin-sample')).toBe(true);
    project.tracks[0].muted = true;
    expect(exportNbs(project, 6, 10).diagnostics.some(item => item.code === 'nbs-builtin-sample')).toBe(false);
  });

  it('keeps a v6 brass replacement as a custom sample for an older export target', () => {
    const project = createProject(); project.patterns[0].notes = [{ ...newNote(0, 66), instrumentId: 'trumpet' }];
    project.instruments.find(instrument => instrument.id === 'trumpet')!.assetId = 'replacement';
    project.assets.push({ id: 'replacement', name: 'my-trumpet.ogg', mime: 'audio/ogg', data: 'AQID' });
    const result = exportNbs(project, 5, 10), oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
    expect(result.diagnostics.some(item => item.code === 'nbs-builtin-sample')).toBe(false);
    expect(Object.values(oracle.instruments.all).filter(instrument => !instrument.isBuiltIn).map(instrument => instrument.soundFile)).toEqual(['my-trumpet.ogg']);
    expect(exportNbs(project, 6, 10).diagnostics.some(item => item.code === 'nbs-builtin-sample')).toBe(true);
  });

  it('imports actual independent-writer solo and locked states without adding audible notes', () => {
    const source = new Song();
    source.layers.create().notes.create(0, 0);
    const locked = source.layers.create(); locked.isLocked = true; locked.notes.create(0, 5);
    const solo = source.layers.create(); solo.isSolo = true; solo.notes.create(0, 1);
    const project = importNbs(new Uint8Array(toArrayBuffer(source)), 'solo.nbs').project;
    expect(project.tracks.map(track => [track.locked, track.solo])).toEqual([[false, false], [true, false], [false, true]]);
    expect(project.tracks[1].muted).toBe(true);
    expect(flattenNotes(project).map(note => note.effectiveInstrument)).toEqual(['bass']);
    expect(flattenNotes(project, true)).toHaveLength(3);
    const exported = exportNbs(project, 6, 10), oracle = fromArrayBuffer(Uint8Array.from(exported.bytes).buffer);
    expect(exported.diagnostics.some(item => item.code === 'nbs-audible-tracks')).toBe(true);
    expect(oracle.layers.all.flatMap(layer => Object.values(layer.notes.all))).toHaveLength(1);
    expect(flattenNotes(project, true)).toHaveLength(3);
  });

  it('distinguishes imported OpenNBS lock-and-mute from this editor’s ordinary edit lock', () => {
    const source = new Song(); source.layers.create().notes.create(0, 0);
    const locked = source.layers.create(); locked.isLocked = true; locked.notes.create(0, 1);
    const imported = importNbs(new Uint8Array(toArrayBuffer(source)), 'locked.nbs');
    expect(imported.project.tracks[1]).toMatchObject({ locked: true, muted: true });
    expect(flattenNotes(imported.project).map(note => note.effectiveInstrument)).toEqual(['harp']);
    expect(flattenNotes(imported.project, true)).toHaveLength(2);
    expect(imported.diagnostics.some(item => item.code === 'nbs-layer-state')).toBe(true);
    const editor = createProject(); editor.tracks[0].locked = true; editor.patterns[0].notes = [newNote(0, 66)];
    expect(flattenNotes(editor)).toHaveLength(1); expect(editor.tracks[0].muted).toBe(false);
    expect(exportNbs(editor, 6, 10).diagnostics.some(item => item.code === 'nbs-audible-tracks')).toBe(false);
  });

  it.each([3, 255])('rejects unknown layer state %s instead of silently changing its playback', state => {
    expect(() => importNbs(nbsFixture({ version: 6, layers: [{ state }], notes: [{ tick: 0, instrument: 0 }] }), 'unknown-state.nbs')).toThrow('层状态');
  });

  it.each([4, 5, 6] as const)('preserves v%s layer/note volume, panning, key and fine pitch in the exported playback values', version => {
    const project = importNbs(nbsFixture({ version, layers: [{ volume: 70, pan: 140 }], notes: [{ tick: 0, instrument: 0, key: 38, velocity: 60, pan: 20, detune: -37 }] }), 'expressive.nbs').project;
    const original = flattenNotes(project)[0];
    expect(original.gain).toBeCloseTo(.42); expect(original.effectivePan).toBeCloseTo(-.2);
    const result = exportNbs(project, version, 10), oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
    expect(oracle.layers.all[0].volume).toBe(100); expect(oracle.layers.all[0].stereo).toBe(0);
    expect(oracle.layers.all[0].notes.all[0]).toMatchObject({ velocity: 42, panning: -20, key: 38, pitch: -37 });
    const note = flattenNotes(importNbs(result.bytes, 'again.nbs').project)[0];
    expect(note.gain).toBeCloseTo(original.gain); expect(note.effectivePan).toBeCloseTo(original.effectivePan);
    expect(note.midi).toBe(original.midi); expect(note.detune).toBe(original.detune);
  });

  it('uses note panning directly for a centred source layer', () => {
    const project = importNbs(nbsFixture({ version: 5, layers: [{ pan: 100 }], notes: [{ tick: 0, instrument: 0, pan: 20 }] }), 'centre.nbs').project;
    expect(flattenNotes(project)[0].effectivePan).toBe(-.8);
  });

  it('converts a real Tempo Changer custom event to an exact fixed-grid onset map', () => {
    const result = importNbs(nbsFixture({ version: 5, tempo: 10, layers: [{ name: 'Music' }, { name: 'Tempo' }], custom: [{ name: 'Tempo Changer', soundFile: '' }], notes: [
      { tick: 0, instrument: 0 }, { tick: 4, instrument: 0 }, { tick: 4, layer: 1, instrument: 16, detune: 300 }, { tick: 8, instrument: 0 },
    ] }), 'tempo.nbs');
    expect(result.diagnostics.some(item => item.code === 'nbs-tempo-events')).toBe(true);
    expect(result.project.tempos).toEqual([{ tick: 0, bpm: 150 }, { tick: 960, bpm: 300 }]);
    const timing = createTempoMap(result.project), notes = flattenNotes(result.project);
    expect(notes).toHaveLength(3);
    [0, .4, .6].forEach((seconds, index) => expect(timing.seconds(notes[index].absoluteTick)).toBeCloseTo(seconds, 12));
    const exported = exportNbs(result.project, 6, 20), oracle = fromArrayBuffer(Uint8Array.from(exported.bytes).buffer);
    expect(oracle.getTempo()).toBe(20); expect(oracle.layers.all[0].notes.getTicks).toEqual([0, 8, 12]);
    expect(exported.diagnostics.some(item => item.code === 'nbs-tempo-baked')).toBe(true);
  });

  it.each([0, .0001, .004, .005, .009, -1, NaN, Infinity, 327.68])('rejects an unrepresentable %s tick/s before producing a file', tempo => {
    expect(() => exportNbs(createProject(), 5, tempo)).toThrow('0.01');
  });
  it('writes the valid 0.01 tick/s boundary as a nonzero tempo', () => {
    const project = createProject(); project.patterns[0].notes = [newNote(0, 66)];
    const exported = exportNbs(project, 5, .01);
    expect(fromArrayBuffer(Uint8Array.from(exported.bytes).buffer).getTempo()).toBe(.01);
    expect(importNbs(exported.bytes, 'slow.nbs').project.tempos[0].bpm).toBe(.15);
  });
  it('reports the whole-song loop omission in the actual conversion diagnostics', () => {
    const project = importNbs(nbsFixture({ version: 5, loop: { enabled: true, count: 3, start: 4 }, notes: [{ tick: 0, instrument: 0 }, { tick: 8, instrument: 0 }] }), 'loop.nbs').project;
    const before = structuredClone(project), result = exportNbs(project, 6, 20);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'nbs-song-loop-loss', severity: 'warning' }));
    expect(fromArrayBuffer(Uint8Array.from(result.bytes).buffer).loop.enabled).toBe(false);
    expect(project).toEqual(before);
    expect((project.provenance!.metadata.loop as { enabled: number }).enabled).toBe(1);
  });
});
