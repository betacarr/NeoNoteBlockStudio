import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';
import { createProject, newNote, newTrack } from '../src/core/project';
import { previewRecordingProject, recordingProjectsEqual } from '../src/core/recording';
import { moveRegion } from '../src/core/region-transfer';
import { MAX_PROJECT_TICK } from '../src/core/expansion';
import type { Project, Region } from '../src/core/types';

// Execute the actual App command/history/selection/save closures. React state,
// playback stop and the desktop file dialog are explicit inert boundaries;
// these checks do not claim physical pointer, focus, or packaged GUI coverage.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Region transfer App boundary missing: ${start} / ${end}`);
  return source.slice(from, to);
}
const code = transformSync([
  section('  const selectionSnapshot =', '\n  function selectTrack('),
  section('  function commit(', '\n  const changeTrack ='),
  section('  const changeRegion =', '\n  function trimCurrentRegion('),
  section('  function undo()', '\n  function copyNotes('),
  section('  function projectForSave(', '\n  async function saveOriginalMidi('),
  section('  async function save(', '\n  async function newProject('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const selectStart = source.indexOf('<select aria-label="片段所属轨道"'), selectEnd = source.indexOf('</select>', selectStart);
if (selectStart < 0 || selectEnd < 0) throw new Error('Actual region track inspector selector missing');
const selectorCode = transformSync(`return ${source.slice(selectStart, selectEnd + '</select>'.length)};`,
  { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
type Element = { type: string; props: Record<string, any> };
const element = (type: string, props: Record<string, any> | null, ...children: any[]): Element => ({ type, props: { ...props, children: children.flat(Infinity) } });

interface Functions {
  selectRegion: (region: Region) => void;
  changeRegion: (id: string, patch: Partial<Region>) => void;
  commit: (label: string, change: (project: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  save: (as?: boolean) => Promise<boolean>;
}
interface Entry { label: string; project: Project; selection: EditorSelection }

function fixture(shared = false) {
  const initial = createProject('App region transfer'); initial.ppq = 480;
  initial.tracks.push(newTrack('Destination', 1, 'bass'));
  const sourceTrack = initial.tracks[0], destination = initial.tracks[1], originalRegion = initial.regions[0];
  originalRegion.start = 120; originalRegion.offset = 30; originalRegion.length = 1920;
  initial.patterns[0].notes = [{ ...newNote(60, 63, 91.5), id: 'source-note', velocity: .73, pan: -.25, detune: 9.125, height: .5,
    midiSource: { onOrder: 7, offOrder: 13, releaseVelocity: 42, offSourceTrack: 0 } }];
  initial.patterns[0].midiEvents = [{ id: 'source-message', tick: 30, order: 3, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } }];
  initial.patterns.push({ id: 'destination-pattern', name: 'Destination', length: 1920, notes: [{ ...newNote(0, 48), id: 'destination-note' }] });
  initial.regions.push({ id: 'destination-region', trackId: destination.id, patternId: 'destination-pattern', start: 0, offset: 0, length: 1920, loop: false });
  if (shared) initial.regions.push({ ...originalRegion, id: 'source-copy', start: 2400 });
  initial.assets.push({ id: 'midi-archive', name: 'source.mid', mime: 'audio/midi', data: 'AQIDBA==' });
  initial.midi = { schema: 1, format: 1, sourceAssetId: 'midi-archive', conductor: [] };
  const before = structuredClone(initial), projectRef = { current: initial }, savedSnapshot = { current: initial as Project | undefined };
  const numberEditOwner = { current: { project: initial, generation: 0 } };
  const history = { current: [] as Entry[] }, future = { current: [] as Entry[] };
  const state = { selectedTrack: sourceTrack.id, selectedRegion: originalRegion.id, selectedRegions: new Set([originalRegion.id]), selectedNotes: new Set(['source-note']), focus: 'piano' as EditorSelection['focus'], dirty: false, revision: 0, filePath: 'original.nbsx' };
  const selectedRegionsRef = { current: state.selectedRegions };
  const setProject = vi.fn(), stop = vi.fn(), setMessage = vi.fn();
  const files: Uint8Array[] = [];
  const desktop = { saveFile: vi.fn(async (_name: string, bytes: Uint8Array) => { files.push(bytes.slice()); return 'saved.nbsx'; }), clearRecovery: vi.fn(async () => {}) };
  const render = (): Functions => {
    const scope = { project: projectRef.current, projectRef, savedSnapshot, numberEditOwner, numberGeneration: numberEditOwner.current.generation, MAX_PROJECT_TICK, history, future, produce, normalizeEditorSelection, moveRegion,
      ...state, setProject, stop, setMessage,
      setSelectedTrack: (value: string) => { state.selectedTrack = value; }, setSelectedRegion: (value: string) => { state.selectedRegion = value; },
      selectedRegionsRef, setSelectedRegions: (value: Set<string>) => { state.selectedRegions = value; },
      setSelectedNotes: (value: Set<string>) => { state.selectedNotes = value; }, setFocus: (value: EditorSelection['focus']) => { state.focus = value; },
      setDirty: (value: boolean) => { state.dirty = value; }, setRevision: (update: (value: number) => number) => { state.revision = update(state.revision); },
      portable: false, library: undefined, finishNumberDraft: () => true, previewRecordingProject, recordingProjectsEqual,
      playbackMode: 'realtime', finishHeld: { current: vi.fn() },
      keysHeld: { current: new Map() }, engine: { position: () => undefined }, editorDocumentKey: 7, saveNbsx,
      window: { desktop }, setFilePath: (value: string) => { state.filePath = value; }, setRecovery: vi.fn() };
    return Function(...Object.keys(scope), `${code}\nreturn {selectRegion,changeRegion,commit,undo,redo,save};`)(...Object.values(scope)) as Functions;
  };
  const selection = () => normalizeEditorSelection(projectRef.current, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
  const selector = () => {
    const project = projectRef.current, region = project.regions.find(item => item.id === state.selectedRegion)!, track = project.tracks.find(item => item.id === region.trackId)!;
    const scope = { project, region, track, selectedRegions: state.selectedRegions, regionGroupIssue: '', changeRegion: render().changeRegion, element };
    return Function(...Object.keys(scope), selectorCode)(...Object.values(scope)) as Element;
  };
  return { initial, before, sourceTrack, destination, originalRegion, projectRef, savedSnapshot, numberEditOwner, history, future, state, setProject, stop, setMessage, files, desktop, render, selection, selector };
}
const withoutTimestamp = (project: Project) => { const copy = structuredClone(project); delete (copy as Partial<Project>).modifiedAt; return copy; };

describe('App region transfer, selection, history and desktop save (isolated actual-source integration)', () => {
  it('follows a cross-track move, saves every field, and restores source/target selection on Undo/Redo', async () => {
    const test = fixture();
    // Match the existing RegionClip pointerdown selection before pointerup commit.
    test.render().selectRegion(test.originalRegion); test.state.focus = 'arrangement';
    test.render().changeRegion(test.originalRegion.id, { start: 960.5, trackId: test.destination.id });
    const expected = structuredClone(test.before); Object.assign(expected.regions[0], { start: 960.5, trackId: test.destination.id });
    delete expected.patterns[0].notes[0].midiSource!.offSourceTrack;
    expect(withoutTimestamp(test.projectRef.current)).toEqual(withoutTimestamp(expected));
    expect(test.selection()).toEqual({ trackId: test.destination.id, regionId: test.originalRegion.id, noteIds: [], focus: 'arrangement' });
    expect(test.history.current).toHaveLength(1); expect(test.history.current[0].selection).toEqual({ trackId: test.sourceTrack.id, regionId: test.originalRegion.id, regionIds: [test.originalRegion.id], noteIds: [], focus: 'arrangement' });
    expect(test.numberEditOwner.current.generation).toBe(1);
    expect(await test.render().save(true)).toBe(true);
    expect(withoutTimestamp(openNbsx(test.files[0]))).toEqual(withoutTimestamp(expected));
    test.render().undo(); expect(test.projectRef.current).toBe(test.initial);
    expect(test.selection()).toEqual({ trackId: test.sourceTrack.id, regionId: test.originalRegion.id, noteIds: [], focus: 'arrangement' });
    test.render().redo(); expect(withoutTimestamp(test.projectRef.current)).toEqual(withoutTimestamp(expected));
    expect(test.selection()).toEqual({ trackId: test.destination.id, regionId: test.originalRegion.id, noteIds: [], focus: 'arrangement' });
    expect(await test.render().save(true)).toBe(true); expect(withoutTimestamp(openNbsx(test.files[1]))).toEqual(withoutTimestamp(expected));
  });

  it('respects a different valid pre-command selection when a direct move is undone', () => {
    const test = fixture(); test.render().selectRegion(test.initial.regions[1]);
    const previousSelection = test.selection();
    test.render().changeRegion(test.originalRegion.id, { trackId: test.destination.id });
    expect(test.selection()).toMatchObject({ trackId: test.destination.id, regionId: test.originalRegion.id, noteIds: [], focus: 'arrangement' });
    test.render().undo(); expect(test.selection()).toEqual(previousSelection); expect(test.projectRef.current).toBe(test.initial);
  });

  it('does not consume redo, clear note selection or increment owners for a same-target/time no-op', () => {
    const test = fixture(); test.render().commit('unrelated edit', project => { project.name = 'Changed'; }); test.render().undo();
    const future = test.future.current, previousSelection = test.selection(), owner = test.numberEditOwner.current;
    test.render().changeRegion(test.originalRegion.id, { trackId: test.sourceTrack.id, start: test.originalRegion.start });
    expect(test.projectRef.current).toBe(test.initial); expect(test.history.current).toEqual([]); expect(test.future.current).toBe(future);
    expect(test.selection()).toEqual(previousSelection); expect(test.numberEditOwner.current).toBe(owner);
    test.render().redo(); expect(test.projectRef.current.name).toBe('Changed');
  });

  it.each(['source', 'target'] as const)('uses live %s locking even through an older rendered move callback', locked => {
    const test = fixture(true), oldCallback = test.render().changeRegion;
    test.render().commit('lock', project => { project.tracks[locked === 'source' ? 0 : 1].locked = true; });
    const previous = test.projectRef.current, owner = test.numberEditOwner.current, previousSelection = test.selection(), future = test.future.current;
    oldCallback(test.originalRegion.id, { trackId: test.destination.id, start: 960 });
    expect(test.projectRef.current).toBe(previous); expect(test.numberEditOwner.current).toBe(owner); expect(test.selection()).toEqual(previousSelection);
    expect(test.history.current).toHaveLength(1); expect(test.future.current).toBe(future); expect(test.projectRef.current.patterns).toHaveLength(2);
  });

  it('rejects a missing destination and invalid start without changing the project or selection', () => {
    const test = fixture(), previousSelection = test.selection();
    test.render().changeRegion(test.originalRegion.id, { trackId: 'missing', start: 960 });
    test.render().changeRegion(test.originalRegion.id, { trackId: test.destination.id, start: Infinity });
    expect(test.projectRef.current).toBe(test.initial); expect(test.selection()).toEqual(previousSelection); expect(test.history.current).toEqual([]);
  });

  it('retains the existing same-track start and inspector length patch behavior', () => {
    const test = fixture(), previousSelection = test.selection();
    test.render().changeRegion(test.originalRegion.id, { start: 480 });
    test.render().changeRegion(test.originalRegion.id, { length: 1440 });
    expect(test.projectRef.current.regions[0]).toEqual({ ...test.before.regions[0], start: 480, length: 1440 });
    expect(test.projectRef.current.patterns).toBe(test.initial.patterns); expect(test.selection()).toEqual(previousSelection);
    expect(test.history.current).toHaveLength(2);
  });

  it('rejects an invalid same-track time and mixed movement/property patches atomically', () => {
    const test = fixture(), originalSelection = test.selection(), future = test.future.current;
    for (const start of [-1, NaN, Infinity, 1e12 + 1]) test.render().changeRegion(test.originalRegion.id, { start });
    test.render().changeRegion(test.originalRegion.id, { start: 960, length: 480 });
    test.render().changeRegion(test.originalRegion.id, { trackId: test.destination.id, loop: true });
    test.render().changeRegion(test.originalRegion.id, { patternId: 'destination-pattern' });
    expect(test.projectRef.current).toBe(test.initial); expect(test.selection()).toEqual(originalSelection);
    expect(test.history.current).toEqual([]); expect(test.future.current).toBe(future); expect(test.numberEditOwner.current.generation).toBe(0);
  });

  it('rejects a callback from a replaced document even when every UUID and number generation was reused', () => {
    const test = fixture(), callback = test.render().changeRegion, replacement = structuredClone(test.initial);
    replacement.name = 'Reopened same UUID'; test.projectRef.current = replacement; test.numberEditOwner.current = { project: replacement, generation: 0 };
    callback(test.originalRegion.id, { trackId: test.destination.id, start: 960 });
    expect(test.projectRef.current).toBe(replacement); expect(test.history.current).toEqual([]);
    test.render().changeRegion(test.originalRegion.id, { trackId: test.destination.id, start: 960 });
    expect(test.history.current).toHaveLength(1); expect(test.projectRef.current.name).toBe('Reopened same UUID');
  });

  it('rejects stale geometry after recording appended a note without changing number generation', () => {
    const test = fixture(), callback = test.render().changeRegion;
    const latest = produce(test.initial, draft => { draft.patterns[0].notes.push({ ...newNote(600, 75, 48), id: 'recorded-note' }); });
    test.projectRef.current = latest; test.numberEditOwner.current = { project: latest, generation: 0 };
    callback(test.originalRegion.id, { start: 960 }); expect(test.projectRef.current).toBe(latest); expect(test.history.current).toEqual([]);
    test.render().changeRegion(test.originalRegion.id, { start: 960 });
    expect(test.projectRef.current.patterns[0]).toBe(latest.patterns[0]); expect(test.projectRef.current.patterns[0].notes.map(note => note.id)).toEqual(['source-note', 'recorded-note']);
    expect(test.projectRef.current.patterns[0].notes[0].midiSource?.offSourceTrack).toBe(0); expect(test.history.current).toHaveLength(1);
  });

  it('invalidates an old movement callback after Undo/Redo returns to the identical project reference', () => {
    const test = fixture(); test.render().commit('metadata', project => { project.name = 'Metadata'; });
    const callback = test.render().changeRegion, snapshot = test.projectRef.current;
    test.render().undo(); test.render().redo(); expect(test.projectRef.current).toBe(snapshot);
    const history = test.history.current.length; callback(test.originalRegion.id, { trackId: test.destination.id });
    expect(test.projectRef.current).toBe(snapshot); expect(test.history.current).toHaveLength(history);
  });

  it('uses the actual inspector select with all tracks in original order, including hidden instruments and disabled locked targets', () => {
    const test = fixture(); test.initial.tracks.push({ ...newTrack('Locked third', 2, 'bell'), id: 'locked-third', locked: true });
    const select = test.selector(), options = select.props.children as Element[];
    expect(select.props.value).toBe(test.sourceTrack.id); expect(select.props.disabled).toBe(false);
    expect(options.map(option => [option.props.value, option.props.disabled])).toEqual([[test.sourceTrack.id, false], [test.destination.id, false], ['locked-third', true]]);
    expect(options[1].props.children.join('')).toBe('2. Destination'); expect(select.props.title).toContain('默认音色、混音和 Delay');
    select.props.onChange({ currentTarget: { value: test.destination.id } });
    expect(test.projectRef.current.regions[0]).toMatchObject({ trackId: test.destination.id, start: 120, offset: 30, length: 1920, loop: false });
    expect(test.selection()).toEqual({ trackId: test.destination.id, regionId: test.originalRegion.id, noteIds: [], focus: 'arrangement' }); expect(test.history.current).toHaveLength(1);
    test.selector().props.onChange({ currentTarget: { value: 'locked-third' } }); expect(test.history.current).toHaveLength(1);
  });

  it('disables the actual inspector selector for a locked source and the callback cannot bypass the lock', () => {
    const test = fixture(); test.sourceTrack.locked = true; const select = test.selector();
    expect(select.props.disabled).toBe(true); select.props.onChange({ currentTarget: { value: test.destination.id } });
    expect(test.projectRef.current).toBe(test.initial); expect(test.history.current).toEqual([]);
  });

  it('detaches only the routed shared copy and Undo/Redo restores exact patterns and MIDI resources', async () => {
    const test = fixture(true), sourcePattern = test.initial.patterns[0];
    test.render().changeRegion(test.originalRegion.id, { trackId: test.destination.id, start: 960 });
    const moved = test.projectRef.current, selected = resolveEditorSelection(moved, test.selection());
    expect(moved.patterns).toHaveLength(3); expect(selected.pattern?.id).not.toBe(sourcePattern.id);
    expect(selected.pattern?.notes[0].midiSource).toEqual({ onOrder: 7, offOrder: 13, releaseVelocity: 42 });
    expect(moved.patterns[0]).toBe(sourcePattern); expect(moved.regions[2]).toBe(test.initial.regions[2]);
    expect(moved.assets).toBe(test.initial.assets); expect(moved.midi).toBe(test.initial.midi);
    expect(await test.render().save(true)).toBe(true); expect(withoutTimestamp(openNbsx(test.files[0]))).toEqual(withoutTimestamp(moved));
    test.render().undo(); expect(test.projectRef.current).toBe(test.initial); expect(test.selection().noteIds).toEqual(['source-note']);
    test.render().redo(); expect(test.projectRef.current).toBe(moved); expect(test.selection().noteIds).toEqual([]);
    test.render().changeRegion(test.originalRegion.id, { trackId: test.sourceTrack.id, start: 120 });
    expect(test.projectRef.current.patterns).toHaveLength(3);
    const returned = resolveEditorSelection(test.projectRef.current, test.selection());
    expect(returned.pattern?.notes[0].midiSource).not.toHaveProperty('offSourceTrack'); expect(sourcePattern.notes[0].midiSource?.offSourceTrack).toBe(0);
  });
});
