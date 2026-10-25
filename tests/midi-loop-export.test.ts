import { describe, expect, it } from 'vitest';
import { parseMidi, type MidiEvent } from 'midi-file';
import { createProject, flattenNotes, newNote, validateProject } from '../src/core/project';
import { exportMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';
import { openNbsx, saveNbsx } from '../src/core/container';
import type { StoredMidiEvent } from '../src/core/types';

function absolute(bytes: Uint8Array) {
  return parseMidi(bytes).tracks.flatMap((events, track) => {
    let tick = 0; return events.map(event => ({ ...event, track, tick: tick += event.deltaTime }));
  });
}
function fixture(period = 1, offset = 1e12, length = 1) {
  const project = createProject('Literal loop messages');
  project.patterns[0].length = period;
  project.patterns[0].notes = [];
  project.regions[0] = { ...project.regions[0], start: 0, offset, length, loop: true };
  return project;
}
const cc = (tick: number, value: number, order = 0): StoredMidiEvent => ({
  id: `cc-${tick}-${value}-${order}`,tick,order,event: { deltaTime: 0,type: 'controller',channel: 0,controllerType: 64,value },
});
const program = (tick: number, order: number): StoredMidiEvent => ({ id: `pc-${tick}-${order}`,tick,order,event: { deltaTime: 0,type: 'programChange',channel: 0,programNumber: 24 } });
const end = (tick: number, order = 99): StoredMidiEvent => ({ id: `end-${tick}-${order}`,tick,order,event: { deltaTime: 0,meta: true,type: 'endOfTrack' } });
const controllers = (bytes: Uint8Array) => absolute(bytes).flatMap(event => event.type === 'controller' ? [[event.tick,event.value]] : []);

describe('MIDI export visits actual loop message ranges instead of silent source cycles', () => {
  it('exports a schema-valid trillion-tick offset with just one real onset, preserving the full saved source', () => {
    const project = fixture(); project.patterns[0].notes = [newNote(0,66,0)];
    const before = structuredClone(project);
    expect(validateProject(project)).toBe(project);
    expect(flattenNotes(project,true).map(note => note.absoluteTick)).toEqual([0]);
    const reopened = openNbsx(saveNbsx(project));
    expect(exportNbs(reopened,5,'bpm-7.5').bytes.length).toBeGreaterThan(0);
    expect(absolute(exportMidi(reopened).bytes).flatMap(event => event.type === 'noteOn' || event.type === 'noteOff' ? [[event.tick,event.type,event.noteNumber]] : [])).toEqual([[0,'noteOn',66],[0,'noteOff',66]]);
    const expected = structuredClone(before); expected.modifiedAt = reopened.modifiedAt;
    expect(reopened).toEqual(expected); expect(project).toEqual(before);
  });

  it('keeps real program/controller and terminal releases at a huge offset without adding the next loop start', () => {
    const project = fixture();
    project.patterns[0].midiEvents = [program(0,0),cc(.25,127,1),cc(1,0,2),end(1)];
    const before = structuredClone(project), output = exportMidi(project);
    expect(controllers(output.bytes)).toEqual([[0,0],[0,127],[1,0]]);
    expect(absolute(output.bytes).flatMap(event => event.type === 'programChange' && event.programNumber === 24 ? [event.tick] : [])).toEqual([0]);
    expect(output.diagnostics.some(item => item.code === 'midi-expression-cropped')).toBe(true);
    expect(project).toEqual(before);
  });

  it('preserves loop-seam source occurrence order and the inclusive last release', () => {
    const project = fixture(4,0,8);
    project.patterns[0].midiEvents = [cc(0,9,0),cc(4,10,1)];
    expect(controllers(exportMidi(project).bytes)).toEqual([[0,9],[4,10],[4,9],[8,10]]);
    project.regions[0].midiEndExclusive = true;
    expect(controllers(exportMidi(project).bytes)).toEqual([[0,9],[4,10],[4,9]]);
  });

  it('owns a legacy far-source terminal event even when its tick exceeds the source period', () => {
    const project = fixture(1,1e12,1);
    project.patterns[0].midiEvents = [cc(1e12,41)];
    expect(controllers(exportMidi(project).bytes)).toEqual([[0,41],[1,41]]);
    project.regions[0].midiEndExclusive = true;
    expect(controllers(exportMidi(project).bytes)).toEqual([[0,41]]);
  });

  it('checks the emitted float expression for the large-coordinate fractional-period endpoint', () => {
    const project = fixture(1.1,999999999999.9,1.1);
    project.patterns[0].midiEvents = [cc(999999999999.9,42)];
    project.regions[0].midiEndExclusive = true;
    // Actual c1 local is 1.0999755859375, strictly below the saved 1.1 endpoint.
    expect(controllers(exportMidi(project).bytes)).toEqual([[0,42],[1,42]]);
  });

  it('does not repeat or crop a nonloop message merely because the source offset is large', () => {
    const project = fixture(1,1e12,1); project.regions[0].loop = false;
    project.patterns[0].midiEvents = [cc(1e12,70),end(1e12)];
    const result = exportMidi(project);
    expect(controllers(result.bytes)).toEqual([[0,70]]);
    expect(result.diagnostics.some(item => item.code === 'midi-expression-cropped')).toBe(false);
  });

  it('skips an empty long loop and source-only tempo metadata without iterating every silent cycle', () => {
    const project = fixture(1,0,100001);
    expect(absolute(exportMidi(project).bytes).filter(event => event.type === 'endOfTrack' && event.track === 1).map(event => event.tick)).toEqual([100001]);
    project.patterns[0].midiEvents = [{ id: 'stored-tempo',tick: 0,order: 0,event: { deltaTime: 0,meta: true,type: 'setTempo',microsecondsPerBeat: 500000 } }];
    expect(absolute(exportMidi(project).bytes).filter(event => event.type === 'setTempo').map(event => event.tick)).toEqual([0]);
  });

  it('counts an excessive actual expression range before allocating any repeated MIDI payload', () => {
    const project = fixture(1,0,4000001); project.patterns[0].midiEvents = [cc(0,64)];
    const before = structuredClone(project);
    expect(() => exportMidi(project)).toThrow('MIDI 消息超过 400 万');
    expect(project).toEqual(before);
  });

  it('matches an independent small cycle-major oracle for fractional crops, source tails, order and right-edge ownership', () => {
    const cases = [
      [1,0,1],[1.25,.25,5],[4,3,9],[7,10.25,12],[1.5,8.75,3.25],[8,0,8],
      [2.5,.1,1.1],[3.75,12,8],[1,50.25,2.5],[1.1,.9,4.1],
    ];
    for (const [period,offset,length] of cases) for (const exclusive of [false,true]) {
      const project = fixture(period,offset,length);
      project.regions[0].midiEndExclusive = exclusive;
      const stored = [cc(period,20,1),cc(0,10,2),program(period / 2,3),cc(period * 2 + .25,30,4)];
      project.patterns[0].midiEvents = stored;
      const expected: { tick: number;occurrence: number;order: number;event: MidiEvent }[] = [];
      // Deliberately naive, bounded enumeration; no production interval helper.
      for (let cycle = 0; cycle < Math.ceil((offset + length) / period); cycle++) for (const item of stored) {
        const local = item.tick + cycle * period - offset;
        if (local >= 0 && (exclusive ? local < length : local <= length)) expected.push({ tick: local,occurrence: cycle * period - offset,order: item.order,event: item.event });
      }
      expected.sort((a,b) => a.tick - b.tick || a.occurrence - b.occurrence || a.order - b.order);
      const tuple = (event: MidiEvent, tick: number) => event.type === 'controller' ? [Math.round(tick),'cc',event.value] : event.type === 'programChange' && event.programNumber === 24 ? [Math.round(tick),'pc',24] : undefined;
      const actual = absolute(exportMidi(project).bytes).flatMap(event => { const value = tuple(event,event.tick); return value ? [value] : []; });
      expect(actual,JSON.stringify({ period,offset,length,exclusive })).toEqual(expected.map(item => tuple(item.event,item.tick)));
    }
  });
});
