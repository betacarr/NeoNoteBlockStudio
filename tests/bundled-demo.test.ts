import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { fromArrayBuffer } from '@nbsjs/core';
import { createDemo, createProject, flattenNotes, projectEnd, validateProject } from '../src/core/project';
import { openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';

describe('public-domain built-in Ode to Joy example', () => {
  it('keeps the two complete vocal phrases and their dotted cadences from the 1826 score', () => {
    const project = createDemo(), melody = project.patterns[0].notes;
    const first = [66, 66, 67, 69, 69, 67, 66, 64, 62, 62, 64, 66, 66, 64, 64];
    expect(melody.map(note => note.midi)).toEqual([...first, ...first.slice(0, 12), 64, 62, 62]);
    expect(melody.map(note => note.tick / 960)).toEqual([0,1,2,3,4,5,6,7,8,9,10,11,12,13.5,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29.5,30]);
    expect(melody.map(note => note.duration / 960)).toEqual([...Array(12).fill(1),1.5,0.5,2,...Array(12).fill(1),1.5,0.5,2]);
    expect(projectEnd(project)).toBe(8 * 4 * project.ppq);
    expect(project.tempos).toEqual([{ tick: 0, bpm: 108 }]);
    expect(project.timeSignatures).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(project.author).toBe('Ludwig van Beethoven');
    expect(project.description).toContain('Schott 1826');
  });

  it('uses only vanilla-range notes with a sparse bell part and independent editable tracks', () => {
    const project = validateProject(createDemo()), notes = flattenNotes(project);
    expect(project.tracks.map(track => track.instrumentId)).toEqual(['harp', 'bass', 'bell']);
    expect(project.patterns.map(pattern => pattern.notes.length)).toEqual([30, 16, 4]);
    expect(notes).toHaveLength(50);
    expect(notes.every(note => note.midi >= 54 && note.midi <= 78 && note.tick + note.duration <= 30720)).toBe(true);
    expect(project.regions).toHaveLength(3);
    project.regions.forEach((region, index) => expect(region).toMatchObject({ trackId: project.tracks[index].id, patternId: project.patterns[index].id, start: 0, offset: 0, length: 30720, loop: false }));
    expect(new Set(notes.map(note => note.id)).size).toBe(50);
  });

  it('round-trips NBSX without renaming a saved user project and leaves new projects blank', () => {
    const project = createDemo();
    expect(openNbsx(saveNbsx(project))).toEqual({ ...project, modifiedAt: expect.any(String) });
    project.name = '玻璃庭院'; project.description = '我的作品';
    expect(openNbsx(saveNbsx(project))).toMatchObject({ name: '玻璃庭院', description: '我的作品' });
    const blank = createProject();
    expect(flattenNotes(blank)).toEqual([]);
    expect(blank.name).not.toBe(createDemo().name);
    expect(blank.tracks[0].name).toBe('竖琴');
  });

  it('exports every onset and pitch to independently parsed MIDI and NBS', () => {
    const project = createDemo(), expected = flattenNotes(project).map(note => [note.absoluteTick, note.midi]).sort(order);
    const midi = parseMidi(exportMidi(project).bytes);
    const actual = midi.tracks.flatMap(events => {
      let tick = 0;
      return events.flatMap(event => { tick += event.deltaTime; return event.type === 'noteOn' && event.velocity > 0 ? [[tick, event.noteNumber]] : []; });
    }).sort(order);
    expect(actual).toEqual(expected);
    // Eight NBS ticks per beat represent every quarter/eighth onset exactly.
    const bytes = exportNbs(project, 5, 'bpm-7.5').bytes;
    const nbs = fromArrayBuffer(Uint8Array.from(bytes).buffer);
    const nbsNotes = nbs.layers.all.flatMap(layer => Object.entries(layer.notes.all).map(([tick, note]) => [Number(tick) * 960 * 108 / (60 * nbs.getTempo()), note.key + 21])).sort(order);
    expect(nbsNotes).toEqual(expected);
  });
});

function order(a: number[], b: number[]) { return a[0] - b[0] || a[1] - b[1]; }
