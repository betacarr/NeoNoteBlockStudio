import { describe, expect, it } from 'vitest';
import { produce, produceWithPatches, applyPatches, enablePatches } from 'immer';
import { parseMidi, type MidiEvent } from 'midi-file';
import { fromArrayBuffer } from '@nbsjs/core';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { exportMidi, originalMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';
import { createProject, newNote, newTrack, renderNoteEvents, validateProject } from '../src/core/project';
import { allocateTrackMidiChannel, deleteTrack, inspectTrackDelete, inspectTrackMove, moveTrackInView } from '../src/core/track-management';
import type { Project } from '../src/core/types';
import { midiEnd, smf } from './fixtures/midi';

enablePatches();
// Actual core transactions and serializers, independent MIDI/NBS decoding and
// literal musical answers. Patch reversal exercises model round trips, not App
// history, physical gestures, sound rendering or external-DAW execution.
const visible = new Set(['a', 'c', 'd']);
function fixture() {
  const project = createProject('Track management interoperability'); project.ppq = 480; project.audio.mode = 'studio';
  project.tracks = [
    { ...newTrack('A shared', 0, 'harp'), id: 'a', volume: .5, pan: .125, sourceMidiTrack: 1, delay: { ...createDefaultDelay(), enabled: false, panAmount: .25, releaseOffset: -.25 } },
    { ...newTrack('B hidden locked', 1, 'bass'), id: 'b', volume: .25, locked: true },
    { ...newTrack('C shared and unique', 2, 'harp'), id: 'c', volume: .75, pan: -.25, midiChannel: 7, sourceMidiTrack: 3 },
    { ...newTrack('D empty', 3, 'harp'), id: 'd' },
    { ...newTrack('E custom archive', 4, 'custom-tone'), id: 'e', volume: 1.25, pan: .25, midiChannel: 11, sourceMidiTrack: 4 },
  ];
  project.patterns = [
    { id: 'shared', name: 'Complete shared source', length: 960, notes: [
      { ...newNote(0, 60, 240), id: 'shared-first', velocity: 1, pan: .125, detune: 12, height: .25, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 35, offSourceTrack: 3 } },
      { ...newNote(480, 64, 720), id: 'shared-second', velocity: .5, pan: -.125, detune: -5, height: -.5, instrumentId: 'custom-tone', midiSource: { onOrder: 6, offOrder: 8, releaseVelocity: 51, offSourceTrack: 3 } },
    ], midiEvents: [{ id: 'shared-control', tick: 120, order: 4, sourceTrack: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 11, value: 90 } }] },
    { id: 'b-source', name: 'Locked source', length: 960, notes: [{ ...newNote(240, 48, 480), id: 'b-note', velocity: 1 }],
      midiEvents: [{ id: 'b-control', tick: 240, order: 1, event: { deltaTime: 0, type: 'controller', channel: 1, controllerType: 1, value: 23 } }] },
    { id: 'c-only', name: 'C unique source', length: 480, notes: [{ ...newNote(0, 69, 120), id: 'c-note', velocity: 1, pan: .25, midiSource: { onOrder: 10, offOrder: 15, releaseVelocity: 63, offSourceTrack: 1 } }],
      midiEvents: [
        { id: 'c-control', tick: 120, order: 16, sourceTrack: 3, event: { deltaTime: 0, type: 'controller', channel: 7, controllerType: 64, value: 127 } },
        { id: 'c-sysex', tick: 60, order: 11, sourceTrack: 3, event: { deltaTime: 0, type: 'sysEx', data: [125, 4, 8, 247] } },
        { id: 'c-unknown', tick: 60, order: 12, sourceTrack: 3, event: { deltaTime: 0, type: 'unknownMeta', metatypeByte: 126, data: [17, 23, 41] } },
      ] },
    { id: 'e-source', name: 'Original channel source', length: 960, notes: [{ ...newNote(120, 72, 480), id: 'e-note', velocity: .5, pan: -.25, midiSource: { onOrder: 20, offOrder: 21, releaseVelocity: 47, offSourceTrack: 3 } }] },
  ];
  project.regions = [
    { id: 'ra', trackId: 'a', patternId: 'shared', start: 0, length: 960, offset: 0, loop: false },
    { id: 'rb', trackId: 'b', patternId: 'b-source', start: 0, length: 960, offset: 0, loop: false },
    { id: 'rc-shared', trackId: 'c', patternId: 'shared', start: 960, length: 960, offset: 0, loop: false, midiEndExclusive: true },
    { id: 'rc-only', trackId: 'c', patternId: 'c-only', start: 1920, length: 480, offset: 0, loop: false },
    { id: 're', trackId: 'e', patternId: 'e-source', start: 240, length: 960, offset: 0, loop: false },
  ];
  const archive = smf(Array.from({ length: 6 }, (_, index) => [0, 255, 3, 8, 115, 111, 117, 114, 99, 101, 45, 48 + index, ...midiEnd]));
  const wav = Uint8Array.of(82, 73, 70, 70, 40, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 4, 0, 0, 0, 0, 0, 0, 0);
  project.assets = [{ id: 'archive', name: 'original.mid', mime: 'audio/midi', data: bytesToBase64(archive) }, { id: 'sample', name: 'portable.wav', mime: 'audio/wav', data: bytesToBase64(wav) }];
  project.instruments.find(instrument => instrument.id === 'harp')!.assetId = 'sample';
  project.instruments.find(instrument => instrument.id === 'bass')!.assetId = 'sample';
  project.instruments.push({ ...project.instruments[0], id: 'custom-tone', name: 'Custom portable', englishName: 'Custom portable', nbsIndex: undefined, assetId: 'sample', gmProgram: 10 });
  project.midi = { schema: 1, format: 1, sourceAssetId: 'archive', sourceTrackNames: ['source-0', 'source-1', 'source-2', 'source-3', 'source-4', 'source-5'],
    conductor: [{ id: 'global-marker', tick: 480, order: 1, sourceTrack: 0, event: { deltaTime: 0, type: 'marker', text: 'KEEP CONDUCTOR' } }] };
  project.provenance = { kind: 'midi', filename: 'original.mid', metadata: { fixture: 'All source data retained' } };
  validateProject(project); return { project, archive };
}
function model(project: Project) { const { modifiedAt: _timestamp, ...rest } = project; return rest; }
function reordered(project: Project) {
  return produce(project, draft => { expect(moveTrackInView(draft, 'c', -1, visible)).toBe(true); });
}
function deleted(project: Project) {
  return produce(project, draft => { expect(deleteTrack(draft, 'c', visible)).toEqual({ removedRegionIds: ['rc-shared', 'rc-only'], removedPatternIds: ['c-only'] }); });
}
function expectedReordered(project: Project) {
  const expected = structuredClone(project);
  expected.tracks = [expected.tracks[2], expected.tracks[1], { ...expected.tracks[0], midiChannel: 0 }, expected.tracks[3], expected.tracks[4]];
  return expected;
}
function expectedDeleted(project: Project) {
  const expected = structuredClone(project);
  expected.tracks = [expected.tracks[0], expected.tracks[1], { ...expected.tracks[3], midiChannel: 3 }, expected.tracks[4]];
  expected.regions = [expected.regions[0], expected.regions[1], expected.regions[4]];
  expected.patterns = [expected.patterns[0], expected.patterns[1], expected.patterns[3]];
  return expected;
}
function events(project: Project) {
  const parsed = parseMidi(exportMidi(project).bytes);
  return parsed.tracks.flatMap((track, index) => { let tick = 0; const name = track.find(event => event.type === 'trackName'); return track.map(event => ({ ...event, tick: tick += event.deltaTime, track: index, trackName: name?.type === 'trackName' ? name.text : '' })); });
}
function notes(project: Project, type: 'noteOn' | 'noteOff') {
  return events(project).flatMap(event => (event.type === 'noteOn' || event.type === 'noteOff') && event.type === type ? [[event.tick, event.noteNumber, event.channel, event.velocity]] : []).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
}
const allOnsets = [[0, 60, 0, 127], [240, 48, 1, 127], [360, 72, 11, 64], [480, 64, 0, 64], [960, 60, 7, 127], [1440, 64, 7, 64], [1920, 69, 7, 127]];
const allReleases = [[240, 60, 0, 35], [720, 48, 1, 0], [840, 72, 11, 47], [1200, 64, 0, 51], [1200, 60, 7, 35], [2040, 69, 7, 63], [2160, 64, 7, 51]];

describe('Track management musical/file interoperability', () => {
  it('swaps only visible canonical slots, pins changed implicit channels and roundtrips complete sources/assets', () => {
    const { project, archive } = fixture(), before = structuredClone(project);
    expect(inspectTrackMove(project, 'c', -1, visible)).toEqual({ ok: true, targetId: 'a' }); expect(project).toEqual(before);
    const result = reordered(project); expect(result).toEqual(expectedReordered(before)); expect(project).toEqual(before);
    expect(result.tracks[1]).toBe(project.tracks[1]); expect(result.patterns).toBe(project.patterns); expect(result.regions).toBe(project.regions);
    const reopened = openNbsx(saveNbsx(result)); expect(model(reopened)).toEqual(model(expectedReordered(before))); expect(originalMidi(reopened)?.bytes).toEqual(archive);
  });

  it('deletes only C-owned regions/unique source, pins D old channel and preserves full shared source and raw MIDI routes', () => {
    const { project, archive } = fixture(), before = structuredClone(project); expect(inspectTrackDelete(project, 'c', visible)).toEqual({ ok: true });
    const result = deleted(project); expect(result).toEqual(expectedDeleted(before)); expect(project).toEqual(before);
    expect(result.patterns[0]).toBe(project.patterns[0]); expect(result.patterns[0].notes[0].midiSource?.offSourceTrack).toBe(3);
    expect(result.assets).toBe(project.assets); expect(result.instruments).toBe(project.instruments); expect(result.midi).toBe(project.midi);
    const reopened = openNbsx(saveNbsx(result)); expect(model(reopened)).toEqual(model(expectedDeleted(before))); expect(originalMidi(reopened)?.bytes).toEqual(archive);
  });

  it('keeps literal original MIDI channels/releases/controllers after filtered reorder without imposing MIDI track byte order', () => {
    const { project } = fixture();
    for (const candidate of [project, reordered(project)]) {
      expect(notes(candidate, 'noteOn')).toEqual(allOnsets); expect(notes(candidate, 'noteOff')).toEqual(allReleases);
      expect(events(candidate).flatMap(event => event.type === 'controller' ? [[event.tick, event.channel, event.controllerType, event.value]] : []).sort((a, b) => a[0] - b[0])).toEqual([[120, 0, 11, 90], [240, 1, 1, 23], [1080, 7, 11, 90], [2040, 7, 64, 127]]);
      expect(events(candidate).flatMap(event => event.type === 'sysEx' ? [[event.tick, Array.from(event.data)]] : [])).toEqual([[1980, [125, 4, 8, 247]]]);
      expect(events(candidate).flatMap(event => event.type === 'unknownMeta' ? [[event.tick, event.metatypeByte, Array.from(event.data)]] : [])).toEqual([[1980, 126, [17, 23, 41]]]);
      expect(events(candidate).flatMap(event => event.type === 'marker' ? [[event.tick, event.text]] : [])).toEqual([[480, 'KEEP CONDUCTOR']]);
    }
  });

  it('exports surviving note-offs into the deleted track source bucket instead of dropping them as ghost data', () => {
    const result = deleted(fixture().project);
    expect(notes(result, 'noteOn')).toEqual(allOnsets.slice(0, 4)); expect(notes(result, 'noteOff')).toEqual(allReleases.filter(note => note[2] !== 7));
    const offBucket = events(result).filter(event => event.trackName === 'source-3');
    expect(offBucket.flatMap(event => event.type === 'noteOff' ? [[event.tick, event.noteNumber, event.channel, event.velocity]] : [])).toEqual([[240, 60, 0, 35], [840, 72, 11, 47], [1200, 64, 0, 51]]);
    expect(offBucket.some(event => event.type === 'noteOn')).toBe(false);
    expect(events(result).flatMap(event => event.type === 'controller' ? [[event.tick, event.channel, event.controllerType, event.value]] : []).sort((a, b) => a[0] - b[0])).toEqual([[120, 0, 11, 90], [240, 1, 1, 23]]);
    expect(events(result).some(event => event.type === 'sysEx' || event.type === 'unknownMeta')).toBe(false);
  });

  it.each([4, 5, 6] as const)('keeps literal NBS v%s onsets, per-note mix and custom instruments through reorder, removing only deleted C output', version => {
    const { project } = fixture(), custom = version === 6 ? 20 : 16;
    const wanted = [[0, 39, 0, 50, 25, 12], [4, 27, 1, 25, 0, 0], [6, 51, custom, 63, 0, 0], [8, 43, custom, 25, 0, -5], [16, 39, 0, 75, -12, 12], [24, 43, custom, 38, -37, -5], [32, 48, 0, 75, 0, 0]];
    const read = (source: Project) => { const song = fromArrayBuffer(Uint8Array.from(exportNbs(source, version, 'bpm-7.5').bytes).buffer); expect(song.getTempo()).toBe(16); return Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => { const note = layer.notes.all[tick]; return [tick, note.key, note.instrument, note.velocity, note.panning, note.pitch]; })).sort((a, b) => Number(a[0]) - Number(b[0])); };
    expect(read(project)).toEqual(wanted); expect(read(reordered(project))).toEqual(wanted); expect(read(deleted(project))).toEqual(wanted.slice(0, 4));
  });

  it('preserves literal render-event onsets, durations, gains, panning and effective instruments', () => {
    const { project } = fixture(), read = (source: Project) => renderNoteEvents(source).notes.map(note => [note.trackId, note.absoluteTick, note.midi, note.duration, note.gain, note.effectivePan, note.effectiveInstrument]);
    const wanted = [['a', 0, 60, 240, .5, .25, 'harp'], ['b', 240, 48, 480, .25, 0, 'bass'], ['e', 360, 72, 480, .625, 0, 'custom-tone'], ['a', 480, 64, 720, .25, 0, 'custom-tone'], ['c', 960, 60, 240, .75, -.125, 'harp'], ['c', 1440, 64, 720, .375, -.375, 'custom-tone'], ['c', 1920, 69, 120, .75, 0, 'harp']];
    expect(read(project)).toEqual(wanted); expect(read(reordered(project))).toEqual(wanted); expect(read(deleted(project))).toEqual(wanted.slice(0, 4));
  });

  it('restores complete literal models through one transaction patch reversal/reapplication', () => {
    const { project } = fixture();
    for (const operation of ['move', 'delete'] as const) {
      const [next, patches, inverse] = produceWithPatches(project, draft => { if (operation === 'move') moveTrackInView(draft, 'c', -1, visible); else deleteTrack(draft, 'c', visible); });
      const expected = operation === 'move' ? expectedReordered(project) : expectedDeleted(project);
      expect(next).toEqual(expected); const undone = applyPatches(next, inverse); expect(undone).toEqual(project);
      const redone = applyPatches(undone, patches); expect(redone).toEqual(expected); expect(model(openNbsx(saveNbsx(redone)))).toEqual(model(expected));
    }
  });

  it('refuses hidden/locked deletion atomically, accepts empty deletion and supports deleting the last empty track', () => {
    const { project } = fixture(), before = structuredClone(project);
    expect(inspectTrackDelete(project, 'b').ok).toBe(false); expect(deleteTrack(project, 'b')).toBeUndefined();
    expect(inspectTrackMove(project, 'b', -1, visible).ok).toBe(false); expect(moveTrackInView(project, 'b', -1, visible)).toBe(false); expect(project).toEqual(before);
    const withoutEmpty = produce(project, draft => { expect(deleteTrack(draft, 'd', visible)).toEqual({ removedRegionIds: [], removedPatternIds: [] }); });
    const expected = structuredClone(before); expected.tracks.splice(3, 1); expect(withoutEmpty).toEqual(expected);
    const last = structuredClone(project); last.tracks = [last.tracks[3]]; last.regions = []; last.patterns = [];
    expect(deleteTrack(last, 'd')).toEqual({ removedRegionIds: [], removedPatternIds: [] }); expect(last.tracks).toEqual([]);
    const reopened = openNbsx(saveNbsx(last)); expect(model(reopened)).toEqual(model(last)); expect(originalMidi(reopened)?.bytes).toEqual(originalMidi(project)?.bytes);
  });

  it('allocates an unused preferred channel, otherwise first free, reusing only when all 16 are occupied', () => {
    const { project } = fixture(); expect(allocateTrackMidiChannel(project)).toBe(5); expect(allocateTrackMidiChannel(project, 7)).toBe(2);
    project.tracks = Array.from({ length: 16 }, (_, index) => ({ ...newTrack('Occupied ' + index), midiChannel: index }));
    expect(allocateTrackMidiChannel(project)).toBe(0); expect(allocateTrackMidiChannel(project, 31)).toBe(15);
  });
});
