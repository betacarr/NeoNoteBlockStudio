import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { Midi } from '@tonejs/midi';
import { fromArrayBuffer, Song, toArrayBuffer } from '@nbsjs/core';
import { strToU8, zipSync } from 'fflate';
import { createProject, duplicateRegion, flattenNotes, newNote, validateProject, projectDiagnostics, projectEnd } from '../src/core/project';
import { noteAudioParameters, renderDuration, listenerForProject } from '../src/audio/parameters';
import { saveNbsx, openNbsx } from '../src/core/container';
import { importMidi, exportMidi } from '../src/core/midi';
import { importNbs, exportNbs } from '../src/core/nbs';
import { secondsToTick, tickToSeconds } from '../src/core/time';
import { resolveNoteBlockSounds } from '../src/core/sound-events';
import { nativeArtifacts, releaseById } from '../src/core/releases';
import { audioFacts } from '../src/audio/profiles';
import { legacyLinearAttenuation, legacySourceGain } from '../src/audio/legacy';
import { broadcastForProject, withinBroadcastRange } from '../src/audio/delivery';
import { audioImplementation } from '../src/audio/implementations';

it('warns at the reviewed historical voice-pool configuration without changing musical content', () => {
  const project = createProject(); project.audio.profileId = 'java-1.7.10';
  project.patterns[0].notes = Array.from({ length: 28 }, () => newNote(0, 66));
  expect(projectDiagnostics(project).some(item => item.code === 'voice-pressure')).toBe(false);
  project.patterns[0].notes.push(newNote(0, 66));
  const before = structuredClone(project);
  expect(projectDiagnostics(project).some(item => item.code === 'voice-pressure')).toBe(true);
  expect(project).toEqual(before); expect(flattenNotes(project)).toHaveLength(29);
  project.audio.profileId = 'java-1.16.5';
  expect(projectDiagnostics(project).some(item => item.code === 'voice-pressure')).toBe(false);
});

describe('actual world sound delivery', () => {
  it.each(['java-1.12.2','java-1.13','java-1.14','java-1.16.5','java-1.19.2','java-1.20.2','java-1.20.5','java-26.3'])('checks %s server delivery from player feet separately from the ear-centred mixer distance', profileId => {
    const project = createProject(); project.audio.profileId=profileId; const broadcast = broadcastForProject(project);
    expect(broadcast?.range).toBe(48);
    expect(withinBroadcastRange(0, 47.88, -2, broadcast)).toBe(false);
    expect(Math.hypot(0, 47.88, -2)).toBeLessThan(48);
    expect(withinBroadcastRange(0, 12, -2, broadcast)).toBe(true);
    expect(withinBroadcastRange(48, 0, 0, { listenerPosition: [0, 0, 0], range: 48 })).toBe(false);
    project.audio.mode = 'studio'; expect(broadcastForProject(project)).toBeUndefined();
  });
});

describe('legacy source arithmetic', () => {
  it('selects the original 1.13 JOrbis path even though STB is present in its dependencies', () => {
    const release = releaseById('1.13')!;
    expect(release.audioLibraries.some(library => library.name.includes('lwjgl-stb'))).toBe(true);
    expect(audioImplementation(release)).toEqual({ decoderKind: 'legacy-jorbis', attenuationModel: 'paulscode-linear' });
    expect(audioImplementation({ ...release, clientSha1: 'unrecognised' }).decoderKind).toBe('unknown');
  });
  it('retains Java float rounding at the distance boundary and source gain multiplication', () => {
    expect(legacyLinearAttenuation(0, 0, 0, 48)).toBe(1);
    expect(legacyLinearAttenuation(0, 48, 0, 48)).toBe(0);
    expect(legacyLinearAttenuation(0, 47.999996, 0, 48)).toBe(Math.fround(1 - Math.fround(Math.fround(47.999996) / 48)));
    expect(legacySourceGain(.7, 2, 0, -2, 48)).toBe(Math.fround(legacyLinearAttenuation(2, 0, -2, 48) * Math.fround(.7)));
  });
});

describe('audio tails and large event sets', () => {
  it('keeps game master gain on the listener rather than baking it into each source', () => {
    const project = createProject(); project.audio.masterGain=.35; project.patterns[0].notes.push(newNote(0,66));
    const note=flattenNotes(project)[0]; expect(noteAudioParameters(project,note).gain).toBe(Math.fround(note.gain)); expect(listenerForProject(project)?.gain).toBe(Math.fround(.35));
  });
  it('retains a complete sample tail after the actual vanilla pitch clamp', () => {
    const project = createProject(); project.patterns[0].notes.push(newNote(projectEnd(project) - 1, 120, 1)); project.regions[0].length = projectEnd(project);
    const notes = flattenNotes(project), last = tickToSeconds(notes[0].absoluteTick, project);
    expect(noteAudioParameters(project, notes[0]).pitch).toBe(2);
    expect(renderDuration(project, notes, () => 4)).toBeCloseTo(last + 2 + .15);
    project.patterns[0].notes[0].duration = 100000;
    expect(renderDuration(project, flattenNotes(project), () => 4)).toBeCloseTo(last + 2 + .15);
  });
  it('handles 180,000 unique event times without spreading them onto the call stack', () => {
    const project = createProject(), count = 180000;
    project.patterns[0].notes = Array.from({ length: count }, (_, index) => ({ ...newNote(index, 66, 1), id: `large-${index}` }));
    project.patterns[0].length = count; project.regions[0].length = count;
    expect(projectDiagnostics(project)).toEqual([]);
    const duration = renderDuration(project, flattenNotes(project), () => 1);
    expect(Number.isFinite(duration)).toBe(true);
  });
});

describe('version-specific game audio resources', () => {
  it('uses the actual event samples instead of similarly named files', () => {
    const resolved = resolveNoteBlockSounds({ 'block.note_block.harp': { sounds: ['note/harp2'] }, 'block.note_block.bass': { sounds: ['note/bassattack'] }, 'block.note_block.chime': { sounds: [{ name: 'note/icechime', attenuation_distance: 24, pitch: .9 }] } });
    expect(resolved.harp.path).toBe('minecraft/sounds/note/harp2.ogg');
    expect(resolved.bass.path).toBe('minecraft/sounds/note/bassattack.ogg');
    expect(resolved.chime.attenuationDistance).toBe(24); expect(resolved.chime.pitch).toBe(.9);
    expect(() => resolveNoteBlockSounds({ 'block.note_block.harp': { sounds: ['note/harp', 'note/harp2'] } })).toThrow('变体');
    expect(() => resolveNoteBlockSounds({ 'block.note_block.harp': { sounds: ['../outside'] } })).toThrow('路径');
  });
  it('chooses the release and architecture-specific native archive', () => {
    expect(nativeArtifacts(releaseById('1.16.5')!, 'openal', 'win32', 'x64').map(a => a.path)).toEqual(['org/lwjgl/lwjgl-openal/3.2.2/lwjgl-openal-3.2.2-natives-windows.jar']);
    const macArm = nativeArtifacts(releaseById('1.19.2')!, 'openal', 'darwin', 'arm64');
    expect(macArm).toHaveLength(1); expect(macArm[0].path).toContain('natives-macos-arm64');
    expect(nativeArtifacts(releaseById('1.12.2')!, 'openal', 'win32', 'x64')).toHaveLength(1);
  });
  it('records the codec change and later volume change separately from game measurements', () => {
    expect(audioFacts('java-1.20.4')?.decoder).toBe('stb'); expect(audioFacts('java-1.20.5')?.decoder).toBe('jorbis');
    expect(audioFacts('java-1.21.8')?.volumeRule).toBe('category-before-clamp'); expect(audioFacts('java-1.21.9')?.volumeRule).toBe('category-after-clamp');
    expect(audioFacts('java-26.3')?.gameRecording).toBe('pending');
  });
});

describe('independent copies and explicit looping', () => {
  it('copies content independently while loop repetitions retain natural event timing', () => {
    const p = createProject(); p.patterns[0].notes.push(newNote(0, 66, 120)); p.patterns[0].length = 960;
    p.regions[0].length = 2880; p.regions[0].loop = true;
    expect(flattenNotes(p).map(n => n.absoluteTick)).toEqual([0, 960, 1920]);
    const copy = duplicateRegion(p, p.regions[0].id)!;
    const pattern = p.patterns.find(pt => pt.id === copy.patternId)!; pattern.notes[0].midi = 72;
    expect(p.patterns[0].notes[0].midi).toBe(66);
    expect(pattern.notes[0].id).not.toBe(p.patterns[0].notes[0].id);
  });
  it('keeps overlapping notes and excludes muted tracks from playback only', () => {
    const p = createProject(); p.patterns[0].notes.push(newNote(0, 66), newNote(0, 69)); p.tracks[0].muted = true;
    expect(flattenNotes(p)).toHaveLength(0); expect(flattenNotes(p, true)).toHaveLength(2);
  });
  it('creates independent copies inside immutable editor transactions', () => {
    const p = createProject(); p.patterns[0].notes.push(newNote(0, 66));
    const copied = produce(p, draft => { duplicateRegion(draft, draft.regions[0].id); });
    expect(p.regions).toHaveLength(1); expect(copied.regions).toHaveLength(2);
    expect(copied.patterns[1].notes[0].id).not.toBe(p.patterns[0].notes[0].id);
  });
});
describe('NBSX portable project', () => {
  it('round trips exact musical content and embedded binary resources', () => {
    const p = createProject('中文工程'); p.patterns[0].notes.push({ ...newNote(100, 68, 777), height: -1.25, detune: -37 });
    p.assets.push({ id: 'sample-fixture', name: '中文.ogg', mime: 'audio/ogg', data: 'AAECA//+' });
    const loaded = openNbsx(saveNbsx(p));
    expect(loaded.patterns).toEqual(p.patterns); expect(loaded.assets).toEqual(p.assets); expect(loaded.name).toBe('中文工程');
  });
  it('rejects unsupported schema versions, broken references and zip traversal', () => {
    const p = createProject();
    expect(() => validateProject({ ...p, version: 99 })).toThrow('版本');
    p.regions[0].patternId = 'missing'; expect(() => validateProject(p)).toThrow('引用');
    expect(() => openNbsx(zipSync({ '../project.json': strToU8('{}') }))).toThrow('路径');
  });
  it('loads v1 projects into the current schema without changing their musical content', () => {
    const current = createProject('旧档'); current.patterns[0].notes.push(newNote(120,66,240));
    const legacy = { ...current, version: 1 };
    const loaded = openNbsx(zipSync({ 'project.json': strToU8(JSON.stringify(legacy)) }));
    expect(loaded.version).toBe(2); expect(loaded.patterns).toEqual(current.patterns); expect(legacy.version).toBe(1);
    expect(openNbsx(saveNbsx(loaded)).patterns).toEqual(current.patterns);
  });
});
describe('musical timing and MIDI', () => {
  it('integrates tempo changes and inverts boundary positions', () => {
    const p = createProject(); p.tempos = [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 60 }];
    expect(tickToSeconds(2880, p)).toBe(2);
    for (const tick of [0, 480, 1919, 1920, 2880, 10000]) expect(secondsToTick(tickToSeconds(tick, p), p)).toBeCloseTo(tick, 7);
  });
  it('preserves MIDI PPQ, track split, durations, tempo, signature and expression metadata', () => {
    const source = new Midi();
    source.header.fromJSON({ name: 'MIDI fixture', ppq: 480, meta: [], keySignatures: [], tempos: [{ ticks: 0, bpm: 110 }, { ticks: 960, bpm: 85 }], timeSignatures: [{ ticks: 0, timeSignature: [3, 4] }] });
    const melody = source.addTrack(); melody.name = String.fromCharCode(...new TextEncoder().encode('旋律')); melody.channel = 2; melody.instrument.number = 73;
    melody.addNote({ midi: 72, ticks: 120, durationTicks: 555, velocity: .75 }); melody.addCC({ number: 11, ticks: 240, value: .6 }); melody.addPitchBend({ ticks: 300, value: .25 });
    const bass = source.addTrack(); bass.name = 'Bass'; bass.channel = 3; bass.addNote({ midi: 54, ticks: 960, durationTicks: 480, velocity: .5 });
    const { project } = importMidi(source.toArray(), 'fixture.mid');
    expect(project.ppq).toBe(480); expect(project.tracks.map(t => t.name)).toEqual(['旋律', 'Bass']);
    expect(project.patterns[0].notes[0].duration).toBe(555);
    const exported = new Midi(exportMidi(openNbsx(saveNbsx(project))).bytes);
    expect(exported.header.ppq).toBe(480); expect(exported.header.tempos.map(t => [t.ticks, Math.round(t.bpm)])).toEqual([[0, 110], [960, 85]]);
    expect(exported.tracks[0].notes[0].durationTicks).toBe(555); expect(exported.tracks[0].channel).toBe(2);
    expect(exported.tracks[0].instrument.number).toBe(73); expect(exported.tracks[0].controlChanges[11]).toHaveLength(1); expect(exported.tracks[0].pitchBends).toHaveLength(1);
  });
  it('rejects SMPTE instead of silently applying PPQ timing', () => {
    const bytes = new Midi().toArray(); bytes[12] = 0xe7; expect(() => importMidi(bytes, 'smpte.mid')).toThrow('SMPTE');
  });
});
describe('NBS compatibility with independent official library', () => {
  it.each([4, 5, 6] as const)('exports v%s chords to separate layers, preserving timing and tuning', version => {
    const p = createProject('Test NBS'); p.tracks[0].pan = .2; p.tracks[0].volume = .5;
    p.patterns[0].notes.push({ ...newNote(0, 66), velocity: .8, pan: -.4, detune: -50 }, newNote(0, 70), newNote(960, 72));
    const result = exportNbs(p, version, 20), oracle = fromArrayBuffer(Uint8Array.from(result.bytes).buffer);
    expect(oracle.name).toBe('Test NBS'); expect(oracle.getTempo()).toBe(20); expect(oracle.layers.getTotal()).toBe(2);
    const first = oracle.layers.all[0].notes.all[0]; expect(first.key).toBe(45); expect(first.pitch).toBe(-50); expect(first.velocity).toBe(40);
    const loaded = importNbs(result.bytes, 'test.nbs').project;
    expect(flattenNotes(loaded)).toHaveLength(3); expect(tickToSeconds(flattenNotes(loaded)[2].absoluteTick, loaded)).toBeCloseTo(.5, 5);
  });
  it('reads files produced by the independent library', () => {
    const song = new Song(); song.name = 'Oracle'; song.setTempo(12.5);
    song.layers.create().notes.create(10, 7, { key: 57, velocity: 63, pitch: 25, panning: -20 });
    const result = importNbs(new Uint8Array(toArrayBuffer(song) as ArrayBuffer), 'oracle.nbs').project;
    const note = flattenNotes(result)[0]; expect(note.midi).toBe(78); expect(note.detune).toBe(25); expect(note.effectiveInstrument).toBe('bell'); expect(tickToSeconds(note.absoluteTick, result)).toBeCloseTo(.8, 6);
  });
  it('converts OpenNBS custom-instrument transposition to a sampler root without reversing its pitch', () => {
    const song = new Song(); song.setTempo(10);
    song.instruments.create({ name: 'Custom fixture', soundFile: 'custom.ogg', key: 57 });
    song.layers.create().notes.create(song.instruments.firstCustomIndex, song.instruments.firstCustomIndex, { key: 45 });
    const imported = importNbs(new Uint8Array(toArrayBuffer(song) as ArrayBuffer), 'custom.nbs').project;
    const custom = imported.instruments.find(i => i.name === 'Custom fixture')!;
    expect(custom.rootMidi).toBe(54);
    const note = flattenNotes(imported)[0]; expect(Math.pow(2, (note.midi - custom.rootMidi) / 12)).toBe(2);
    const exported = importNbs(exportNbs(imported, 6, 10).bytes, 'custom-roundtrip.nbs').project;
    expect(exported.instruments.find(i => i.name === 'Custom fixture')?.rootMidi).toBe(54);
  });
  it('bakes variable-tempo onsets into the fixed NBS time grid without altering the original project', () => {
    const p = createProject(); p.tempos.push({ tick: 960, bpm: 60 }); p.patterns[0].notes.push(newNote(0, 66), newNote(1920, 68));
    const before = JSON.stringify(p); const { bytes, diagnostics } = exportNbs(p, 5, 20);
    const loaded = importNbs(bytes, 'tempo.nbs').project;
    expect(tickToSeconds(flattenNotes(loaded)[1].absoluteTick, loaded)).toBeCloseTo(1.5, 6);
    expect(diagnostics.some(d => d.code === 'nbs-tempo-baked')).toBe(true); expect(JSON.stringify(p)).toBe(before);
  });
  it('rejects truncated and unknown-version binary input', () => {
    expect(() => importNbs(new Uint8Array([0, 0, 99]), 'future.nbs')).toThrow('支持');
    expect(() => importNbs(new Uint8Array([0, 0, 5]), 'truncated.nbs')).toThrow('结束');
  });
});
