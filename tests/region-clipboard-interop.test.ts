import { describe, expect, it } from 'vitest';
import { fromArrayBuffer } from '@nbsjs/core';
import { parseMidi, type MidiEvent } from 'midi-file';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createRegionClipboard, planRegionPaste } from '../src/core/region-clipboard';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import { exportMidi, originalMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';
import { midiEnd, smf } from './fixtures/midi';
import type { Project } from '../src/core/types';

// Exercise the actual transfer then independent MIDI/NBS readers. Expected
// onsets, ends and payloads below are literal musical results, not another paste
// planner. No browser, keyboard, audio DSP or external-DAW execution is claimed.
function fixture() {
  const source = createProject('Clipboard source'), target = createProject('Clipboard destination');
  source.ppq = 480; target.ppq = 960;
  source.tracks = [newTrack('Source A', 0, 'bass'), newTrack('Source gap', 1, 'flute'), newTrack('Source B', 2, 'bass')];
  source.tracks.forEach((track, index) => { track.id = `source-track-${index}`; track.sourceMidiTrack = index + 7; track.midiChannel = index + 1; });
  source.patterns = [
    { id: 'source-pattern-a', name: 'Trimmed A', length: 1440, notes: [
      { ...newNote(0, 54, 240), id: 'cropped-before' },
      { ...newNote(240, 60, 360), id: 'sounding-a', velocity: .75, pan: -.2, detune: 12.5, height: .75,
        midiSource: { onOrder: 2, offOrder: 7, releaseVelocity: 43, offSourceTrack: 7 } },
      { ...newNote(1200, 72, 120), id: 'cropped-after' },
    ], midiEvents: [
      { id: 'source-control', tick: 360, order: 3, sourceTrack: 7, event: { deltaTime: 0, type: 'controller' as const, channel: 1, controllerType: 11, value: 23 } },
      { id: 'source-sysex', tick: 480, order: 4, sourceTrack: 7, event: { deltaTime: 0, type: 'sysEx' as const, data: [126, 127, 9, 1, 247] } },
    ] },
    { id: 'source-pattern-b', name: 'Loop B', length: 960, notes: [
      { ...newNote(240, 67, 120), id: 'sounding-b', instrumentId: 'flute', velocity: .5,
        midiSource: { onOrder: 10, offOrder: 12, releaseVelocity: 51, offSourceTrack: 9 } },
    ], midiEvents: [{ id: 'source-loop-control', tick: 480, order: 11, sourceTrack: 9, event: { deltaTime: 0, type: 'controller' as const, channel: 3, controllerType: 1, value: 72 } }] },
  ];
  source.regions = [
    { id: 'region-a', trackId: 'source-track-0', patternId: 'source-pattern-a', start: 480, length: 960, offset: 120, loop: false },
    { id: 'region-b', trackId: 'source-track-2', patternId: 'source-pattern-b', start: 1920, length: 1440, offset: 240, loop: true },
  ];
  const originalSource = smf([[0, 255, 1, 6, 83, 79, 85, 82, 67, 69, ...midiEnd]], 0);
  const originalTarget = smf([[0, 255, 1, 6, 84, 65, 82, 71, 69, 84, ...midiEnd]], 0);
  source.assets = [{ id: 'source-archive', name: 'source.mid', mime: 'audio/midi', data: bytesToBase64(originalSource) }];
  source.midi = { schema: 1, format: 1, sourceAssetId: 'source-archive', conductor: [{ id: 'source-global', tick: 0, order: 0, event: { deltaTime: 0, type: 'text', text: 'SOURCE-GLOBAL' } }] };
  target.tracks = [newTrack('Guard', 0, 'harp'), { ...newTrack('Locked gap', 1), locked: true }, { ...newTrack('Destination', 2, 'harp'), midiChannel: 5, sourceMidiTrack: 2, pan: .1 }];
  target.tracks.forEach((track, index) => { track.id = `target-track-${index}`; });
  target.patterns[0].notes = [{ ...newNote(0, 54, 240), id: 'target-guard' }];
  target.regions[0].trackId = target.tracks[0].id;
  target.assets = [{ id: 'target-archive', name: 'target.mid', mime: 'audio/midi', data: bytesToBase64(originalTarget) }];
  target.midi = { schema: 1, format: 1, sourceAssetId: 'target-archive', sourceTrackNames: ['Guard', 'Locked', 'Destination'],
    conductor: [{ id: 'target-global', tick: 60, order: 0, event: { deltaTime: 0, type: 'text', text: 'TARGET-GLOBAL' } }] };
  validateProject(source); validateProject(target);
  return { source, target, originalSource, originalTarget };
}
function transferred() {
  const values = fixture(), beforeSource = structuredClone(values.source), beforeTarget = structuredClone(values.target);
  const clipboard = createRegionClipboard(values.source, new Set(['region-a', 'region-b']), 1, 'region-b');
  const plan = planRegionPaste(values.target, clipboard, 3840, 'target-track-2', 2);
  const project = structuredClone(values.target);
  project.tracks.push(...plan.tracks); project.patterns.push(...plan.patterns); project.regions.push(...plan.regions);
  project.instruments.push(...plan.instruments); project.assets.push(...plan.assets);
  expect(values.source).toEqual(beforeSource); expect(values.target).toEqual(beforeTarget);
  return { ...values, project, plan, beforeTarget };
}
function absolute(bytes: Uint8Array): (MidiEvent & { tick: number; track: number })[] {
  return parseMidi(bytes).tracks.flatMap((events, track) => { let tick = 0; return events.map(event => ({ ...event, tick: tick += event.deltaTime, track })); });
}

describe('Region clipboard exported musical interoperability', () => {
  it('roundtrips full cropped sources, loop periods and untouched target archive through NBSX', () => {
    const { project, plan, beforeTarget, originalTarget } = transferred();
    const reopened = openNbsx(saveNbsx(project)); const { modifiedAt: _a, ...actual } = reopened, { modifiedAt: _b, ...expected } = project;
    expect(actual).toEqual(expected); expect(originalMidi(reopened)?.bytes).toEqual(originalTarget);
    expect(reopened.assets).toEqual(beforeTarget.assets); expect(reopened.midi).toEqual(beforeTarget.midi);
    expect(reopened.tempos).toEqual(beforeTarget.tempos); expect(reopened.timeSignatures).toEqual(beforeTarget.timeSignatures);
    expect(reopened.tracks.slice(0, 3)).toEqual(beforeTarget.tracks); expect(reopened.patterns.slice(0, 1)).toEqual(beforeTarget.patterns);
    expect(plan.regions.map(({ start, length, offset, loop }) => [start, length, offset, loop])).toEqual([[3840, 1920, 240, false], [6720, 2880, 480, true]]);
    expect(plan.patterns.map(pattern => [pattern.length, pattern.notes.map(note => [note.tick, note.duration])])).toEqual([[2880, [[0, 480], [480, 720], [2400, 240]]], [1920, [[480, 240]]]]);
    expect(plan.tracks).toHaveLength(2); expect(plan.tracks.map(track => track.sourceMidiTrack)).toEqual([undefined, undefined]);
    expect(plan.regions.find(region => region.id === plan.primaryRegionId)?.trackId).toBe('target-track-2');
  });

  it('exports literal MIDI onsets/releases and rechannelled expressions without source conductor or stray off-track routes', () => {
    const { project } = transferred(), result = exportMidi(project), parsed = parseMidi(result.bytes), events = absolute(result.bytes);
    expect(parsed.header.ticksPerBeat).toBe(960);
    const notes = events.filter(event => event.type === 'noteOn' || event.type === 'noteOff');
    expect(notes.map(event => [event.type, event.tick, 'noteNumber' in event ? event.noteNumber : undefined, 'channel' in event ? event.channel : undefined, 'velocity' in event ? event.velocity : undefined]).sort((a,b) => Number(a[1])-Number(b[1]))).toEqual([
      ['noteOn',0,54,0,102], ['noteOff',240,54,0,0],
      ['noteOn',4080,60,5,95], ['noteOff',4800,60,5,43],
      ['noteOn',6720,67,3,64], ['noteOff',6960,67,3,51], ['noteOn',8640,67,3,64], ['noteOff',8880,67,3,51],
    ]);
    for (const midi of [60,67]) expect(new Set(notes.filter(event => 'noteNumber' in event && event.noteNumber === midi).map(event => event.track)).size).toBe(1);
    expect(events.filter(event => event.type === 'controller').map(event => [event.tick,event.channel,event.controllerType,event.value]).sort((a,b) => a[0]-b[0])).toEqual([[4320,5,11,23],[7200,3,1,72],[9120,3,1,72]]);
    expect(events.filter(event => event.type === 'sysEx').map(event => [event.tick,Array.from(event.data)])).toEqual([[4560,[126,127,9,1,247]]]);
    expect(events.filter(event => event.type === 'text').map(event => [event.tick,event.text])).toEqual([[60,'TARGET-GLOBAL']]);
  });

  it.each([4, 5, 6] as const)('exports NBS v%s at the correct audible crop/loop positions while leaving the editable source intact', version => {
    const { project } = transferred(), before = structuredClone(project), song = fromArrayBuffer(Uint8Array.from(exportNbs(project,version,40).bytes).buffer);
    const notes = Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => ({ tick, ...layer.notes.all[tick] }))).sort((a,b) => a.tick-b.tick);
    expect(notes.map(note => [note.tick,note.key,note.instrument,note.velocity,note.pitch,note.panning])).toEqual([
      [0,33,0,80,0,0], [85,39,0,75,13,-10], [140,46,6,50,0,0], [180,46,6,50,0,0],
    ]);
    expect(project).toEqual(before);
  });
});
