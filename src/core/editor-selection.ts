import type { Note, Pattern, Project, Region, Track } from './types';

export interface EditorSelection {
  trackId?: string;
  regionId?: string;
  regionIds?: string[];
  noteIds: string[];
  focus: 'piano' | 'arrangement';
}

export interface ResolvedEditorSelection {
  track: Track | undefined;
  region: Region | undefined;
  pattern: Pattern | undefined;
  notes: Note[];
}

/** Resolve only the explicitly selected clip; a fallback track has no clip target. */
export function resolveEditorSelection(project: Project, selection: Readonly<EditorSelection>): ResolvedEditorSelection {
  const requestedRegion = project.regions.find(region => region.id === selection.regionId);
  let track: Track | undefined;
  let region: Region | undefined;
  if (selection.trackId !== undefined) {
    track = project.tracks.find(item => item.id === selection.trackId);
    if (track && requestedRegion?.trackId === track.id) region = requestedRegion;
  } else if (requestedRegion) {
    track = project.tracks.find(item => item.id === requestedRegion.trackId);
    if (track) region = requestedRegion;
  }
  track ??= project.tracks[0];
  const pattern = region ? project.patterns.find(item => item.id === region.patternId) : undefined;
  const noteIds = new Set(selection.noteIds);
  return { track, region, pattern, notes: pattern?.notes.filter(note => noteIds.has(note.id)) ?? [] };
}

/** Legacy snapshots retain their explicit clip target. An explicit group owns
 * its primary: keep a member primary, otherwise use its first valid member.
 */
export function normalizeEditorSelection(project: Project, selection: Readonly<EditorSelection>): EditorSelection {
  if (Object.prototype.hasOwnProperty.call(selection, 'regionIds')) {
    const tracks = new Set(project.tracks.map(track => track.id)), regions = new Map(project.regions.map(region => [region.id, region]));
    const group = [...new Set(selection.regionIds ?? [])].filter(id => { const region = regions.get(id); return region !== undefined && tracks.has(region.trackId); });
    const primary = group.includes(selection.regionId ?? '') ? regions.get(selection.regionId!) : regions.get(group[0]);
    const { track, region, notes } = resolveEditorSelection(project, { ...selection, regionId: primary?.id, trackId: primary?.trackId ?? selection.trackId });
    return { ...(track ? { trackId: track.id } : {}), ...(region ? { regionId: region.id } : {}), regionIds: group,
      noteIds: notes.map(note => note.id), focus: selection.focus };
  }
  const { track, region, notes } = resolveEditorSelection(project, selection);
  return {
    ...(track ? { trackId: track.id } : {}),
    ...(region ? { regionId: region.id } : {}),
    noteIds: notes.map(note => note.id),
    focus: selection.focus,
  };
}
