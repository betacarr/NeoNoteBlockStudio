import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { parseMidi } from 'midi-file';
import { createProject, newNote, renderNoteEvents, validateProject, flattenNotes, newTrack } from '../src/core/project';
import { createAuditionProject } from '../src/core/audition-project';
import { saveNbsx, openNbsx } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { exportNbs } from '../src/core/nbs';
import { exportMidi, importMidi } from '../src/core/midi';
import { expressionFixture } from './fixtures/midi';
import { validateDrumMappings } from '../src/core/drum-mapping';

function fixture() {
  const project = createProject('drum'); project.ppq = 480;
  project.patterns[0].notes = [{ ...newNote(120,36,240), velocity: .8 }];
  project.tracks[0].drumPresetId = 'kit'; project.tracks[0].volume = .5;
  project.drumPresets = [{ id:'kit', name:'Kit', mappings:[{id:'kick',trigger:36,notes:[
    {id:'a',instrumentId:'basedrum',midi:60,offsetBeats:0,durationBeats:.25,velocity:1},
    {id:'b',instrumentId:'snare',midi:60,offsetBeats:0,durationBeats:.5,velocity:.5},
    {id:'c',instrumentId:'hat',midi:67,offsetBeats:.125,durationBeats:.125,velocity:.25},
  ]}]}];
  return project;
}
describe('embedded drum mapping and shared render expansion', () => {
  it('keeps one source event while expanding simultaneous pitches/instruments and fine beat offsets', () => {
    const p = fixture(), before = structuredClone(p), notes = renderNoteEvents(p).notes;
    expect(flattenNotes(p)).toHaveLength(1); expect(p).toEqual(before);
    expect(notes.map(n => [n.effectiveInstrument,n.midi,n.absoluteTick,n.duration,n.velocity,n.gain])).toEqual([
      ['basedrum',60,120,120,.8,.4], ['snare',60,120,240,.4,.2], ['hat',67,180,60,.2,.1],
    ]);
    expect(new Set(notes.map(n => n.id)).size).toBe(3);
    p.ppq = 960; expect(renderNoteEvents(p).notes[2].absoluteTick).toBe(240);
  });
  it('supports finer-than-MIDI-tick delay with no fixed note block grid', () => {
    const p=fixture(); p.drumPresets![0].mappings[0].notes[2].offsetBeats = 1 / 1000;
    expect(renderNoteEvents(p).notes[2].absoluteTick).toBe(120.48);
    expect(exportMidi(p).diagnostics.some(d => d.code === 'midi-drum-quantization')).toBe(true);
    expect(exportNbs(p,5,'bpm-7.5').diagnostics.some(d => d.code === 'nbs-quantization')).toBe(true);
  });
  it('applies track Delay once after mapping, including the mapped onset and velocity', () => {
    const p=fixture(); p.tracks[0].delay = {...createDefaultDelay(),enabled:true,mode:'tail',interval:.5,tail:.5,feedback:.5,wet:.5};
    const plan=renderNoteEvents(p);
    expect(plan.notes).toHaveLength(6); expect(plan.generated).toBe(3);
    const hat = plan.notes.filter(n=>n.effectiveInstrument==='hat');
    expect(hat.map(n=>[n.absoluteTick,n.velocity,n.gain])).toEqual([[180,.2,.1],[420,.05,.025]]);
  });
  it('preserves mapping through NBSX, audition, shared assignment, and independent deep copy', () => {
    const p=fixture(); const restored=openNbsx(saveNbsx(p)); expect(restored.drumPresets).toEqual(p.drumPresets);
    expect(restored.patterns[0].notes).toHaveLength(1); expect(renderNoteEvents(restored).notes).toHaveLength(3);
    const track=newTrack('shared'); track.drumPresetId='kit'; p.tracks.push(track);
    p.drumPresets![0].mappings[0].notes[0].midi=62;
    expect(renderNoteEvents(createAuditionProject(p,track,36)).notes.some(n=>n.midi===62)).toBe(true);
    const copy=structuredClone(p.drumPresets![0]); copy.id='other'; copy.mappings.forEach(m=>{m.id+='copy';m.notes.forEach(n=>n.id+='copy');}); p.drumPresets!.push(copy); copy.mappings[0].notes[0].midi=65;
    expect(p.drumPresets![0].mappings[0].notes[0].midi).toBe(62);
  });
  it('rejects missing presets and missing trigger mappings without silent dry-note fallback', () => {
    const p=fixture(); p.tracks[0].drumPresetId='absent'; expect(()=>validateProject(p)).toThrow(/预设不存在/);
    p.tracks[0].drumPresetId='kit'; p.patterns[0].notes[0].midi=37; expect(()=>renderNoteEvents(p)).toThrow(/MIDI 37/);
  });
  it.each(['offsetBeats','durationBeats','velocity'] as const)('rejects invalid %s', field => {
    const p=fixture(); p.drumPresets![0].mappings[0].notes[0][field]=NaN; expect(()=>validateDrumMappings(p)).toThrow();
  });
  it('rejects duplicate trigger keys and unknown instruments', () => {
    const p=fixture(); p.drumPresets![0].mappings.push({...structuredClone(p.drumPresets![0].mappings[0]),id:'duplicate'}); expect(()=>validateProject(p)).toThrow();
    p.drumPresets![0].mappings.pop(); p.drumPresets![0].mappings[0].notes[0].instrumentId='absent'; expect(()=>validateProject(p)).toThrow();
  });
  it('does not alter legacy projects without optional presets', () => {
    const p=createProject(); p.patterns[0].notes=[newNote(0,66)]; expect(validateProject(p)).toBe(p);
    expect(renderNoteEvents(p).notes).toEqual(flattenNotes(p));
  });
  it('exports NBS and MIDI actual onsets, same-pitch different instruments, and Delay exactly once', () => {
    const p=fixture(); p.tracks[0].delay={...createDefaultDelay(),enabled:true,mode:'tail',interval:.5,tail:.5,feedback:.5,wet:.5};
    const midi=parseMidi(exportMidi(p).bytes); const midiNotes=midi.tracks.flatMap(events=>{let tick=0;return events.flatMap(e=>{tick+=e.deltaTime;return e.type==='noteOn'&&e.velocity>0?[[tick,e.noteNumber]]:[];});}).sort(order);
    const expected=renderNoteEvents(p).notes.map(n=>[n.absoluteTick,n.midi]).sort(order); expect(midiNotes).toEqual(expected);
    expect(midi.tracks.flatMap(t=>t.filter(e=>e.type==='programChange'))).toHaveLength(3);
    const nbs=fromArrayBuffer(Uint8Array.from(exportNbs(p,5,'bpm-7.5').bytes).buffer);
    const nbsNotes=nbs.layers.all.flatMap(l=>Object.entries(l.notes.all).map(([tick,n])=>[Number(tick)*60,n.key+21])).sort(order); expect(nbsNotes).toEqual(expected);
    expect(p.patterns[0].notes).toHaveLength(1);
  });
  it('preserves independent non-drum MIDI notes and assigned channel', () => {
    const p=fixture(), other=newTrack('melody'); p.tracks.push(other);
    p.patterns.push({id:'melody-pattern',name:'melody',length:960,notes:[newNote(0,72)]});
    p.regions.push({id:'melody-region',trackId:other.id,patternId:'melody-pattern',start:0,length:960,offset:0,loop:false});
    const events=parseMidi(exportMidi(p).bytes).tracks.flat(); expect(events.find(e=>e.type==='noteOn'&&e.noteNumber===72)).toMatchObject({channel:1});
    expect(events.filter(e=>e.type==='noteOn'&&e.noteNumber===36)).toHaveLength(0);
  });
  it('preserves archived non-drum controller, SysEx, and pitch bend messages', () => {
    const p=importMidi(expressionFixture(),'source.mid').project, drum=fixture(), track=drum.tracks[0];
    p.drumPresets=drum.drumPresets; p.tracks.push(track); p.patterns.push(drum.patterns[0]); p.regions.push(drum.regions[0]);
    const actual=parseMidi(exportMidi(p).bytes).tracks.flat();
    const original=parseMidi(expressionFixture()).tracks.flat();
    for (const type of ['controller','pitchBend','sysEx','endSysEx','lyrics']) {
      expect(actual.filter(e=>e.type===type).map(({deltaTime:_delta,...e})=>e)).toEqual(original.filter(e=>e.type===type).map(({deltaTime:_delta,...e})=>e));
    }
  });
  it('places mapped loop occurrences and their delay on the musical NBS grid once', () => {
    const p=fixture(); p.patterns[0].length=960; p.regions[0].length=1920; p.regions[0].loop=true;
    p.tracks[0].delay={...createDefaultDelay(),enabled:true,mode:'tail',interval:.5,tail:.5,feedback:.5,wet:.5};
    const expected=renderNoteEvents(p).notes.map(n=>[n.absoluteTick,n.midi]).sort(order);
    const nbs=fromArrayBuffer(Uint8Array.from(exportNbs(p,5,'bpm-7.5').bytes).buffer);
    const actual=nbs.layers.all.flatMap(l=>Object.entries(l.notes.all).map(([tick,n])=>[Number(tick)*60,n.key+21])).sort(order);
    expect(actual).toEqual(expected); expect(expected).toHaveLength(12);
  });
});
function order(a:number[],b:number[]) { return a[0]-b[0] || a[1]-b[1]; }
