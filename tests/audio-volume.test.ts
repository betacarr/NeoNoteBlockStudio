import { describe, expect, it } from 'vitest';
import { gameEventPitchParameters, gamePitchParameters, gameVolumeParameters } from '../src/audio/volume';
import { listenerForProject, noteAudioParameters } from '../src/audio/parameters';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { audioFacts, audioProfile, gameHrtfControl } from '../src/audio/profiles';
import type { SampleLibrary } from '../src/core/types';
import { broadcastForProject, withinBroadcastRange } from '../src/audio/delivery';

const f = Math.fround;

describe('original version-specific master/category gain', () => {
  it.each(['1.3.1', '1.3.2', '1.4.2', '1.4.4', '1.4.5', '1.4.6', '1.4.7', '1.5.1', '1.5.2', '1.6.1', '1.6.2', '1.6.4'])('keeps Java %s global sound on the source and applies the downstream clip', version => {
    const id = `java-${version}`;
    expect(gameVolumeParameters(id, 3, .7)).toEqual({ gain: f(.7), listenerGain: 1 });
    expect(gameVolumeParameters(id, .5, 1.5)).toEqual({ gain: .75, listenerGain: 1 });
    expect(gameVolumeParameters(id, 3, 2)).toEqual({ gain: 1, listenerGain: 1 });
    expect(gameVolumeParameters(id, 3, -0)).toEqual({ gain: -0, listenerGain: 1 });
    expect(gamePitchParameters(id, Math.pow(2, -11 / 12))).toBe(.523809552192688);
    expect(gamePitchParameters(id, 5)).toBe(2);
    expect(audioProfile(id).status).toBe('code-reviewed');
    expect(gameHrtfControl(id)).toBe(false);
  });
  it.each(['1.0', '1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5'])('preserves Java %s raw client-block-event pitch before named pitch packets existed', version => {
    const project = createProject(); project.audio.profileId = `java-${version}`; project.audio.masterGain = 1.5;
    project.patterns[0].notes = [newNote(0, 55)];
    expect(noteAudioParameters(project, flattenNotes(project)[0]).pitch).toBe(.5297315716743469);
    expect(gamePitchParameters(project.audio.profileId, .25)).toBe(.5);
    expect(gamePitchParameters(project.audio.profileId, 4)).toBe(2);
    expect(gameVolumeParameters(project.audio.profileId, .5, 1.5)).toEqual({ gain: .75, listenerGain: 1 });
    expect(gameVolumeParameters(project.audio.profileId, 3, 2)).toEqual({ gain: 1, listenerGain: 1 });
    expect(audioProfile(project.audio.profileId).status).toBe('code-reviewed');
    expect(audioProfile(project.audio.profileId).measurementSummary).toBeUndefined();
  });
  it('uses the pre13 stationary client audibility reference without borrowing a server-feet offset', () => {
    const project = createProject(); project.audio.profileId = 'java-1.2.5';
    const gate = broadcastForProject(project);
    expect(gate?.listenerPosition).toEqual([0, -0, 0]);
    expect(withinBroadcastRange(0, 47.9, 0, gate)).toBe(true);
    expect(withinBroadcastRange(0, 48, 0, gate)).toBe(false);
    project.audio.profileId = 'java-1.3.1';
    expect(broadcastForProject(project)?.listenerPosition).toEqual([0, -1.62, 0]);
    expect(withinBroadcastRange(0, 47.9, 0, broadcastForProject(project))).toBe(false);
  });
  it('uses the early source/global model for project parameters and leaves studio mode unrestricted', () => {
    const project = createProject(); project.audio.profileId = 'java-1.5.2'; project.audio.masterGain = 1.5;
    project.patterns[0].notes = [newNote(0, 55)];
    const note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note).gain).toBe(Math.min(1, f(Math.min(1, f(note.gain)) * 1.5)));
    expect(noteAudioParameters(project, note).pitch).toBe(.523809552192688);
    expect(noteAudioParameters(project, note).maxDistance).toBe(48);
    expect(listenerForProject(project)?.gain).toBe(1);
    project.audio.mode = 'studio';
    expect(noteAudioParameters(project, note).gain).toBe(note.gain);
    expect(listenerForProject(project)?.gain).toBe(1.5);
  });
  it.each(['1.16.5', '1.19.2', '1.20.5', '1.21.8'])('keeps Java %s master on the listener and clamps the category-weighted instance first', version => {
    expect(audioFacts(`java-${version}`)?.masterVolumePlacement).toBe('listener');
    expect(gameVolumeParameters(`java-${version}`, 3, .7, .2)).toEqual({ gain: f(3 * f(.2)), listenerGain: f(.7) });
    expect(gameVolumeParameters(`java-${version}`, 3, .7)).toEqual({ gain: 1, listenerGain: f(.7) });
  });
  it.each(['1.21.9', '1.21.10', '1.21.11', '26.1', '26.1.1', '26.1.2', '26.2', '26.3'])('applies Java %s master/category after clamping the instance with a unity listener', version => {
    expect(audioFacts(`java-${version}`)?.masterVolumePlacement).toBe('source');
    expect(gameVolumeParameters(`java-${version}`, 3, .7, .2)).toEqual({ gain: f(f(.2) * f(.7)), listenerGain: 1 });
    expect(gameVolumeParameters(`java-${version}`, 3, .7)).toEqual({ gain: f(.7), listenerGain: 1 });
  });
  it('uses Java float conversion before category/master multiplication', () => {
    const master = .71, category = .13, source = .27;
    const expected = f(f(source) * f(f(master) * f(category)));
    expect(expected).not.toBe(f(source * master * category));
    expect(gameVolumeParameters('java-26.3', source, master, category).gain).toBe(expected);
  });
  it('uses the same volume model for actual project native parameters without reducing attenuation range', () => {
    const p = createProject(); p.patterns[0].notes = [newNote(0, 66)]; p.audio.masterGain = .7;
    const note = flattenNotes(p)[0];
    p.audio.profileId = 'java-1.21.8'; const before = noteAudioParameters(p, note);
    expect(before.gain).toBe(f(note.gain)); expect(listenerForProject(p)?.gain).toBe(f(.7));
    p.audio.profileId = 'java-1.21.9'; const after = noteAudioParameters(p, note);
    expect(after.gain).toBe(f(f(note.gain) * f(.7))); expect(listenerForProject(p)?.gain).toBe(1);
    expect(after.maxDistance).toBe(before.maxDistance); expect(after.maxDistance).toBe(48);
    p.audio.mode = 'studio'; expect(noteAudioParameters(p, note).gain).toBe(note.gain); expect(listenerForProject(p)?.gain).toBe(.7);
  });
  it('retains silence and gain clamp boundaries in both models', () => {
    for (const profile of ['java-1.21.8', 'java-26.3']) {
      expect(gameVolumeParameters(profile, 3, 0).gain * gameVolumeParameters(profile, 3, 0).listenerGain).toBe(0);
      expect(gameVolumeParameters(profile, -1, 1).gain).toBe(0);
      expect(gameVolumeParameters(profile, 3, 1).gain).toBe(1);
    }
  });
  it.each(['1.21.8', '1.21.9'])('preserves a negative-zero category accepted by original Java %s options', version => {
    expect(gameVolumeParameters(`java-${version}`, 3, .7, -0).gain).toBe(-0);
    expect(gameVolumeParameters(`java-${version}`, -Number.MIN_VALUE, 1).gain).toBe(-0);
    expect(gameVolumeParameters(`java-${version}`, -1, 1).gain).toBe(0);
  });
  it('preserves master negative zero at its original version-specific owner', () => {
    expect(gameVolumeParameters('java-1.21.8', 3, -0, .2)).toEqual({ gain: f(3 * f(.2)), listenerGain: -0 });
    expect(gameVolumeParameters('java-1.21.9', 3, -0, .2)).toEqual({ gain: -0, listenerGain: 1 });
  });
  it('keeps the signed-zero consequence of clamping before versus after multiplication', () => {
    expect(gameVolumeParameters('java-1.21.8', -1, 1, 0).gain).toBe(-0);
    expect(gameVolumeParameters('java-1.21.9', -1, 1, 0).gain).toBe(0);
    expect(gameVolumeParameters('java-1.21.8', NaN, 1).gain).toBeNaN();
    expect(gameVolumeParameters('java-1.21.9', NaN, 1).gain).toBeNaN();
  });
  it.each(['1.21.8', '1.21.9'])('rounds the Java %s note pitch before applying a sound-event pitch', version => {
    // Original NoteBlock note=1 and event pitch=1.5: original classes return 0x3f4b6abc.
    const originalPitch = 0.7945973873138428;
    expect(gamePitchParameters(`java-${version}`, Math.pow(2, -11 / 12), 1.5)).toBe(originalPitch);
    expect(f(Math.pow(2, -11 / 12) * 1.5)).not.toBe(originalPitch);
    const project = createProject(); project.audio.profileId = `java-${version}`;
    project.patterns[0].notes = [newNote(0, 55)];
    const library: SampleLibrary = { root: 'fixture', version, profileId: project.audio.profileId, samples: {},
      soundEvents: { harp: { event: 'block.note_block.harp', path: 'fixture.ogg', volume: 1, pitch: 1.5, attenuationDistance: 16 } } };
    expect(noteAudioParameters(project, flattenNotes(project)[0], library).pitch).toBe(originalPitch);
  });
  it.each([[0, .5], [1, .523809552192688], [2, .5555555820465088], [12, 1], [24, 2]])('retains the original 1.7.10 sound-packet pitch for note %s', (note, expected) => {
    expect(gamePitchParameters('java-1.7.10', Math.pow(2, (note - 12) / 12))).toBe(expected);
  });
  it('keeps 1.7.10 event volume and category products in double until the original final cast', () => {
    const instance = .8827458620071411, eventVolume = .6290736794471741, category = .1719992607831955;
    expect(gameVolumeParameters('java-1.7.10', instance, .7, category, eventVolume).gain).toBe(.09551328420639038);
    expect(gameVolumeParameters('java-1.21.8', instance, .7, category, eventVolume).gain).toBe(.09551329165697098);
  });
  it('applies the original 1.8 category float after the double instance/event clamp', () => {
    expect(gameVolumeParameters('java-1.8', 3, .7, .5)).toEqual({ gain: .5, listenerGain: f(.7) });
    expect(gameVolumeParameters('java-1.7.10', 3, .7, .5).gain).toBe(1);
    const instance = .06794767826795578, eventVolume = .004947261101031497, category = .1327817738056183;
    expect(gameVolumeParameters('java-1.8', instance, .7, category, eventVolume).gain).toBe(.00004463524601305835);
    expect(f(f(Math.min(1, f(instance * f(eventVolume)))) * f(category))).not.toBe(.00004463524601305835);
  });
  it('retains 1.8 wire-byte overflow and bypasses it in studio mode', () => {
    expect(gamePitchParameters('java-1.8', 5)).toBe(f(59 / 63));
    expect(gamePitchParameters('java-1.7.10', 5)).toBe(2);
    const project = createProject(); project.audio.profileId = 'java-1.8';
    project.patterns[0].notes = [newNote(0, 55)]; const note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note).pitch).toBe(.523809552192688);
    project.audio.mode = 'studio'; expect(noteAudioParameters(project, note).pitch).toBe(.5297315716743469);
  });
  it.each(['1.8.1', '1.8.2', '1.8.3', '1.8.4', '1.8.5', '1.8.6', '1.8.7', '1.8.8', '1.8.9'])('uses the independently reviewed Java %s packet and category ordering', version => {
    const id = `java-${version}`;
    expect(gamePitchParameters(id, 5)).toBe(.9365079402923584);
    expect(gamePitchParameters(id, Math.pow(2, -11 / 12))).toBe(.523809552192688);
    expect(gameVolumeParameters(id, 3, .7, .5)).toEqual({ gain: .5, listenerGain: f(.7) });
    expect(audioProfile(id).status).toBe('code-reviewed');
    expect(audioProfile(id).voiceWarning).toBe(28);
    expect(audioProfile(id).measurementSummary).toBeUndefined();
    expect(gameHrtfControl(id)).toBe(false);
  });
  it('uses the original 1.9 registered sound packet scale of 63.5', () => {
    // Original NoteBlock -> registered packet -> real Netty read/write -> instance -> engine.
    expect(gamePitchParameters('java-1.9', 1)).toBe(.9921259880065918);
    expect(gamePitchParameters('java-1.8.9', 1)).toBe(1);
    expect(gameEventPitchParameters('java-1.9', 1)).toBe(1);
    expect(gameVolumeParameters('java-1.9', 3, .7, .5)).toEqual({ gain: 1, listenerGain: f(.7) });
    expect(audioProfile('java-1.9').status).toBe('code-reviewed');
    expect(audioProfile('java-1.9').measurementSummary).toBeUndefined();
    expect(gameHrtfControl('java-1.9')).toBe(false);
  });
  it('applies the 1.9 packet pitch in game preview and bypasses transport in studio mode', () => {
    const project = createProject(); project.audio.profileId = 'java-1.9';
    project.patterns[0].notes = [newNote(0, 66)]; const note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note).pitch).toBe(.9921259880065918);
    project.audio.mode = 'studio'; expect(noteAudioParameters(project, note).pitch).toBe(1);
  });
  it('applies the historical packet rule in game preview and preserves unrestricted studio tuning', () => {
    const project = createProject(); project.audio.profileId = 'java-1.7.10';
    project.patterns[0].notes = [newNote(0, 55)];
    const note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note).pitch).toBe(.523809552192688);
    project.audio.mode = 'studio';
    expect(noteAudioParameters(project, note).pitch).toBe(.5297315716743469);
  });
});
