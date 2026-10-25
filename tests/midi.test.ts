import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { unzipSync, zipSync } from 'fflate';
import { parseMidi, type MidiEvent } from 'midi-file';
import { saveNbsx, openNbsx } from '../src/core/container';
import { importMidi, exportMidi, originalMidi } from '../src/core/midi';
import { duplicateRegion, flattenNotes, validateProject } from '../src/core/project';
import { smf, expressionFixture, programChangeFixture, midiEnd as end } from './fixtures/midi';
import { exportNbs } from '../src/core/nbs';
function absolute(bytes: Uint8Array): (MidiEvent & { tick: number; track: number })[] {
  return parseMidi(bytes).tracks.flatMap((events, track) => { let tick = 0; return events.map(event => ({ ...event, tick: tick += event.deltaTime, track })); });
}

describe('MIDI source fidelity and editable arrangement', () => {
  it('keeps a long note whose note-off follows a program change', () => {
    const source = programChangeFixture();
    const p = importMidi(source, 'program-change.mid').project;
    expect(p.tracks).toHaveLength(1);
    expect(p.patterns[0].notes.map(note => [note.midi, note.tick, note.duration])).toEqual([[72,0,480],[64,480,120]]);
    expect(p.tracks[0].instrumentId).toBe('flute'); expect(p.patterns[0].notes[1].instrumentId).toBe('guitar');
    expect(absolute(exportMidi(p).bytes).filter(event => event.type === 'programChange').map(event => [event.tick, event.programNumber])).toEqual([[0,73],[240,24]]);
  });
  it('retains expressions, SysEx, text, unknown metadata, release velocity and meter details through NBSX', () => {
    const source = expressionFixture(), p = openNbsx(saveNbsx(importMidi(source, '表达.mid').project));
    expect(originalMidi(p)?.bytes).toEqual(source); expect(p.tracks[0].name).toBe('旋律');
    expect(p.timeSignatures[0]).toMatchObject({ numerator: 7, denominator: 8, metronome: 36, thirtyseconds: 8 });
    const before = absolute(source), after = absolute(exportMidi(p).bytes);
    const kinds = new Set(['controller','pitchBend','noteAftertouch','channelAftertouch','sysEx','endSysEx','lyrics','text','unknownMeta','sequencerSpecific','keySignature','portPrefix','timeSignature']);
    const selected = (events: ReturnType<typeof absolute>) => events.filter(event => kinds.has(event.type)).map(({ deltaTime: _delta, track: _track, running: _running, ...event }: ReturnType<typeof absolute>[number] & { running?: boolean }) => ({ ...event, ...('data' in event ? { data: Array.from(event.data) } : {}) })).sort((a, b) => a.tick - b.tick || a.type.localeCompare(b.type));
    expect(selected(after)).toEqual(selected(before));
    expect(after.find(event => event.type === 'noteOff')).toMatchObject({ tick:120,velocity:35,channel:2 });
    expect(after.filter(event => event.type === 'endOfTrack' && event.track === 1).map(event => event.tick)).toEqual([240]);
  });
  it('moves and copies retained messages with independent region content', () => {
    const p = importMidi(expressionFixture(), 'copy.mid').project; p.regions[0].start = 960;
    const copied = produce(p, draft => { const region = duplicateRegion(draft, draft.regions[0].id)!; const pattern = draft.patterns.find(pattern => pattern.id === region.patternId)!;
      const controller = pattern.midiEvents!.find(event => event.event.type === 'controller' && event.event.controllerType === 11)!; if (controller.event.type === 'controller') controller.event.value = 24;
      const system = pattern.midiEvents!.find(event => event.event.type === 'sysEx')!; if ('data' in system.event) (system.event.data as number[])[0] = 125;
      pattern.notes[0].midiSource!.releaseVelocity = 77;
    });
    expect(p.patterns[0].notes[0].midiSource?.releaseVelocity).toBe(35);
    const originalSystem = p.patterns[0].midiEvents!.find(event => event.event.type === 'sysEx')!.event;
    expect('data' in originalSystem && originalSystem.data[0]).toBe(126);
    expect(validateProject(openNbsx(saveNbsx(copied)))).toBeTruthy();
    const output = absolute(exportMidi(copied).bytes);
    expect(p.patterns[0].length).toBe(1680);
    expect(output.flatMap(event => event.type === 'controller' && event.controllerType === 11 ? [[event.tick,event.value]] : [])).toEqual([[1020,96],[2700,24]]);
    expect(output.filter(event => event.type === 'noteOff').map(event => [event.tick,event.velocity])).toEqual([[1080,35],[2760,77]]);
  });
  it('repeats expression events in explicit loop mode and preserves its final silent range', () => {
    const p = importMidi(expressionFixture(), 'loop.mid').project; p.regions[0].loop = true; p.regions[0].length = 3360;
    const output = absolute(exportMidi(p).bytes);
    expect(output.filter(event => event.type === 'pitchBend').map(event => event.tick)).toEqual([60,1740]);
    expect(output.find(event => event.type === 'endOfTrack' && event.track === 1)?.tick).toBe(3360);
    expect(flattenNotes(p)).toHaveLength(2);
  });
  it('pairs repeated same-pitch notes FIFO without letting unmatched note-offs corrupt later notes', () => {
    const source = smf([[0,128,60,0,0,144,60,100,10,144,60,90,10,128,60,20,10,128,60,30,...end]], 0);
    const { project, diagnostics } = importMidi(source, 'overlap.mid');
    expect(project.patterns[0].notes.map(note => [note.tick,note.duration,note.midiSource?.releaseVelocity])).toEqual([[0,20,20],[10,20,30]]);
    expect(diagnostics.some(item => item.code === 'midi-safety-releases')).toBe(true);
    expect(absolute(exportMidi(project).bytes).filter(event => event.type === 'noteOff')).toHaveLength(3);
  });
  it('distinguishes identical channels and notes on separate MIDI ports', () => {
    const p = importMidi(smf([
      [0,255,33,1,1,0,192,73,0,144,60,100,131,116,128,60,0,...end],
      [0,255,33,1,2,0,192,24,0,144,60,100,100,128,60,0,...end],
    ]), 'ports.mid').project;
    expect(p.patterns.map(pattern => pattern.notes[0].duration)).toEqual([500,100]); expect(p.tracks.map(track => track.instrumentId)).toEqual(['flute','guitar']);
  });
  it('retains a zero-duration note instead of changing its source timing', () => {
    const p = importMidi(smf([[0,144,60,64,0,128,60,35,...end]],0),'zero.mid').project;
    expect(p.patterns[0].notes[0].duration).toBe(0);
    expect(absolute(exportMidi(openNbsx(saveNbsx(p))).bytes).filter(event => event.type === 'noteOn' || event.type === 'noteOff').map(event => [event.tick,event.type])).toEqual([[0,'noteOn'],[0,'noteOff']]);
  });
  it('rejects truncated tracks, oversized VLQs, zero PPQ and independent format-2 sequences', () => {
    const complete = expressionFixture(); expect(() => importMidi(complete.subarray(0,complete.length-1),'broken.mid')).toThrow('截断');
    expect(() => importMidi(smf([[255,255,255,255,0,255,47,0]],0),'vlq.mid')).toThrow('四字节');
    const zeroPpq = complete.slice(); zeroPpq[12] = zeroPpq[13] = 0; expect(() => importMidi(zeroPpq,'zero-ppq.mid')).toThrow('分辨率');
    expect(() => importMidi(smf([end],2),'independent.mid')).toThrow('独立乐段');
  });
  it('preserves a SysEx message relative to all channels at the same tick', () => {
    const p = importMidi(smf([[0,144,60,90,0,145,64,80,0,240,5,126,127,9,1,247,60,128,60,0,0,129,64,0,...end]],0),'ordering.mid').project;
    expect(p.tracks).toHaveLength(2);
    expect(absolute(exportMidi(p).bytes).filter(event => event.tick === 0 && (event.type === 'noteOn' || event.type === 'sysEx')).map(event => event.type === 'noteOn' ? event.noteNumber : event.type)).toEqual([60,64,'sysEx']);
  });
  it('keeps the final pedal release and orders it before the next loop starts', () => {
    const p = importMidi(smf([[0,176,64,127,0,144,60,90,131,96,128,60,0,139,32,176,64,0,...end]],0),'pedal.mid').project;
    expect(p.patterns[0].length).toBe(1920);
    expect(absolute(exportMidi(p).bytes).flatMap(event => event.type === 'controller' ? [[event.tick,event.value]] : [])).toEqual([[0,127],[1920,0]]);
    p.regions[0].loop = true; p.regions[0].length = 3840;
    expect(absolute(exportMidi(p).bytes).flatMap(event => event.type === 'controller' && event.tick === 1920 ? [event.value] : [])).toEqual([0,127]);
  });
  it('does not hide a zero-duration source note at the final bar boundary', () => {
    const p = importMidi(smf([[143,0,144,60,90,0,128,60,0,...end]],0),'terminal-zero.mid').project;
    expect(flattenNotes(p)).toHaveLength(1);
    expect(absolute(exportMidi(p).bytes).find(event => event.type === 'noteOn')?.tick).toBe(1920);
  });
  it('retains the original track of a cross-track note-off', () => {
    const p = importMidi(smf([[0,144,60,100,130,64,...end.slice(1)],[100,128,60,35,...end]]),'cross-track.mid').project;
    expect(p.patterns[0].notes[0].duration).toBe(100);
    expect(absolute(exportMidi(p).bytes).find(event => event.type === 'noteOff')).toMatchObject({tick:100,track:2,velocity:35});
  });
  it('rejects an NBSX that lost its archived source file', () => {
    const p = importMidi(expressionFixture(),'archive.mid').project;
    const files = unzipSync(saveNbsx(p)); delete files[`assets/${p.midi!.sourceAssetId}`];
    expect(() => openNbsx(zipSync(files))).toThrow('原始 MIDI');
  });
  it('archives unknown file chunks without interpreting them as music', () => {
    const source = expressionFixture(), extra = new Uint8Array(source.length + 11);
    extra.set(source.subarray(0,14)); extra.set([84,69,83,84,0,0,0,3,1,2,3],14); extra.set(source.subarray(14),25);
    const {project,diagnostics} = importMidi(extra,'extra.mid');
    expect(diagnostics.some(item => item.code === 'midi-extra-chunks')).toBe(true);
    expect(originalMidi(openNbsx(saveNbsx(project)))?.bytes).toEqual(extra);
  });
  it('reports MIDI expression and meter loss when converting to NBS', () => {
    const p = importMidi(expressionFixture(),'expression.mid').project;
    const before = JSON.stringify(p), result = exportNbs(p);
    expect(result.diagnostics.map(item => item.code)).toContain('nbs-midi-messages');
    expect(result.diagnostics.map(item => item.code)).toContain('nbs-meter');
    expect(JSON.stringify(p)).toBe(before);
  });
});
