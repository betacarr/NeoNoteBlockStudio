import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { importNbs, exportNbs } from '../src/core/nbs';
import { flattenNotes, validateProject } from '../src/core/project';
import { openNbsx, saveNbsx } from '../src/core/container';
import { nbsFixture, type FixtureLayer, type FixtureNote } from './fixtures/nbs-interop';

const load = (notes: FixtureNote[], layers: FixtureLayer[]) => importNbs(nbsFixture({ version: 6, notes, layers }), 'layers.nbs');
const at = (layer: number, instrument = 0, tick = 0): FixtureNote => ({ tick, layer, instrument, key: 40 + layer });

describe('adjacent NBS instrument layers', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('merges adjacent single-instrument layers for NBS v%s into one complete editable region per group', version => {
    const imported = importNbs(nbsFixture({ version, notes: [at(0), at(1), at(2, 1), at(3, 1)], layers: [
      { name: 'Harp left' }, { name: 'Harp right' }, { name: 'Bass left' }, { name: 'Bass right' },
    ] }), 'adjacent.nbs');
    const p = imported.project;
    expect(p.tracks.map(track => track.instrumentId)).toEqual(['harp', 'bass']);
    expect(p.patterns.map(pattern => pattern.name)).toEqual(['Harp left', 'Bass left']);
    expect(p.regions.map(region => p.tracks.findIndex(track => track.id === region.trackId))).toEqual([0, 1]);
    expect(p.regions.map(region => p.patterns.find(pattern => pattern.id === region.patternId)!.notes.map(note => note.midi))).toEqual([[61, 62], [63, 64]]);
    expect(new Set(p.patterns.flatMap(pattern => pattern.notes.map(note => note.id))).size).toBe(4);
    expect(flattenNotes(p).map(note => note.effectiveInstrument)).toEqual(['harp', 'harp', 'bass', 'bass']);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'nbs-layer-merge' }));
    expect(validateProject(p)).toBe(p);
    const mapping = p.provenance!.metadata.layerMapping as { layer: number; name: string; trackId: string; patternId: string; regionId: string; noteIds: string[] }[];
    expect(mapping.map(row => row.layer)).toEqual([0, 1, 2, 3]);
    expect(mapping.map(row => row.name)).toEqual(['Harp left', 'Harp right', 'Bass left', 'Bass right']);
    expect(mapping.map(row => [row.trackId, row.patternId, row.regionId])).toEqual([0, 0, 1, 1].map(index => {
      const region = p.regions[index]; return [region.trackId, region.patternId, region.id];
    }));
    expect(mapping.flatMap(row => row.noteIds)).toEqual(p.patterns.flatMap(pattern => pattern.notes.map(note => note.id)));
    expect(openNbsx(saveNbsx(p)).provenance!.metadata.layerMapping).toEqual(mapping);
  });

  it('does not join matching instruments across a different instrument, an empty layer or a mixed-instrument layer', () => {
    const p = load([at(0), at(1, 1), at(2), at(4), at(5), at(5, 1, 1), at(6), at(7)], Array.from({ length: 8 }, () => ({}))).project;
    expect(p.tracks).toHaveLength(7);
    expect(p.regions.map(region => p.tracks.findIndex(track => track.id === region.trackId))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(p.patterns[3].notes).toHaveLength(0);
    expect(p.patterns[5].notes.map(note => note.instrumentId)).toEqual(['harp', 'bass']);
    expect(p.patterns[6].notes).toHaveLength(2);
    expect(flattenNotes(p, true)).toHaveLength(8);
  });

  it('keeps volume, effective pan, timing, pitch and detune when merging differently mixed layers, including subsequent layers', () => {
    const layers = [{ name: 'One', volume: 70, pan: 140 }, { name: 'Two', volume: 30, pan: 20 }, { name: 'Three', volume: 0, pan: 200 }, { name: 'Four', volume: 90, pan: 80 }];
    const notes = layers.map((_, layer) => ({ ...at(layer, 0, layer * 2), velocity: 35 + layer * 10, pan: 20 + layer * 50, detune: -37 + layer }));
    const imported = load(notes, layers), p = imported.project;
    const separate = notes.map((note, layer) => load([{ ...note, layer: 0 }], [layers[layer]]).project);
    const expected = separate.flatMap(project => flattenNotes(project, true));
    expect(p.tracks).toHaveLength(1); expect(p.tracks[0]).toMatchObject({ volume: 1, pan: 0 });
    const actual = flattenNotes(p, true);
    for (let index = 0; index < actual.length; index++) {
      expect(actual[index].gain).toBe(expected[index].gain);
      expect(actual[index].effectivePan).toBe(expected[index].effectivePan);
      expect(actual[index].absoluteTick).toBe(expected[index].absoluteTick);
      expect(actual[index].midi).toBe(expected[index].midi);
      expect(actual[index].duration).toBe(expected[index].duration);
      expect(actual[index].detune).toBe(expected[index].detune);
    }
    expect(p.provenance!.metadata.layers).toEqual(expect.arrayContaining(layers.map(layer => expect.objectContaining(layer))));
    const reopened = openNbsx(saveNbsx(p));
    expect(reopened.patterns).toEqual(p.patterns); expect(reopened.regions).toEqual(p.regions);
    expect(reopened.provenance).toEqual(p.provenance);
    expect(flattenNotes(reopened, true)).toEqual(actual);
    const exported = exportNbs(reopened, 6, 10), oracle = fromArrayBuffer(Uint8Array.from(exported.bytes).buffer);
    const exportedNotes = oracle.layers.all.flatMap(layer => Object.values(layer.notes.all));
    expect(exportedNotes).toHaveLength(notes.length);
    expect(exportedNotes.map(note => note.velocity).sort((a, b) => a - b)).toEqual(actual.map(note => Math.round(note.gain * 100)).sort((a, b) => a - b));
  });

  it('does not bake equal layer mixes or alter original note velocity unnecessarily', () => {
    const p = load([{ ...at(0), velocity: 75, pan: 20 }, { ...at(1), velocity: 25, pan: 180 }], [{ volume: 70, pan: 140 }, { volume: 70, pan: 140 }]).project;
    expect(p.tracks).toHaveLength(1); expect(p.tracks[0]).toMatchObject({ volume: .7, pan: .4 });
    expect(p.patterns).toHaveLength(1); expect(p.regions).toHaveLength(1);
    expect(p.patterns[0].notes.map(note => note.velocity)).toEqual([.75, .25]);
  });

  it('keeps independent coincident unisons and all their original layer identities in one source', () => {
    const p = load([{ ...at(0), key: 45 }, { ...at(1), key: 45 }, { ...at(2), key: 45 }], [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }]).project;
    expect(p.patterns).toHaveLength(1); expect(p.regions).toHaveLength(1);
    expect(p.patterns[0].notes).toHaveLength(3);
    expect(new Set(p.patterns[0].notes.map(note => note.id)).size).toBe(3);
    expect(p.patterns[0].notes.map(note => [note.tick, note.midi])).toEqual([[0, 66], [0, 66], [0, 66]]);
    const mapping = p.provenance!.metadata.layerMapping as { noteIds: string[] }[];
    expect(mapping.map(row => row.noteIds)).toEqual(p.patterns[0].notes.map(note => [note.id]));
    const restored = openNbsx(saveNbsx(p));
    expect(restored.patterns[0].notes).toEqual(p.patterns[0].notes);
    expect(restored.provenance!.metadata.layerMapping).toEqual(mapping);
    expect(flattenNotes(restored)).toHaveLength(3);
  });

  it('preserves lock/mute and solo boundaries while merging consecutive layers with identical playback states', () => {
    const imported = load([at(0), at(1), at(2), at(3), at(4), at(5)], [{}, {}, { locked: true }, { locked: true }, { solo: true }, { solo: true }]);
    const p = imported.project;
    expect(p.tracks.map(track => [track.locked, track.muted, track.solo])).toEqual([[false, false, false], [true, true, false], [false, false, true]]);
    expect(flattenNotes(p)).toHaveLength(2); expect(flattenNotes(p, true)).toHaveLength(6);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'nbs-layer-state-boundary' }));
  });

  it('uses full custom instrument identity rather than matching names or a fallback harp ID', () => {
    const p = importNbs(nbsFixture({ version: 6, custom: [{ name: 'Same' }, { name: 'Same' }], layers: [{}, {}, {}], notes: [at(0, 20), at(1, 20), at(2, 21)] }), 'custom.nbs').project;
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].instrumentId).not.toBe(p.tracks[1].instrumentId);
    expect(flattenNotes(p).map(note => note.effectiveInstrument)).toEqual([p.tracks[0].instrumentId, p.tracks[0].instrumentId, p.tracks[1].instrumentId]);
  });
});
