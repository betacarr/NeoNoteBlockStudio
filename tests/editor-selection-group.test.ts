import { describe, expect, it } from 'vitest';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';
import { createDemo } from '../src/core/project';

function fixture() {
  const project = createDemo(), first = project.regions[0], second = project.regions[1];
  const selection: EditorSelection = { trackId: first.trackId, regionId: first.id, noteIds: [project.patterns[0].notes[0].id], focus: 'arrangement' };
  return { project, first, second, selection };
}

describe('explicit arrangement group selection snapshots', () => {
  it('preserves the exact legacy shape when regionIds was not supplied', () => {
    const { project, selection } = fixture(), normalized = normalizeEditorSelection(project, selection);
    expect(normalized).toEqual(selection); expect(normalized).not.toHaveProperty('regionIds');
  });

  it('treats an explicit empty group as empty even when an old primary and note selection remain', () => {
    const { project, first, selection } = fixture();
    expect(normalizeEditorSelection(project, { ...selection, regionIds: [] })).toEqual({ trackId: first.trackId, regionIds: [], noteIds: [], focus: 'arrangement' });
  });

  it('uses the authoritative group order to replace an old primary outside the group and follows the new track', () => {
    const { project, selection, second } = fixture(), third = project.regions[2];
    const normalized = normalizeEditorSelection(project, { ...selection, regionIds: ['missing', third.id, second.id, third.id] });
    expect(normalized).toEqual({ trackId: third.trackId, regionId: third.id, regionIds: [third.id, second.id], noteIds: [], focus: 'arrangement' });
  });

  it('retains a primary inside the group, overrides a mismatched track, and keeps only its actual source notes', () => {
    const { project, first, second, selection } = fixture();
    const normalized = normalizeEditorSelection(project, { ...selection, trackId: second.trackId, regionIds: [second.id, first.id], noteIds: [...selection.noteIds, project.patterns[1].notes[0].id] });
    expect(normalized).toEqual({ ...selection, regionIds: [second.id, first.id] });
  });

  it('filters missing source tracks and stale regions without restoring a toggled-off old primary', () => {
    const { project, first, second, selection } = fixture(); project.tracks = project.tracks.filter(track => track.id !== second.trackId);
    expect(normalizeEditorSelection(project, { ...selection, regionIds: [second.id, 'missing'] })).toEqual({ trackId: first.trackId, regionIds: [], noteIds: [], focus: 'arrangement' });
  });

  it('retains a selected occurrence whose source was removed but does not invent note targets', () => {
    const { project, first, selection } = fixture(); project.patterns = project.patterns.filter(pattern => pattern.id !== first.patternId);
    expect(normalizeEditorSelection(project, { ...selection, regionIds: [first.id] })).toEqual({ ...selection, regionIds: [first.id], noteIds: [] });
  });

  it('is idempotent and leaves project, supplied group order and IDs untouched', () => {
    const { project, first, second, selection } = fixture(), supplied = { ...selection, regionIds: [second.id, first.id, 'missing', second.id] }, before = structuredClone({ project, supplied });
    const normalized = normalizeEditorSelection(project, supplied);
    expect(normalizeEditorSelection(project, normalized)).toEqual(normalized); expect({ project, supplied }).toEqual(before); expect(normalized.regionIds).not.toBe(supplied.regionIds);
  });

  it('keeps the direct single-primary resolver contract until normalization is explicitly requested', () => {
    const { project, first, selection } = fixture(), group = { ...selection, regionIds: [] };
    expect(resolveEditorSelection(project, group).region).toBe(first);
    expect(resolveEditorSelection(project, normalizeEditorSelection(project, group)).region).toBeUndefined();
    project.tracks = [];
    expect(normalizeEditorSelection(project, { ...selection, regionIds: [first.id] })).toEqual({ regionIds: [], noteIds: [], focus: 'arrangement' });
  });
});
