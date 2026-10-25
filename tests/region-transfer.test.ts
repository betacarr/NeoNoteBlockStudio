import { produce } from 'immer';
import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi, originalMidi } from '../src/core/midi';
import { createProject, flattenNotes, newNote, newTrack, validateProject } from '../src/core/project';
import { moveRegion } from '../src/core/region-transfer';
import type { Project } from '../src/core/types';

function fixture(shared = false, routed = true) {
  const project = createProject('Region transfer'); project.ppq = 480;
  const source = project.tracks[0], target = newTrack('Target', 1, 'bass');
  source.sourceMidiTrack = 0; source.midiChannel = 1; target.sourceMidiTrack = 1; target.midiChannel = 5;
  project.tracks.push(target);
  const pattern = project.patterns[0], region = project.regions[0];
  pattern.length = region.length = 1920; region.start = 120; region.offset = 30; region.loop = true;
  pattern.notes = [
    { ...newNote(60, 63, 91.5), velocity: .73, pan: -.25, detune: 9.125, height: .5, instrumentId: 'harp',
      midiSource: { onOrder: 7, offOrder: 13, releaseVelocity: 42, ...(routed ? { offSourceTrack: 2 } : {}) } },
    { ...newNote(480, 70, 0), velocity: .42 },
  ];
  pattern.midiEvents = [
    { id: 'sysex', tick: 0, order: 1, sourceTrack: 0, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } },
    { id: 'controller', tick: 240, order: 2, sourceTrack: 0, event: { deltaTime: 0, type: 'controller', channel: 1, controllerType: 64, value: 127, running: true } },
  ];
  project.assets.push({ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==', sha1: 'a'.repeat(40) });
  project.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', sourceTrackNames: ['Source', 'Target', 'Off route'], conductor: [] };
  if (shared) project.regions.push({ ...region, id: 'shared-copy', start: 2400 });
  return { project, source, target, pattern, region };
}
const withoutTimestamp = (project: Project) => { const copy = structuredClone(project); delete (copy as Partial<Project>).modifiedAt; return copy; };

describe('single region transfer and MIDI route ownership', () => {
  it('moves one region with all ranges, notes, messages, resources and other regions intact', () => {
    const test = fixture(false, false), before = structuredClone(test.project);
    const result = moveRegion(test.project, test.region.id, test.target.id, 1234.5);
    const expected = structuredClone(before); Object.assign(expected.regions[0], { start: 1234.5, trackId: test.target.id });
    expect(result).toBe(test.region); expect(test.project).toEqual(expected);
    expect(test.project.patterns[0]).toBe(test.pattern); expect(validateProject(test.project)).toBe(test.project);
  });

  it('keeps same-track timing edits and their original NoteOff route without a clone', () => {
    const test = fixture(true), before = structuredClone(test.project);
    moveRegion(test.project, test.region.id, test.source.id, 720);
    const expected = structuredClone(before); expected.regions[0].start = 720;
    expect(test.project).toEqual(expected); expect(test.project.patterns[0]).toBe(test.pattern);
  });

  it('returns the original region for a valid no-op and keeps the complete Immer snapshot', () => {
    const test = fixture(true);
    expect(moveRegion(test.project, test.region.id, test.source.id, test.region.start)).toBe(test.region);
    const next = produce(test.project, draft => { moveRegion(draft, test.region.id, test.source.id, test.region.start); });
    expect(next).toBe(test.project); expect(next.patterns[0]).toBe(test.pattern);
  });

  it.each(['source', 'target'] as const)('refuses a currently locked %s without writing or cloning', locked => {
    const test = fixture(true); test[locked].locked = true;
    const before = structuredClone(test.project);
    expect(moveRegion(test.project, test.region.id, test.target.id, 960)).toBeUndefined();
    expect(test.project).toEqual(before);
    expect(produce(test.project, draft => { moveRegion(draft, test.region.id, test.target.id, 960); })).toBe(test.project);
  });

  it.each([-1, NaN, Infinity, -Infinity, 1e12 + 1])('rejects the out-of-schema start %s before any change', start => {
    const test = fixture(true), before = structuredClone(test.project);
    expect(moveRegion(test.project, test.region.id, test.target.id, start)).toBeUndefined();
    expect(test.project).toEqual(before);
  });

  it('accepts the schema upper start without imposing an unrelated region-end limit', () => {
    const test = fixture(false, false);
    expect(moveRegion(test.project, test.region.id, test.target.id, 1e12)?.start).toBe(1e12);
    expect(() => validateProject(test.project)).not.toThrow();
  });

  it.each(['region', 'source', 'target', 'pattern'] as const)('rejects a missing %s before any change', missing => {
    const test = fixture(true);
    if (missing === 'source') test.project.tracks = test.project.tracks.filter(item => item !== test.source);
    if (missing === 'target') test.project.tracks = test.project.tracks.filter(item => item !== test.target);
    if (missing === 'pattern') test.project.patterns = [];
    const before = structuredClone(test.project);
    expect(moveRegion(test.project, missing === 'region' ? 'missing' : test.region.id, test.target.id, 960)).toBeUndefined();
    expect(test.project).toEqual(before);
  });

  it('clears only the route on an exclusively used source, including route zero, and never resurrects it', () => {
    const test = fixture(); test.pattern.notes[0].midiSource!.offSourceTrack = 0;
    const before = structuredClone(test.pattern), notes = test.pattern.notes, messages = test.pattern.midiEvents;
    moveRegion(test.project, test.region.id, test.target.id, 960);
    const expected = structuredClone(before); delete expected.notes[0].midiSource!.offSourceTrack;
    expect(test.pattern).toEqual(expected); expect(test.pattern.notes).toBe(notes); expect(test.pattern.midiEvents).toBe(messages);
    moveRegion(test.project, test.region.id, test.source.id, 120);
    expect(test.pattern).toEqual(expected); expect(test.project.patterns).toHaveLength(1);
  });

  it('detaches a routed shared source with new IDs and deeply independent MIDI payloads', () => {
    const test = fixture(true), original = structuredClone(test.pattern), untouchedRegion = structuredClone(test.project.regions[1]);
    moveRegion(test.project, test.region.id, test.target.id, 960);
    const clone = test.project.patterns[1];
    expect(test.project.regions[1]).toEqual(untouchedRegion); expect(test.pattern).toEqual(original);
    expect(test.region.patternId).toBe(clone.id); expect(clone.id).not.toBe(test.pattern.id); expect(clone.name).toBe(test.pattern.name);
    const ids = [...test.project.patterns.flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id), ...(pattern.midiEvents ?? []).map(event => event.id)]), ...test.project.regions.map(region => region.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(clone.notes.map(({ id, ...note }) => note)).toEqual(structuredClone(original.notes).map(({ id, ...note }) => {
      if (note.midiSource) delete note.midiSource.offSourceTrack; return note;
    }));
    expect(clone.midiEvents?.map(({ id, ...event }) => event)).toEqual(original.midiEvents?.map(({ id, ...event }) => event));
    expect(clone.notes[0].midiSource).not.toBe(test.pattern.notes[0].midiSource);
    const clonedEvent = clone.midiEvents![0].event, originalEvent = test.pattern.midiEvents![0].event;
    expect(clonedEvent).not.toBe(originalEvent);
    if (clonedEvent.type !== 'sysEx' || originalEvent.type !== 'sysEx') throw new Error('Expected independent SysEx arrays');
    expect(clonedEvent.data).not.toBe(originalEvent.data);
    if (!Array.isArray(clonedEvent.data)) throw new Error('Expected a cloned mutable SysEx array');
    clonedEvent.data[0] = 99;
    clone.notes[0].midiSource!.releaseVelocity = 77;
    expect(test.pattern).toEqual(original); expect(() => validateProject(test.project)).not.toThrow();
  });

  it('keeps a shared source shared when no note carries an old NoteOff route', () => {
    const test = fixture(true, false), original = test.pattern;
    moveRegion(test.project, test.region.id, test.target.id, 960);
    expect(test.project.patterns).toEqual([original]); expect(test.region.patternId).toBe(test.project.regions[1].patternId);
  });

  it('lets implicit notes follow the destination instrument and mix while retaining explicit overrides and every source attribute', () => {
    const test = fixture(false, false), before = structuredClone(test.pattern);
    test.target.volume = 2; test.target.pan = .4;
    moveRegion(test.project, test.region.id, test.target.id, 100.25);
    const notes = flattenNotes(test.project);
    expect(notes.map(note => [note.midi, note.effectiveInstrument, note.absoluteTick, note.gain])).toEqual([[63, 'harp', 130.25, 1.46], [70, 'bass', 550.25, .84]]);
    expect(notes[0].effectivePan).toBeCloseTo(.15, 12); expect(notes[1].effectivePan).toBe(.4);
    expect(test.pattern).toEqual(before); expect(test.project.patterns[0]).toBe(test.pattern);
  });

  it('refuses a required detach at the existing pattern-count limit before changing its source or region', () => {
    const test = fixture(true);
    for (let index = 1; index < 100000; index++) test.project.patterns.push({ id: `empty-pattern-${index}`, name: 'Empty', length: 1, notes: [] });
    const source = structuredClone(test.pattern), region = structuredClone(test.region);
    expect(moveRegion(test.project, test.region.id, test.target.id, 960)).toBeUndefined();
    expect(test.project.patterns).toHaveLength(100000); expect(test.pattern).toEqual(source); expect(test.region).toEqual(region);
  });

  it('roundtrips the full moved project and routes both MIDI note edges to the destination', () => {
    const test = fixture(); test.region.loop = false; test.region.offset = 0; test.pattern.notes = [test.pattern.notes[0]]; test.pattern.midiEvents = [];
    const originalBytes = originalMidi(test.project)!.bytes;
    const moved = produce(test.project, draft => { moveRegion(draft, test.region.id, test.target.id, 960); });
    const reopened = openNbsx(saveNbsx(moved));
    expect(withoutTimestamp(reopened)).toEqual(withoutTimestamp(moved)); expect(originalMidi(reopened)!.bytes).toEqual(originalBytes);
    const midi = parseMidi(exportMidi(reopened).bytes), source = midi.tracks.find(track => track.some(event => event.type === 'trackName' && event.text === 'Target'))!;
    expect(source.filter(event => event.type === 'noteOn' || event.type === 'noteOff').map(event => [event.type, 'channel' in event ? event.channel : -1, 'noteNumber' in event ? event.noteNumber : -1])).toEqual([['noteOn', 5, 63], ['noteOff', 5, 63]]);
    expect(midi.tracks.flatMap(track => track.filter(event => event.type === 'noteOff'))).toHaveLength(1);
  });
});
