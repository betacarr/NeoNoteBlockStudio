import type { Note, Pattern, Project, Region, ShortcutPreset } from './types';
import { uid } from './project';
import { cloneMidiEvent } from './midi-events';
import { grownPatternLength, type MeterProject } from './meter';

export interface NoteMovement { tick: number; pitch: number }
export interface SourceRange { start: number; end: number }

/** Keep a chord together when its drag reaches the start of time or either end of the keyboard. */
export function constrainNoteMovement(notes: readonly Note[], tick: number, pitch: number): NoteMovement {
  if (!notes.length) return { tick: 0, pitch: 0 };
  const firstTick = notes.reduce((value, note) => Math.min(value, note.tick), Infinity);
  const low = notes.reduce((value, note) => Math.min(value, note.midi), 127);
  const high = notes.reduce((value, note) => Math.max(value, note.midi), 0);
  return { tick: Math.max(tick, -firstTick), pitch: Math.max(-low, Math.min(127 - high, pitch)) };
}

export function dragNotes(notes: readonly Note[], ids: ReadonlySet<string>, kind: 'move' | 'resize', tick: number, pitch = 0): Note[] {
  const movement = kind === 'move' ? constrainNoteMovement(notes.filter(note => ids.has(note.id)), tick, pitch) : { tick, pitch: 0 };
  return notes.map(note => ids.has(note.id) ? kind === 'move'
    ? { ...note, tick: note.tick + movement.tick, midi: note.midi + movement.pitch }
    : { ...note, duration: Math.max(1, note.duration + movement.tick) }
    : note);
}

/** A short note still has a body that can be grabbed independently of its right edge. */
export const noteResizeHandleWidth = (width: number): number => Math.min(7, Math.max(2, width * .28));

export function dragPlacedNote(note: Note, preset: ShortcutPreset, tick: number, pitch: number, extensionEnd: number): Note {
  return preset === 'fl' ? dragNotes([note], new Set([note.id]), 'move', tick, pitch)[0]
    : { ...note, duration: Math.max(note.duration, extensionEnd - note.tick) };
}

/** Only an uncropped source end follows new content; an explicitly set playback border stays put. */
export function growEditedPattern(project: MeterProject, region: Region, pattern: Pattern, required: number): void {
  if (required <= pattern.length) return;
  const followsSourceEnd = !region.loop && Math.abs(region.offset + region.length - pattern.length) < 1e-6;
  pattern.length = grownPatternLength(project, region, pattern, required);
  if (followsSourceEnd) region.length = Math.max(1, pattern.length - region.offset);
}

export function planRegionTrim(region: Region, sourceLength: number, edge: 'start' | 'end', projectTick: number): { region: Region; prepend: number } {
  if (edge === 'end') return { region: { ...region, length: Math.max(1, projectTick - region.start) }, prepend: 0 };
  const end = region.start + region.length, start = Math.max(0, Math.min(end - 1, projectTick));
  const desiredOffset = region.offset + start - region.start;
  const period = Math.max(1, sourceLength);
  return { region: { ...region, start, length: end - start, offset: region.loop ? (desiredOffset % period + period) % period : Math.max(0, desiredOffset) }, prepend: region.loop ? 0 : Math.max(0, -desiredOffset) };
}

/** Logic-style region borders preserve the absolute timing and length of every existing note. */
export function trimRegion(project: Project, regionId: string, edge: 'start' | 'end', projectTick: number): Region | undefined {
  const region = project.regions.find(item => item.id === regionId);
  let pattern = project.patterns.find(item => item.id === region?.patternId);
  if (!region || !pattern || !Number.isFinite(projectTick)) return;
  const plan = planRegionTrim(region, pattern.length, edge, projectTick);
  if (plan.prepend) {
    if (project.regions.some(item => item.id !== region.id && item.patternId === pattern!.id)) {
      pattern = { ...pattern, id: uid(), notes: pattern.notes.map(note => ({ ...note, id: uid(), ...(note.midiSource ? { midiSource: { ...note.midiSource } } : {}) })),
        ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(item => ({ ...item, id: uid(), event: cloneMidiEvent(item.event) })) } : {}) };
      project.patterns.push(pattern); region.patternId = pattern.id;
    }
    for (const note of pattern.notes) note.tick += plan.prepend;
    for (const event of pattern.midiEvents ?? []) event.tick += plan.prepend;
    pattern.length += plan.prepend;
  }
  Object.assign(region, { start: plan.region.start, offset: plan.region.offset, length: plan.region.length });
  return region;
}

/** Project the selected arrangement copy back onto the source shown in the piano roll. */
export function regionSourceRanges(sourceLength: number, region?: Pick<Region, 'offset' | 'length' | 'loop'>): SourceRange[] {
  if (!region) return [{ start: 0, end: sourceLength }];
  if (!region.loop) return [{ start: region.offset, end: region.offset + region.length }];
  const period = Math.max(1, sourceLength), start = region.offset % period;
  if (region.length >= period) return [{ start: 0, end: period }];
  const end = start + region.length;
  return end <= period ? [{ start, end }] : [{ start: 0, end: end - period }, { start, end: period }];
}
