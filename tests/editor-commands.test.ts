import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { canCopyNotes, canCutNotes, canPasteNotes } from '../src/core/editor-commands';
import { createProject, newNote, uid } from '../src/core/project';
import { createMeterMap, patternTickAt } from '../src/core/meter';
import { createNoteClipboard, planNotePaste, type NoteClipboard } from '../src/core/note-clipboard';
import { growEditedPattern } from '../src/core/editor-interaction';
import { openNbsx, saveNbsx } from '../src/core/container';
import type { Note, Project, Track } from '../src/core/types';

// Exercise App's actual command functions without mounting a UI or synthesizing input.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  function copyNotes('), end = source.indexOf('  function duplicate(', start);
if (start < 0 || end < 0) throw new Error('App clipboard command functions were not found');
const { code } = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' });

function fixture({ focus = 'piano', locked = false, ids = 'valid', missingTrack = false, ppq = 960 }: {
  focus?: 'piano' | 'arrangement'; locked?: boolean; ids?: 'valid' | 'empty' | 'stale' | 'all'; missingTrack?: boolean; ppq?: number;
} = {}) {
  const project = createProject(), pattern = project.patterns[0], region = project.regions[0];
  project.ppq = ppq;
  pattern.notes = [newNote(0, 60, 240), newNote(480, 64, 480)];
  pattern.notes[0].midiSource = { onOrder: 2, offOrder: 5, releaseVelocity: 43 };
  const track: Track | undefined = missingTrack ? undefined : { ...project.tracks[0], locked };
  const selectedNotes = new Set(ids === 'all' ? pattern.notes.map(note => note.id) : ids === 'valid' ? [pattern.notes[0].id] : ids === 'stale' ? ['removed-note'] : []);
  const selected = pattern.notes.filter(note => selectedNotes.has(note.id));
  const clipboard = { current: createNoteClipboard(project, [newNote(960, 72, 120)], project.tracks[0].id, 1) as NoteClipboard | undefined }, beforeClipboard = clipboard.current;
  const beforeProject = structuredClone(project);
  const projectRef = { current: project };
  // App commits replace the project root. Retain that actual transaction
  // boundary so a failed/no-op cut cannot masquerade as a successful commit.
  const editNotes = vi.fn((_label: string, change: (notes: Note[]) => Note[]) => {
    projectRef.current = produce(projectRef.current, draft => { const live = draft.patterns.find(item => item.id === pattern.id)!; live.notes = change(live.notes); });
  });
  const commit = vi.fn((_label: string, change: (project: Project) => void) => { projectRef.current = produce(projectRef.current, change); });
  const setFocus = vi.fn(), engine = { loadProjectSamples: vi.fn(async (_project: Project) => {}) };
  const selection = { current: selectedNotes };
  const setSelectedNotes = vi.fn((next: Set<string>) => { selection.current = next; }), setMessage = vi.fn();
  const deleteSelection = vi.fn(() => { throw new Error('Note cut must not dispatch region deletion'); });
  const scope = { canCopyNotes, canCutNotes, canPasteNotes, focus, track, pattern, region, project, selected, selectedNotes, clipboard, editNotes, setSelectedNotes, setMessage, deleteSelection,
    createNoteClipboard, planNotePaste, projectRef, editorDocumentKey: 1, commit, growEditedPattern, setFocus, engine,
    positionRef: { current: 0 }, meterMap: createMeterMap(project), sourceOrigin: 0, preferences: { snap: 16 }, patternTickAt, uid };
  const commands = Function(...Object.keys(scope), `${code}\nreturn { copyNotes, cutNotes, pasteNotes };`)(...Object.values(scope)) as { copyNotes: () => boolean; cutNotes: () => void; pasteNotes: (duplicate?: boolean) => void };
  return { ...commands, get project() { return projectRef.current; }, get pattern() { return projectRef.current.patterns.find(item => item.id === pattern.id)!; }, track, selected, selectedNotes, selection, clipboard, beforeClipboard, beforeProject, editNotes, commit, setFocus, engine, setSelectedNotes, setMessage, deleteSelection };
}

describe('note clipboard command safety', () => {
  it.each([
    { ids: 'empty' as const },
    { ids: 'stale' as const },
    { focus: 'arrangement' as const, ids: 'empty' as const },
    { focus: 'arrangement' as const, ids: 'valid' as const },
    { missingTrack: true },
  ])('leaves the clipboard and project intact when copy/cut is unavailable: %j', options => {
    const state = fixture(options);
    expect(canCopyNotes(options.focus ?? 'piano', state.track, state.selected)).toBe(false);
    expect(canCutNotes(options.focus ?? 'piano', state.track, state.selected)).toBe(false);
    expect(state.copyNotes()).toBe(false);
    state.cutNotes();
    expect(state.clipboard.current).toBe(state.beforeClipboard);
    expect(state.project).toEqual(state.beforeProject);
    expect(state.editNotes).not.toHaveBeenCalled();
    expect(state.deleteSelection).not.toHaveBeenCalled();
    expect(state.setSelectedNotes).not.toHaveBeenCalled();
    expect(state.setMessage).not.toHaveBeenCalled();
  });

  it.each([false, true])('copies a detached note snapshot without editing the project or selection (locked: %j)', locked => {
    const state = fixture({ locked });
    expect(canCopyNotes('piano', state.track, state.selected)).toBe(true);
    expect(state.copyNotes()).toBe(true);
    expect(state.clipboard.current!.notes).toEqual(state.selected);
    expect(state.clipboard.current!.notes[0]).not.toBe(state.selected[0]);
    expect(state.clipboard.current!.notes[0].midiSource).not.toBe(state.selected[0].midiSource);
    expect(state.clipboard.current!.ppq).toBe(state.project.ppq);
    expect(state.clipboard.current!.sourceTrackId).toBe(state.track!.id);
    expect(state.project).toEqual(state.beforeProject);
    expect(state.editNotes).not.toHaveBeenCalled();
    expect(state.setSelectedNotes).not.toHaveBeenCalled();
  });

  it('rejects locked-track cut before replacing an existing clipboard or editing the project', () => {
    const state = fixture({ locked: true });
    expect(canCopyNotes('piano', state.track, state.selected)).toBe(true);
    expect(canCutNotes('piano', state.track, state.selected)).toBe(false);
    state.cutNotes();
    expect(state.clipboard.current).toBe(state.beforeClipboard);
    expect(state.project).toEqual(state.beforeProject);
    expect(state.editNotes).not.toHaveBeenCalled();
    expect(state.deleteSelection).not.toHaveBeenCalled();
    expect(state.setSelectedNotes).not.toHaveBeenCalled();
    expect(state.setMessage).not.toHaveBeenCalled();
  });

  it('cuts only selected notes while retaining their region, source and unselected notes', () => {
    const state = fixture(), selected = structuredClone(state.selected);
    expect(canCutNotes('piano', state.track, state.selected)).toBe(true);
    state.cutNotes();
    expect(state.clipboard.current!.notes).toEqual(selected);
    expect(state.pattern.notes).toEqual([state.beforeProject.patterns[0].notes[1]]);
    expect(state.project.regions).toEqual(state.beforeProject.regions);
    expect(state.project.patterns).toHaveLength(state.beforeProject.patterns.length);
    expect(state.editNotes).toHaveBeenCalledExactlyOnceWith('剪切音符', expect.any(Function), expect.objectContaining({ project: state.beforeProject, selectedNotes: state.selectedNotes }));
    expect(state.setSelectedNotes).toHaveBeenCalledExactlyOnceWith(new Set());
    expect(state.deleteSelection).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps a locked selection copyable after a rejected paste (duplicate: %j)', duplicate => {
    const state = fixture({ locked: true });
    expect(canPasteNotes(state.track, state.pattern, state.clipboard.current!.notes)).toBe(false);
    state.pasteNotes(duplicate);
    expect(state.project).toEqual(state.beforeProject);
    expect(state.clipboard.current).toBe(state.beforeClipboard);
    expect(state.selection.current).toBe(state.selectedNotes);
    expect(state.editNotes).not.toHaveBeenCalled();
    expect(state.setSelectedNotes).not.toHaveBeenCalled();
    const stillSelected = state.pattern.notes.filter(note => state.selection.current.has(note.id));
    expect(canCopyNotes('piano', state.track, stillSelected)).toBe(true);
    expect(state.copyNotes()).toBe(true);
    expect(state.clipboard.current!.notes).toEqual(stillSelected);
  });

  it('leaves selection and project unchanged for a missing paste target or empty clipboard', () => {
    const missing = fixture({ missingTrack: true });
    missing.pasteNotes();
    expect(missing.project).toEqual(missing.beforeProject);
    expect(missing.selection.current).toBe(missing.selectedNotes);
    expect(missing.editNotes).not.toHaveBeenCalled();
    expect(canPasteNotes(missing.track, missing.pattern, missing.clipboard.current!.notes)).toBe(false);
    const empty = fixture(); empty.clipboard.current = undefined;
    empty.pasteNotes();
    expect(empty.project).toEqual(empty.beforeProject);
    expect(empty.selection.current).toBe(empty.selectedNotes);
    expect(empty.editNotes).not.toHaveBeenCalled();
    expect(canPasteNotes(empty.track, undefined, [newNote(0, 60, 120)])).toBe(false);
  });

  it.each([false, true])('selects only inserted detached notes after a permitted paste (duplicate: %j)', duplicate => {
    const state = fixture(), sourceNotes = structuredClone(duplicate ? state.selected : state.clipboard.current!.notes);
    expect(canPasteNotes(state.track, state.pattern, sourceNotes)).toBe(true);
    state.pasteNotes(duplicate);
    const inserted = state.pattern.notes.filter(note => state.selection.current.has(note.id));
    expect(inserted).toHaveLength(sourceNotes.length);
    expect(state.pattern.notes).toHaveLength(state.beforeProject.patterns[0].notes.length + sourceNotes.length);
    expect(inserted[0].id).not.toBe(sourceNotes[0].id);
    expect(inserted[0]).toMatchObject({ midi: sourceNotes[0].midi, duration: sourceNotes[0].duration });
    expect(inserted[0].tick).toBe(duplicate ? 240 : 0);
    expect(state.clipboard.current).toBe(state.beforeClipboard);
    expect(state.commit).toHaveBeenCalledTimes(1);
    expect(state.setFocus).toHaveBeenCalledExactlyOnceWith('piano');
  });
  it('keeps beat spacing and duration when pasting between PPQ resolutions', () => {
    const source = fixture({ ppq: 480, ids: 'all' }), target = fixture({ ppq: 960, focus: 'piano' });
    expect(source.copyNotes()).toBe(true); target.clipboard.current = source.clipboard.current;
    const before = structuredClone(target.project); target.pasteNotes();
    const inserted = target.pattern.notes.filter(note => target.selection.current.has(note.id));
    expect(inserted.map(note => [note.tick, note.duration, note.midi])).toEqual([[0, 480, 60], [960, 960, 64]]);
    expect(target.pattern.notes.slice(0, 2)).toEqual(before.patterns[0].notes);
    expect(target.commit).toHaveBeenCalledOnce(); expect(target.setFocus).toHaveBeenCalledExactlyOnceWith('piano');
    expect(openNbsx(saveNbsx(target.project)).patterns[0].notes).toEqual(target.pattern.notes);
    expect(source.project.patterns).toEqual(source.beforeProject.patterns);
  });
  it('commits colliding custom instruments and sample bytes together with the notes', () => {
    const source = fixture({ ppq: 480 }), target = fixture({ ppq: 960 });
    source.project.instruments.push({ ...source.project.instruments[0], id: 'copied-custom', assetId: 'copied-sample', name: 'Source custom' });
    source.project.assets.push({ id: 'copied-sample', name: 'source.wav', mime: 'audio/wav', data: 'AQID' });
    source.pattern.notes[0].instrumentId = 'copied-custom'; source.pattern.notes[0].midiSource!.offSourceTrack = 7;
    target.project.instruments.push({ ...target.project.instruments[0], id: 'copied-custom', assetId: 'copied-sample', name: 'Target custom' });
    target.project.assets.push({ id: 'copied-sample', name: 'target.wav', mime: 'audio/wav', data: 'BAUG' });
    const originalInstrument = structuredClone(target.project.instruments.at(-1)), originalAsset = structuredClone(target.project.assets[0]);
    expect(source.copyNotes()).toBe(true); target.clipboard.current = source.clipboard.current; target.pasteNotes();
    const inserted = target.pattern.notes.find(note => target.selection.current.has(note.id))!;
    const instrument = target.project.instruments.find(item => item.id === inserted.instrumentId)!, asset = target.project.assets.find(item => item.id === instrument.assetId)!;
    expect(inserted.instrumentId).not.toBe('copied-custom'); expect(asset.id).not.toBe('copied-sample'); expect(asset.data).toBe('AQID');
    expect(target.project.instruments.find(item => item.id === 'copied-custom')).toEqual(originalInstrument); expect(target.project.assets.find(item => item.id === 'copied-sample')).toEqual(originalAsset);
    expect(inserted.midiSource?.releaseVelocity).toBe(43); expect(inserted.midiSource?.offSourceTrack).toBeUndefined();
    expect(target.commit).toHaveBeenCalledOnce(); expect(target.engine.loadProjectSamples).toHaveBeenCalledOnce();
    expect(openNbsx(saveNbsx(target.project)).instruments).toEqual(target.project.instruments);
  });
  it('pastes a large valid selection without a function-argument count limit', () => {
    const source = createProject('Large clipboard source'), target = fixture();
    source.patterns[0].notes = Array.from({ length: 150000 }, (_, index) => ({ ...newNote(index, 60, 1), id: `large-source-${index}` }));
    target.clipboard.current = createNoteClipboard(source, source.patterns[0].notes, source.tracks[0].id, 1);
    target.pasteNotes();
    expect(target.pattern.notes).toHaveLength(150002); expect(target.selection.current.size).toBe(150000);
    expect(target.pattern.notes[2].tick).toBe(0); expect(target.pattern.notes.at(-1)?.tick).toBe(149999);
    expect(source.patterns[0].notes).toHaveLength(150000); expect(source.patterns[0].notes[0].id).toBe('large-source-0');
    expect(target.commit).toHaveBeenCalledOnce();
  });
});
