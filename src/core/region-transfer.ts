import { MAX_PROJECT_TICK } from './expansion';
import { uid } from './project';
import type { Project, Region } from './types';

/** Mutate an editable project/draft, moving only this arrangement occurrence.
 * Rejected targets and valid no-ops write nothing, preserving Immer history.
 */
export function moveRegion(project: Project, regionId: string, targetTrackId: string, start: number): Region | undefined {
  if (!Number.isFinite(start) || start < 0 || start > MAX_PROJECT_TICK) return;
  const region = project.regions.find(item => item.id === regionId);
  const source = project.tracks.find(item => item.id === region?.trackId);
  const target = project.tracks.find(item => item.id === targetTrackId);
  let pattern = project.patterns.find(item => item.id === region?.patternId);
  if (!region || !source || !target || !pattern || source.locked || target.locked) return;
  if (region.trackId === targetTrackId && region.start === start) return region;

  if (region.trackId !== targetTrackId && pattern.notes.some(note => note.midiSource?.offSourceTrack !== undefined)) {
    if (project.regions.some(item => item.id !== region.id && item.patternId === pattern!.id)) {
      // These are the existing NBSX schema limits; check before allocating IDs
      // or touching the original shared source, including conductor messages.
      if (project.patterns.length >= 100000) return;
      let notes = pattern.notes.length, messages = (pattern.midiEvents?.length ?? 0) + (project.midi?.conductor.length ?? 0);
      for (const item of project.patterns) {
        notes += item.notes.length; messages += item.midiEvents?.length ?? 0;
        if (notes > 2000000 || messages > 2000000) return;
      }
      pattern = { ...pattern, id: uid(), notes: pattern.notes.map(note => ({ ...note, id: uid(), ...(note.midiSource ? { midiSource: { ...note.midiSource } } : {}) })),
        ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(item => ({ ...item, id: uid(),
          event: { ...item.event, ...('data' in item.event ? { data: Array.from(item.event.data) } : {}) } })) } : {}) };
      project.patterns.push(pattern); region.patternId = pattern.id;
    }
    for (const note of pattern.notes) if (note.midiSource?.offSourceTrack !== undefined) delete note.midiSource.offSourceTrack;
  }
  region.trackId = targetTrackId; region.start = start;
  return region;
}
