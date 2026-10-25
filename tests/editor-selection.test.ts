import { describe, expect, it } from 'vitest';
import { createDemo } from '../src/core/project';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';

function fixture() {
  const project = createDemo(), track = project.tracks[1], region = project.regions[1];
  const pattern = project.patterns.find(item => item.id === region.patternId)!;
  const selection: EditorSelection = { trackId: track.id, regionId: region.id, noteIds: [pattern.notes[0].id], focus: 'arrangement' };
  return { project, track, region, pattern, selection };
}

describe('editor selection targets', () => {
  it('leaves an emptied wind-chime track selected with no target for a second Delete', () => {
    const { project, track, region, selection } = fixture();
    project.regions = project.regions.filter(item => item.id !== region.id);
    project.patterns = project.patterns.filter(item => item.id !== region.patternId);
    const before = structuredClone(project);
    for (const selected of [selection, { ...selection, regionId: undefined }]) {
      const resolved = resolveEditorSelection(project, selected);
      expect(resolved.track).toBe(track);
      expect(resolved.region).toBeUndefined();
      expect(resolved.pattern).toBeUndefined();
      expect(resolved.notes).toEqual([]);
    }
    expect(project).toEqual(before);
    expect(project.regions.some(item => item.trackId === project.tracks[0].id)).toBe(true);
  });

  it('rejects a clip on another track instead of silently changing the selected track', () => {
    const { project, track, selection } = fixture();
    const resolved = resolveEditorSelection(project, { ...selection, regionId: project.regions[0].id, noteIds: [project.patterns[0].notes[0].id] });
    expect(resolved).toEqual({ track, region: undefined, pattern: undefined, notes: [] });
  });

  it('infers the track from a valid clip when no track ID was supplied', () => {
    const { project, track, region, pattern, selection } = fixture();
    expect(resolveEditorSelection(project, { ...selection, trackId: undefined })).toEqual({ track, region, pattern, notes: [pattern.notes[0]] });
  });

  it('does not use a valid clip to repair an explicitly stale track ID', () => {
    const { project, selection } = fixture();
    expect(resolveEditorSelection(project, { ...selection, trackId: 'deleted-track' })).toEqual({ track: project.tracks[0], region: undefined, pattern: undefined, notes: [] });
  });

  it('does not select the first clip when selection IDs are absent or stale', () => {
    const { project, selection } = fixture();
    for (const ids of [{}, { regionId: 'deleted-region' }, { trackId: 'deleted-track', regionId: 'deleted-region' }]) {
      expect(resolveEditorSelection(project, { ...ids, noteIds: selection.noteIds, focus: 'piano' })).toEqual({ track: project.tracks[0], region: undefined, pattern: undefined, notes: [] });
    }
  });

  it('restores the original clip/note target when Undo restores the project and its historical selection', () => {
    const { project, track, region, pattern, selection } = fixture();
    const original = structuredClone(project), storedSelection = structuredClone(selection);
    project.regions = project.regions.filter(item => item.id !== region.id);
    project.patterns = project.patterns.filter(item => item.id !== pattern.id);
    expect(normalizeEditorSelection(project, selection)).toEqual({ trackId: track.id, noteIds: [], focus: 'arrangement' });
    const restored = resolveEditorSelection(original, storedSelection);
    expect(restored.track?.id).toBe(track.id);
    expect(restored.region?.id).toBe(region.id);
    expect(restored.pattern?.id).toBe(pattern.id);
    expect(restored.notes.map(note => note.id)).toEqual(selection.noteIds);
    expect(selection).toEqual(storedSelection);
  });

  it('keeps note IDs only from the selected clip source and removes duplicates without changing inputs', () => {
    const { project, track, region, pattern, selection } = fixture();
    selection.focus = 'piano';
    selection.noteIds = [pattern.notes[1].id, 'deleted-note', project.patterns[0].notes[0].id, pattern.notes[0].id, pattern.notes[1].id];
    const before = structuredClone({ project, selection });
    const normalized = normalizeEditorSelection(project, selection);
    expect(normalized).toEqual({ trackId: track.id, regionId: region.id, noteIds: pattern.notes.slice(0, 2).map(note => note.id), focus: 'piano' });
    expect(normalizeEditorSelection(project, normalized)).toEqual(normalized);
    expect({ project, selection }).toEqual(before);
  });

  it('resolves a specific later copy without switching to the first clip on that track', () => {
    const { project, track, region, pattern, selection } = fixture();
    const copy = { ...region, id: 'later-copy', start: region.start + region.length };
    project.regions.push(copy);
    const resolved = resolveEditorSelection(project, { ...selection, regionId: copy.id });
    expect(resolved).toEqual({ track, region: copy, pattern, notes: [pattern.notes[0]] });
    expect(normalizeEditorSelection(project, { ...selection, regionId: copy.id }).regionId).toBe(copy.id);
  });

  it('has no edit target when the last track is gone, even if a stale clip object remains', () => {
    const { project, selection } = fixture();
    project.tracks = [];
    for (const selected of [selection, { ...selection, trackId: undefined }]) {
      expect(resolveEditorSelection(project, selected)).toEqual({ track: undefined, region: undefined, pattern: undefined, notes: [] });
      expect(normalizeEditorSelection(project, selected)).toEqual({ noteIds: [], focus: 'arrangement' });
    }
    project.regions = []; project.patterns = [];
    expect(normalizeEditorSelection(project, { noteIds: [], focus: 'piano' })).toEqual({ noteIds: [], focus: 'piano' });
  });

  it('does not borrow the first pattern when the selected clip has lost its source', () => {
    const { project, track, region, pattern, selection } = fixture();
    project.patterns = project.patterns.filter(item => item.id !== pattern.id);
    expect(resolveEditorSelection(project, selection)).toEqual({ track, region, pattern: undefined, notes: [] });
  });
});
