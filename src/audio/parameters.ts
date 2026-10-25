import { projectEnd } from '../core/project';
import { createTempoMap, type TempoMap } from '../core/time';
import type { FlatNote, Project, SampleLibrary, NativeRenderRequest } from '../core/types';
import { gamePitchParameters, gameVolumeParameters } from './volume';

export type PitchPolicy = 'game' | 'musical';

export function listenerForProject(project: Project): NativeRenderRequest['listener'] {
  return { position: [0, 0, 0], orientation: [0, 0, -1, 0, 1, 0], gain: project.audio.mode === 'vanilla' ? gameVolumeParameters(project.audio.profileId, 1, project.audio.masterGain).listenerGain : project.audio.masterGain };
}

export function noteAudioParameters(project: Project, note: FlatNote, library?: SampleLibrary, pitchPolicy: PitchPolicy = 'game') {
  const instrument = project.instruments.find(i => i.id === note.effectiveInstrument), sound = library?.soundEvents?.[note.effectiveInstrument];
  const instancePitch = Math.pow(2, (note.midi - (instrument?.rootMidi ?? 66) + note.detune / 100) / 12);
  const rawPitch = instancePitch * (sound?.pitch ?? 1);
  const rawGain = note.gain * (sound?.volume ?? 1);
  return {
    pitch: pitchPolicy === 'musical' ? rawPitch
      : project.audio.mode === 'vanilla' ? gamePitchParameters(project.audio.profileId, instancePitch, sound?.pitch ?? 1) : Math.fround(rawPitch),
    gain: project.audio.mode === 'vanilla' ? gameVolumeParameters(project.audio.profileId, note.gain, project.audio.masterGain, 1, sound?.volume ?? 1).gain : rawGain,
    x: note.effectivePan * 2, y: note.height, z: -2,
    maxDistance: project.audio.mode === 'vanilla' ? 3 * (sound?.attenuationDistance ?? 16) : 1e9,
  };
}

// The allocation and playback must use the same pitch policy so slow musical
// notes retain their entire natural tail and native game captures stay exact.
export function renderDuration(project: Project, notes: FlatNote[], sampleDuration: (id: string) => number, library?: SampleLibrary, timing: TempoMap = createTempoMap(project), pitchPolicy: PitchPolicy = 'game'): number {
  return notes.reduce((end, note) => Math.max(end, timing.seconds(note.absoluteTick) + sampleDuration(note.effectiveInstrument) / noteAudioParameters(project, note, library, pitchPolicy).pitch), timing.seconds(projectEnd(project))) + .15;
}
