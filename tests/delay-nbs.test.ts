import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { createProject, flattenNotes, newNote, renderNoteEvents } from '../src/core/project';
import { createDefaultDelay } from '../src/core/delay';
import { exportNbs } from '../src/core/nbs';
import { openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi, importMidi, originalMidi } from '../src/core/midi';
import { expressionFixture } from './fixtures/midi';
import { createAuditionProject } from '../src/core/audition-project';

function fixture() {
  const project = createProject('Delay source'), note = newNote(0, 66, 960);
  project.ppq = 480; project.tempos = [{ tick: 0, bpm: 120 }];
  Object.assign(note, { velocity: .8, pan: -.1, detune: 12, height: .25, instrumentId: 'bell', midiSource: { onOrder: 3, offOrder: 7, releaseVelocity: 65 } });
  project.patterns[0].notes = [note]; project.patterns[0].length = project.regions[0].length = 1920;
  project.tracks[0].pan = .2;
  project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', interval: .5, feedback: .5, wet: 1, tail: 2 };
  return project;
}
const readNotes = (bytes: Uint8Array) => {
  const song = fromArrayBuffer(Uint8Array.from(bytes).buffer);
  return Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => ({ tick, ...layer.notes.all[tick] }))).sort((a,b) => a.tick - b.tick || (b.velocity ?? -1) - (a.velocity ?? -1));
};

describe('Delay materialized as actual NBS notes', () => {
  it.each([4,5,6] as const)('writes v%s independent-reader note times and velocities without changing source', version => {
    const project = fixture(), before = structuredClone(project);
    const result = exportNbs(project, version, 20), notes = readNotes(result.bytes);
    expect(notes.map(note => [note.tick,note.velocity])).toEqual([[0,80],[5,40],[10,20],[15,10],[20,5]]);
    expect(notes.every(note => note.key === 45 && note.instrument === 7 && note.pitch === 12 && note.panning === 10)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:'nbs-delay-baked'}));
    expect(flattenNotes(project)).toHaveLength(1); expect(project).toEqual(before);
  });

  it('releases before the source note-off and applies ADSR only to echo onset levels', () => {
    const project = fixture(); Object.assign(project.tracks[0].delay!, { mode:'gate', interval:.25, attack:.5, decay:.5, sustain:.5, releaseOffset:-1.5, release:.5 });
    const notes = readNotes(exportNbs(project,5,40).bytes);
    // Source duration is 2 beats. Release starts at .5 and ends at 1 beat.
    expect(notes.map(note=>[note.tick,note.velocity])).toEqual([[0,80],[5,20],[10,20],[15,5]]);
    expect(project.patterns[0].notes[0].duration).toBe(960);
  });

  it('does not use note duration or gate parameters in independent-tail mode', () => {
    const project = fixture(), first = exportNbs(project,5,20).bytes;
    project.patterns[0].notes[0].duration = 0;
    Object.assign(project.tracks[0].delay!, { attack:256,decay:256,release:0,releaseOffset:-256 });
    expect(exportNbs(project,5,20).bytes).toEqual(first);
  });

  it('writes echoes past the arrangement border and uses separate lanes at collisions', () => {
    const project = fixture(); project.regions[0].length = project.patterns[0].length = 481;
    project.patterns[0].notes.push({...newNote(480,66,1),velocity:1,instrumentId:'bell'});
    Object.assign(project.tracks[0].delay!, { interval:1,tail:1 });
    const notes = readNotes(exportNbs(project,5,20).bytes);
    expect(notes.map(note=>[note.tick,note.velocity])).toEqual([[0,80],[10,100],[10,40],[20,50]]);
    expect(Object.keys(fromArrayBuffer(Uint8Array.from(exportNbs(project,5,20).bytes).buffer).layers.all)).toHaveLength(2);
  });

  it('warns when NBS integer velocity cannot retain very soft echoes', () => {
    const project = fixture(); Object.assign(project.tracks[0].delay!, {feedback:.1,tail:4});
    const result = exportNbs(project,5,20);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:'nbs-delay-volume-quantization',severity:'warning'}));
    expect(readNotes(result.bytes).some(note=>note.velocity===0)).toBe(true);
  });

  it('keeps dry MIDI exports and embedded original bytes unchanged and persists only settings', () => {
    const project = importMidi(expressionFixture(),'original.mid').project;
    const original = originalMidi(project)!.bytes.slice(), midi = exportMidi(project).bytes;
    const sourceNotes = structuredClone(project.patterns), sourceArchive = structuredClone(project.midi);
    project.tracks[0].delay = {...createDefaultDelay(),enabled:true,mode:'tail',interval:.5,tail:2,panAmount:.4};
    expect(renderNoteEvents(project,true).generated).toBeGreaterThan(0);
    const before = structuredClone(project);
    exportNbs(project, 5, 20);
    expect(exportMidi(project).bytes).toEqual(midi); expect(originalMidi(project)!.bytes).toEqual(original);
    expect(project).toEqual(before);
    const reopened = openNbsx(saveNbsx(project));
    expect(reopened.tracks[0].delay).toEqual(project.tracks[0].delay);
    expect(reopened.patterns).toEqual(sourceNotes); expect(reopened.midi).toEqual(sourceArchive);
    expect(originalMidi(reopened)!.bytes).toEqual(original); expect(exportMidi(reopened).bytes).toEqual(midi);
  });

  it('refuses impossible echo expansion before returning partial NBS bytes', () => {
    const project = fixture(); Object.assign(project.tracks[0].delay!, {interval:1/128,tail:256});
    expect(()=>exportNbs(project)).toThrow('4096');
    expect(project.patterns[0].notes).toHaveLength(1);
  });
});

describe('Delay stereo positions in independent NBS readback', () => {
  it.each(([4, 5, 6] as const).flatMap(version => (['gate', 'tail'] as const).map(mode => ({ version, mode }))))('writes v$version $mode echoes relative to the dry pan without baking the source', ({ version, mode }) => {
    const project = fixture();
    Object.assign(project.tracks[0].delay!, { mode, panAmount: .4, attack: 0, decay: 0, sustain: 1, release: .5 });
    const before = structuredClone(project), notes = readNotes(exportNbs(project, version, 20).bytes);
    // @nbsjs/core exposes note panning relative to centre, in [-100, 100].
    expect(notes.map(note => [note.tick, note.velocity, note.panning])).toEqual([
      [0, 80, 10], [5, 40, -30], [10, 20, 50], [15, 10, -30], [20, 5, 50],
    ]);
    expect(notes.every(note => note.key === 45 && note.instrument === 7 && note.pitch === 12)).toBe(true);
    expect(flattenNotes(project)).toHaveLength(1); expect(project).toEqual(before);
  });

  it.each([
    { notePan: .7, trackPan: .2, expected: [90, 50, 100, 50, 100] },
    { notePan: -.7, trackPan: -.2, expected: [-90, -100, -50, -100, -50] },
    { notePan: .8, trackPan: .7, expected: [100, 60, 100, 60, 100] },
    { notePan: -.8, trackPan: -.7, expected: [-100, -100, -60, -100, -60] },
  ])('clamps the dry mix before adding alternating width: note $notePan, track $trackPan', ({ notePan, trackPan, expected }) => {
    const project = fixture(); project.patterns[0].notes[0].pan = notePan; project.tracks[0].pan = trackPan;
    project.tracks[0].delay!.panAmount = .4;
    const before = structuredClone(project);
    expect(readNotes(exportNbs(project, 5, 20).bytes).map(note => note.panning)).toEqual(expected);
    expect(project).toEqual(before);
  });

  it('keeps different dry and echo positions in independent layers at the same NBS tick', () => {
    const project = fixture();
    project.patterns[0].notes.push({ ...newNote(240, 66, 960), velocity: 1, pan: -.3, instrumentId: 'bell' });
    Object.assign(project.tracks[0].delay!, { panAmount: .4, tail: 1 });
    const before = structuredClone(project), bytes = exportNbs(project, 5, 20).bytes;
    expect(readNotes(bytes).map(note => [note.tick, note.velocity, note.panning])).toEqual([
      [0, 80, 10], [5, 100, -10], [5, 40, -30], [10, 50, -50], [10, 20, 50], [15, 25, 30],
    ]);
    const song = fromArrayBuffer(Uint8Array.from(bytes).buffer), layers = Object.values(song.layers.all);
    expect(layers).toHaveLength(2);
    expect(layers.map(layer => layer.notes.all[5]?.panning).sort((a, b) => a! - b!)).toEqual([-30, -10]);
    expect(layers.map(layer => layer.notes.all[10]?.panning).sort((a, b) => a! - b!)).toEqual([-50, 50]);
    expect(project).toEqual(before);
  });

  it('starts on the left for each source note and each loop occurrence, including coincident events', () => {
    const project = fixture();
    project.patterns[0].notes.push({ ...newNote(240, 70, 0), velocity: 1, pan: .3, instrumentId: 'bell' });
    project.patterns[0].length = 480; Object.assign(project.regions[0], { length: 960, loop: true });
    Object.assign(project.tracks[0].delay!, { panAmount: .4, tail: .5 });
    const before = structuredClone(project), notes = readNotes(exportNbs(project, 6, 20).bytes);
    expect(notes.map(note => [note.tick, note.key, note.velocity, note.panning])).toEqual([
      [0, 45, 80, 10], [5, 49, 100, 50], [5, 45, 40, -30],
      [10, 45, 80, 10], [10, 49, 50, 10], [15, 49, 100, 50], [15, 45, 40, -30], [20, 49, 50, 10],
    ]);
    expect(renderNoteEvents(project).generated).toBe(4);
    expect(project).toEqual(before);
  });

  it.each([4, 5, 6] as const)('keeps zero and absent widths byte-identical in NBS v%s, including a disabled effect', version => {
    const zero = fixture(), legacy = structuredClone(zero);
    delete legacy.tracks[0].delay!.panAmount;
    expect(exportNbs(zero, version, 20).bytes).toEqual(exportNbs(legacy, version, 20).bytes);
    zero.tracks[0].delay!.enabled = false; zero.tracks[0].delay!.panAmount = 1;
    legacy.tracks[0].delay!.enabled = false;
    expect(exportNbs(zero, version, 20).bytes).toEqual(exportNbs(legacy, version, 20).bytes);
  });

  it('roundtrips the full NBSX project with width settings and only the original stored notes', () => {
    const project = fixture(); project.tracks[0].delay!.panAmount = .625;
    const before = structuredClone(project), reopened = openNbsx(saveNbsx(project));
    const expected = structuredClone(before); expected.modifiedAt = reopened.modifiedAt;
    expect(reopened).toEqual(expected);
    expect(reopened.patterns[0].notes).toHaveLength(1);
    expect(reopened.patterns[0].notes[0].pan).toBe(-.1);
    expect(reopened.tracks[0].pan).toBe(.2); expect(reopened.tracks[0].delay!.panAmount).toBe(.625);
    expect(exportNbs(reopened, 5, 20).bytes).toEqual(exportNbs(project, 5, 20).bytes);
    expect(project).toEqual(before);
  });
});

describe('single-note audition projects', () => {
  it('copies track effects and exact note duration while shifting real tempo changes', () => {
    const project = fixture(); project.tempos = [{tick:0,bpm:120},{tick:480,bpm:60},{tick:960,bpm:180}];
    const before=structuredClone(project), preview=createAuditionProject(project,project.tracks[0],66,project.patterns[0].notes[0],720);
    expect(preview.ppq).toBe(480); expect(preview.tempos).toEqual([{tick:0,bpm:60},{tick:240,bpm:180}]);
    expect(preview.patterns[0].notes[0].duration).toBe(960); expect(preview.regions[0].length).toBe(960);
    expect(preview.tracks[0].delay).toEqual(project.tracks[0].delay); expect(preview.tracks[0].delay).not.toBe(project.tracks[0].delay);
    expect(renderNoteEvents(preview).generated).toBe(4); expect(project).toEqual(before);
  });
  it('uses the editor note length for a fresh keyboard trigger, with no long empty region', () => {
    const project=fixture(), preview=createAuditionProject(project,project.tracks[0],60,undefined,0,16);
    expect(preview.patterns[0].notes[0].duration).toBe(120); expect(preview.regions[0].length).toBe(120);
  });
});
