import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { growEditedPattern } from '../src/core/editor-interaction';
import { normalizeEditorSelection } from '../src/core/editor-selection';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { previewRecordingProject, recordingProjectsEqual } from '../src/core/recording';
import type { Note, Project } from '../src/core/types';

// Run the actual App functions at their state/desktop boundaries, without a DOM,
// synthesized input, React mounting, native notification, or window-close claim.
// flushActiveNumberInput is the explicit component boundary; the component's
// draft parsing, physical blur, and pending notifications have separate tests.
const appSource = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string): string {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`App number integration source boundary missing: ${start} / ${end}`);
  return appSource.slice(from, to);
}
const numberCode = transformSync([
  section('  function commit(', '\n  const changeTrack ='),
  section('  const changeRegion =', '\n  function trimCurrentRegion('),
  section('  function editNotes(', '\n  function updateNotes('),
  section('  function updateNotes(', '\n  function moveNoteSelection('),
  section('  function adopt(', '\n  async function openBytes('),
  section('  function undo()', '\n  function copyNotes('),
  section('  function projectForSave(', '\n  async function saveOriginalMidi('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const saveCode = transformSync(section('  async function save(', '\n  async function newProject('), { loader: 'ts', target: 'es2022' }).code;
const contextExpression = section('  const numberContext = ', '\n  const liveNumberContext').slice('  const numberContext = '.length).trim().replace(/;$/, '');
const contextFor = Function('editorDocumentKey', 'project', 'numberGeneration', 'revision', 'region', 'pattern', 'selectedNotes', `return ${contextExpression};`) as
  (key: number, project: Project, generation: number, revision: number, region: Project['regions'][number] | undefined, pattern: Project['patterns'][number] | undefined, notes: Set<string>) => string;

interface NumberFunctions {
  commit: (label: string, change: (project: Project) => void, preserveNumberDraft?: boolean) => void;
  undo: () => void;
  redo: () => void;
  adopt: (next: Project) => void;
  setNumberPending: (field: string, pending: boolean) => void;
  commitNoteNumber: (patch: Partial<Note>) => void | boolean;
  commitRegionLength: (value: number) => void | boolean;
  finishNumberDraft: () => boolean;
  projectForSave: () => Project;
}
type Recovery = { name: string; bytes: Uint8Array; projectId?: string } | null;

function fixture({ locked = false, missingPattern = false, missingRegion = false, ppq = 480, saveResult = 'C:\\fixture\\saved.nbsx' }: {
  locked?: boolean; missingPattern?: boolean; missingRegion?: boolean; ppq?: number; saveResult?: string | null;
} = {}) {
  const project = createProject('Number integration fixture'); project.ppq = ppq;
  const actualPattern = project.patterns[0], actualRegion = project.regions[0], track = project.tracks[0]; track.locked = locked;
  actualPattern.notes = [
    { ...newNote(17.25, 60, 91.5), id: 'selected-note', velocity: .7, pan: -.2, detune: 9.125, height: .25, instrumentId: track.instrumentId, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 3 } },
    { ...newNote(137.25, 67, 360), id: 'unselected-note', velocity: .4, pan: .3, detune: -12.5, height: -.5 },
  ];
  actualPattern.midiEvents = [{ id: 'unchanged-controller', tick: 240, order: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127 } }];
  const before = structuredClone(project), selectedNotes = new Set(['selected-note']);
  const pattern = missingPattern ? undefined : actualPattern, region = missingRegion ? undefined : actualRegion;
  const numberGeneration = 0, numberEditOwner = { current: { project, generation: numberGeneration } };
  const numberContext = contextFor(4, project, numberGeneration, 0, region, pattern, selectedNotes), liveNumberContext = { current: numberContext };
  let liveProject = project;
  const readProject = vi.fn(() => liveProject), projectRef = { get current() { return readProject(); }, set current(next: Project) { liveProject = next; } };
  const savedSnapshot: { current: Project | undefined } = { current: project };
  const history = { current: [] as { label: string; project: Project; selection: unknown }[] }, future = { current: [{ label: 'preserved-future', project }] as unknown[] };
  const numberDrafts = { current: new Set<string>() };
  const selectedRegionsRef = { current: new Set([actualRegion.id]) }, instrumentFilterRef = { current: '' };
  const state = { dirty: false, hasNumberDraft: false, revision: 0, filePath: 'C:\\fixture\\original.nbsx', recovery: { name: 'recovery.nbsx', bytes: Uint8Array.of(1, 2), projectId: project.id } as Recovery };
  const setProject = vi.fn(), setDirty = vi.fn((value: boolean) => { state.dirty = value; });
  const setRevision = vi.fn((update: (previous: number) => number) => { state.revision = update(state.revision); });
  const setHasNumberDraft = vi.fn((value: boolean) => { state.hasNumberDraft = value; }), setMessage = vi.fn();
  const setFilePath = vi.fn((value: string) => { state.filePath = value; });
  const setRecovery = vi.fn((update: (value: Recovery) => Recovery) => { state.recovery = update(state.recovery); });
  const selectionSnapshot = (value = projectRef.current) => normalizeEditorSelection(value, { trackId: track.id, regionId: region?.id, noteIds: [...selectedNotes], focus: 'piano' });
  let onFlush: () => boolean = () => true;
  const flushActiveNumberInput = vi.fn(() => onFlush());
  const scope = { recordDiagnostic: () => {}, audioDiagnosticSnapshot: () => ({}), signalLogged: { current: false }, project, projectRef, pattern, track, region, selectedNotes, numberContext, liveNumberContext, numberGeneration, numberEditOwner, numberDrafts, setHasNumberDraft, setMessage,
    produce, history, future, selectionSnapshot, setProject, setDirty, setRevision, changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, inspectorBeatTicks, noteTimingError, regionLengthError, MAX_PROJECT_TICK,
    portable: false, library: undefined, flattenNotes, bytesToBase64, flushActiveNumberInput,
    savedSnapshot, setFilePath, stop: vi.fn(), playbackMode: 'realtime', finishHeld: { current: vi.fn() }, seek: vi.fn(), restoreSelection: vi.fn(), setEditorDocumentKey: vi.fn(), setPianoViewRequest: vi.fn(),
    setSelectedTrack: vi.fn(), setSelectedRegion: vi.fn(), setSelectedNotes: vi.fn(), setImportDiagnostics: vi.fn(),
    flpOpenTicket: { current: 0 }, setFlpImport: vi.fn(), setModal: vi.fn(), setInstrumentFilter: vi.fn(), selectedRegionsRef, instrumentFilterRef, setSelectedRegions: vi.fn(), liveClipboardTarget: { current: undefined },
    engine: { loadProjectSamples: vi.fn(async () => {}) } };
  const createFunctions = (bindings: typeof scope) => Function(...Object.keys(bindings), `${numberCode}\nreturn {commit,undo,redo,adopt,setNumberPending,commitNoteNumber,commitRegionLength,finishNumberDraft,projectForSave};`)(...Object.values(bindings)) as NumberFunctions;
  const functions = createFunctions(scope);
  // Capture a later App-render callback while preserving its real shared refs.
  const capture = () => {
    const project = projectRef.current, numberGeneration = numberEditOwner.current.generation;
    const pattern = missingPattern ? undefined : project.patterns.find(item => item.id === actualPattern.id);
    const region = missingRegion ? undefined : project.regions.find(item => item.id === actualRegion.id);
    const track = project.tracks.find(item => item.id === scope.track.id)!;
    const numberContext = contextFor(4, project, numberGeneration, state.revision, region, pattern, selectedNotes);
    liveNumberContext.current = numberContext;
    return createFunctions({ ...scope, project, pattern, region, track, numberGeneration, numberContext });
  };
  const projectForSave = vi.fn(functions.projectForSave), encode = vi.fn(saveNbsx);
  const files: { name: string; bytes: Uint8Array; existing?: string }[] = [];
  const saveFile = vi.fn(async (name: string, bytes: Uint8Array, existing?: string): Promise<string | null> => { files.push({ name, bytes: bytes.slice(), existing }); return saveResult; });
  const clearRecovery = vi.fn(async (_id: string) => {});
  const download = vi.fn(() => { throw new Error('Desktop fixture must not use browser download'); });
  const localStorage = { removeItem: vi.fn(() => { throw new Error('Desktop fixture must not use browser localStorage'); }) };
  const saveScope = { finishNumberDraft: functions.finishNumberDraft, projectRef, projectForSave, saveNbsx: encode,
    previewRecordingProject, recordingProjectsEqual, keysHeld: { current: new Map() }, engine: { position: () => undefined }, editorDocumentKey: 4,
    window: { desktop: { saveFile, clearRecovery } }, filePath: state.filePath, savedSnapshot, setFilePath, setDirty, setMessage,
    portable: false, setRecovery, download, localStorage };
  const save = Function(...Object.keys(saveScope), `${saveCode}\nreturn save;`)(...Object.values(saveScope)) as (as?: boolean) => Promise<boolean>;
  return { ...functions, capture, save, before, capturedProject: project, projectRef, readProject, savedSnapshot, liveNumberContext, numberEditOwner, history, future,
    numberDrafts, state, setProject, setDirty, setRevision, setHasNumberDraft, setMessage, setFilePath, setRecovery,
    projectForSave, encode, saveFile, files, clearRecovery, download, localStorage, flushActiveNumberInput,
    useFlush: (flush: () => boolean) => { onFlush = flush; }, currentProject: () => liveProject };
}

const withoutTimestamp = (project: Project) => { const copy = structuredClone(project); delete (copy as Partial<Project>).modifiedAt; return copy; };

describe('actual App number commit and desktop save functions (isolated integration scope)', () => {
  it('rejects late note and region commits after the selection/document context changes', () => {
    const test = fixture(), future = test.future.current;
    test.liveNumberContext.current = 'different-selection-or-document';
    test.commitNoteNumber({ height: 2.125 }); test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(test.capturedProject); expect(test.currentProject()).toEqual(test.before);
    expect(test.history.current).toEqual([]); expect(test.future.current).toBe(future); expect(test.setProject).not.toHaveBeenCalled();
  });

  it.each(['reopened-same-ids', 'undo', 'locked-mid-draft', 'deleted-target'] as const)('rejects the captured callback when project identity changed: %s', change => {
    const test = fixture(), next = produce(test.capturedProject, draft => {
      if (change === 'locked-mid-draft') draft.tracks[0].locked = true;
      else if (change === 'deleted-target') { draft.patterns = []; draft.regions = []; }
      else draft.description = change;
    });
    test.projectRef.current = next;
    test.commitNoteNumber({ midi: 72 }); test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(next); expect(test.history.current).toEqual([]); expect(test.setProject).not.toHaveBeenCalled();
  });

  it('keeps a captured note-number callback valid after recording append and preserves the complete latest project', () => {
    const test = fixture(), expected = structuredClone(test.before), context = test.liveNumberContext.current;
    const recorded = { ...newNote(701.5, 76, 35.25), id: 'recorded-note', velocity: .625, pan: -.125, detune: 2.5, height: 1.25 };
    expected.patterns[0].notes.push(recorded); expected.patterns[0].notes[0].detune = 17.625;
    // The third argument is App's recording-append boundary, not a mocked MIDI event.
    test.commit('录入音符', next => { next.patterns[0].notes.push(recorded); }, true);
    expect(test.numberEditOwner.current).toEqual({ project: test.currentProject(), generation: 0 }); expect(test.state.revision).toBe(1);
    expect(test.currentProject()).not.toBe(test.capturedProject);
    test.capture(); // Actual render-context expression must ignore recording's revision increment.
    expect(test.liveNumberContext.current).toBe(context);
    test.commitNoteNumber({ detune: 17.625 });
    expect(withoutTimestamp(test.currentProject())).toEqual(withoutTimestamp(expected));
    expect(withoutTimestamp(openNbsx(saveNbsx(test.currentProject())))).toEqual(withoutTimestamp(expected));
    expect(test.history.current).toHaveLength(2); expect(test.numberEditOwner.current.generation).toBe(1);
  });

  it('allows a captured region-length callback after an unrelated recording append', () => {
    const test = fixture(), expected = structuredClone(test.before);
    const recorded = { ...newNote(603.5, 71, 23.25), id: 'recorded-note', velocity: .55 };
    expected.patterns[0].notes.push(recorded); expected.regions[0].length = 1.125 * expected.ppq;
    test.commit('录入音符', next => { next.patterns[0].notes.push(recorded); }, true);
    test.commitRegionLength(1.125);
    expect(withoutTimestamp(test.currentProject())).toEqual(withoutTimestamp(expected)); expect(test.history.current).toHaveLength(2);
  });

  it('does not overwrite a region length grown by recording, while the selected-note draft remains valid', () => {
    const test = fixture(), recorded = { ...newNote(test.before.patterns[0].length + 5.5, 74, 20), id: 'recorded-grown-note' };
    test.commit('录入音符', next => {
      next.patterns[0].notes.push(recorded); growEditedPattern(next, next.regions[0], next.patterns[0], recorded.tick + 1);
    }, true);
    const afterRecording = test.currentProject(), expected = structuredClone(afterRecording);
    expect(afterRecording.regions[0].length).toBeGreaterThan(test.before.regions[0].length);
    expect(test.numberEditOwner.current.generation).toBe(0);
    test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(afterRecording); expect(test.history.current).toHaveLength(1);
    expected.patterns[0].notes[0].height = 1.875;
    test.commitNoteNumber({ height: 1.875 });
    expect(withoutTimestamp(test.currentProject())).toEqual(withoutTimestamp(expected)); expect(test.history.current).toHaveLength(2);
  });

  it('invalidates captured callbacks synchronously after ordinary editing even before a render updates context', () => {
    const test = fixture(), context = test.liveNumberContext.current;
    test.commit('普通编辑', next => { next.description = 'Changed without a React rerender'; });
    const edited = test.currentProject(); expect(test.numberEditOwner.current.generation).toBe(1);
    expect(test.liveNumberContext.current).toBe(context);
    test.commitNoteNumber({ height: 2.125 }); test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(edited); expect(test.history.current).toHaveLength(1); expect(test.setProject).toHaveBeenCalledOnce();
  });

  it('does not preserve a draft when recording commit follows an unowned project replacement', () => {
    const test = fixture(); test.projectRef.current = produce(test.capturedProject, next => { next.description = 'Unowned replacement'; });
    test.commit('录入音符', next => { next.patterns[0].notes.push({ ...newNote(300, 73, 120), id: 'recorded-note' }); }, true);
    const recorded = test.currentProject(); expect(test.numberEditOwner.current).toEqual({ project: recorded, generation: 1 });
    test.commitNoteNumber({ height: 2.125 }); test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(recorded); expect(test.history.current).toHaveLength(1);
  });

  it.each(['undo', 'redo'] as const)('invalidates captured callbacks synchronously on actual %s', action => {
    const test = fixture();
    test.commit('录入音符', next => { next.patterns[0].notes.push({ ...newNote(300, 73, 120), id: 'recorded-note' }); }, true);
    if (action === 'redo') test.undo();
    const callback = action === 'redo' ? test.capture() : test, generation = test.numberEditOwner.current.generation;
    const context = test.liveNumberContext.current;
    callback[action]();
    const restored = test.currentProject(), historyLength = test.history.current.length, future = test.future.current;
    expect(test.numberEditOwner.current).toEqual({ project: restored, generation: generation + 1 });
    expect(test.liveNumberContext.current).toBe(context);
    callback.commitNoteNumber({ height: 2.125 }); callback.commitRegionLength(.25);
    expect(test.currentProject()).toBe(restored); expect(test.history.current).toHaveLength(historyLength); expect(test.future.current).toBe(future);
  });

  it('invalidates old callbacks when actual adopt reopens the same IDs', () => {
    const test = fixture(), reopened = structuredClone(test.before), context = test.liveNumberContext.current;
    reopened.description = 'Reopened same IDs'; test.adopt(reopened);
    expect(test.numberEditOwner.current).toEqual({ project: reopened, generation: 1 }); expect(test.liveNumberContext.current).toBe(context);
    test.commitNoteNumber({ height: 2.125 }); test.commitRegionLength(.25);
    expect(test.currentProject()).toBe(reopened); expect(test.currentProject()).toEqual(reopened); expect(test.history.current).toHaveLength(0);
    expect(test.future.current).toHaveLength(0); expect(test.setProject).toHaveBeenCalledExactlyOnceWith(reopened);
  });

  it.each([{ locked: true }, { missingPattern: true }])('keeps the real editNotes guard for unavailable numeric note targets: %j', options => {
    const test = fixture(options);
    expect(() => test.commitNoteNumber({ detune: 22.625 })).not.toThrow();
    expect(test.currentProject()).toEqual(test.before); expect(test.history.current).toEqual([]); expect(test.setProject).not.toHaveBeenCalled();
  });

  it('commits one selected-note patch through real produce and preserves every other project field', () => {
    const test = fixture(), expected = structuredClone(test.before);
    expected.patterns[0].notes[0].height = -1.125; expected.patterns[0].notes[0].detune = 22.625;
    test.commitNoteNumber({ height: -1.125, detune: 22.625 });
    // A second delivery of the same captured callback is stale after its commit.
    test.commitNoteNumber({ height: -1.125, detune: 22.625 });
    expect(withoutTimestamp(test.currentProject())).toEqual(withoutTimestamp(expected));
    expect(test.history.current).toHaveLength(1); expect(test.future.current).toEqual([]); expect(test.setRevision).toHaveBeenCalledOnce();
    expect(test.state.dirty).toBe(true); expect(test.currentProject()).not.toBe(test.capturedProject);
  });

  it.each([{ ppq: 1, value: .25, length: 1 }, { ppq: 480, value: .125, length: 120 }, { ppq: 480, value: 1.125, length: 540 }])('keeps region length legal without integer-rounding quarter-note values: %j', ({ ppq, value, length }) => {
    const test = fixture({ ppq }), expected = structuredClone(test.before); expected.regions[0].length = length;
    test.commitRegionLength(value);
    expect(withoutTimestamp(test.currentProject())).toEqual(withoutTimestamp(expected));
    expect(test.history.current).toHaveLength(1); expect(openNbsx(saveNbsx(test.currentProject())).regions[0].length).toBe(length);
  });

  it.each([{ locked: true }, { missingRegion: true }])('does not edit an unavailable or locked region: %j', options => {
    const test = fixture(options); test.commitRegionLength(1);
    expect(test.currentProject()).toEqual(test.before); expect(test.history.current).toEqual([]);
  });

  it('aggregates two field pending transitions instead of clearing the second field with the first', () => {
    const test = fixture();
    test.setNumberPending('note-height', true); test.setNumberPending('region-length', true); test.setNumberPending('note-height', true);
    expect(test.numberDrafts.current).toEqual(new Set(['note-height', 'region-length'])); expect(test.state.hasNumberDraft).toBe(true);
    test.setNumberPending('note-height', false);
    expect(test.numberDrafts.current).toEqual(new Set(['region-length'])); expect(test.state.hasNumberDraft).toBe(true);
    test.setNumberPending('region-length', false);
    expect(test.numberDrafts.current.size).toBe(0); expect(test.state.hasNumberDraft).toBe(false);
    expect(test.currentProject()).toEqual(test.before); expect(test.history.current).toEqual([]); expect(test.state.dirty).toBe(false);
  });

  it('rejects an invalid flush before reading a save snapshot, serializing, or calling the desktop fixture', async () => {
    const test = fixture(); test.setNumberPending('note-height', true); test.useFlush(() => false); test.readProject.mockClear();
    expect(await test.save()).toBe(false);
    expect(test.flushActiveNumberInput).toHaveBeenCalledOnce(); expect(test.readProject).not.toHaveBeenCalled();
    expect(test.projectForSave).not.toHaveBeenCalled(); expect(test.encode).not.toHaveBeenCalled(); expect(test.saveFile).not.toHaveBeenCalled();
    expect(test.savedSnapshot.current).toBe(test.capturedProject); expect(test.numberDrafts.current).toEqual(new Set(['note-height']));
    expect(test.setMessage).toHaveBeenCalledWith('属性中有未完成或超出范围的数字，请修正后再继续。');
  });

  it.each([false, true])('flushes the actual note commit before encoding the full saved NBSX (save as: %s)', async as => {
    const test = fixture(), expected = structuredClone(test.before); expected.patterns[0].notes[0].detune = 17.625;
    test.setNumberPending('note-detune', true);
    test.useFlush(() => { test.setNumberPending('note-detune', false); test.commitNoteNumber({ detune: 17.625 }); return true; });
    expect(await test.save(as)).toBe(true); expect(test.flushActiveNumberInput).toHaveBeenCalledOnce(); expect(test.history.current).toHaveLength(1);
    expect(test.files).toHaveLength(1); expect(test.files[0].existing).toBe(as ? undefined : 'C:\\fixture\\original.nbsx');
    expect(withoutTimestamp(openNbsx(test.files[0].bytes))).toEqual(withoutTimestamp(expected));
    expect(test.savedSnapshot.current).toBe(test.currentProject()); expect(test.state.dirty).toBe(false); expect(test.state.hasNumberDraft).toBe(false);
    expect(test.clearRecovery).toHaveBeenCalledExactlyOnceWith(test.before.id); expect(test.state.recovery).toBe(null);
    expect(test.download).not.toHaveBeenCalled(); expect(test.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('blocks serialization when another field remains pending after a successful active-input flush', async () => {
    const test = fixture({ saveResult: null }), recovery = test.state.recovery;
    test.setNumberPending('note-height', true); test.setNumberPending('region-length', true);
    test.useFlush(() => { test.setNumberPending('note-height', false); test.commitNoteNumber({ height: 2.125 }); return true; });
    expect(await test.save()).toBe(false);
    expect(test.flushActiveNumberInput).toHaveBeenCalledOnce(); expect(test.files).toHaveLength(0); expect(test.encode).not.toHaveBeenCalled();
    expect(test.currentProject().patterns[0].notes[0].height).toBe(2.125); expect(test.state.dirty).toBe(true);
    expect(test.savedSnapshot.current).toBe(test.capturedProject); expect(test.setFilePath).not.toHaveBeenCalled();
    expect(test.setRecovery).not.toHaveBeenCalled(); expect(test.clearRecovery).not.toHaveBeenCalled(); expect(test.state.recovery).toBe(recovery);
    expect(test.numberDrafts.current).toEqual(new Set(['region-length'])); expect(test.state.hasNumberDraft).toBe(true);
    expect(test.setMessage.mock.calls.some(([message]) => String(message).startsWith('已保存'))).toBe(false);
  });

  it('keeps the current numeric edit dirty when the file dialog cancels after all fields are resolved', async () => {
    const test = fixture({ saveResult: null }), recovery = test.state.recovery;
    test.setNumberPending('note-height', true);
    test.useFlush(() => { test.setNumberPending('note-height', false); test.commitNoteNumber({ height: 2.125 }); return true; });
    expect(await test.save()).toBe(false);
    expect(test.files).toHaveLength(1); expect(openNbsx(test.files[0].bytes).patterns[0].notes[0].height).toBe(2.125);
    expect(test.currentProject().patterns[0].notes[0].height).toBe(2.125); expect(test.state.dirty).toBe(true);
    expect(test.savedSnapshot.current).toBe(test.capturedProject); expect(test.setFilePath).not.toHaveBeenCalled();
    expect(test.clearRecovery).not.toHaveBeenCalled(); expect(test.setRecovery).not.toHaveBeenCalled(); expect(test.state.recovery).toBe(recovery);
    expect(test.numberDrafts.current.size).toBe(0); expect(test.state.hasNumberDraft).toBe(false);
  });
});
