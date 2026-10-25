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
import { createProject, newNote, newTrack, uid } from '../src/core/project';
import { moveRegion } from '../src/core/region-transfer';
import { filterTracks } from '../src/core/track-filter';
import { inspectTrackMove, moveTrackInView, inspectTrackDelete, deleteTrack, allocateTrackMidiChannel } from '../src/core/track-management';
import type { Note, Project, Track } from '../src/core/types';

// Actual App callbacks/history/selection/number functions and rendered controls,
// with real Immer, track operations and complete NBSX serialization. Hooks,
// numeric flush and engine are inert boundaries; no GUI/keyboard/audio claim.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`Track App boundary missing: ${from}`);
  return source.slice(start, end);
}
const callbacks = transformSync([
  section('  const selectionSnapshot =', '\n  const changeTrack ='),
  section('  function filterInstruments(', '\n  function selectMixerTrack('),
  section('  const changeRegion =', '\n  function moveNoteSelection('),
  section('  function adopt(', '\n  async function openBytes('),
  section('  function undo()', '\n  function changeExportOptions('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const numberContextCode = section('  const numberContext = ', '\n  const liveNumberContext').slice('  const numberContext = '.length);
const trackMenu = transformSync(`return ${section("    { label: '轨道',", "\n    { label: '播放',").trim().replace(/,$/, '')};`, { loader: 'ts' }).code;
function control(label: string) {
  const at = source.indexOf(`<button aria-label="${label}"`), end = source.indexOf('</button>', at);
  if (at < 0 || end < 0) throw new Error(`Track control missing: ${label}`);
  return transformSync(`return ${source.slice(at, end + 9)};`, { loader: 'tsx', jsxFactory: 'element' }).code;
}
const controls = { up: control('上移当前轨道'), down: control('下移当前轨道'), remove: control('删除当前轨道') };
type Status = { hidden: boolean; upIssue: string; downIssue: string; deleteIssue: string; deleteDescription: string };
interface Api {
  addTrack(): void; moveCurrentTrack(direction: -1 | 1): void; deleteCurrentTrack(): void;
  trackControlState(project: Project, id: string, filter: string): Status;
  selectRegionGroup(ids: Set<string>, primary?: string): void; selectTrack(track: Track): void; filterInstruments(value: string): void;
  selectionSnapshot(project?: Project): EditorSelection; commit(label: string, change: (project: Project) => void, preserve?: boolean): void;
  setNumberPending(field: string, pending: boolean): void; commitNoteNumber(patch: Partial<Note>): boolean | void;
  undo(): void; redo(): void; adopt(project: Project): void;
  menu(): { items: { command: string; label: string; disabled?: boolean }[] };
  control(name: keyof typeof controls): { props: { disabled: boolean; title: string; onClick(): void } };
}
interface Entry { label: string; project: Project; selection: EditorSelection }
function projectFixture() {
  const project = createProject('Track management'); project.ppq = 480;
  project.tracks = Array.from({ length: 5 }, (_, i) => ({ ...newTrack(`Track ${i}`, i, i % 2 ? 'bass' : 'harp'), id: `track-${i}`, volume: .5 + i / 10, pan: (i - 2) / 10, sourceMidiTrack: i + 10 }));
  project.patterns = project.tracks.map((track, i) => ({ id: `pattern-${i}`, name: `Source ${i}`, length: 960,
    notes: [{ ...newNote(120, 60 + i, 720), id: `note-${i}`, velocity: .75, detune: 12.5, pan: -.2, height: .5, ...(i === 2 ? { instrumentId: 'flute' } : {}), midiSource: { onOrder: 3, offOrder: 7, releaseVelocity: 43, offSourceTrack: i + 10 } }],
    midiEvents: [{ id: `event-${i}`, tick: 240, order: 4, sourceTrack: i + 10, event: { deltaTime: 0 as const, type: 'sysEx' as const, data: [126, i, 9, 1, 247] } }] }));
  project.regions = project.tracks.map((track, i) => ({ id: `region-${i}`, trackId: track.id, patternId: `pattern-${i}`, start: i * 240, offset: 60, length: 720, loop: i % 2 === 0 }));
  project.assets = [{ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }, { id: 'portable', name: 'sample.wav', mime: 'audio/wav', data: 'AQID' }];
  project.instruments = project.instruments.map(instrument => instrument.id === 'flute' ? { ...instrument, assetId: 'portable' } : instrument);
  project.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', conductor: [{ id: 'text', tick: 0, order: 0, event: { deltaTime: 0, type: 'text', text: 'Keep original source' } }] };
  return project;
}
function fixture(project = projectFixture()) {
  const projectRef = { current: project }, savedSnapshot = { current: project as Project | undefined }, numberEditOwner = { current: { project, generation: 0 } };
  const history = { current: [] as Entry[] }, future = { current: [] as Entry[] };
  const state = { selectedTrack: project.tracks[2]?.id ?? project.tracks[0]?.id ?? '', selectedRegion: project.regions[2]?.id ?? project.regions[0]?.id ?? '',
    selectedRegions: new Set([project.regions[2]?.id ?? project.regions[0]?.id].filter((id): id is string => !!id)), selectedNotes: new Set<string>(),
    focus: 'arrangement' as EditorSelection['focus'], instrumentFilter: '', editorDocumentKey: 1, dirty: false, revision: 0, message: '', hasNumberDraft: false };
  const selectedRegionsRef = { current: state.selectedRegions }, instrumentFilterRef = { current: '' }, liveClipboardTarget: { current: unknown } = { current: undefined };
  const liveNumberContext = { current: '' }, numberDrafts = { current: new Set<string>() };
  const engine = { loadProjectSamples: vi.fn(async () => {}) }, stop = vi.fn(), finishHeld = { current: vi.fn() };
  const hooks: { flush(): boolean; inspected?(): void; noMove?: boolean; noDelete?: boolean; inspectionError?: string } = { flush: () => true };
  const flushActiveNumberInput = vi.fn(() => hooks.flush());
  const inspectMove = vi.fn((...args: Parameters<typeof inspectTrackMove>) => { const result = hooks.inspectionError ? { ok: false as const, reason: hooks.inspectionError } : inspectTrackMove(...args); hooks.inspected?.(); return result; });
  const inspectDelete = vi.fn((...args: Parameters<typeof inspectTrackDelete>) => { const result = hooks.inspectionError ? { ok: false as const, reason: hooks.inspectionError } : inspectTrackDelete(...args); hooks.inspected?.(); return result; });
  const move = vi.fn((...args: Parameters<typeof moveTrackInView>) => hooks.noMove ? false : moveTrackInView(...args));
  const remove = vi.fn((...args: Parameters<typeof deleteTrack>) => hooks.noDelete ? undefined : deleteTrack(...args));
  const allocate = vi.fn(allocateTrackMidiChannel);
  const set = <K extends keyof typeof state>(key: K) => (value: typeof state[K] | ((old: typeof state[K]) => typeof state[K])) => { state[key] = typeof value === 'function' ? (value as (old: typeof state[K]) => typeof state[K])(state[key]) : value; };
  function render(): Api {
    const project = projectRef.current, { track, region, pattern, notes: selected } = resolveEditorSelection(project, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
    const clipboardTarget = { documentKey: state.editorDocumentKey, focus: state.focus, trackId: state.selectedTrack, regionId: state.selectedRegion, regions: state.selectedRegions, notes: state.selectedNotes, filter: state.instrumentFilter };
    liveClipboardTarget.current = clipboardTarget; selectedRegionsRef.current = state.selectedRegions; instrumentFilterRef.current = state.instrumentFilter;
    const numberGeneration = numberEditOwner.current.generation;
    const numberContext = Function('editorDocumentKey', 'project', 'numberGeneration', 'region', 'pattern', 'selectedNotes', `return ${numberContextCode}`)(state.editorDocumentKey, project, numberGeneration, region, pattern, state.selectedNotes) as string; liveNumberContext.current = numberContext;
    const scope = { ...state, project, projectRef, savedSnapshot, numberEditOwner, numberGeneration, numberContext, liveNumberContext, numberDrafts, track, region, pattern, selected,
      selectedRegionsRef, instrumentFilterRef, liveClipboardTarget, clipboardTarget, history, future, produce, normalizeEditorSelection, resolveEditorSelection, createMeterMap, patternOrigin,
      filterTracks, uid, newNote, newTrack, changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, trimRegion, moveRegion, MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError,
      inspectTrackMove: inspectMove, moveTrackInView: move, inspectTrackDelete: inspectDelete, deleteTrack: remove, allocateTrackMidiChannel: allocate,
      engine, stop, finishHeld, playbackMode: 'realtime', flushActiveNumberInput, setProject: vi.fn(), setSelectedTrack: set('selectedTrack'), setSelectedRegion: set('selectedRegion'), setSelectedRegions: set('selectedRegions'),
      setSelectedNotes: set('selectedNotes'), setFocus: set('focus'), setInstrumentFilter: set('instrumentFilter'), setDirty: set('dirty'), setRevision: set('revision'), setMessage: set('message'), setHasNumberDraft: set('hasNumberDraft'), setEditorDocumentKey: set('editorDocumentKey'),
      flpOpenTicket: { current: 0 }, setFlpImport: vi.fn(), setModal: vi.fn(), setPianoViewRequest: vi.fn(), library: undefined, setFilePath: vi.fn(), setImportDiagnostics: vi.fn(), seek: vi.fn(), window: {},
    };
    const api = Function(...Object.keys(scope), `${callbacks}\nreturn {addTrack,moveCurrentTrack,deleteCurrentTrack,trackControlState,selectRegionGroup,selectTrack,filterInstruments,selectionSnapshot,commit,setNumberPending,commitNoteNumber,undo,redo,adopt};`)(...Object.values(scope)) as Api;
    const ui = { ...scope, ...api, bindings: {}, trackManagement: api.trackControlState(project, state.selectedTrack, state.instrumentFilter), element: (_type: unknown, props: unknown) => ({ props }) };
    api.menu = () => Function(...Object.keys(ui), trackMenu)(...Object.values(ui)); api.control = name => Function(...Object.keys(ui), controls[name])(...Object.values(ui));
    return api;
  }
  const group = (ids = ['region-0', 'region-2', 'region-4'], primary = 'region-2') => render().selectRegionGroup(new Set(ids), primary);
  const redoMarker = () => { render().commit('future', p => { p.author = 'future'; }); render().undo(); };
  return { project, projectRef, savedSnapshot, numberEditOwner, history, future, state, selectedRegionsRef, instrumentFilterRef, liveClipboardTarget, numberDrafts,
    engine, stop, finishHeld, hooks, flushActiveNumberInput, inspectMove, inspectDelete, move, remove, allocate, render, group, redoMarker };
}
const normalized = (project: Project) => { const clone = structuredClone(project); delete (clone as Partial<Project>).modifiedAt; return clone; };
const roundtrip = (project: Project) => expect(normalized(openNbsx(saveNbsx(project)))).toEqual(normalized(project));

describe('Actual App visible-track ordering and complete historical selection', () => {
  it.each([-1, 1] as const)('swaps only visible neighbors in direction %s, retaining group/primary/notes and pinning old implicit MIDI channels', direction => {
    const t = fixture(); t.project.tracks[2].locked = true; t.project.tracks[4].locked = true; t.group(); t.state.focus = 'piano'; t.state.selectedNotes = new Set(['note-2']); t.render().filterInstruments('harp');
    const before = structuredClone(t.project), selection = t.render().selectionSnapshot(); expect(t.render().control(direction < 0 ? 'up' : 'down').props.disabled).toBe(false);
    t.render().moveCurrentTrack(direction); const next = t.projectRef.current, expected = structuredClone(before), other = direction < 0 ? 0 : 4;
    expected.tracks[2].midiChannel = 2; expected.tracks[other].midiChannel = other; [expected.tracks[2], expected.tracks[other]] = [expected.tracks[other], expected.tracks[2]];
    expect(normalized(next)).toEqual(normalized(expected)); expect(next.tracks[1]).toEqual(before.tracks[1]); expect(next.tracks[3]).toEqual(before.tracks[3]);
    expect(t.render().selectionSnapshot()).toEqual(selection); expect(t.state.instrumentFilter).toBe('harp'); expect(t.history.current).toHaveLength(1); roundtrip(next);
    expect(t.stop).not.toHaveBeenCalled(); expect(t.finishHeld.current).not.toHaveBeenCalled(); expect(t.engine.loadProjectSamples).not.toHaveBeenCalled();
    t.render().undo(); expect(t.projectRef.current).toBe(t.project); expect(t.render().selectionSnapshot()).toEqual(selection);
    t.render().redo(); expect(t.projectRef.current).toBe(next); expect(t.render().selectionSnapshot()).toEqual(selection); roundtrip(next);
  });

  it('keeps boundary, hidden and locked-delete commands out of history and preserves redo', () => {
    const t = fixture(); t.group(['region-0'], 'region-0'); t.render().filterInstruments('harp'); t.redoMarker(); const redo = t.future.current;
    expect(t.render().control('up').props.disabled).toBe(true); t.render().moveCurrentTrack(-1); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    t.group(['region-4'], 'region-4'); expect(t.render().control('down').props.disabled).toBe(true); t.render().moveCurrentTrack(1); expect(t.future.current).toBe(redo);
    t.render().filterInstruments('bass'); for (const name of ['up', 'down', 'remove'] as const) { expect(t.render().control(name).props.disabled).toBe(true); expect(t.render().control(name).props.title).toContain('隐藏'); }
    t.render().moveCurrentTrack(-1); t.render().moveCurrentTrack(1); t.render().deleteCurrentTrack(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    t.render().filterInstruments('harp'); t.render().commit('lock', p => { p.tracks[4].locked = true; }); const locked = t.projectRef.current;
    expect(t.render().control('remove').props.disabled).toBe(true); t.render().deleteCurrentTrack(); expect(t.projectRef.current).toBe(locked); expect(t.state.message).toContain('锁定');
  });

  it('deletes only the current track, preserves the surviving group and chooses its nearest visible primary in one Undo/Redo', () => {
    const t = fixture(); t.group(); t.render().filterInstruments('harp'); const before = structuredClone(t.project), selection = t.render().selectionSnapshot(); t.render().deleteCurrentTrack();
    const next = t.projectRef.current, expected = structuredClone(before); expected.tracks.splice(2, 1); expected.tracks[2].midiChannel = 3; expected.tracks[3].midiChannel = 4; expected.regions.splice(2, 1); expected.patterns.splice(2, 1);
    expect(normalized(next)).toEqual(normalized(expected)); expect(t.state.selectedRegions).toEqual(new Set(['region-0', 'region-4'])); expect(t.state.selectedRegion).toBe('region-4'); expect(t.state.selectedTrack).toBe('track-4'); expect(t.state.selectedNotes.size).toBe(0);
    expect(next.assets).toEqual(before.assets); expect(next.instruments).toEqual(before.instruments); expect(next.midi).toEqual(before.midi); expect(t.history.current).toHaveLength(1); roundtrip(next);
    const after = t.render().selectionSnapshot(); t.render().undo(); expect(t.projectRef.current).toBe(t.project); expect(t.render().selectionSnapshot()).toEqual(selection);
    t.render().redo(); expect(t.projectRef.current).toBe(next); expect(t.render().selectionSnapshot()).toEqual(after); roundtrip(next);
  });

  it('keeps shared sources and other locked/hidden selected tracks intact while deleting the one unlocked current track', () => {
    const project = projectFixture(); project.regions[2].patternId = 'pattern-0'; project.patterns.splice(2, 1); project.tracks[0].locked = true;
    const t = fixture(project); t.group(['region-0', 'region-1', 'region-2'], 'region-2'); t.render().filterInstruments('harp'); const before = structuredClone(project); t.render().deleteCurrentTrack();
    expect(t.projectRef.current.tracks.map(track => track.id)).toEqual(['track-0', 'track-1', 'track-3', 'track-4']); expect(t.projectRef.current.patterns).toEqual(before.patterns);
    expect(t.projectRef.current.regions.map(region => region.id)).toEqual(['region-0', 'region-1', 'region-3', 'region-4']); expect(t.state.selectedRegions).toEqual(new Set(['region-0', 'region-1'])); expect(t.state.selectedRegion).toBe('region-0');
    expect(t.projectRef.current.patterns[0].notes[0].midiSource).toEqual(before.patterns[0].notes[0].midiSource); roundtrip(t.projectRef.current);
  });

  it('keeps a surviving primary and its valid notes rather than replacing it with an unselected nearest region', () => {
    const t = fixture(); t.group(['region-0', 'region-2'], 'region-0'); t.state.selectedTrack = 'track-2'; t.state.selectedNotes = new Set(['note-0']); t.state.focus = 'piano';
    t.render().deleteCurrentTrack(); expect(t.state.selectedRegion).toBe('region-0'); expect(t.state.selectedTrack).toBe('track-0'); expect(t.state.selectedRegions).toEqual(new Set(['region-0'])); expect(t.state.selectedNotes).toEqual(new Set(['note-0']));
  });

  it('preserves hidden surviving group members without adding an unselected region', () => {
    const t = fixture(); t.group(['region-1', 'region-2'], 'region-2'); t.render().filterInstruments('harp'); t.render().deleteCurrentTrack();
    expect(t.state.selectedRegions).toEqual(new Set(['region-1'])); expect(t.state.selectedRegion).toBe('region-1'); expect(t.state.selectedTrack).toBe('track-1'); expect(t.state.instrumentFilter).toBe('harp'); expect(t.render().control('remove').props.title).toContain('隐藏');
  });

  it('chooses the next visible track only when the old group is empty, keeping the current filter', () => {
    const t = fixture(); t.render().filterInstruments('harp'); t.render().deleteCurrentTrack();
    expect(t.state.selectedTrack).toBe('track-4'); expect(t.state.selectedRegion).toBe('region-4'); expect(t.state.selectedRegions).toEqual(new Set(['region-4'])); expect(t.state.instrumentFilter).toBe('harp');
  });

  it('falls back to the nearest global track when the filter has no remaining visible rows, and leaves an empty nearest track empty', () => {
    const project = projectFixture(); project.tracks.forEach((track, index) => { track.instrumentId = index === 2 ? 'bass' : 'harp'; }); project.regions.splice(3, 1); project.patterns.splice(3, 1);
    const t = fixture(project); t.render().filterInstruments('bass'); t.render().deleteCurrentTrack();
    expect(t.state.instrumentFilter).toBe('bass'); expect(t.state.selectedTrack).toBe('track-3'); expect(t.state.selectedRegion).toBe(''); expect(t.state.selectedRegions.size).toBe(0); expect(t.render().control('up').props.title).toContain('隐藏'); roundtrip(t.projectRef.current);
  });

  it('allows deleting the final track and restores the complete project/selected notes through Undo', () => {
    const project = projectFixture(); project.tracks = project.tracks.slice(0, 1); project.patterns = project.patterns.slice(0, 1); project.regions = project.regions.slice(0, 1);
    const t = fixture(project); t.state.focus = 'piano'; t.state.selectedNotes = new Set(['note-0']); const selected = t.render().selectionSnapshot(), before = structuredClone(project);
    t.render().deleteCurrentTrack(); expect(t.projectRef.current.tracks).toEqual([]); expect(t.projectRef.current.regions).toEqual([]); expect(t.projectRef.current.patterns).toEqual([]); expect(t.state.selectedTrack).toBe(''); expect(t.state.selectedRegion).toBe(''); expect(t.state.selectedNotes.size).toBe(0);
    expect(t.projectRef.current.assets).toEqual(before.assets); expect(t.projectRef.current.instruments).toEqual(before.instruments); expect(t.projectRef.current.midi).toEqual(before.midi); roundtrip(t.projectRef.current);
    t.render().undo(); expect(t.projectRef.current).toBe(project); expect(t.render().selectionSnapshot()).toEqual(selected); t.render().redo(); expect(t.projectRef.current.tracks).toEqual([]);
  });
});

describe('Actual App track commands: drafts, live ownership, channel allocation and UI', () => {
  it.each(['up', 'down', 'remove', 'add'] as const)('blocks %s before inspection/allocation when a number draft is invalid', action => {
    const t = fixture(); t.redoMarker(); const redo = t.future.current, selected = t.render().selectionSnapshot(); t.numberDrafts.current.add('velocity'); t.hooks.flush = () => false;
    const api = t.render(); if (action === 'up') api.moveCurrentTrack(-1); else if (action === 'down') api.moveCurrentTrack(1); else if (action === 'remove') api.deleteCurrentTrack(); else api.addTrack();
    expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.render().selectionSnapshot()).toEqual(selected); expect(t.inspectMove).not.toHaveBeenCalled(); expect(t.inspectDelete).not.toHaveBeenCalled(); expect(t.allocate).not.toHaveBeenCalled(); expect(t.state.message).toContain('数字');
  });

  it('uses a legitimate numeric commit before deletion, so one Undo restores the freshly edited note', () => {
    const t = fixture(); t.state.focus = 'piano'; t.state.selectedNotes = new Set(['note-2']); const api = t.render(); api.setNumberPending('velocity', true);
    t.hooks.flush = () => { api.commitNoteNumber({ velocity: .25 }); api.setNumberPending('velocity', false); return true; }; api.deleteCurrentTrack();
    expect(t.projectRef.current.tracks.some(track => track.id === 'track-2')).toBe(false); expect(t.history.current).toHaveLength(2); t.render().undo();
    expect(t.projectRef.current.patterns.find(pattern => pattern.id === 'pattern-2')?.notes[0].velocity).toBe(.25); expect(t.state.selectedNotes).toEqual(new Set(['note-2'])); roundtrip(t.projectRef.current);
  });

  it('adds from the latest track/meter snapshot and allocates an unused MIDI channel after a valid flush', () => {
    const t = fixture(); const api = t.render(); api.setNumberPending('number', true);
    t.hooks.flush = () => { api.commit('valid numeric boundary', p => { p.ppq = 960; p.timeSignatures = [{ tick: 0, numerator: 7, denominator: 8 }]; p.tracks[2].instrumentId = 'flute'; p.tracks[2].midiChannel = 5; p.tracks.push({ ...newTrack('Newly recorded track'), id: 'fresh-track', midiChannel: 6 }); }); api.setNumberPending('number', false); return true; };
    api.addTrack(); const next = t.projectRef.current, added = next.tracks.at(-1)!, region = next.regions.at(-1)!, pattern = next.patterns.at(-1)!;
    expect(added).toMatchObject({ name: '轨道 7', instrumentId: 'flute', midiChannel: 2 }); expect(region).toMatchObject({ trackId: added.id, start: 0, offset: 0, length: 3360, loop: false }); expect(pattern).toMatchObject({ length: 3360, notes: [] });
    expect(t.allocate.mock.calls[0][0].tracks).toHaveLength(6); expect(t.state.selectedTrack).toBe(added.id); expect(t.state.selectedRegions).toEqual(new Set([region.id])); expect(t.history.current).toHaveLength(2); roundtrip(next);
  });

  it('creates an explicit channel-zero track from an empty project', () => {
    const project = projectFixture(); project.tracks = []; project.regions = []; project.patterns = []; const t = fixture(project); t.render().addTrack();
    expect(t.projectRef.current.tracks[0]).toMatchObject({ midiChannel: 0, instrumentId: 'harp' }); expect(t.state.selectedTrack).toBe(t.projectRef.current.tracks[0].id); expect(t.history.current).toHaveLength(1); roundtrip(t.projectRef.current);
  });

  it('rejects old project/generation, track/group/filter selection and same-ID adoption callbacks without writing into a new document', () => {
    const t = fixture(), old = t.render(); old.commit('metadata', p => { p.author = 'changed'; }); old.moveCurrentTrack(-1); old.deleteCurrentTrack(); old.addTrack(); expect(t.projectRef.current.tracks).toHaveLength(5);
    t.render().undo(); const redo = t.future.current; old.deleteCurrentTrack(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    const targetOld = t.render(); t.group(['region-4'], 'region-4'); targetOld.moveCurrentTrack(-1); targetOld.deleteCurrentTrack(); targetOld.addTrack(); expect(t.projectRef.current).toBe(t.project);
    const filterOld = t.render(); t.render().filterInstruments('harp'); filterOld.deleteCurrentTrack(); expect(t.projectRef.current).toBe(t.project);
    const adoptOld = t.render(), reopened = structuredClone(t.project); t.hooks.flush = () => { adoptOld.adopt(reopened); return true; }; adoptOld.addTrack();
    expect(t.projectRef.current).toBe(reopened); expect(reopened.tracks).toHaveLength(5); expect(t.history.current).toEqual([]); expect(t.liveClipboardTarget.current).toBeUndefined();
  });

  it('rechecks owner after inspection and preserves redo when the actual mutator rejects or no-ops', () => {
    const t = fixture(); t.redoMarker(); const redo = t.future.current; t.hooks.inspected = () => { t.numberEditOwner.current = { ...t.numberEditOwner.current, generation: t.numberEditOwner.current.generation + 1 }; };
    t.render().moveCurrentTrack(-1); expect(t.move).not.toHaveBeenCalled(); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo);
    t.hooks.inspected = undefined; t.hooks.noMove = true; t.render().moveCurrentTrack(-1); t.hooks.noDelete = true; t.render().deleteCurrentTrack();
    expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toBe(redo); expect(t.state.selectedTrack).toBe('track-2'); expect(t.history.current).toEqual([]);
    t.hooks.inspectionError = 'Fixture prospective save exceeds its byte budget'; t.render().deleteCurrentTrack(); expect(t.state.message).toContain('byte budget'); expect(t.future.current).toBe(redo);
  });

  it('renders compact inspector controls and the same menu commands, names the delete target/count, and leaves Delete as selected-content deletion', () => {
    const t = fixture(), api = t.render(); expect(api.control('remove').props.title).toContain('Track 2'); expect(api.control('remove').props.title).toContain('1 个片段'); expect(api.control('remove').props.title).toContain('撤销');
    expect(api.menu().items.map(item => item.command)).toEqual(['add-track', 'track-up', 'track-down', 'delete-track']); api.control('up').props.onClick(); expect(t.history.current).toHaveLength(1);
    const bindings = section('  commands.current =', '\n  const bindings ='); expect(bindings).toContain("'track-up': () => moveCurrentTrack(-1)"); expect(bindings).toContain("'track-down': () => moveCurrentTrack(1)"); expect(bindings).toContain("'delete-track': deleteCurrentTrack"); expect(bindings).toContain('delete: deleteSelection');
    expect(section('    const onSpaceDown =', '\n    const onKeyDown =')).toContain('commands.current.play?.()');
    expect(t.inspectMove).toHaveBeenCalledOnce(); expect(t.inspectDelete).not.toHaveBeenCalled(); expect(t.stop).not.toHaveBeenCalled();
  });
});
