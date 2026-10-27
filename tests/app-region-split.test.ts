import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { growEditedPattern, trimRegion } from '../src/core/editor-interaction';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createMeterMap, patternOrigin } from '../src/core/meter';
import { createProject, flattenNotes, newNote, newTrack, uid } from '../src/core/project';
import { inspectRegionSplit, splitRegionGroup } from '../src/core/region-split';
import { moveRegion } from '../src/core/region-transfer';
import { commandForShortcut, inspectShortcuts, isShortcutInput, SHORTCUT_COMMANDS, shortcutForEvent, textEditingCommands } from '../src/core/shortcuts';
import { filterTracks } from '../src/core/track-filter';
import type { Note, Project, Region } from '../src/core/types';

// Execute actual App selection/history/draft/split callbacks with real core,
// Immer and NBSX. Setters, number-input flush and engine are inert boundaries;
// keyboard/menu callback tests below are not physical input or GUI evidence.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`App split boundary missing: ${from}`);
  return source.slice(start, end);
}
const code = transformSync([
  section('  const selectionSnapshot =', '\n  const changeTrack ='),
  section('  function filterInstruments(', '\n  function selectMixerTrack('),
  section('  const changeRegion =', '\n  function moveNoteSelection('),
  section('  function adopt(', '\n  async function openBytes('),
  section('  function undo()', '\n  function changeExportOptions('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const numberContextCode = section('  const numberContext = ', '\n  const liveNumberContext').slice('  const numberContext = '.length);
const menu = transformSync(`return ${section("    { label: '编辑',", "\n    { label: '视图',").trim().replace(/,$/, '')};`, { loader: 'ts' }).code;
const buttonStart = source.indexOf('<button aria-label="在播放头拆分片段"'), buttonEnd = source.indexOf('</button>', buttonStart);
if (buttonStart < 0 || buttonEnd < 0) throw new Error('Missing actual split toolbar button');
const button = transformSync(`return ${source.slice(buttonStart, buttonEnd + 9)};`, { loader: 'tsx', jsxFactory: 'element' }).code;
const nativeMenu = transformSync(section('    const off = window.desktop?.onMenu(command => {', '\n    const offOpen'), { loader: 'ts' }).code;
const keyboard = transformSync(section('    const onKeyDown =', '\n    const onKeyUp ='), { loader: 'ts' }).code;
const geometryMemos = transformSync(section('  const selectedRegionGeometry =', '\n  const regionCopyIssue'), { loader: 'ts' }).code;
interface Entry { label: string; project: Project; selection: EditorSelection }
interface Api {
  splitSelectedRegions(): void; regionSplitProblem(project: Project, ids: ReadonlySet<string>, filter: string, tick: number, cachedProblem?: string, candidates?: readonly Region[]): string;
  regionGroupProblem(project: Project, ids: ReadonlySet<string>, filter: string, readOnly?: boolean): string;
  selectionSnapshot(project?: Project): EditorSelection; selectRegionGroup(ids: Set<string>, primary?: string): void;
  commit(label: string, change: (project: Project) => void, preserve?: boolean): void; undo(): void; redo(): void; adopt(project: Project): void;
  setNumberPending(field: string, pending: boolean): void; commitNoteNumber(patch: Partial<Note>): boolean | void; commitRegionLength(value: number): boolean | void;
  filterInstruments(value: string): void;
  menu(): { items: { command: string; label: string; disabled?: boolean }[] };
  button(): { props: { disabled: boolean; title: string; onClick(): void } };
}
function projectFixture() {
  const project = createProject('Split regions'); project.id = 'split-project'; project.ppq = 480;
  project.tracks = [newTrack('Loop', 0, 'harp'), newTrack('Crop', 1, 'bass'), newTrack('Later', 2, 'harp')]; project.tracks.forEach((track, i) => { track.id = `track-${i}`; });
  project.patterns = [
    { id: 'pattern-a', name: 'Full loop source', length: 960, notes: [
      { ...newNote(0, 60, 720), id: 'note-a0', velocity: .6, pan: -.2, detune: 12.5, height: .25, instrumentId: 'flute', midiSource: { onOrder: 3, offOrder: 7, releaseVelocity: 43, offSourceTrack: 2 } },
      { ...newNote(720, 72, 600), id: 'note-a1', velocity: .9 },
    ], midiEvents: [{ id: 'event-a', tick: 360, order: 4, sourceTrack: 2, event: { deltaTime: 0, type: 'sysEx', data: [126, 127, 9, 1, 247] } }] },
    { id: 'pattern-b', name: 'Full cropped source', length: 1440, notes: [{ ...newNote(0, 54, 480), id: 'outside-before' }, { ...newNote(240, 67, 960), id: 'note-b', velocity: .75, midiSource: { onOrder: 10, offOrder: 20, releaseVelocity: 51, offSourceTrack: 3 } }, { ...newNote(1320, 78, 240), id: 'outside-after' }] },
    { id: 'pattern-c', name: 'Unaffected source', length: 480, notes: [{ ...newNote(120, 66, 240), id: 'note-c' }] },
  ];
  project.regions = [
    { id: 'region-a', trackId: 'track-0', patternId: 'pattern-a', start: 480, offset: 1320, length: 1440, loop: true },
    { id: 'region-b', trackId: 'track-1', patternId: 'pattern-b', start: 840, offset: 120, length: 960, loop: false },
    { id: 'region-c', trackId: 'track-2', patternId: 'pattern-c', start: 3000, offset: 0, length: 480, loop: false },
  ];
  project.assets = [{ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }, { id: 'portable-sample', name: 'sample.wav', mime: 'audio/wav', data: 'AQID' }];
  project.instruments = project.instruments.map(instrument => instrument.id === 'flute' ? { ...instrument, assetId: 'portable-sample' } : instrument);
  project.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', conductor: [{ id: 'text', tick: 0, order: 0, event: { deltaTime: 0, type: 'text', text: 'Original conductor' } }] };
  return project;
}
function fixture(project = projectFixture()) {
  const projectRef = { current: project }, savedSnapshot = { current: project as Project | undefined }, numberEditOwner = { current: { project, generation: 0 } };
  const history = { current: [] as Entry[] }, future = { current: [] as Entry[] };
  const state = { selectedTrack: 'track-0', selectedRegion: 'region-a', selectedRegions: new Set(['region-a']), selectedNotes: new Set<string>(), focus: 'arrangement' as EditorSelection['focus'],
    instrumentFilter: '', editorDocumentKey: 1, dirty: false, revision: 0, message: '', hasNumberDraft: false };
  const selectedRegionsRef = { current: state.selectedRegions }, instrumentFilterRef = { current: '' }, liveClipboardTarget: { current: unknown } = { current: undefined };
  const liveNumberContext = { current: '' }, numberDrafts = { current: new Set<string>() }, positionRef = { current: 960 }, preferences = { snap: 16 };
  const stop = vi.fn(), finishHeld = { current: vi.fn() }, engine = { loadProjectSamples: vi.fn(async () => {}) };
  const hooks: { flush(): boolean; inspected?(): void; inspectResult?: ReturnType<typeof inspectRegionSplit>; splitUndefined?: boolean } = { flush: () => true };
  const flushActiveNumberInput = vi.fn(() => hooks.flush()), inspect = vi.fn((...args: Parameters<typeof inspectRegionSplit>) => { const result = hooks.inspectResult ?? inspectRegionSplit(...args); hooks.inspected?.(); return result; });
  const split = vi.fn((...args: Parameters<typeof splitRegionGroup>) => hooks.splitUndefined ? undefined : splitRegionGroup(...args));
  const set = <K extends keyof typeof state>(key: K) => (value: typeof state[K] | ((old: typeof state[K]) => typeof state[K])) => { state[key] = typeof value === 'function' ? (value as (old: typeof state[K]) => typeof state[K])(state[key]) : value; };
  function render(): Api {
    const project = projectRef.current, { track, region, pattern, notes: selected } = resolveEditorSelection(project, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
    const clipboardTarget = { documentKey: state.editorDocumentKey, focus: state.focus, trackId: state.selectedTrack, regionId: state.selectedRegion, regions: state.selectedRegions, notes: state.selectedNotes, filter: state.instrumentFilter };
    liveClipboardTarget.current = clipboardTarget; selectedRegionsRef.current = state.selectedRegions; instrumentFilterRef.current = state.instrumentFilter;
    const numberGeneration = numberEditOwner.current.generation;
    const numberContext = Function('editorDocumentKey', 'project', 'numberGeneration', 'region', 'pattern', 'selectedNotes', `return ${numberContextCode}`)(state.editorDocumentKey, project, numberGeneration, region, pattern, state.selectedNotes) as string;
    liveNumberContext.current = numberContext;
    const scope = { recordDiagnostic: () => {}, audioDiagnosticSnapshot: () => ({}), signalLogged: { current: false }, ...state, project, projectRef, savedSnapshot, numberEditOwner, numberGeneration, numberContext, liveNumberContext, numberDrafts,
      track, region, pattern, selected, selectedRegionsRef, instrumentFilterRef, liveClipboardTarget, clipboardTarget, positionRef, preferences,
      history, future, produce, normalizeEditorSelection, resolveEditorSelection, createMeterMap, patternOrigin, meterMap: createMeterMap(project),
      uid, newNote, newTrack, moveRegion, trimRegion, changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError, filterTracks,
      inspectRegionSplit: inspect, splitRegionGroup: split, stop, finishHeld, engine, playbackMode: 'realtime', flushActiveNumberInput,
      setProject: vi.fn(), setSelectedTrack: set('selectedTrack'), setSelectedRegion: set('selectedRegion'), setSelectedRegions: set('selectedRegions'), setSelectedNotes: set('selectedNotes'), setFocus: set('focus'),
      setInstrumentFilter: set('instrumentFilter'), setDirty: set('dirty'), setRevision: set('revision'), setMessage: set('message'), setHasNumberDraft: set('hasNumberDraft'), setEditorDocumentKey: set('editorDocumentKey'),
      flpOpenTicket: { current: 0 }, setFlpImport: vi.fn(), setModal: vi.fn(), setPianoViewRequest: vi.fn(), library: undefined, setFilePath: vi.fn(), setImportDiagnostics: vi.fn(), seek: vi.fn(), window: {},
    };
    const api = Function(...Object.keys(scope), `${code}\nreturn {splitSelectedRegions,regionSplitProblem,regionGroupProblem,selectionSnapshot,selectRegionGroup,commit,undo,redo,adopt,setNumberPending,commitNoteNumber,commitRegionLength,filterInstruments};`)(...Object.values(scope)) as Api;
    const ui = { ...scope, ...api, regionSplitIssue: api.regionSplitProblem(project, state.selectedRegions, state.instrumentFilter, positionRef.current), regionGroupIssue: '', regionCopyIssue: '',
      bindings: { 'split-region': 'Ctrl+T' }, canCopyNotes: () => false, canCutNotes: () => false, canPasteRegionSelection: false, canEditSelection: false,
      lastClipboardKind: { current: undefined }, clipboard: { current: undefined }, visibleRegionIds: new Set(), playhead: positionRef.current,
      shortcutPlatform: 'win', displayShortcut: (value: string) => value, Scissors: () => null, element: (_type: unknown, props: unknown) => ({ props }) };
    api.menu = () => Function(...Object.keys(ui), menu)(...Object.values(ui)); api.button = () => Function(...Object.keys(ui), button)(...Object.values(ui));
    return api;
  }
  const group = (ids = ['region-a', 'region-b', 'region-c'], primary = 'region-a') => render().selectRegionGroup(new Set(ids), primary);
  const markRedo = () => { render().commit('future', p => { p.author = 'future'; }); render().undo(); };
  return { project, projectRef, savedSnapshot, numberEditOwner, history, future, state, positionRef, preferences, selectedRegionsRef, instrumentFilterRef, liveClipboardTarget,
    numberDrafts, engine, stop, finishHeld, hooks, flushActiveNumberInput, inspect, split, render, group, markRedo };
}
const normalized = (project: Project) => { const clone = structuredClone(project); delete (clone as Partial<Project>).modifiedAt; return clone; };
const roundtrip = (project: Project) => expect(normalized(openNbsx(saveNbsx(project)))).toEqual(normalized(project));
const splitMenu = (api: Api) => api.menu().items.find(item => item.command === 'split-region')!;
const noteContent = (notes: Note[]) => notes.map(({ id: _id, ...note }) => note);

describe('Actual App playhead split, full source independence and one-step selection history', () => {
  it('splits at the raw fractional playhead without re-snapping and preserves full sources/MIDI/resources outside the crop', () => {
    const t = fixture(); t.positionRef.current = 941.25; const before = structuredClone(t.project), oldSelection = t.render().selectionSnapshot();
    t.render().splitSelectedRegions(); const next = t.projectRef.current, left = next.regions.find(region => region.id === 'region-a')!, right = next.regions.find(region => !before.regions.some(old => old.id === region.id))!;
    expect([left.start, left.offset, left.length, left.loop]).toEqual([480, 1320, 461.25, true]); expect([right.start, right.offset, right.length, right.loop]).toEqual([941.25, 1781.25, 978.75, true]);
    expect(left.midiEndExclusive).toBe(true); expect(right.midiEndExclusive).toBeUndefined(); expect(left.patternId).not.toBe(right.patternId);
    for (const half of [left, right]) {
      const pattern = next.patterns.find(pattern => pattern.id === half.patternId)!;
      expect(pattern.length).toBe(960); expect(noteContent(pattern.notes)).toEqual(noteContent(before.patterns[0].notes));
      expect(pattern.midiEvents?.map(({ id: _id, ...event }) => event)).toEqual(before.patterns[0].midiEvents?.map(({ id: _id, ...event }) => event));
    }
    expect(next.regions.filter(region => ['region-b', 'region-c'].includes(region.id))).toEqual(before.regions.slice(1));
    expect(next.assets).toEqual(before.assets); expect(next.instruments).toEqual(before.instruments); expect(next.midi).toEqual(before.midi); expect(next.tempos).toEqual(before.tempos); expect(next.timeSignatures).toEqual(before.timeSignatures);
    expect(t.state.selectedRegions).toEqual(new Set([right.id])); expect(t.state.selectedRegion).toBe(right.id); expect(t.state.focus).toBe('arrangement'); expect(t.history.current).toHaveLength(1); roundtrip(next);
    expect(t.stop).not.toHaveBeenCalled(); expect(t.finishHeld.current).not.toHaveBeenCalled(); expect(t.engine.loadProjectSamples).not.toHaveBeenCalled();
    const afterSelection = t.render().selectionSnapshot(); t.render().undo(); expect(t.projectRef.current).toBe(t.project); expect(t.render().selectionSnapshot()).toEqual(oldSelection);
    t.render().redo(); expect(t.projectRef.current).toBe(next); expect(t.render().selectionSnapshot()).toEqual(afterSelection); roundtrip(next);
    expect(t.stop).not.toHaveBeenCalled();
  });

  it('splits only crossing selected members and keeps a primary which was not split', () => {
    const t = fixture(); t.group(undefined, 'region-c'); const before = structuredClone(t.project), selection = t.render().selectionSnapshot(), onsets = flattenNotes(t.project).map(note => [note.absoluteTick, note.midi]);
    t.render().splitSelectedRegions(); const next = t.projectRef.current, rights = next.regions.filter(region => !before.regions.some(old => old.id === region.id));
    expect(rights.map(region => [region.trackId, region.start, region.offset, region.length])).toEqual([['track-0', 960, 1800, 960], ['track-1', 960, 240, 840]]);
    expect(t.state.selectedRegions).toEqual(new Set([...rights.map(region => region.id), 'region-c'])); expect(t.state.selectedRegion).toBe('region-c'); expect(t.state.selectedTrack).toBe('track-2');
    expect(next.regions.find(region => region.id === 'region-c')).toEqual(before.regions[2]); expect(next.patterns.find(pattern => pattern.id === 'pattern-c')).toEqual(before.patterns[2]);
    expect(flattenNotes(next).map(note => [note.absoluteTick, note.midi])).toEqual(onsets); expect(t.history.current).toHaveLength(1); roundtrip(next);
    t.render().undo(); expect(t.render().selectionSnapshot()).toEqual(selection); t.render().redo(); expect(t.state.selectedRegion).toBe('region-c'); expect(t.state.selectedRegions.size).toBe(3);
  });

  it('follows a split primary to its right half and detaches a shared source without changing the other instance', () => {
    const project = projectFixture(); project.regions.push({ ...project.regions[0], id: 'unselected-shared', start: 6000 }); const original = structuredClone(project);
    const t = fixture(project); t.group(['region-a', 'region-b'], 'region-b'); t.render().splitSelectedRegions();
    const next = t.projectRef.current, rightB = next.regions.find(region => region.trackId === 'track-1' && region.id !== 'region-b')!, leftA = next.regions.find(region => region.id === 'region-a')!;
    expect(t.state.selectedRegion).toBe(rightB.id); expect(t.state.selectedTrack).toBe('track-1'); expect(next.regions.find(region => region.id === 'unselected-shared')).toEqual(original.regions[3]);
    expect(next.patterns.find(pattern => pattern.id === 'pattern-a')).toEqual(original.patterns[0]); expect(leftA.patternId).not.toBe('pattern-a');
    const rightA = next.regions.find(region => region.trackId === 'track-0' && !['region-a', 'unselected-shared'].includes(region.id))!;
    expect(new Set([leftA.patternId, rightA.patternId, 'pattern-a']).size).toBe(3); roundtrip(next);
  });

  it('allows the dedicated split command from piano focus, clears obsolete note selection and restores it on Undo', () => {
    const t = fixture(); t.state.focus = 'piano'; t.state.selectedNotes = new Set(['note-a0']); const before = t.render().selectionSnapshot();
    expect(splitMenu(t.render()).disabled).toBe(false); t.render().splitSelectedRegions(); expect(t.state.focus).toBe('arrangement'); expect(t.state.selectedNotes.size).toBe(0);
    t.render().undo(); expect(t.render().selectionSnapshot()).toEqual(before); expect(t.state.focus).toBe('piano'); expect(t.state.selectedNotes).toEqual(new Set(['note-a0']));
  });
});

describe('Actual App split no-op, ownership and live numeric draft boundaries', () => {
  it.each([0, 480, 1920, 2500, 480.5, 1919.5])('leaves original reference, redo, selection and dirty state untouched for playhead %s', tick => {
    const t = fixture(); t.markRedo(); t.positionRef.current = tick; const redo = t.future.current, selection = t.render().selectionSnapshot();
    expect(t.render().button().props.disabled).toBe(true); expect(splitMenu(t.render()).disabled).toBe(true); t.render().splitSelectedRegions();
    expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.history.current).toEqual([]); expect(t.render().selectionSnapshot()).toEqual(selection); expect(t.state.dirty).toBe(false);
  });

  it('rejects the whole group if any interior candidate would create a sub-tick half', () => {
    const t = fixture(); t.group(['region-a', 'region-b']); t.positionRef.current = 840.5;
    expect(t.render().button().props.disabled).toBe(true); t.render().splitSelectedRegions(); expect(t.projectRef.current).toBe(t.project); expect(t.history.current).toEqual([]); expect(t.state.message).toMatch(/1|min|长度|tick/i);
  });

  it('rejects a locked or hidden selected member even when that member does not intersect the playhead', () => {
    const t = fixture(); t.project.tracks[2].locked = true; t.group(); t.markRedo(); const redo = t.future.current;
    expect(t.render().button().props.title).toContain('锁定'); t.render().splitSelectedRegions(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    const hidden = fixture(); hidden.group(); hidden.render().filterInstruments('harp'); expect(splitMenu(hidden.render()).disabled).toBe(true); expect(hidden.render().button().props.title).toContain('隐藏');
    hidden.render().splitSelectedRegions(); expect(hidden.projectRef.current).toBe(hidden.project); expect(hidden.state.selectedRegions.size).toBe(3);
    hidden.render().filterInstruments(''); expect(hidden.projectRef.current).toBe(hidden.project); expect(hidden.render().button().props.disabled).toBe(false);
  });

  it('blocks an invalid number draft before core inspection and retains all history/selection', () => {
    const t = fixture(); t.markRedo(); const redo = t.future.current, selection = t.render().selectionSnapshot(); t.numberDrafts.current.add('length'); t.hooks.flush = () => false;
    t.render().splitSelectedRegions(); expect(t.inspect).not.toHaveBeenCalled(); expect(t.split).not.toHaveBeenCalled(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.render().selectionSnapshot()).toEqual(selection); expect(t.state.message).toContain('数字');
  });

  it('inspects and splits fresh geometry after a valid numeric length commit without a React render', () => {
    const t = fixture(); t.positionRef.current = 2100; const api = t.render(); api.setNumberPending('length', true);
    t.hooks.flush = () => { api.commitRegionLength(4); api.setNumberPending('length', false); return true; }; api.splitSelectedRegions();
    const next = t.projectRef.current, right = next.regions.find(region => !['region-a', 'region-b', 'region-c'].includes(region.id))!;
    expect([next.regions[0].length, right.start, right.length, right.offset]).toEqual([1620, 2100, 300, 2940]); expect(t.history.current).toHaveLength(2); expect(t.state.selectedRegion).toBe(right.id);
    expect(t.inspect.mock.calls[0][0]).not.toBe(t.project); expect(t.inspect.mock.calls[0][0].regions[0].length).toBe(1920); roundtrip(next);
    t.render().undo(); expect(t.projectRef.current.regions[0].length).toBe(1920); expect(t.projectRef.current.regions).toHaveLength(3);
  });

  it('uses changed notes and raw offsets from a valid flush, and rejects fresh geometry which no longer crosses the playhead', () => {
    const t = fixture(); const api = t.render(); api.setNumberPending('numeric', true);
    t.hooks.flush = () => { api.commit('numeric boundary', p => { p.patterns[0].notes[0].velocity = .2; p.regions[0].offset = 2400; }); api.setNumberPending('numeric', false); return true; }; api.splitSelectedRegions();
    const next = t.projectRef.current, right = next.regions.find(region => !['region-a', 'region-b', 'region-c'].includes(region.id))!;
    expect(right.offset).toBe(2880); expect(next.patterns.find(pattern => pattern.id === right.patternId)?.notes[0].velocity).toBe(.2); roundtrip(next);
    const shortened = fixture(); shortened.positionRef.current = 1200; const shortApi = shortened.render(); shortApi.setNumberPending('length', true);
    shortened.hooks.flush = () => { shortApi.commitRegionLength(1); shortApi.setNumberPending('length', false); return true; }; shortApi.splitSelectedRegions();
    expect(shortened.projectRef.current.regions).toHaveLength(3); expect(shortened.history.current).toHaveLength(1); expect(shortened.projectRef.current.regions[0].length).toBe(480); expect(shortened.split).not.toHaveBeenCalled();
  });

  it('rejects stale project, generation, group and filter callbacks without consuming redo', () => {
    const t = fixture(), old = t.render(); old.commit('metadata', p => { p.author = 'changed'; }); old.splitSelectedRegions(); expect(t.projectRef.current.regions).toHaveLength(3);
    t.render().undo(); const redo = t.future.current; old.splitSelectedRegions(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    const groupOld = t.render(); t.group(['region-b'], 'region-b'); groupOld.splitSelectedRegions(); expect(t.projectRef.current).toBe(t.project);
    const filterOld = t.render(); t.render().filterInstruments('bass'); filterOld.splitSelectedRegions(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.state.message).toContain('片段拆分');
  });

  it('rejects same-ID document adoption inside flush and a synchronous owner change after core inspection', () => {
    const t = fixture(), api = t.render(), reopened = structuredClone(t.project); reopened.patterns[0].notes[0].velocity = .1;
    t.hooks.flush = () => { api.adopt(reopened); return true; }; api.splitSelectedRegions(); expect(t.projectRef.current).toBe(reopened); expect(t.history.current).toEqual([]); expect(t.inspect).not.toHaveBeenCalled(); expect(t.liveClipboardTarget.current).toBeUndefined();
    const owner = fixture(); owner.markRedo(); const redo = owner.future.current;
    owner.hooks.inspected = () => { owner.numberEditOwner.current = { ...owner.numberEditOwner.current, generation: owner.numberEditOwner.current.generation + 1 }; };
    owner.render().splitSelectedRegions(); expect(owner.projectRef.current).toBe(owner.project); expect(owner.future.current).toBe(redo); expect(owner.split).not.toHaveBeenCalled();
  });

  it('reports actual core capacity/range rejection without committing, and leaves a mutator no-op out of history', () => {
    const t = fixture(); t.project.regions[0].offset = MAX_PROJECT_TICK; t.markRedo(); const redo = t.future.current; t.render().splitSelectedRegions();
    expect(t.inspect.mock.results[0].value.ok).toBe(false); expect(t.split).not.toHaveBeenCalled(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.state.message).toMatch(/范围|超|offset|偏移/);
    const noop = fixture(); noop.markRedo(); const old = noop.future.current; noop.hooks.splitUndefined = true; noop.render().splitSelectedRegions();
    expect(noop.projectRef.current).toBe(noop.project); expect(noop.future.current).toBe(old); expect(noop.history.current).toEqual([]); expect(noop.state.selectedRegions).toEqual(new Set(['region-a']));
  });

  it('computes toolbar availability without full core inspection and wires one compact, accessible action', () => {
    const t = fixture(), api = t.render(), toolbar = api.button(); expect(toolbar.props.disabled).toBe(false); expect(toolbar.props.title).toContain('Ctrl+T'); expect(splitMenu(api)).toMatchObject({ label: '在播放头拆分片段', disabled: false });
    expect(t.inspect).not.toHaveBeenCalled(); expect(t.split).not.toHaveBeenCalled(); toolbar.props.onClick(); expect(t.history.current).toHaveLength(1);
    expect(source.slice(buttonStart, buttonEnd)).toContain('Scissors'); expect(source.slice(buttonStart, buttonEnd)).toContain('拆分');
    expect(section('  commands.current =', '\n  const bindings =')).toContain("'split-region': splitSelectedRegions");
  });

  it('reuses source-derived geometry memos across playhead updates without rebuilding full-project track/pattern indexes', () => {
    const t = fixture(), api = t.render(), filters = vi.fn(), selectedRegions = new Set(['region-a']);
    const regions = new Proxy(t.project.regions, { get(target, key) { if (key === 'filter') return (...args: Parameters<typeof target.filter>) => { filters(); return target.filter(...args); }; return Reflect.get(target, key); } });
    const project = { ...t.project, regions, get tracks(): Project['tracks'] { throw new Error('UI must reuse the group check'); }, get patterns(): Project['patterns'] { throw new Error('UI must reuse the group check'); } };
    const cache: { deps: unknown[]; value: unknown }[] = []; let hook = 0;
    const useMemo = (calculate: () => unknown, deps: unknown[]) => { const i = hook++, old = cache[i]; if (!old || deps.length !== old.deps.length || deps.some((value, index) => value !== old.deps[index])) cache[i] = { deps, value: calculate() }; return cache[i].value; };
    const run = Function('useMemo', 'project', 'selectedRegions', 'instrumentFilter', 'playhead', 'regionGroupIssue', 'regionSplitProblem', `${geometryMemos}\nreturn {selectedRegionGeometry,regionSplitIssue};`);
    const outputs = [960, 961, 962].map(tick => { hook = 0; return run(useMemo, project, selectedRegions, '', tick, '', api.regionSplitProblem) as { selectedRegionGeometry: Region[]; regionSplitIssue: string }; });
    expect(outputs.map(result => result.regionSplitIssue)).toEqual(['', '', '']); expect(filters).toHaveBeenCalledOnce();
    expect(outputs[1].selectedRegionGeometry).toBe(outputs[0].selectedRegionGeometry); expect(outputs[2].selectedRegionGeometry).toBe(outputs[0].selectedRegionGeometry);
    expect(t.inspect).not.toHaveBeenCalled(); expect(t.split).not.toHaveBeenCalled();
  });
});

describe('Actual App split command dispatch at inert text/native boundaries', () => {
  it('accepts Ctrl+T from piano/arrangement domains and keeps both keyboard and native command out of text inputs', () => {
    class FakeElement { constructor(readonly input: boolean) {} closest(selector: string) { return this.input && selector.startsWith('input,select,textarea') ? this : null; } }
    vi.stubGlobal('Element', FakeElement);
    try {
      const dispatch = vi.fn(), commands = { current: { 'split-region': dispatch } }, bindings = inspectShortcuts('fl', {}, 'win').effective;
      const scope = { isShortcutInput, modal: null, setModal: vi.fn(), cancelFlpImport: vi.fn(), keyboardEnabled: false, recording: false, shortcutPlatform: 'win', shortcutForEvent, commandForShortcut, bindings, commands, midiDown: { current: vi.fn() } };
      const keydown = Function(...Object.keys(scope), `${keyboard}\nreturn onKeyDown;`)(...Object.values(scope)) as (event: unknown) => void;
      const event = (input: boolean) => ({ key: 't', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false, repeat: false, target: new FakeElement(input), getModifierState: () => false, preventDefault: vi.fn() });
      const text = event(true); keydown(text); expect(dispatch).not.toHaveBeenCalled(); expect(text.preventDefault).not.toHaveBeenCalled();
      const editor = event(false); keydown(editor); expect(dispatch).toHaveBeenCalledOnce(); expect(editor.preventDefault).toHaveBeenCalledOnce();
      let menuCallback!: (command: string) => void; const document = { activeElement: new FakeElement(true), execCommand: vi.fn() };
      Function('window', 'isShortcutInput', 'document', 'textEditingCommands', 'modalRef', 'commands', 'SHORTCUT_COMMANDS', nativeMenu)(
        { desktop: { onMenu: (callback: (command: string) => void) => { menuCallback = callback; } } }, isShortcutInput, document, textEditingCommands, { current: null }, commands, SHORTCUT_COMMANDS);
      menuCallback('split-region'); expect(dispatch).toHaveBeenCalledOnce(); expect(document.execCommand).not.toHaveBeenCalled();
      document.activeElement = new FakeElement(false); menuCallback('split-region'); expect(dispatch).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
