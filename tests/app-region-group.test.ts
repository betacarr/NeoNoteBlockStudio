import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { canCopyNotes, canCutNotes, canPasteNotes, canEditSelectedNotes, changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';
import { growEditedPattern, trimRegion } from '../src/core/editor-interaction';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createMeterMap, patternTickAt, patternOrigin } from '../src/core/meter';
import { createNoteClipboard, planNotePaste, type NoteClipboard } from '../src/core/note-clipboard';
import { createProject, newNote, newTrack, uid } from '../src/core/project';
import { applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup, type RegionMove } from '../src/core/region-batch';
import { moveRegion } from '../src/core/region-transfer';
import { filterTracks } from '../src/core/track-filter';
import { allocateTrackMidiChannel } from '../src/core/track-management';
import type { Note, Project, Region, Track } from '../src/core/types';

// Execute actual App selection/history/commands and actual rendered-control
// expressions, with real Immer/core/NBSX. Setters/engine/hooks are inert state
// boundaries: no browser, physical gesture, audio or packaged GUI claim.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`App group boundary missing: ${from}`);
  return source.slice(start, end);
}
const code = transformSync([
  section('  const selectionSnapshot =', '\n  const changeTrack ='),
  section('  function filterInstruments(', '\n  function selectMixerTrack('),
  section('  const changeRegion =', '\n  function moveNoteSelection('),
  section('  function adopt(', '\n  async function openBytes('),
  section('  function undo()', '\n  function changeExportOptions('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const editingMenuCode = transformSync(`return ${section("    { label: '编辑',", "\n    { label: '视图',").trim().replace(/,$/, '')};`, { loader: 'ts' }).code;
type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: { ...props, children: children.flat(Infinity) } });
function controlCode(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`App group control missing: ${start}`);
  return transformSync(`return ${source.slice(from, to + end.length)};`, { loader: 'tsx', jsxFactory: 'element' }).code;
}
const controls = {
  target: controlCode('<select aria-label="片段所属轨道"', '</select>'),
  name: controlCode('<input aria-label="片段名称"', '/>'),
  length: controlCode('<CommitNumberInput aria-label="片段长度"', '/>'),
  duplicate: controlCode('<button disabled={!!regionGroupIssue} onClick={duplicateCurrentRegion}', '</button>'),
  loop: controlCode("<button className={region?.loop ? 'selected-text' : ''}", '</button>'),
};
const NumberInput = () => null;
interface Entry { label: string; project: Project; selection: EditorSelection }
interface Commands {
  selectionSnapshot: (project?: Project) => EditorSelection;
  restoreSelection: (project: Project, selection: EditorSelection) => void;
  selectRegion: (region: Region) => void; selectRegionGroup: (ids: Set<string>, primary?: string) => void; selectTrack: (track: Track) => void;
  selectAllInEditor: () => void; filterInstruments: (value: string) => void;
  changeRegionGroup: (changes: RegionMove[]) => void; changeRegion: (id: string, patch: Partial<Region>) => void;
  trimCurrentRegion: (id: string, edge: 'start' | 'end', tick: number) => void;
  renameCurrentRegion: (name: string) => void; commitRegionLength: (beats: number) => void;
  commit: (label: string, change: (project: Project) => void, preserve?: boolean) => void; undo: () => void; redo: () => void;
  duplicate: () => void; duplicateCurrentRegion: () => void; deleteSelection: () => void;
  copyNotes: () => boolean; cutNotes: () => void; pasteNotes: (duplicate?: boolean) => void;
  addTrack: () => void; createRegion: (track: string, tick: number) => void; adopt: (project: Project) => void;
  regionGroupProblem: (project: Project, ids: ReadonlySet<string>, filter: string, allowLocked?: boolean) => string;
  regionSplitProblem: (project: Project, ids: ReadonlySet<string>, filter: string, tick: number) => string;
}
function fixture() {
  const initial = createProject('App region group'); initial.ppq = 480;
  initial.tracks = [newTrack('A', 0, 'harp'), newTrack('B', 1, 'bass'), newTrack('C', 2, 'flute'), { ...newTrack('Locked', 3, 'bell'), locked: true }].map((track, index) => ({ ...track, id: `track-${index}` }));
  initial.patterns = initial.tracks.map((track, index) => ({ id: `pattern-${index}`, name: `Pattern ${index}`, length: 480,
    notes: [{ ...newNote(60, 60 + index, 91.5), id: `note-${index}`, velocity: .73, pan: -.25, detune: 9.125, height: .5,
      ...(index === 1 ? { instrumentId: 'flute' } : {}), midiSource: { onOrder: 7, offOrder: 13, releaseVelocity: 42, offSourceTrack: index } }],
    midiEvents: [{ id: `message-${index}`, tick: 30, order: 3, sourceTrack: index, event: { deltaTime: 0 as const, type: 'sysEx' as const, data: [1, 2, 3] } }] }));
  initial.regions = initial.tracks.map((track, index) => ({ id: `region-${index}`, trackId: track.id, patternId: `pattern-${index}`, start: [120, 840, 0, 0][index], offset: index === 0 ? 30 : 0, length: index === 1 ? 960 : 480, loop: index < 2 }));
  initial.assets = [{ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }];
  initial.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', conductor: [] };
  const before = structuredClone(initial), projectRef = { current: initial }, savedSnapshot = { current: initial as Project | undefined };
  const numberEditOwner = { current: { project: initial, generation: 0 } };
  const history = { current: [] as Entry[] }, future = { current: [] as Entry[] };
  const state = { selectedTrack: 'track-0', selectedRegion: 'region-0', selectedRegions: new Set(['region-0']), selectedNotes: new Set(['note-0']), focus: 'arrangement' as EditorSelection['focus'], instrumentFilter: '', dirty: false, revision: 0, message: '' };
  const selectedRegionsRef = { current: state.selectedRegions }, instrumentFilterRef = { current: '' }, clipboard = { current: undefined as NoteClipboard | undefined };
  const liveNumberContext = { current: 'current' }, finishHeld = { current: vi.fn() }, finishNumberDraft = vi.fn(() => true);
  const engine = { loadProjectSamples: vi.fn(async () => {}) }, stop = vi.fn();
  function render() {
    const project = projectRef.current, resolved = resolveEditorSelection(project, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
    const clipboardTarget = { documentKey: 1, focus: state.focus, trackId: state.selectedTrack, regionId: state.selectedRegion, regions: state.selectedRegions, notes: state.selectedNotes, filter: state.instrumentFilter };
    const { track, region, pattern, notes: selected } = resolved;
    const scope = { recordDiagnostic: () => {}, audioDiagnosticSnapshot: () => ({}), signalLogged: { current: false }, project, projectRef, savedSnapshot, numberEditOwner, numberGeneration: numberEditOwner.current.generation,
      ...state, selectedRegionsRef, instrumentFilterRef, history, future, clipboard, produce, normalizeEditorSelection, resolveEditorSelection, filterTracks, clipboardTarget, liveClipboardTarget: { current: clipboardTarget },
      applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup, moveRegion, MAX_PROJECT_TICK,
      setProject: vi.fn(), setSelectedTrack: (id: string) => { state.selectedTrack = id; }, setSelectedRegion: (id: string) => { state.selectedRegion = id; },
      setSelectedRegions: (ids: Set<string>) => { state.selectedRegions = ids; }, setSelectedNotes: (ids: Set<string>) => { state.selectedNotes = ids; },
      setFocus: (focus: EditorSelection['focus']) => { state.focus = focus; }, setInstrumentFilter: (value: string) => { state.instrumentFilter = value; },
      setDirty: (value: boolean) => { state.dirty = value; }, setRevision: (update: (value: number) => number) => { state.revision = update(state.revision); }, setMessage: (message: string) => { state.message = message; },
      track, region, pattern, selected, canCopyNotes, canCutNotes, canPasteNotes, canEditSelectedNotes, changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, trimRegion,
      createNoteClipboard, planNotePaste, uid, newTrack, newNote, patternTickAt, patternOrigin, createMeterMap, allocateTrackMidiChannel, positionRef: { current: 0 }, sourceOrigin: region ? region.start - region.offset : 0,
      meterMap: createMeterMap(project), preferences: { snap: 16 }, editorDocumentKey: 1, engine, finishNumberDraft,
      numberContext: 'current', liveNumberContext, inspectorBeatTicks, noteTimingError, regionLengthError, numberDrafts: { current: new Set<string>() }, setHasNumberDraft: vi.fn(), flushActiveNumberInput: vi.fn(() => true),
      liveDelayContext: { current: 'delay' }, delayContext: 'delay', playbackMode: 'realtime', finishHeld, stop,
      flpOpenTicket: { current: 0 }, setFlpImport: vi.fn(), setModal: vi.fn(), setEditorDocumentKey: vi.fn(), setPianoViewRequest: vi.fn(),
      library: undefined, setFilePath: vi.fn(), setImportDiagnostics: vi.fn(), seek: vi.fn(), window: {},
    };
    const api = Function(...Object.keys(scope), `${code}\nreturn {selectionSnapshot,restoreSelection,selectRegion,selectRegionGroup,selectTrack,selectAllInEditor,filterInstruments,changeRegionGroup,changeRegion,trimCurrentRegion,renameCurrentRegion,commitRegionLength,commit,undo,redo,duplicate,duplicateCurrentRegion,deleteSelection,copyNotes,cutNotes,pasteNotes,addTrack,createRegion,adopt,regionGroupProblem,regionSplitProblem};`)(...Object.values(scope)) as Commands;
    const groupIssue = api.regionGroupProblem(project, state.selectedRegions, state.instrumentFilter);
    const visible = new Set(filterTracks(project.tracks, state.instrumentFilter).map(track => track.id));
    const uiScope = { ...scope, ...api, element, CommitNumberInput: NumberInput, Copy: () => null, Repeat: () => null,
      regionGroupIssue: groupIssue, regionSplitIssue: api.regionSplitProblem(project, state.selectedRegions, state.instrumentFilter, scope.positionRef.current), regionCopyIssue: api.regionGroupProblem(project, state.selectedRegions, state.instrumentFilter, true),
      lastClipboardKind: { current: clipboard.current ? 'notes' : undefined }, canPasteRegionSelection: false,
      canEditSelection: state.focus === 'piano' && canEditSelectedNotes(track, pattern, state.selectedNotes),
      visibleRegionIds: new Set(project.regions.filter(region => visible.has(region.trackId)).map(region => region.id)), bindings: {} };
    return { ...api,
      menu: () => Function(...Object.keys(uiScope), editingMenuCode)(...Object.values(uiScope)) as { items: { command: string; label: string; disabled: boolean }[] },
      control: (name: keyof typeof controls) => Function(...Object.keys(uiScope), controls[name])(...Object.values(uiScope)) as Element,
    };
  }
  const group = (ids = ['region-0', 'region-1'], primary = 'region-1') => render().selectRegionGroup(new Set(ids), primary);
  const setFilter = (value: string) => render().filterInstruments(value);
  return { initial, before, projectRef, savedSnapshot, numberEditOwner, history, future, state, selectedRegionsRef, instrumentFilterRef, clipboard, finishNumberDraft, finishHeld, stop, engine, liveNumberContext, render, group, setFilter };
}
const normalized = (project: Project) => { const copy = structuredClone(project); delete (copy as Partial<Project>).modifiedAt; return copy; };
const roundtrip = (project: Project) => expect(normalized(openNbsx(saveNbsx(project)))).toEqual(normalized(project));
const gridMove: RegionMove[] = [{ id: 'region-0', trackId: 'track-1', start: 360 }, { id: 'region-1', trackId: 'track-2', start: 1080 }];

describe('App arrangement group selection and historical ownership', () => {
  it('keeps an existing group when its primary changes, replaces it for an unselected clip and clears it for an empty track', () => {
    const t = fixture(); t.group();
    t.render().selectRegion(t.initial.regions[0]);
    expect(t.state.selectedRegions).toEqual(new Set(['region-0', 'region-1'])); expect(t.state.selectedRegion).toBe('region-0'); expect(t.state.selectedTrack).toBe('track-0');
    t.render().selectRegion(t.initial.regions[2]); expect(t.state.selectedRegions).toEqual(new Set(['region-2']));
    const empty = newTrack('Empty'); t.initial.tracks.push(empty); t.render().selectTrack(empty);
    expect(t.state.selectedRegion).toBe(''); expect(t.state.selectedRegions.size).toBe(0); expect(t.state.selectedNotes.size).toBe(0);
    expect(t.history.current).toEqual([]); expect(t.projectRef.current).toBe(t.initial);
  });

  it('uses an explicit empty group without falling back to a previous primary, and supports old single-selection history', () => {
    const t = fixture(); t.group(); t.render().selectRegionGroup(new Set());
    expect(t.state.selectedRegion).toBe(''); expect(t.render().selectionSnapshot()).toMatchObject({ regionIds: [], noteIds: [], focus: 'arrangement' });
    t.render().restoreSelection(t.initial, { trackId: 'track-0', regionId: 'region-0', noteIds: ['note-0'], focus: 'piano' });
    expect(t.state.selectedRegions).toEqual(new Set(['region-0'])); expect(t.state.selectedNotes).toEqual(new Set(['note-0'])); expect(t.state.focus).toBe('piano');
  });

  it('moves the whole group once, roundtrips every project field and restores the complete group/primary on Undo/Redo', () => {
    const t = fixture(); t.group(); const expected = structuredClone(t.before);
    Object.assign(expected.regions[0], { trackId: 'track-1', start: 360 }); Object.assign(expected.regions[1], { trackId: 'track-2', start: 1080 });
    delete expected.patterns[0].notes[0].midiSource!.offSourceTrack; delete expected.patterns[1].notes[0].midiSource!.offSourceTrack;
    const beforeSelection = t.render().selectionSnapshot(); t.render().changeRegionGroup(gridMove);
    const moved = t.projectRef.current, movedSelection = t.render().selectionSnapshot();
    expect(normalized(moved)).toEqual(normalized(expected)); expect(t.history.current).toHaveLength(1); expect(t.history.current[0].selection).toEqual(beforeSelection);
    expect(movedSelection).toMatchObject({ trackId: 'track-2', regionId: 'region-1', regionIds: ['region-0', 'region-1'], noteIds: [], focus: 'arrangement' }); roundtrip(moved);
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.render().selectionSnapshot()).toEqual(beforeSelection);
    t.render().redo(); expect(t.projectRef.current).toBe(moved); expect(t.render().selectionSnapshot()).toEqual(movedSelection); roundtrip(t.projectRef.current);
  });

  it('rejects a stale project, same-reference Undo/Redo generation, and stale group changes without consuming redo', () => {
    const t = fixture(); t.group(); const old = t.render(); old.commit('metadata', p => { p.name = 'New name'; });
    const changed = t.projectRef.current; old.changeRegionGroup(gridMove); expect(t.projectRef.current).toBe(changed); expect(t.history.current).toHaveLength(1);
    const later = t.render(); later.undo(); t.render().redo(); const previous = t.projectRef.current;
    later.changeRegionGroup(gridMove); expect(t.projectRef.current).toBe(previous);
    t.render().undo(); const redo = t.future.current; t.group(['region-0'], 'region-0'); t.render().changeRegionGroup(gridMove);
    expect(t.future.current).toBe(redo); expect(t.projectRef.current).toBe(t.initial); expect(t.state.selectedRegions).toEqual(new Set(['region-0']));
  });

  it('rejects hidden/locked selections as one unit, preserves redo, and clearing the view filter keeps the source and selection', () => {
    const t = fixture(); t.group(); t.render().commit('metadata', p => { p.name = 'Changed'; }); t.render().undo(); const redo = t.future.current;
    t.setFilter('harp'); const selected = new Set(t.state.selectedRegions), before = t.projectRef.current;
    for (const command of [() => t.render().duplicateCurrentRegion(), () => t.render().deleteSelection(), () => t.render().changeRegionGroup(gridMove)]) command();
    expect(t.projectRef.current).toBe(before); expect(t.future.current).toBe(redo); expect(t.state.message).toContain('隐藏'); expect(t.state.selectedRegions).toEqual(selected);
    expect(t.render().control('duplicate').props.disabled).toBe(true);
    t.setFilter(''); expect(t.projectRef.current).toBe(before); expect(t.state.selectedRegions).toEqual(selected); expect(t.future.current).toBe(redo);
    t.group(['region-0', 'region-3'], 'region-0'); t.render().duplicateCurrentRegion(); t.render().deleteSelection();
    expect(t.state.message).toContain('锁定'); expect(t.projectRef.current).toBe(before); expect(t.future.current).toBe(redo);
  });

  it('rejects an invalid or locked destination atomically and leaves a true same-position move out of history', () => {
    const t = fixture(); t.group(); t.render().commit('metadata', p => { p.name = 'Redo target'; }); t.render().undo(); const redo = t.future.current, selection = t.render().selectionSnapshot();
    t.render().changeRegionGroup([{ ...gridMove[0] }, { ...gridMove[1], trackId: 'track-3' }]);
    t.render().changeRegionGroup([{ ...gridMove[0] }, { ...gridMove[1], trackId: 'missing' }]);
    t.render().changeRegionGroup([{ id: 'region-0', trackId: 'track-0', start: 120 }, { id: 'region-1', trackId: 'track-1', start: 840 }]);
    expect(t.projectRef.current).toBe(t.initial); expect(t.future.current).toBe(redo); expect(t.history.current).toEqual([]); expect(t.render().selectionSnapshot()).toEqual(selection);
  });
});

describe('App batch commands, context menus and complete-project persistence', () => {
  it('duplicates all selected clips by the literal group span with independent sources and one history operation', () => {
    const t = fixture(); t.initial.regions[1].patternId = 'pattern-0'; t.group(); const original = structuredClone(t.initial), selection = t.render().selectionSnapshot();
    t.render().duplicate(); const next = t.projectRef.current, copies = next.regions.slice(4);
    expect(copies.map(item => [item.trackId, item.start, item.offset, item.length, item.loop])).toEqual([['track-0', 1800, 30, 480, true], ['track-1', 2520, 0, 960, true]]);
    expect(next.regions.slice(0, 4)).toEqual(original.regions); expect(next.patterns.slice(0, 4)).toEqual(original.patterns); expect(next.assets).toEqual(original.assets);
    expect(t.state.selectedRegions).toEqual(new Set(copies.map(item => item.id))); expect(t.state.selectedRegion).toBe(copies[1].id); expect(t.state.selectedTrack).toBe('track-1');
    const [a, b] = copies.map(item => next.patterns.find(pattern => pattern.id === item.patternId)!);
    expect(a.id).not.toBe(b.id); expect(a.id).not.toBe('pattern-0'); expect(a.notes[0].id).not.toBe(b.notes[0].id);
    expect(a.notes[0]).toMatchObject({ tick: 60, duration: 91.5, midi: 60, velocity: .73, pan: -.25, detune: 9.125, height: .5, midiSource: original.patterns[0].notes[0].midiSource });
    expect(a.midiEvents![0].id).not.toBe(b.midiEvents![0].id); expect(a.midiEvents![0].event).toEqual(original.patterns[0].midiEvents![0].event);
    const messageA = a.midiEvents![0].event, messageB = b.midiEvents![0].event;
    expect(messageA).not.toBe(original.patterns[0].midiEvents![0].event);
    if (!('data' in messageA) || !('data' in messageB)) throw new Error('Expected retained SysEx payloads');
    expect(messageA.data).not.toBe(messageB.data);
    expect(t.history.current).toHaveLength(1); roundtrip(next);
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.render().selectionSnapshot()).toEqual(selection);
    t.render().redo(); expect(t.projectRef.current).toBe(next); expect(t.state.selectedRegions).toEqual(new Set(copies.map(item => item.id)));
  });

  it('deletes exactly the selected group and restores its independent sources/MIDI/selection in one Undo', () => {
    const t = fixture(); t.group(); const original = structuredClone(t.initial), selected = t.render().selectionSnapshot();
    t.render().deleteSelection(); const expected = structuredClone(original); expected.regions = expected.regions.slice(2); expected.patterns = expected.patterns.slice(2);
    expect(normalized(t.projectRef.current)).toEqual(normalized(expected)); expect(t.state.selectedRegions.size).toBe(0); expect(t.state.selectedRegion).toBe(''); expect(t.history.current).toHaveLength(1); roundtrip(t.projectRef.current);
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.render().selectionSnapshot()).toEqual(selected); roundtrip(t.projectRef.current);
    const redo = t.future.current; t.render().selectRegionGroup(new Set()); t.render().deleteSelection(); t.render().duplicateCurrentRegion();
    expect(t.future.current).toBe(redo); expect(t.projectRef.current).toBe(t.initial); expect(t.state.selectedRegion).toBe('');
  });

  it('selects only visible regions from arrangement Ctrl+A and leaves piano Ctrl+A in the note domain', () => {
    const t = fixture(); t.group(); const initial = structuredClone(t.initial); t.setFilter('bass'); t.render().selectAllInEditor();
    expect(t.state.selectedRegions).toEqual(new Set(['region-1'])); expect(t.state.selectedRegion).toBe('region-1'); expect(t.state.focus).toBe('arrangement');
    expect(t.render().menu().items.find(item => item.command === 'select-all')?.label).toBe('全选可见片段');
    t.state.focus = 'piano'; t.render().selectAllInEditor(); expect(t.state.selectedNotes).toEqual(new Set(['note-1'])); expect(t.state.selectedRegions).toEqual(new Set(['region-1']));
    expect(t.render().menu().items.find(item => item.command === 'select-all')?.label).toBe('全选音符');
    t.state.focus = 'arrangement'; t.setFilter('not-found'); t.render().selectAllInEditor(); expect(t.state.selectedRegions.size).toBe(0); expect(t.state.selectedRegion).toBe('');
    expect(t.projectRef.current).toEqual(initial); expect(t.history.current).toEqual([]); expect(t.state.dirty).toBe(false);
  });

  it('keeps note-only command primitives out of arrangement while its menu enables region copy and guards whole-group edits', () => {
    const t = fixture(); t.clipboard.current = createNoteClipboard(t.initial, t.initial.patterns[0].notes, 'track-0', 1); const clipboard = t.clipboard.current;
    t.group(); const before = t.projectRef.current; t.render().copyNotes(); t.render().cutNotes(); t.render().pasteNotes();
    expect(t.clipboard.current).toBe(clipboard); expect(t.projectRef.current).toBe(before); expect(t.history.current).toEqual([]);
    const menu = t.render().menu().items; expect(menu.find(item => item.command === 'paste')?.disabled).toBe(true); expect(menu.find(item => item.command === 'copy')?.disabled).toBe(false);
    expect(menu.find(item => item.command === 'copy')?.label).toBe('复制片段');
    expect(menu.find(item => item.command === 'duplicate')?.disabled).toBe(false); expect(menu.find(item => item.command === 'delete')?.disabled).toBe(false);
    t.group(['region-0', 'region-3'], 'region-0'); expect(t.render().menu().items.find(item => item.command === 'duplicate')?.disabled).toBe(true); expect(t.render().menu().items.find(item => item.command === 'delete')?.disabled).toBe(true);
    t.state.focus = 'piano'; t.state.selectedNotes = new Set(['note-0']); expect(t.render().copyNotes()).toBe(true); expect(t.clipboard.current).not.toBe(clipboard); expect(t.projectRef.current).toBe(before);
  });

  it('disables multi-region inspector/loop controls and rejects captured callbacks rather than editing the primary only', () => {
    const t = fixture(); const old = t.render(), capturedName = old.control('name'), capturedLength = old.control('length');
    t.group(); const before = t.projectRef.current;
    for (const name of ['target', 'name', 'length', 'loop'] as const) expect(t.render().control(name).props.disabled).toBe(true);
    t.render().control('target').props.onChange({ currentTarget: { value: 'track-2' } });
    capturedName.props.onChange({ target: { value: 'Late name' } }); capturedLength.props.onCommit(2);
    t.render().control('loop').props.onClick();
    expect(t.projectRef.current).toBe(before); expect(t.history.current).toEqual([]); expect(t.state.selectedRegions).toEqual(new Set(['region-0', 'region-1']));
  });

  it('retains explicit single-region hidden-target selection and editing while filter-visible batch operations stay guarded', () => {
    const t = fixture(); t.setFilter('bass');
    expect(t.render().control('target').props.disabled).toBe(false); expect(t.render().control('duplicate').props.disabled).toBe(true);
    t.render().control('target').props.onChange({ currentTarget: { value: 'track-2' } });
    expect(t.projectRef.current.regions[0].trackId).toBe('track-2'); expect(t.state.instrumentFilter).toBe('bass'); expect(t.state.selectedTrack).toBe('track-2');
    expect(t.render().control('target').props.disabled).toBe(false);
    t.render().control('target').props.onChange({ currentTarget: { value: 'track-0' } });
    expect(t.projectRef.current.regions[0].trackId).toBe('track-0'); expect(t.state.instrumentFilter).toBe('bass'); expect(t.state.selectedRegions).toEqual(new Set(['region-0']));
    expect(t.render().control('name').props.disabled).toBe(false); expect(t.render().control('length').props.disabled).toBe(false);
    t.render().control('name').props.onChange({ target: { value: 'Still editable while hidden' } });
    expect(t.projectRef.current.patterns[0].name).toBe('Still editable while hidden'); roundtrip(t.projectRef.current);
  });

  it('collapses piano range trimming to its one target before the history snapshot without changing the active panel', () => {
    const t = fixture(); t.group(); t.state.focus = 'piano';
    t.render().trimCurrentRegion('region-0', 'end', 840);
    expect(t.state.focus).toBe('piano'); expect(t.state.selectedRegions).toEqual(new Set(['region-0'])); expect(t.state.selectedRegion).toBe('region-0');
    expect(t.projectRef.current.regions[0].length).toBe(720); expect(t.projectRef.current.regions.slice(1)).toEqual(t.before.regions.slice(1));
    expect(t.history.current).toHaveLength(1); expect(t.history.current[0].selection).toMatchObject({ regionIds: ['region-0'], regionId: 'region-0', focus: 'piano' });
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.state.selectedRegions).toEqual(new Set(['region-0'])); expect(t.state.focus).toBe('piano');
  });

  it('replaces the group for new clips/tracks/adoption without changing ordinary piano and numeric behavior', () => {
    const t = fixture(); t.group(); t.render().createRegion('track-2', 2400); const created = t.projectRef.current.regions.at(-1)!;
    expect(t.state.selectedRegions).toEqual(new Set([created.id])); expect(t.state.selectedRegion).toBe(created.id);
    const oldTrackCount = t.projectRef.current.tracks.length;
    t.render().addTrack(); const added = t.projectRef.current.regions.at(-1)!; expect(t.projectRef.current.tracks).toHaveLength(oldTrackCount + 1); expect(added.id).not.toBe(created.id); expect(t.state.selectedRegions).toEqual(new Set([added.id])); expect(t.state.selectedTrack).toBe(added.trackId);
    const replacement = createProject('Opened'); t.render().adopt(replacement);
    expect(t.state.selectedRegions).toEqual(new Set([replacement.regions[0].id])); expect(t.state.selectedRegion).toBe(replacement.regions[0].id); expect(t.state.instrumentFilter).toBe(''); expect(t.history.current).toEqual([]); expect(t.future.current).toEqual([]);
  });
});
