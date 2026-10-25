import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { parseMidi } from 'midi-file';
import { fromArrayBuffer } from '@nbsjs/core';
import { unzipSync, strFromU8 } from 'fflate';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { exportMidi, originalMidi } from '../src/core/midi';
import { exportNbs } from '../src/core/nbs';
import { changeNoteVelocities, type VelocityMode } from '../src/core/note-velocity';
import { createProject, newNote, newTrack, renderNoteEvents, validateProject } from '../src/core/project';
import { PianoNoteIndex } from '../src/ui/piano-note-index';
import { previewPianoNotes } from '../src/ui/piano-preview';
import type { Project } from '../src/core/types';
import { midiEnd, smf } from './fixtures/midi';

// Load the existing committed, self-contained five-track literal fixture only,
// without executing its tests. It is the small-WAV counterpart of the GUI model:
// A/C shared source, C-only source, locked B, empty D and portable custom E.
// Ignored .local GUI downloads are deliberately not required by a clean checkout.
const fixtureSource = readFileSync(new URL('./track-management-interop.test.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const from = fixtureSource.indexOf('function fixture()'), to = fixtureSource.indexOf('\nfunction model(', from);
if (from < 0 || to < 0) throw Error('Committed track fixture boundary missing');
const fixtureCode = transformSync(fixtureSource.slice(from, to), { loader: 'ts', target: 'es2022' }).code;
const dependencies = { createProject, newNote, newTrack, createDefaultDelay, bytesToBase64, smf, midiEnd, validateProject };
const createFixture = Function(...Object.keys(dependencies), fixtureCode + '\nreturn fixture;')(...Object.values(dependencies)) as () => { project: Project; archive: Uint8Array };
function fixture() {
  const values = createFixture(), notes = values.project.patterns[0].notes;
  notes[0].velocity = .25; notes[1].velocity = .75; return values;
}
const both = new Set(['shared-first', 'shared-second']);
const states: { name: string; value: number; previewValue: number; mode: VelocityMode; ids: Set<string>; velocities: [number, number]; midi: [number | null, number]; nbs: [number, number, number, number]; gains: [number, number, number, number] }[] = [
  { name: 'relative plus eighth', value: .125, previewValue: .125, mode: 'relative', ids: both, velocities: [.375, .875], midi: [48, 111], nbs: [19, 44, 28, 66], gains: [.1875, .4375, .28125, .65625] },
  { name: 'relative upper bound', value: 1, previewValue: .25, mode: 'relative', ids: both, velocities: [.5, 1], midi: [64, 127], nbs: [25, 50, 38, 75], gains: [.25, .5, .375, .75] },
  { name: 'relative lower bound', value: -1, previewValue: -.25, mode: 'relative', ids: both, velocities: [0, .5], midi: [null, 64], nbs: [0, 25, 0, 38], gains: [0, .25, 0, .375] },
  { name: 'absolute inspector half', value: .5, previewValue: .5, mode: 'absolute', ids: both, velocities: [.5, .5], midi: [64, 64], nbs: [25, 25, 38, 38], gains: [.25, .25, .375, .375] },
  { name: 'absolute single first half', value: .5, previewValue: .5, mode: 'absolute', ids: new Set(['shared-first']), velocities: [.5, .75], midi: [64, 95], nbs: [25, 38, 38, 56], gains: [.25, .375, .375, .5625] },
];
function absolute(project: Project) {
  return parseMidi(exportMidi(project).bytes).tracks.flatMap((events, track) => { let tick = 0; return events.map(event => ({ ...event, tick: tick += event.deltaTime, track })); });
}
function expectedOnsets(first: number | null, second: number) {
  return [...(first === null ? [] : [[0, 60, 0, first], [960, 60, 7, first]]), [480, 64, 0, second], [1440, 64, 7, second],
    [240, 48, 1, 127], [360, 72, 11, 64], [1920, 69, 7, 127]].sort((a, b) => a[0] - b[0]);
}
function completeSavedZip(project: Project, expected: Project, archive: Uint8Array) {
  const bytes = saveNbsx(project), entries = unzipSync(bytes), actual = JSON.parse(strFromU8(entries['project.json'])), rawExpected = structuredClone(expected);
  const expectedEntries: Record<string, Uint8Array> = { mimetype: new TextEncoder().encode('application/vnd.exnoteblock.project+zip') };
  for (const asset of rawExpected.assets) { expectedEntries['assets/' + asset.id] = Uint8Array.from(Buffer.from(asset.data!, 'base64')); delete asset.data; }
  delete actual.modifiedAt; const { modifiedAt: _stamp, ...expectedWithoutStamp } = rawExpected;
  expect(actual).toEqual(expectedWithoutStamp); expect(Object.keys(entries).sort()).toEqual(['project.json', ...Object.keys(expectedEntries)].sort());
  for (const [name, data] of Object.entries(expectedEntries)) expect(entries[name]).toEqual(data);
  const reopened = openNbsx(bytes), { modifiedAt: _actualStamp, ...reopenedModel } = reopened, { modifiedAt: _expectedStamp, ...expectedModel } = expected;
  expect(reopenedModel).toEqual(expectedModel); expect(originalMidi(reopened)?.bytes).toEqual(archive);
}

describe('Note velocity independent musical/file interoperability', () => {
  it('loads the literal .25/.75 baseline and original release routes without changing the archive', () => {
    const { project, archive } = fixture(); completeSavedZip(project, project, archive);
    expect(absolute(project).flatMap(event => event.type === 'noteOn' ? [[event.tick, event.noteNumber, event.channel, event.velocity]] : []).sort((a, b) => a[0] - b[0])).toEqual(expectedOnsets(32, 95));
    expect(project.patterns[0].notes.map(note => [note.id, note.velocity, note.midiSource?.offSourceTrack])).toEqual([['shared-first', .25, 3], ['shared-second', .75, 3]]);
  });

  it.each(states)('$name preserves whole ZIP metadata and emits literal MIDI/NBS/render dynamics', state => {
    const { project: source, archive } = fixture(), before = structuredClone(source), expected = structuredClone(source);
    expected.patterns[0].notes[0].velocity = state.velocities[0]; expected.patterns[0].notes[1].velocity = state.velocities[1];
    const sourceNotes = source.patterns[0].notes, index = new PianoNoteIndex(sourceNotes);
    for (const mode of ['body', 'velocity'] as const) {
      const preview = previewPianoNotes(index, undefined, { kind: 'velocity', ids: state.ids, deltaTick: 0, deltaPitch: 0, value: state.previewValue, velocityMode: state.mode }, { start: 0, end: 1920, low: 0, high: 127 }, mode);
      expect(preview).toEqual(expected.patterns[0].notes); expect(source.patterns[0].notes).toBe(sourceNotes); expect(source).toEqual(before);
    }
    const changed = produce(source, draft => { draft.patterns[0].notes = changeNoteVelocities(draft.patterns[0].notes, state.ids, state.value, state.mode); });
    expect(changed).toEqual(expected); expect(source).toEqual(before); completeSavedZip(changed, expected, archive);
    const midi = absolute(changed);
    expect(midi.flatMap(event => event.type === 'noteOn' ? [[event.tick, event.noteNumber, event.channel, event.velocity]] : []).sort((a, b) => a[0] - b[0])).toEqual(expectedOnsets(...state.midi));
    const releases = [[720, 48, 1, 0], [840, 72, 11, 47], [1200, 64, 0, 51], [2040, 69, 7, 63], [2160, 64, 7, 51], ...(state.midi[0] === null ? [] : [[240, 60, 0, 35], [1200, 60, 7, 35]])].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    expect(midi.flatMap(event => event.type === 'noteOff' ? [[event.tick, event.noteNumber, event.channel, event.velocity]] : []).sort((a, b) => a[0] - b[0] || a[2] - b[2])).toEqual(releases);
    // A/E releases still go to source3/C; no cleanup or retargeting is allowed
    // merely because the note's velocity changed. Silent MIDI onsets are omitted.
    for (const pitch of [60, 64]) {
      const on = midi.find(event => event.type === 'noteOn' && event.channel === 0 && event.noteNumber === pitch), off = midi.find(event => event.type === 'noteOff' && event.channel === 0 && event.noteNumber === pitch);
      if (on && off) expect(off.track).not.toBe(on.track);
    }
    expect(midi.flatMap(event => event.type === 'controller' ? [[event.tick, event.channel, event.controllerType, event.value]] : []).sort((a, b) => a[0] - b[0])).toEqual([[120, 0, 11, 90], [240, 1, 1, 23], [1080, 7, 11, 90], [2040, 7, 64, 127]]);
    expect(midi.flatMap(event => event.type === 'sysEx' ? [[event.tick, Array.from(event.data)]] : [])).toEqual([[1980, [125, 4, 8, 247]]]);
    expect(midi.flatMap(event => event.type === 'unknownMeta' ? [[event.tick, event.metatypeByte, Array.from(event.data)]] : [])).toEqual([[1980, 126, [17, 23, 41]]]);
    expect(midi.flatMap(event => event.type === 'marker' ? [[event.tick, event.text]] : [])).toEqual([[480, 'KEEP CONDUCTOR']]);
    const rendered = renderNoteEvents(changed);
    expect(rendered.generated).toBe(0);
    expect(rendered.notes.map(note => [note.trackId, note.absoluteTick, note.midi, note.duration, note.gain, note.effectivePan, note.detune, note.height, note.effectiveInstrument])).toEqual([
      ['a', 0, 60, 240, state.gains[0], .25, 12, .25, 'harp'], ['b', 240, 48, 480, .25, 0, 0, 0, 'bass'], ['e', 360, 72, 480, .625, 0, 0, 0, 'custom-tone'],
      ['a', 480, 64, 720, state.gains[1], 0, -5, -.5, 'custom-tone'], ['c', 960, 60, 240, state.gains[2], -.125, 12, .25, 'harp'], ['c', 1440, 64, 720, state.gains[3], -.375, -5, -.5, 'custom-tone'], ['c', 1920, 69, 120, .75, 0, 0, 0, 'harp'],
    ]);
    for (const version of [4, 5, 6] as const) {
      const custom = version === 6 ? 20 : 16, bytes = exportNbs(changed, version, 'bpm-7.5').bytes, song = fromArrayBuffer(Uint8Array.from(bytes).buffer);
      expect(bytes[3]).toBe(custom); expect(song.getTempo()).toBe(16);
      const notes = Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => { const note = layer.notes.all[tick]; return [tick, note.key, note.instrument, note.velocity, note.panning, note.pitch]; })).sort((a, b) => Number(a[0]) - Number(b[0]));
      expect(notes).toEqual([[0, 39, 0, state.nbs[0], 25, 12], [4, 27, 1, 25, 0, 0], [6, 51, custom, 63, 0, 0], [8, 43, custom, state.nbs[1], 0, -5], [16, 39, 0, state.nbs[2], -12, 12], [24, 43, custom, state.nbs[3], -37, -5], [32, 48, 0, 75, 0, 0]]);
    }
  });
});
