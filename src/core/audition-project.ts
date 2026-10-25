import { createProject, newNote, uid } from './project';
import { createTempoMap } from './time';
import type { Note, Project, Track } from './types';

/** Build a read-only single-trigger view with the source tempo and track effects. */
export function createAuditionProject(source: Project, track: Track, midi: number, note?: Note, origin = 0, noteLength = 16): Project {
  const preview = createProject(), timing = createTempoMap(source);
  const start = Math.max(0, origin), active = timing.events.filter(event => event.tick <= start).at(-1)!;
  preview.audio = { ...source.audio }; preview.ppq = source.ppq;
  preview.instruments = source.instruments; preview.assets = source.assets;
  preview.tempos = [{ tick: 0, bpm: active.bpm }, ...timing.events.filter(event => event.tick > start).map(event => ({ tick: event.tick - start, bpm: event.bpm }))];
  Object.assign(preview.tracks[0], { instrumentId: note?.instrumentId ?? track.instrumentId, volume: track.volume, pan: track.pan,
    ...(track.delay ? { delay: structuredClone(track.delay) } : {}) });
  const trigger = { ...newNote(0, midi, Math.max(1, source.ppq * 4 / noteLength)), ...note, id: uid(), tick: 0, midi };
  preview.patterns[0].notes = [trigger];
  preview.patterns[0].length = preview.regions[0].length = Math.max(1, trigger.duration);
  return preview;
}
