import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { canCopyNotes, canCutNotes, canPasteNotes, canEditSelectedNotes, changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../src/core/editor-selection';
import { growEditedPattern, trimRegion } from '../src/core/editor-interaction';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createMeterMap, patternOrigin, patternTickAt } from '../src/core/meter';
import { createNoteClipboard, planNotePaste, type NoteClipboard } from '../src/core/note-clipboard';
import { createProject, newNote, newTrack, uid, validateProject } from '../src/core/project';
import { applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup } from '../src/core/region-batch';
import { createRegionClipboard, planRegionPaste, type RegionClipboard } from '../src/core/region-clipboard';
import { moveRegion } from '../src/core/region-transfer';
import { filterTracks } from '../src/core/track-filter';
import type { Note, Project, Region } from '../src/core/types';

// Actual App command/selection/history/numeric callbacks, real Immer and NBSX.
// React setters, the number-input flush and sample loader are explicit inert
// boundaries. This is neither physical keyboard nor packaged GUI/audio evidence.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`App clipboard boundary missing: ${from}`);
  return source.slice(start, end);
}
const callbacks = transformSync([
  section('  const selectionSnapshot =', '\n  const changeTrack ='),
  section('  function filterInstruments(', '\n  function selectMixerTrack('),
  section('  const changeRegion =', '\n  function moveNoteSelection('),
  section('  function adopt(', '\n  async function openBytes('),
  section('  function undo()', '\n  function changeExportOptions('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const menuCode = transformSync(`return ${section("    { label: '编辑',", "\n    { label: '视图',").trim().replace(/,$/, '')};`, { loader: 'ts' }).code;
const commandBindings = transformSync(section('  commands.current =', '\n  const bindings ='), { loader: 'ts' }).code;
const numberContextCode = section('  const numberContext = ', '\n  const liveNumberContext').slice('  const numberContext = '.length);
const pasteButtonStart = source.indexOf('<button aria-label="粘贴片段"');
const pasteButtonEnd = source.indexOf('</button>', pasteButtonStart);
const pasteButton = transformSync(`return ${source.slice(pasteButtonStart, pasteButtonEnd + 9)};`, { loader: 'tsx', jsxFactory: 'element' }).code;
interface Entry { label: string; project: Project; selection: EditorSelection }
type Api = {
  copySelection(): boolean; cutSelection(): void; pasteSelection(): void;
  copyNotes(): boolean; cutNotes(): boolean; pasteNotes(duplicate?: boolean): void;
  commit(label: string, change: (project: Project) => void, preserve?: boolean): void;
  commitNoteNumber(patch: Partial<Note>): boolean | void; commitRegionLength(value: number): boolean | void;
  setNumberPending(field: string, pending: boolean): void; finishNumberDraft(): boolean;
  selectRegionGroup(ids: Set<string>, primary?: string): void; selectRegion(region: Region): void;
  selectTrack(track: Project['tracks'][number]): void; filterInstruments(value: string): void;
  selectionSnapshot(project?: Project): EditorSelection; undo(): void; redo(): void; adopt(project: Project): void;
  regionGroupProblem(project: Project, ids: ReadonlySet<string>, filter: string, readOnly?: boolean): string;
  regionSplitProblem(project: Project, ids: ReadonlySet<string>, filter: string, tick: number): string;
  menu(): { items: { label: string; command: string; disabled?: boolean }[] };
  pasteButton(): { props: { disabled: boolean; onClick(): void; title: string } };
};
const exports = 'copySelection,cutSelection,pasteSelection,copyNotes,cutNotes,pasteNotes,commit,commitNoteNumber,commitRegionLength,setNumberPending,finishNumberDraft,selectRegionGroup,selectRegion,selectTrack,filterInstruments,selectionSnapshot,undo,redo,adopt,regionGroupProblem,regionSplitProblem';
function wave(value: number) {
  const bytes = new Uint8Array(52), view = new DataView(bytes.buffer);
  for (const [at, word] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < 4; i++) bytes[at + i] = word.charCodeAt(i);
  view.setUint32(4, 44, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 8, true);
  [0, value, -value, 0].forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return bytesToBase64(bytes);
}
function sourceProject() {
  const project = createProject('Region source'); project.id = 'source-document'; project.ppq = 480;
  project.tracks = [newTrack('Source top', 0, 'bass'), newTrack('Gap', 1, 'flute'), newTrack('Source bottom', 2, 'bass')];
  project.tracks.forEach((track, i) => { track.id = `source-track-${i}`; track.sourceMidiTrack = i + 7; track.pan = .1 * i; });
  project.patterns = [
    { id: 'pattern-a', name: 'Full trimmed source', length: 1440, notes: [
      { ...newNote(0, 54, 240), id: 'before-crop' },
      { ...newNote(240, 60, 360), id: 'note-a', velocity: .75, pan: -.2, detune: 12.5, height: .5, instrumentId: 'custom', midiSource: { onOrder: 2, offOrder: 7, releaseVelocity: 43, offSourceTrack: 7 } },
      { ...newNote(1200, 72, 120), id: 'after-crop' },
    ], midiEvents: [{ id: 'message-a', tick: 360, order: 3, sourceTrack: 7, event: { deltaTime: 0, type: 'sysEx', data: [126, 127, 9, 1, 247] } }] },
    { id: 'pattern-b', name: 'Loop source', length: 960, notes: [{ ...newNote(240, 67, 120), id: 'note-b', velocity: .5, midiSource: { onOrder: 10, offOrder: 12, releaseVelocity: 51, offSourceTrack: 9 } }] },
  ];
  project.regions = [
    { id: 'region-a', trackId: 'source-track-0', patternId: 'pattern-a', start: 480, offset: 120, length: 960, loop: false },
    { id: 'region-b', trackId: 'source-track-2', patternId: 'pattern-b', start: 1920, offset: 240, length: 1440, loop: true },
  ];
  project.instruments.push({ ...project.instruments[0], id: 'custom', name: 'Source sample', assetId: 'sample' });
  project.assets = [{ id: 'sample', name: 'source.wav', mime: 'audio/wav', data: wave(2000) }, { id: 'source-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }];
  project.midi = { schema: 1, format: 1, sourceAssetId: 'source-midi', conductor: [{ id: 'source-text', tick: 0, order: 0, event: { deltaTime: 0, type: 'text', text: 'source archive' } }] };
  validateProject(project); return project;
}
function targetProject() {
  const project = createProject('Destination'); project.id = 'target-document'; project.ppq = 960;
  project.tracks = [{ ...newTrack('Destination', 0, 'harp'), id: 'target-track', volume: .6, pan: -.3, sourceMidiTrack: 2, midiChannel: 5 }];
  project.patterns[0].notes = [{ ...newNote(0, 54, 240), id: 'target-guard' }]; project.regions[0].trackId = 'target-track';
  project.instruments.push({ ...project.instruments[0], id: 'custom', name: 'Target original', assetId: 'sample' });
  project.assets = [{ id: 'sample', name: 'target.wav', mime: 'audio/wav', data: wave(1000) }, { id: 'target-midi', name: 'target.mid', mime: 'audio/midi', data: 'BAMCAQ==' }];
  project.midi = { schema: 1, format: 1, sourceAssetId: 'target-midi', conductor: [] };
  return project;
}
function fixture(initial = sourceProject()) {
  const projectRef = { current: initial }, savedSnapshot = { current: initial as Project | undefined }, numberEditOwner = { current: { project: initial, generation: 0 } };
  const history = { current: [] as Entry[] }, future = { current: [] as Entry[] };
  const state = { selectedTrack: initial.regions[0]?.trackId ?? initial.tracks[0]?.id ?? '', selectedRegion: initial.regions[0]?.id ?? '',
    selectedRegions: new Set(initial.regions[0] ? [initial.regions[0].id] : []), selectedNotes: new Set<string>(), focus: 'arrangement' as EditorSelection['focus'],
    instrumentFilter: '', dirty: false, revision: 0, clipboardRevision: 0, message: '', editorDocumentKey: 1, hasNumberDraft: false };
  const selectedRegionsRef = { current: state.selectedRegions }, instrumentFilterRef = { current: '' };
  const clipboard = { current: undefined as NoteClipboard | undefined }, regionClipboard = { current: undefined as RegionClipboard | undefined }, lastClipboardKind = { current: undefined as 'notes' | 'regions' | undefined };
  const liveClipboardTarget: { current: unknown } = { current: undefined }, liveNumberContext = { current: '' }, numberDrafts = { current: new Set<string>() }, positionRef = { current: 0 };
  const engine = { loadProjectSamples: vi.fn(async (_project: Project) => {}) }, stop = vi.fn(), finishHeld = { current: vi.fn() }, preferences = { snap: 16 };
  const hooks: { flush(): boolean; copiedNote?(): void; copiedRegion?(): void; pastedRegion?(): void; pastedNote?(): void } = { flush: () => true };
  const flushActiveNumberInput = vi.fn(() => hooks.flush());
  const set = <K extends keyof typeof state>(key: K) => (value: typeof state[K] | ((old: typeof state[K]) => typeof state[K])) => { state[key] = typeof value === 'function' ? (value as (old: typeof state[K]) => typeof state[K])(state[key]) : value; };
  function render(): Api {
    const project = projectRef.current, { track, region, pattern, notes: selected } = resolveEditorSelection(project, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
    const clipboardTarget = { documentKey: state.editorDocumentKey, focus: state.focus, trackId: state.selectedTrack, regionId: state.selectedRegion, regions: state.selectedRegions, notes: state.selectedNotes, filter: state.instrumentFilter };
    liveClipboardTarget.current = clipboardTarget; selectedRegionsRef.current = state.selectedRegions; instrumentFilterRef.current = state.instrumentFilter;
    const numberGeneration = numberEditOwner.current.generation;
    const numberContext = Function('editorDocumentKey', 'project', 'numberGeneration', 'region', 'pattern', 'selectedNotes', `return ${numberContextCode}`)(state.editorDocumentKey, project, numberGeneration, region, pattern, state.selectedNotes) as string;
    liveNumberContext.current = numberContext;
    const scope = { recordDiagnostic: () => {}, audioDiagnosticSnapshot: () => ({}), signalLogged: { current: false }, project, projectRef, savedSnapshot, numberEditOwner, numberGeneration, ...state, history, future, selectedRegionsRef, instrumentFilterRef,
      clipboard, regionClipboard, lastClipboardKind, liveClipboardTarget, clipboardTarget, liveNumberContext, numberContext, numberDrafts,
      track, region, pattern, selected, positionRef, preferences, meterMap: createMeterMap(project), sourceOrigin: region && pattern ? patternOrigin(region, pattern) : 0,
      produce, normalizeEditorSelection, resolveEditorSelection, createMeterMap, patternOrigin, patternTickAt, createProject, newNote, newTrack, uid,
      canCopyNotes, canCutNotes, canPasteNotes, canEditSelectedNotes, changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, trimRegion,
      MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError, applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup, moveRegion, filterTracks,
      createNoteClipboard: (...args: Parameters<typeof createNoteClipboard>) => { const value = createNoteClipboard(...args); hooks.copiedNote?.(); return value; },
      planNotePaste: (...args: Parameters<typeof planNotePaste>) => { const value = planNotePaste(...args); hooks.pastedNote?.(); return value; },
      createRegionClipboard: (...args: Parameters<typeof createRegionClipboard>) => { const value = createRegionClipboard(...args); hooks.copiedRegion?.(); return value; },
      planRegionPaste: (...args: Parameters<typeof planRegionPaste>) => { const value = planRegionPaste(...args); hooks.pastedRegion?.(); return value; },
      setProject: vi.fn(), setSelectedTrack: set('selectedTrack'), setSelectedRegion: set('selectedRegion'), setSelectedRegions: set('selectedRegions'), setSelectedNotes: set('selectedNotes'),
      setFocus: set('focus'), setInstrumentFilter: set('instrumentFilter'), setDirty: set('dirty'), setRevision: set('revision'), setMessage: set('message'), setClipboardRevision: set('clipboardRevision'),
      setHasNumberDraft: set('hasNumberDraft'), setEditorDocumentKey: set('editorDocumentKey'), engine, stop, finishHeld, playbackMode: 'realtime', flushActiveNumberInput,
      flpOpenTicket: { current: 0 }, setFlpImport: vi.fn(), setModal: vi.fn(), setPianoViewRequest: vi.fn(), library: undefined,
      setFilePath: vi.fn(), setImportDiagnostics: vi.fn(), seek: vi.fn(), window: {},
    };
    const api = Function(...Object.keys(scope), `${callbacks}\nreturn {${exports}};`)(...Object.values(scope)) as Api;
    const regionGroupIssue = api.regionGroupProblem(project, state.selectedRegions, state.instrumentFilter), regionCopyIssue = api.regionGroupProblem(project, state.selectedRegions, state.instrumentFilter, true);
    const regionPasteTargetIssue = track?.locked ? '目标轨道已锁定' : state.instrumentFilter && track && track.instrumentId !== state.instrumentFilter ? '目标轨道被筛选隐藏' : '';
    const uiScope = { ...scope, ...api, bindings: {}, visibleRegionIds: new Set(), canEditSelection: state.focus === 'piano' && canEditSelectedNotes(track, pattern, state.selectedNotes),
      regionGroupIssue, regionCopyIssue, regionSplitIssue: api.regionSplitProblem(project, state.selectedRegions, state.instrumentFilter, positionRef.current), regionPasteTargetIssue, canPasteRegionSelection: lastClipboardKind.current === 'regions' && !!regionClipboard.current?.regions.length && !regionPasteTargetIssue,
      element: (_type: unknown, props: unknown) => ({ props }) };
    api.menu = () => Function(...Object.keys(uiScope), menuCode)(...Object.values(uiScope));
    api.pasteButton = () => Function(...Object.keys(uiScope), pasteButton)(...Object.values(uiScope));
    return api;
  }
  const group = (ids = ['region-a', 'region-b'], primary = 'region-b') => render().selectRegionGroup(new Set(ids), primary);
  const open = (project: Project) => { render().adopt(project); render(); };
  const piano = (id = 'region-a', notes = ['note-a']) => { render().selectRegion(projectRef.current.regions.find(region => region.id === id)!); state.focus = 'piano'; state.selectedNotes = new Set(notes); return render(); };
  return { initial, projectRef, savedSnapshot, numberEditOwner, history, future, state, selectedRegionsRef, instrumentFilterRef, clipboard, regionClipboard, lastClipboardKind,
    engine, stop, finishHeld, hooks, flushActiveNumberInput, numberDrafts, positionRef, preferences, liveClipboardTarget, render, group, open, piano };
}
const withoutModified = (project: Project) => { const result = structuredClone(project); delete (result as Partial<Project>).modifiedAt; return result; };
const roundtrip = (project: Project) => expect(withoutModified(openNbsx(saveNbsx(project)))).toEqual(withoutModified(project));
const menuItem = (api: Api, command: string) => api.menu().items.find(item => item.command === command)!;

describe('Actual App region clipboard, transactional history and complete persistence', () => {
  it('copies a locked group read-only without changing primary, redo, dirty or transport and refreshes the rendered clipboard menu', () => {
    const t = fixture(); t.initial.tracks[2].locked = true; t.group();
    t.future.current.push({ label: 'retained redo', project: t.initial, selection: t.render().selectionSnapshot() });
    const redo = t.future.current, selected = t.render().selectionSnapshot(), baseline = structuredClone(t.initial);
    expect(menuItem(t.render(), 'copy')).toMatchObject({ label: '复制片段', disabled: false });
    expect(menuItem(t.render(), 'cut').disabled).toBe(true);
    expect(t.render().copySelection()).toBe(true);
    expect(t.projectRef.current).toBe(t.initial); expect(t.initial).toEqual(baseline); expect(t.history.current).toEqual([]); expect(t.future.current).toBe(redo);
    expect(t.state.dirty).toBe(false); expect(t.render().selectionSnapshot()).toEqual(selected); expect(t.state.clipboardRevision).toBe(1);
    expect(t.regionClipboard.current?.patterns[0].notes).toEqual(t.initial.patterns[0].notes); expect(t.regionClipboard.current?.patterns[0]).not.toBe(t.initial.patterns[0]);
    expect(t.render().pasteButton().props.disabled).toBe(true); // selected primary is on a locked target
    expect(t.stop).not.toHaveBeenCalled(); expect(t.finishHeld.current).not.toHaveBeenCalled();
  });

  it('cuts after a complete snapshot and restores the full group/source/selection with one Undo and Redo', () => {
    const t = fixture(); t.group(); const before = structuredClone(t.initial), selected = t.render().selectionSnapshot();
    t.render().cutSelection(); expect(t.projectRef.current.regions).toEqual([]); expect(t.projectRef.current.patterns).toEqual([]); expect(t.projectRef.current.assets).toEqual(before.assets);
    expect(t.history.current).toHaveLength(1); expect(t.state.selectedRegions.size).toBe(0); expect(t.state.selectedRegion).toBe(''); expect(t.lastClipboardKind.current).toBe('regions');
    expect(t.regionClipboard.current?.regions).toEqual(before.regions); expect(t.regionClipboard.current?.patterns).toEqual(before.patterns); roundtrip(t.projectRef.current);
    const clip = t.regionClipboard.current, cut = t.projectRef.current;
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.render().selectionSnapshot()).toEqual(selected); expect(t.regionClipboard.current).toBe(clip); roundtrip(t.projectRef.current);
    t.render().redo(); expect(t.projectRef.current).toBe(cut); expect(t.state.selectedRegions.size).toBe(0); expect(t.regionClipboard.current).toBe(clip);
  });

  it('pastes a cross-document PPQ group, gap tracks, custom collision and full MIDI source in one transaction, with a stable top-row primary', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const source = structuredClone(t.initial), target = targetProject(), before = structuredClone(target);
    t.open(target); t.positionRef.current = 3839; t.render().pasteSelection();
    const next = t.projectRef.current, clips = next.regions.slice(1), patterns = clips.map(region => next.patterns.find(pattern => pattern.id === region.patternId)!);
    expect(clips.map(({ start, length, offset, loop }) => [start, length, offset, loop])).toEqual([[3840, 1920, 240, false], [6720, 2880, 480, true]]);
    expect(patterns.map(pattern => [pattern.length, pattern.notes.map(note => [note.tick, note.duration, note.midi])])).toEqual([[2880, [[0, 480, 54], [480, 720, 60], [2400, 240, 72]]], [1920, [[480, 240, 67]]]]);
    expect(patterns[0].notes[1]).toMatchObject({ velocity: .75, pan: -.2, detune: 12.5, height: .5, midiSource: { onOrder: 2, offOrder: 7, releaseVelocity: 43 } });
    expect(patterns[0].notes[1].midiSource).not.toHaveProperty('offSourceTrack');
    expect(patterns[0].midiEvents![0]).toMatchObject({ tick: 720, order: 3, sourceTrack: 7, event: { deltaTime: 0, type: 'sysEx', data: [126, 127, 9, 1, 247] } });
    expect(next.tracks[0]).toEqual(before.tracks[0]); expect(next.tracks.slice(1).map(track => [track.name, track.locked, track.sourceMidiTrack])).toEqual([['Gap', false, undefined], ['Source bottom', false, undefined]]);
    expect(next.assets.slice(0, 2)).toEqual(before.assets); expect(next.midi).toEqual(before.midi); expect(next.tempos).toEqual(before.tempos); expect(next.timeSignatures).toEqual(before.timeSignatures);
    const custom = next.instruments.find(item => item.id === patterns[0].notes[1].instrumentId)!;
    expect(custom.id).not.toBe('custom'); expect(next.assets.find(item => item.id === custom.assetId)?.data).toBe(source.assets[0].data); expect(next.instruments.find(item => item.id === 'custom')).toEqual(before.instruments.find(item => item.id === 'custom'));
    expect(t.state.selectedTrack).toBe('target-track'); expect(t.state.selectedRegion).toBe(clips[0].id); expect(t.state.selectedRegions).toEqual(new Set(clips.map(region => region.id))); expect(t.state.focus).toBe('arrangement');
    expect(t.history.current).toHaveLength(1); expect(t.engine.loadProjectSamples).toHaveBeenLastCalledWith(next); roundtrip(next); expect(t.initial).toEqual(source);
    const pastedSelection = t.render().selectionSnapshot(); t.render().undo(); expect(t.projectRef.current).toBe(target); expect(t.state.selectedRegion).toBe(target.regions[0].id);
    t.render().redo(); expect(t.projectRef.current).toBe(next); expect(t.render().selectionSnapshot()).toEqual(pastedSelection); roundtrip(next);
    t.render().pasteSelection(); expect(t.projectRef.current.regions.slice(3).map(region => region.trackId)).toEqual([next.tracks[0].id, next.tracks[2].id]); expect(t.state.selectedTrack).toBe('target-track');
  });

  it('can paste into an empty project, retains the current filter and exposes newly hidden selections without editing hidden existing targets', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const target = targetProject(); target.tracks = []; target.patterns = []; target.regions = [];
    t.open(target); t.render().filterInstruments('harp'); t.render().pasteSelection();
    expect(t.projectRef.current.tracks).toHaveLength(3); expect(t.state.instrumentFilter).toBe('harp'); expect(t.state.selectedRegions.size).toBe(2); expect(t.state.message).toContain('显示全部所选'); roundtrip(t.projectRef.current);
    const before = t.projectRef.current, history = t.history.current.length, clip = t.regionClipboard.current;
    expect(menuItem(t.render(), 'copy').disabled).toBe(true); t.render().copySelection(); t.render().cutSelection(); t.render().pasteSelection();
    expect(t.projectRef.current).toBe(before); expect(t.history.current).toHaveLength(history); expect(t.regionClipboard.current).toBe(clip);
    t.render().filterInstruments(''); expect(t.projectRef.current).toBe(before); expect(t.state.selectedRegions.size).toBe(2);
  });

  it('appends a substantial shared-source selection without argument spreading or changing original instances', () => {
    const initial = sourceProject(); initial.tracks = initial.tracks.slice(0, 1); initial.patterns = initial.patterns.slice(0, 1);
    initial.regions = Array.from({ length: 1024 }, (_, i) => ({ id: `many-${i}`, trackId: initial.tracks[0].id, patternId: 'pattern-a', start: i * 120, offset: 120, length: 240, loop: false }));
    const t = fixture(initial), baseline = structuredClone(initial); t.group(initial.regions.map(region => region.id), 'many-1023');
    expect(t.render().copySelection()).toBe(true); t.positionRef.current = 122880; t.render().pasteSelection();
    const next = t.projectRef.current, copies = next.regions.slice(1024);
    expect(next.regions.slice(0, 1024)).toEqual(baseline.regions); expect(copies.map(region => [region.start, region.offset, region.length])).toEqual(Array.from({ length: 1024 }, (_, i) => [122880 + 120 * i, 120, 240]));
    expect(new Set(copies.map(region => region.patternId)).size).toBe(1024); expect(next.patterns).toHaveLength(1025); expect(t.history.current).toHaveLength(1); expect(t.state.selectedRegion).toBe(copies[0].id);
    expect(next.assets).toEqual(baseline.assets); expect(next.midi).toEqual(baseline.midi); roundtrip(next);
    expect(section("      commit('粘贴片段'", '\n      if (projectRef.current === target.snapshot)')).not.toContain('.push(...');
  });

  it('rejects hidden copy/cut, locked cut/target and snapshot errors atomically, retaining the old clipboard and redo', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const old = t.regionClipboard.current;
    t.render().commit('redo marker', p => { p.author = 'Changed'; }); t.render().undo(); const redo = t.future.current, before = t.projectRef.current;
    t.render().filterInstruments('bass'); // both selected rows are bass, so the gap is irrelevant
    expect(t.render().copySelection()).toBe(true);
    t.render().filterInstruments('harp'); t.render().copySelection(); t.render().cutSelection(); expect(t.state.message).toContain('隐藏');
    t.render().filterInstruments(''); t.render().commit('lock', p => { p.tracks[2].locked = true; });
    const locked = t.projectRef.current; t.render().cutSelection(); t.render().pasteSelection(); expect(t.projectRef.current).toBe(locked); expect(t.state.message).toMatch(/锁定/);
    t.render().undo(); expect(t.projectRef.current).toBe(before); const future = t.future.current, clip = t.regionClipboard.current;
    t.hooks.copiedRegion = () => { throw new Error('explicit snapshot failure'); }; t.render().cutSelection();
    expect(t.projectRef.current).toBe(before); expect(t.future.current).toBe(future); expect(t.regionClipboard.current).toBe(clip); expect(t.lastClipboardKind.current).toBe('regions'); expect(t.state.message).toContain('snapshot failure');
    expect(old?.regions).toEqual(t.regionClipboard.current?.regions); expect(redo).toHaveLength(1);
  });
});

describe('Actual App note/region domain, live numeric flush and stale callback guards', () => {
  it('replaces the other clipboard only after successful copy, rejects wrong-domain paste, and keeps read-only copy out of history', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const before = t.projectRef.current;
    t.piano(); expect(menuItem(t.render(), 'paste').disabled).toBe(true); t.render().pasteSelection(); expect(t.state.message).toContain('编曲区'); expect(t.projectRef.current).toBe(before);
    expect(t.render().copySelection()).toBe(true); expect(t.regionClipboard.current).toBeUndefined(); expect(t.clipboard.current?.notes).toHaveLength(1); expect(t.lastClipboardKind.current).toBe('notes');
    t.state.focus = 'arrangement'; expect(menuItem(t.render(), 'paste').disabled).toBe(true); t.render().pasteSelection(); expect(t.state.message).toContain('钢琴'); expect(t.projectRef.current).toBe(before);
    t.group(); expect(t.render().copySelection()).toBe(true); expect(t.clipboard.current).toBeUndefined(); expect(t.lastClipboardKind.current).toBe('regions'); expect(t.history.current).toEqual([]); expect(t.state.dirty).toBe(false);
  });

  it('a successful piano cut replaces the region snapshot only after deletion and remains one reversible note transaction', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const snapshot = t.regionClipboard.current;
    t.piano(); const before = t.render().selectionSnapshot(); t.render().cutSelection();
    expect(t.projectRef.current.patterns[0].notes.map(note => note.id)).toEqual(['before-crop', 'after-crop']);
    expect(t.clipboard.current?.notes[0]).toMatchObject({ id: 'note-a', velocity: .75, duration: 360 }); expect(t.regionClipboard.current).toBeUndefined(); expect(t.lastClipboardKind.current).toBe('notes');
    expect(t.history.current).toHaveLength(1); expect(t.state.selectedNotes.size).toBe(0); roundtrip(t.projectRef.current);
    t.render().undo(); expect(t.projectRef.current).toBe(t.initial); expect(t.render().selectionSnapshot()).toEqual(before); expect(t.lastClipboardKind.current).toBe('notes'); expect(t.regionClipboard.current).not.toBe(snapshot);
  });

  it('invalid numeric drafts block all six domain commands without clearing clipboard, selection, project or redo', () => {
    const t = fixture(); t.group(); t.render().copySelection(); t.render().commit('future', p => { p.author = 'Marker'; }); t.render().undo();
    const old = t.regionClipboard.current, redo = t.future.current, before = t.projectRef.current;
    t.numberDrafts.current.add('velocity'); t.hooks.flush = () => false;
    for (const focus of ['arrangement', 'piano'] as const) {
      t.state.focus = focus; t.state.selectedNotes = new Set(['note-b']);
      for (const command of ['copySelection', 'cutSelection', 'pasteSelection'] as const) t.render()[command]();
    }
    expect(t.projectRef.current).toBe(before); expect(t.future.current).toBe(redo); expect(t.history.current).toEqual([]); expect(t.regionClipboard.current).toBe(old); expect(t.clipboard.current).toBeUndefined(); expect(t.lastClipboardKind.current).toBe('regions');
    expect(t.state.message).toContain('数字'); expect(t.state.selectedRegions).toEqual(new Set(['region-a', 'region-b']));
  });

  it('uses the post-flush note data for piano and region copy, including a numeric commit in the same callback', () => {
    const t = fixture(); const api = t.piano(); api.setNumberPending('velocity', true);
    t.hooks.flush = () => { api.commitNoteNumber({ velocity: .25 }); api.setNumberPending('velocity', false); return true; };
    expect(api.copySelection()).toBe(true); expect(t.clipboard.current?.notes[0].velocity).toBe(.25); expect(t.projectRef.current.patterns[0].notes[1].velocity).toBe(.25); expect(t.history.current).toHaveLength(1);
    t.hooks.flush = () => true; t.group(); const regionApi = t.render(); regionApi.setNumberPending('length', true);
    t.hooks.flush = () => { regionApi.commit('valid number boundary', p => { p.regions[0].offset = 240; p.tempos = [{ tick: 0, bpm: 87.5 }]; }); regionApi.setNumberPending('length', false); return true; };
    expect(regionApi.copySelection()).toBe(true); expect(t.regionClipboard.current?.regions[0].offset).toBe(240); expect(t.regionClipboard.current?.patterns[0].notes[1].velocity).toBe(.25);
  });

  it('piano paste recomputes the live primary/offset, source origin, PPQ and meter after a valid flush', () => {
    const t = fixture(); t.piano().copySelection(); const copied = t.clipboard.current!.notes[0]; expect(copied.tick).toBe(240);
    t.positionRef.current = 650; const api = t.render(); api.setNumberPending('number', true);
    t.hooks.flush = () => { api.commit('valid number boundary', p => { p.ppq = 960; p.regions[0].offset = 240; p.tempos = [{ tick: 0, bpm: 90 }]; p.timeSignatures = [{ tick: 0, numerator: 3, denominator: 8 }, { tick: 600, numerator: 5, denominator: 8 }]; }); api.setNumberPending('number', false); return true; };
    api.pasteSelection(); const next = t.projectRef.current, added = next.patterns[0].notes.at(-1)!;
    // Source at head=650-480+240=410, live origin=480-240=240.
    // New meter bar starts at 600; a 240-tick grid snaps project 650 to 600.
    expect(added).toMatchObject({ tick: 360, duration: 720, velocity: .75, pan: -.2, detune: 12.5, height: .5 }); expect(added.id).not.toBe(copied.id);
    expect(next.patterns[0].notes.slice(0, 3)).toEqual(t.initial.patterns[0].notes); expect(t.state.focus).toBe('piano'); roundtrip(next);
  });

  it('region paste snaps against post-flush meter geometry and keeps failed locked piano cut from replacing old content', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const oldRegions = t.regionClipboard.current;
    t.open(targetProject()); const api = t.render(); t.positionRef.current = 650; api.setNumberPending('number', true);
    t.hooks.flush = () => { api.commit('numeric boundary', p => { p.timeSignatures = [{ tick: 0, numerator: 3, denominator: 8 }, { tick: 600, numerator: 5, denominator: 8 }]; }); api.setNumberPending('number', false); return true; };
    api.pasteSelection(); expect(t.projectRef.current.regions.at(-2)?.start).toBe(600);
    t.hooks.flush = () => true; t.open(sourceProject()); t.piano(); t.render().commit('lock source', p => { p.tracks[0].locked = true; });
    t.render().cutSelection(); expect(t.regionClipboard.current).toBe(oldRegions); expect(t.clipboard.current).toBeUndefined(); expect(t.lastClipboardKind.current).toBe('regions');
  });

  it('rejects stale project/generation, selected group, filter and same-ID synchronous adopt without waiting for React render', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const clip = t.regionClipboard.current;
    const stale = t.render(); stale.commit('metadata', p => { p.author = 'changed'; }); stale.copySelection(); expect(t.regionClipboard.current).toBe(clip);
    t.render().undo(); const redo = t.future.current; stale.copySelection(); expect(t.regionClipboard.current).toBe(clip); expect(t.future.current).toBe(redo);
    const oldGroup = t.render(); t.render().selectRegionGroup(new Set(['region-a']), 'region-a'); oldGroup.cutSelection(); expect(t.projectRef.current).toBe(t.initial);
    const oldFilter = t.render(); t.render().filterInstruments('harp'); oldFilter.copySelection(); expect(t.regionClipboard.current).toBe(clip);
    t.render().filterInstruments(''); const api = t.render(), reopen = structuredClone(t.initial); reopen.patterns[0].notes[1].velocity = .1;
    t.hooks.flush = () => { api.adopt(reopen); return true; }; expect(api.copySelection()).toBe(false);
    expect(t.projectRef.current).toBe(reopen); expect(t.regionClipboard.current).toBe(clip); expect(t.liveClipboardTarget.current).toBeUndefined(); expect(t.history.current).toEqual([]); expect(t.state.message).toContain('已更改');
  });

  it('rejects a previously rendered piano note selection or primary after the target changes, without consuming redo', () => {
    const t = fixture(); t.piano().copySelection(); const notes = t.clipboard.current;
    t.render().commit('future', p => { p.author = 'future'; }); t.render().undo(); const redo = t.future.current;
    const staleNotes = t.render(); t.state.selectedNotes = new Set(['before-crop']); t.render(); staleNotes.copySelection(); staleNotes.cutSelection(); staleNotes.pasteSelection();
    expect(t.clipboard.current).toBe(notes); expect(t.projectRef.current).toBe(t.initial); expect(t.future.current).toBe(redo);
    const stalePrimary = t.render(); t.piano('region-b', ['note-b']); stalePrimary.copySelection(); stalePrimary.cutSelection(); stalePrimary.pasteSelection();
    expect(t.clipboard.current).toBe(notes); expect(t.projectRef.current).toBe(t.initial); expect(t.future.current).toBe(redo); expect(t.state.message).toContain('已更改');
  });

  it('rejects re-entry after snapshot/plan without replacing clipboard or applying partial changes, including note cut', () => {
    const t = fixture(); t.group(); t.render().copySelection(); const old = t.regionClipboard.current;
    t.hooks.copiedRegion = () => { t.instrumentFilterRef.current = 'harp'; }; t.render().copySelection(); expect(t.regionClipboard.current).toBe(old);
    t.hooks.copiedRegion = undefined; t.render(); t.hooks.pastedRegion = () => { t.numberEditOwner.current = { ...t.numberEditOwner.current, generation: t.numberEditOwner.current.generation + 1 }; };
    const before = t.projectRef.current; t.render().pasteSelection(); expect(t.projectRef.current).toBe(before); expect(t.history.current).toEqual([]);
    t.hooks.pastedRegion = undefined; t.piano(); t.hooks.copiedNote = () => { t.numberEditOwner.current = { ...t.numberEditOwner.current, generation: t.numberEditOwner.current.generation + 1 }; };
    t.render().cutSelection(); expect(t.projectRef.current).toBe(before); expect(t.regionClipboard.current).toBe(old); expect(t.clipboard.current).toBeUndefined(); expect(t.lastClipboardKind.current).toBe('regions');
  });

  it('ignores delayed pasted-sample failures after another project is adopted, without stopping the transport', async () => {
    const t = fixture(); t.group(); t.render().copySelection(); t.open(targetProject());
    let reject!: (error: Error) => void; t.engine.loadProjectSamples.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    t.render().pasteSelection(); const other = createProject('Later project'); t.open(other); const message = t.state.message;
    reject(new Error('old sample failed')); await Promise.resolve(); await Promise.resolve(); expect(t.state.message).toBe(message); expect(t.projectRef.current).toBe(other);
    expect(t.stop).toHaveBeenCalledTimes(2); // only the two deliberate document adoptions
  });

  it('wires actual rendered menus and native command dispatch to domain wrappers, leaving text-input routing ahead of commands', () => {
    expect(commandBindings).toContain('copy: copySelection'); expect(commandBindings).toContain('cut: cutSelection'); expect(commandBindings).toContain('paste: pasteSelection');
    const t = fixture(); t.group(); expect(menuItem(t.render(), 'copy').label).toBe('复制片段'); expect(t.render().pasteButton().props.disabled).toBe(true);
    t.render().copySelection(); expect(t.render().pasteButton().props.disabled).toBe(false); t.piano(); expect(menuItem(t.render(), 'copy').label).toBe('复制音符');
    const native = section('    const off = window.desktop?.onMenu', '\n    const offOpen');
    expect(native.indexOf('document.execCommand')).toBeLessThan(native.indexOf('commands.current[command]?.()'));
    expect(section('    const onKeyDown =', '\n    const onKeyUp =')).toContain('if (isShortcutInput(event.target)) return;');
  });
});
