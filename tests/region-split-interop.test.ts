import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { parseMidi, type MidiEvent } from 'midi-file';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { exportMidi, originalMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';
import { createProject, newNote, newTrack, renderNoteEvents, validateProject } from '../src/core/project';
import { createRegionClipboard, planRegionPaste } from '../src/core/region-clipboard';
import { inspectRegionSplit, splitRegionGroup } from '../src/core/region-split';
import type { Pattern, Project } from '../src/core/types';
import { midiEnd, smf } from './fixtures/midi';

// Actual split/clipboard/writers, independently decoded with midi-file and
// @nbsjs/core. Literal expectations describe musical output, not another split
// planner. This is core interoperability coverage, not physical input or DSP.
function fixture() {
  const project = createProject('Split interoperability'); project.ppq = 480;
  project.audio.mode = 'studio'; project.tempos = [{ tick: 0, bpm: 120 }, { tick: 1440, bpm: 90 }];
  project.tracks = ['Crop A', 'Loop B', 'Guard', 'Locked', 'Shared A'].map((name, index) => ({ ...newTrack(name, index), id: `track-${index}`, midiChannel: index + 1, sourceMidiTrack: index + 1 }));
  project.tracks[3].locked = true;
  project.patterns = [
    { id: 'pattern-a', name: 'Full A', length: 1920, notes: [
      { ...newNote(0, 54, 120), id: 'a-before' },
      { ...newNote(120, 60, 240), id: 'a-first', velocity: .75, pan: -.1, detune: 7.5, height: .25,
        midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 43, offSourceTrack: 4 } },
      { ...newNote(600, 64, 960), id: 'a-long', midiSource: { onOrder: 7, offOrder: 12, releaseVelocity: 51, offSourceTrack: 4 } },
      { ...newNote(840, 67, 240), id: 'a-cut', instrumentId: 'flute', midiSource: { onOrder: 20, offOrder: 28, releaseVelocity: 67, offSourceTrack: 5 } },
      { ...newNote(1200, 72, 120), id: 'a-later' }, { ...newNote(1800, 76, 120), id: 'a-after' },
    ], midiEvents: [
      { id: 'a-controller', tick: 840, order: 21, sourceTrack: 1, event: { deltaTime: 0, type: 'controller', channel: 1, controllerType: 64, value: 127 } },
      { id: 'a-sysex', tick: 840, order: 22, sourceTrack: 1, event: { deltaTime: 0, type: 'sysEx', data: [125, 1, 2, 3] } },
      { id: 'a-meta', tick: 840, order: 23, sourceTrack: 1, event: { deltaTime: 0, type: 'unknownMeta', metatypeByte: 126, data: [8, 9, 250] } },
    ] },
    { id: 'pattern-b', name: 'Full loop B', length: 720, notes: [
      { ...newNote(0, 55, 120), id: 'b-zero' }, { ...newNote(240, 59, 240), id: 'b-first' },
      { ...newNote(480, 62, 480), id: 'b-long' }, { ...newNote(600, 65, 60), id: 'b-later' },
    ], midiEvents: [
      { id: 'b-zero-controller', tick: 0, order: 1, sourceTrack: 2, event: { deltaTime: 0, type: 'controller', channel: 2, controllerType: 1, value: 9 } },
      { id: 'b-period-controller', tick: 720, order: 9, sourceTrack: 2, event: { deltaTime: 0, type: 'controller', channel: 2, controllerType: 1, value: 10 } },
      { id: 'b-sysex', tick: 720, order: 10, sourceTrack: 2, event: { deltaTime: 0, type: 'sysEx', data: [125, 7, 6, 5] } },
      { id: 'b-meta', tick: 720, order: 11, sourceTrack: 2, event: { deltaTime: 0, type: 'unknownMeta', metatypeByte: 125, data: [4, 3, 2] } },
    ] },
    { id: 'pattern-guard', name: 'Guard source', length: 480, notes: [{ ...newNote(120, 80, 120), id: 'guard-note' }] },
  ];
  project.regions = [
    { id: 'region-a', trackId: 'track-0', patternId: 'pattern-a', start: 240, length: 1440, offset: 120, loop: false },
    { id: 'region-b', trackId: 'track-1', patternId: 'pattern-b', start: 480, length: 1920, offset: 240, loop: true },
    { id: 'region-guard', trackId: 'track-2', patternId: 'pattern-guard', start: 0, length: 480, offset: 0, loop: false },
    { id: 'region-locked', trackId: 'track-3', patternId: 'pattern-guard', start: 480, length: 1440, offset: 0, loop: false },
    { id: 'region-shared', trackId: 'track-4', patternId: 'pattern-a', start: 2880, length: 1920, offset: 0, loop: false },
  ];
  const archive = smf([[0, 255, 1, 6, 83, 79, 85, 82, 67, 69, ...midiEnd]], 0);
  project.assets = [{ id: 'archive', name: 'original.mid', mime: 'audio/midi', data: bytesToBase64(archive) },
    // Hand-encoded mono PCM16 WAV with two samples; no external audio loader.
    { id: 'sample', name: 'portable.wav', mime: 'audio/wav', data: bytesToBase64(Uint8Array.of(
      82, 73, 70, 70, 40, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
      16, 0, 0, 0, 1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0,
      100, 97, 116, 97, 4, 0, 0, 0, 0, 0, 0, 0)) }];
  project.instruments.find(instrument => instrument.id === 'flute')!.assetId = 'sample';
  project.midi = { schema: 1, format: 1, sourceAssetId: 'archive', sourceTrackNames: ['Conductor', 'A', 'B', 'Guard', 'Release A', 'Release cut'],
    conductor: [{ id: 'global-text', tick: 60, order: 0, event: { deltaTime: 0, type: 'text', text: 'KEEP ORIGINAL' } }] };
  validateProject(project); return { project, archive };
}
function split() {
  const values = fixture(), before = structuredClone(values.project);
  const ids = new Set(['region-a', 'region-b', 'region-guard']);
  expect(inspectRegionSplit(values.project, ids, 960)).toEqual({ ok: true, count: 2 });
  expect(values.project).toEqual(before);
  const result = splitRegionGroup(values.project, ids, 960)!; expect(result.pairs).toHaveLength(2);
  return { ...values, before, result };
}
function withoutIdentities(pattern: Pattern) {
  const { id: _pattern, ...rest } = pattern;
  return { ...rest, notes: rest.notes.map(({ id: _note, ...note }) => note),
    midiEvents: rest.midiEvents?.map(({ id: _event, ...event }) => event) };
}
function model(project: Project) { const { modifiedAt: _stamp, ...rest } = project; return rest; }
function absolute(bytes: Uint8Array): (MidiEvent & { tick: number; track: number })[] {
  return parseMidi(bytes).tracks.flatMap((events, track) => { let tick = 0; return events.map(event => ({ ...event, tick: tick += event.deltaTime, track })); });
}

describe('Split regions: file and musical interoperability', () => {
  it('roundtrips literal crop/loop geometry, full independent sources, route metadata and untouched archive/assets', () => {
    const { project, before, result, archive } = split(), reopened = openNbsx(saveNbsx(project));
    expect(model(reopened)).toEqual(model(project)); expect(originalMidi(reopened)?.bytes).toEqual(archive);
    expect(project.tracks).toEqual(before.tracks); expect(project.assets).toEqual(before.assets); expect(project.midi).toEqual(before.midi);
    expect(project.tempos).toEqual(before.tempos); expect(project.timeSignatures).toEqual(before.timeSignatures);
    const [a, ar, b, br, ...guards] = project.regions;
    expect(result.pairs).toEqual([{ leftId: 'region-a', rightId: ar.id }, { leftId: 'region-b', rightId: br.id }]);
    expect([a, ar, b, br].map(({ start, length, offset, loop, midiEndExclusive }) => [start, length, offset, loop, midiEndExclusive])).toEqual([
      [240, 720, 120, false, true], [960, 720, 840, false, undefined], [480, 480, 240, true, true], [960, 1440, 720, true, undefined],
    ]);
    expect(guards).toEqual(before.regions.slice(2)); expect(project.patterns.slice(0, 3)).toEqual(before.patterns);
    expect(project.patterns).toHaveLength(6);
    const clones = project.patterns.slice(3);
    expect(clones.map(withoutIdentities)).toEqual([before.patterns[0], before.patterns[0], before.patterns[1]].map(withoutIdentities));
    expect([a.patternId, ar.patternId, b.patternId, br.patternId]).toEqual([clones[0].id, clones[1].id, 'pattern-b', clones[2].id]);
    const originalIds = new Set(before.patterns.flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id), ...(pattern.midiEvents ?? []).map(event => event.id)]));
    const freshIds = [...clones.flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id), ...(pattern.midiEvents ?? []).map(event => event.id)]), ar.id, br.id];
    expect(freshIds.every(id => !originalIds.has(id))).toBe(true); expect(new Set(freshIds).size).toBe(freshIds.length);
    expect(clones[0].notes[1].midiSource).not.toBe(project.patterns[0].notes[1].midiSource);
    expect(clones[0].midiEvents![1].event).not.toBe(project.patterns[0].midiEvents![1].event);
    expect('data' in clones[0].midiEvents![1].event && clones[0].midiEvents![1].event.data).not.toBe('data' in project.patterns[0].midiEvents![1].event && project.patterns[0].midiEvents![1].event.data);
  });

  it('keeps literal MIDI onsets and full crossing note-off without retriggering at the cut', () => {
    const { project } = split(), events = absolute(exportMidi(project).bytes);
    const onsets = (channel: number) => events.filter(event => event.type === 'noteOn' && event.channel === channel).map(event => [event.tick, event.type === 'noteOn' && event.noteNumber]);
    expect(onsets(1)).toEqual([[240, 60], [720, 64], [960, 67], [1320, 72]]);
    expect(onsets(2)).toEqual([[480, 59], [720, 62], [840, 65], [960, 55], [1200, 59], [1440, 62], [1560, 65], [1680, 55], [1920, 59], [2160, 62], [2280, 65]]);
    expect(events.filter(event => (event.type === 'noteOn' || event.type === 'noteOff') && event.channel === 1 && event.noteNumber === 64).map(event => [event.type, event.tick, 'velocity' in event && event.velocity])).toEqual([
      ['noteOn', 720, 102], ['noteOff', 1680, 51],
    ]);
    // Same-track split preserves original off-track routing, rather than the
    // clipboard's cross-document route-clearing rule.
    const longOn = events.find(event => event.type === 'noteOn' && event.channel === 1 && event.noteNumber === 64)!;
    const longOff = events.find(event => event.type === 'noteOff' && event.channel === 1 && event.noteNumber === 64)!;
    expect(longOn.track).not.toBe(longOff.track);
  });

  it('owns cut-point expressions once and preserves distinct period/zero events at loop seams in source occurrence order', () => {
    const { project, before } = split(), events = absolute(exportMidi(project).bytes);
    expect(events.filter(event => event.type === 'controller' && event.channel === 1).map(event => event.type === 'controller' && [event.tick, event.controllerType, event.value])).toEqual([[960, 64, 127]]);
    expect(events.filter(event => event.type === 'controller' && event.channel === 5).map(event => event.type === 'controller' && [event.tick, event.value])).toEqual([[3720, 127]]);
    expect(events.filter(event => event.type === 'sysEx' && event.data[1] === 1).map(event => event.type === 'sysEx' && [event.tick, Array.from(event.data)])).toEqual([[960, [125, 1, 2, 3]], [3720, [125, 1, 2, 3]]]);
    expect(events.filter(event => event.type === 'unknownMeta' && event.metatypeByte === 126).map(event => event.type === 'unknownMeta' && [event.tick, Array.from(event.data)])).toEqual([[960, [8, 9, 250]], [3720, [8, 9, 250]]]);
    expect(events.filter(event => event.type === 'controller' && event.channel === 2).map(event => event.type === 'controller' && [event.tick, event.value])).toEqual([[960, 10], [960, 9], [1680, 10], [1680, 9], [2400, 10]]);
    expect(events.filter(event => event.type === 'sysEx' && event.data[1] === 7).map(event => event.tick)).toEqual([960, 1680, 2400]);
    expect(events.filter(event => event.type === 'unknownMeta' && event.metatypeByte === 125).map(event => event.type === 'unknownMeta' && [event.tick, Array.from(event.data)])).toEqual([[960, [4, 3, 2]], [1680, [4, 3, 2]], [2400, [4, 3, 2]]]);
    expect(exportMidi(project).bytes).toEqual(exportMidi(before).bytes);
  });

  it('preserves the half-open border through actual cross-document clipboard, PPQ conversion and NBSX reopen', () => {
    const { project } = split(), target = createProject('960 destination'); target.ppq = 960;
    target.patterns = []; target.regions = []; target.tracks[0].id = 'destination';
    const a = project.regions.slice(0, 2), clipboard = createRegionClipboard(project, new Set(a.map(region => region.id)), 1, a[0].id);
    const plan = planRegionPaste(target, clipboard, 0, 'destination', 2);
    target.tracks.push(...plan.tracks); target.patterns.push(...plan.patterns); target.regions.push(...plan.regions);
    target.instruments.push(...plan.instruments); target.assets.push(...plan.assets);
    const reopened = openNbsx(saveNbsx(target)); expect(model(reopened)).toEqual(model(target));
    expect(reopened.regions.map(({ start, length, offset, midiEndExclusive }) => [start, length, offset, midiEndExclusive])).toEqual([[0, 1440, 240, true], [1440, 1440, 1680, undefined]]);
    expect(reopened.patterns.map(pattern => pattern.length)).toEqual([3840, 3840]);
    expect(reopened.patterns.every(pattern => pattern.notes.every(note => note.midiSource?.offSourceTrack === undefined))).toBe(true);
    const events = absolute(exportMidi(reopened).bytes);
    expect(events.filter(event => event.type === 'controller').map(event => [event.tick, event.type === 'controller' && event.value])).toEqual([[1440, 127]]);
    expect(events.filter(event => event.type === 'sysEx').map(event => [event.tick, Array.from(event.data)])).toEqual([[1440, [125, 1, 2, 3]]]);
    expect(events.filter(event => event.type === 'unknownMeta').map(event => [event.tick, Array.from(event.data)])).toEqual([[1440, [8, 9, 250]]]);
    expect(events.filter(event => event.type === 'noteOn').map(event => [event.tick, event.type === 'noteOn' && event.noteNumber])).toEqual([[0, 60], [960, 64], [1440, 67], [2160, 72]]);
  });

  it.each([4, 5, 6] as const)('exports NBS v%s literal tempo-baked Delay taps across the split without changing the original long note or envelope', version => {
    const project = createProject('Tempo and Delay split'); project.ppq = 480; project.audio.mode = 'studio';
    project.tempos = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }];
    project.patterns[0].length = 1920; project.patterns[0].notes = [
      { ...newNote(480, 60, 1440), velocity: .8 }, { ...newNote(960, 64, 240), velocity: .6 },
    ];
    project.regions[0].length = 1920; project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, interval: 1, feedback: .5, wet: 1, attack: 0, decay: 0, sustain: 1, release: 0 };
    const before = structuredClone(project), id = project.regions[0].id;
    expect(splitRegionGroup(project, new Set([id]), 960)?.pairs).toHaveLength(1);
    const rendered = renderNoteEvents(project);
    expect(rendered.generated).toBe(2);
    expect(rendered.notes.map(note => [note.absoluteTick, note.midi, note.duration, note.gain])).toEqual([[480, 60, 1440, .8], [960, 60, 1440, .4], [960, 64, 240, .6], [1440, 60, 1440, .2]]);
    const result = exportNbs(project, version, 40), song = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
    const notes = Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => ({ tick, ...layer.notes.all[tick] }))).sort((a, b) => a.tick - b.tick || (a.key ?? 0) - (b.key ?? 0));
    expect(notes.map(note => [note.tick, note.key, note.instrument, note.velocity])).toEqual([[20, 39, 0, 80], [40, 39, 0, 40], [40, 43, 0, 60], [80, 39, 0, 20]]);
    expect(result.diagnostics.map(item => item.code)).toContain('nbs-delay-baked');
    expect(result.diagnostics.map(item => item.code)).toContain('nbs-tempo-baked');
    expect(result.bytes).toEqual(exportNbs(before, version, 40).bytes);
    expect(project.patterns[0]).toEqual(before.patterns[0]); expect(project.tracks).toEqual(before.tracks);
    const reopened = openNbsx(saveNbsx(project)); expect(model(reopened)).toEqual(model(project));
  });
});
