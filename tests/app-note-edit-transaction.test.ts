import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { canEditSelectedNotes, changeSelectedNotes, moveSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { dragNotes, growEditedPattern } from '../src/core/editor-interaction';
import { normalizeEditorSelection, resolveEditorSelection } from '../src/core/editor-selection';
import { inspectorBeatTicks, noteTimingError } from '../src/core/inspector-timing';
import { createMeterMap, patternOrigin } from '../src/core/meter';
import { applyNoteEdit } from '../src/core/note-edit';
import { changeNoteVelocities } from '../src/core/note-velocity';
import { createProject, flattenNotes, newNote, validateProject } from '../src/core/project';
import { previewRecordingProject, recordingProjectsEqual } from '../src/core/recording';
import type { EditorSelection } from '../src/core/editor-selection';
import type { Note, Project } from '../src/core/types';
import { midiEnd, smf } from './fixtures/midi';

// Actual App functions, real Immer/preflight/serializer/history. State/desktop
// boundaries are inert; no GUI, physical input, native engine or DSP is claimed.
// An optional test-only source path preserves dated old-App failure evidence;
// the ordinary suite always compiles the current product implementation.
const source = readFileSync(process.env.NBSX_NOTE_EDIT_APP_SOURCE ?? new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw Error('Actual App transaction source boundary missing: ' + start + '/' + end);
  return source.slice(from, to);
}
const code = transformSync([
  section('  function restoreSelection(', '\n  function selectRegion('),
  section('  function commit(', '\n  const changeTrack ='),
  section('  function editNotes(', '\n  function updateNotes('),
  section('  function updateNotes(', '\n  function setNumberPending('),
  section('  function commitNoteNumber(', '\n  function commitRegionLength('),
  section('  function moveNoteSelection(', '\n  function stop('),
  section('  function projectForSave(', '\n  async function saveOriginalMidi('),
  section('  async function save(', '\n  async function newProject('),
  section('  function undo()', '\n  function copyNotes('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const contextCode = transformSync(section('  const numberGeneration =', '\n  const liveNumberContext ='), { loader: 'ts', target: 'es2022' }).code;
const evaluateContext = Function('project', 'numberEditOwner', 'region', 'pattern', 'selectedNotes', 'editorDocumentKey', contextCode + '\nreturn {numberGeneration,numberContext};');
type API = {
  commit: (label: string, change: (project: Project) => void, preserveNumberDraft?: boolean) => void;
  editNotes: (label: string, change: (notes: Note[]) => Note[], context?: unknown) => boolean;
  updateNotes: (patch: Partial<Note>) => boolean;
  commitNoteNumber: (patch: Partial<Note>) => void | boolean;
  moveNoteSelection: (tick: number, pitch?: number) => void;
  nudgeNoteSelection: (direction: number, beat?: boolean) => void;
  quantizeNoteSelection: () => void;
  undo: () => void; redo: () => void; save: () => Promise<boolean>;
};
type Entry = { label: string; project: Project; selection: EditorSelection };
function fixture(setup: (project: Project) => void = () => {}) {
  const initial = createProject('App atomic note edit'); initial.ppq = 480;
  initial.patterns[0].length = initial.regions[0].length = 1920;
  initial.patterns[0].notes = [
    { ...newNote(240, 60, 120), id: 'a', velocity: .25, pan: -.125, detune: 7.5, height: .25, instrumentId: 'bell', midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 3 } },
    { ...newNote(480, 64, 300), id: 'b', velocity: .75, pan: .25, detune: -12, height: -.5, midiSource: { onOrder: 4, offOrder: 7, releaseVelocity: 63, offSourceTrack: 3 } },
    { ...newNote(960, 72, 240), id: 'guard', velocity: .5 },
  ];
  initial.patterns[0].midiEvents = [{ id: 'controller', tick: 120, order: 1, sourceTrack: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127 } }];
  const archive = smf(Array.from({ length: 4 }, () => [...midiEnd]));
  initial.assets = [{ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: bytesToBase64(archive) }];
  initial.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', sourceTrackNames: ['conductor', 'onsets', 'guard', 'releases'], conductor: [{ id: 'marker', tick: 0, order: 0, event: { deltaTime: 0, type: 'marker', text: 'KEEP' } }] };
  initial.tracks[0].sourceMidiTrack = 1; setup(initial); validateProject(initial);
  const before = structuredClone(initial), projectRef = { current: initial }, numberEditOwner = { current: { project: initial, generation: 0 } }, savedSnapshot = { current: initial as Project | undefined };
  const state = { project: initial, dirty: false, revision: 0, selectedNotes: new Set(initial.patterns[0].notes.filter(note => note.id !== 'guard').map(note => note.id)), selectedTrack: initial.tracks[0].id, selectedRegion: initial.regions[0].id, focus: 'piano' as 'piano' | 'arrangement' };
  const selectedRegionsRef = { current: new Set([state.selectedRegion]) }, history = { current: [] as Entry[] }, liveNumberContext = { current: '' };
  const selection = () => normalizeEditorSelection(projectRef.current, { trackId: state.selectedTrack, regionId: state.selectedRegion, regionIds: [...selectedRegionsRef.current], noteIds: [...state.selectedNotes], focus: state.focus });
  const future = { current: [{ label: 'preserved-redo', project: initial, selection: selection() }] as Entry[] }, futureBefore = future.current, selectionBefore = selection();
  const setMessage = vi.fn(), setProject = vi.fn((project: Project) => { state.project = project; }), setDirty = vi.fn((dirty: boolean) => { state.dirty = dirty; }), setRevision = vi.fn((change: (revision: number) => number) => { state.revision = change(state.revision); });
  const files: Uint8Array[] = [], clearRecovery = vi.fn(async () => {}), saveFile = vi.fn(async (_name: string, bytes: Uint8Array) => { files.push(bytes.slice()); return 'saved.nbsx'; });
  const stop = vi.fn(), finishHeld = { current: vi.fn() }, generationBefore = numberEditOwner.current;
  function render(): API {
    const project = projectRef.current, resolved = resolveEditorSelection(project, { trackId: state.selectedTrack, regionId: state.selectedRegion, noteIds: [...state.selectedNotes], focus: state.focus });
    const { pattern, region, track } = resolved, context = evaluateContext(project, numberEditOwner, region, pattern, state.selectedNotes, 4); liveNumberContext.current = context.numberContext;
    const scope = { project, projectRef, numberEditOwner, savedSnapshot, ...resolved, ...context, liveNumberContext, selectedNotes: state.selectedNotes, selectedRegionsRef, focus: state.focus,
      preferences: { snap: 16 }, meterMap: createMeterMap(project), sourceOrigin: region && pattern ? patternOrigin(region, pattern) : 0,
      produce, applyNoteEdit, changeSelectedNotes, changeNoteVelocities, notesUnchanged, growEditedPattern, moveSelectedNotes, canEditSelectedNotes, noteTimingError, inspectorBeatTicks,
      history, future, selectionSnapshot: (value = projectRef.current) => normalizeEditorSelection(value, selection()), setProject, setDirty, setRevision, setMessage,
      normalizeEditorSelection, setSelectedTrack: (id: string) => { state.selectedTrack = id; }, setSelectedRegion: (id: string) => { state.selectedRegion = id; }, setSelectedNotes: (ids: Set<string>) => { state.selectedNotes = ids; }, setSelectedRegions: vi.fn(), setFocus: (focus: 'piano' | 'arrangement') => { state.focus = focus; },
      playbackMode: 'realtime', finishHeld, stop, portable: false, library: undefined, flattenNotes, bytesToBase64,
      finishNumberDraft: () => true, previewRecordingProject, recordingProjectsEqual, keysHeld: { current: new Map() }, engine: { position: () => undefined }, editorDocumentKey: 4, saveNbsx,
      filePath: undefined, setFilePath: vi.fn(), setRecovery: vi.fn(), window: { desktop: { saveFile, clearRecovery } }, localStorage: { removeItem: vi.fn() }, download: vi.fn() };
    return Function(...Object.keys(scope), code + '\nreturn {commit,editNotes,updateNotes,commitNoteNumber,moveNoteSelection,nudgeNoteSelection,quantizeNoteSelection,undo,redo,save};')(...Object.values(scope)) as API;
  }
  const first = render();
  return { initial, before, projectRef, numberEditOwner, generationBefore, history, future, futureBefore, savedSnapshot, state, selectedRegionsRef, selection, selectionBefore, setMessage, setProject, setDirty, setRevision, first, render, files,
    external: (project: Project) => { projectRef.current = project; state.project = project; numberEditOwner.current = { project, generation: numberEditOwner.current.generation + 1 }; } };
}
type Fixture = ReturnType<typeof fixture>;
function unchanged(test: Fixture) {
  expect(test.projectRef.current).toBe(test.initial); expect(test.projectRef.current).toEqual(test.before);
  expect(test.projectRef.current.patterns[0].notes).toBe(test.initial.patterns[0].notes); expect(test.numberEditOwner.current).toBe(test.generationBefore);
  expect(test.history.current).toEqual([]); expect(test.future.current).toBe(test.futureBefore); expect(test.selection()).toEqual(test.selectionBefore);
  expect(test.state.dirty).toBe(false); expect(test.setProject).not.toHaveBeenCalled(); expect(test.setDirty).not.toHaveBeenCalled(); expect(test.setRevision).not.toHaveBeenCalled();
}
const model = (project: Project) => { const { modifiedAt: _stamp, ...rest } = project; return rest; };

describe('actual App note edit transaction boundary (isolated source integration)', () => {
  it.each(['nudge', 'quantize', 'resize'])('rejects historical %s overflow without touching references, redo, selection or dirty state', async kind => {
    const test = fixture(project => {
      project.ppq = 960;
      if (kind === 'nudge') { project.patterns[0].length = 3840; project.regions[0].length = 1; project.regions[0].offset = 1e12; project.patterns[0].notes = [{ ...newNote(1e12, 66, 1), id: 'selected' }]; }
      else if (kind === 'quantize') { project.patterns[0].length = project.regions[0].length = 1e12; project.patterns[0].notes = [{ ...newNote(1e12 - 1, 66, 1), id: 'selected' }]; }
      else project.patterns[0].notes = [{ ...newNote(0, 66, 1e12), id: 'selected' }];
    });
    expect(() => { if (kind === 'nudge') test.first.nudgeNoteSelection(1); else if (kind === 'quantize') test.first.quantizeNoteSelection(); else test.first.editNotes('Resize', notes => dragNotes(notes, new Set(['selected']), 'resize', 1)); }).not.toThrow();
    unchanged(test); expect(test.setMessage).toHaveBeenCalled(); expect(validateProject(test.projectRef.current)).toBe(test.initial);
    expect(await test.render().save()).toBe(true); expect(model(openNbsx(test.files[0]))).toEqual(model(test.before));
  });

  it.each(['move', 'resize', 'velocity', 'quantize'] as const)('commits a valid batch %s once, saves all metadata, then restores exact Undo/Redo snapshots', async kind => {
    const test = fixture(project => { if (kind === 'quantize') { project.patterns[0].notes[0].tick = 130; project.patterns[0].notes[1].tick = 390; } }), expected = structuredClone(test.before);
    if (kind === 'move') { expected.patterns[0].notes[0].tick = 360; expected.patterns[0].notes[1].tick = 600; expected.patterns[0].notes[0].midi = 62; expected.patterns[0].notes[1].midi = 66; test.first.moveNoteSelection(120, 2); }
    else if (kind === 'resize') { expected.patterns[0].notes[0].duration = 180; expected.patterns[0].notes[1].duration = 360; expect(test.first.editNotes('Resize', notes => dragNotes(notes, new Set(['a', 'b']), 'resize', 60))).toBe(true); }
    else if (kind === 'velocity') { expected.patterns[0].notes[0].velocity = .375; expected.patterns[0].notes[1].velocity = .875; expect(test.first.editNotes('Velocity', notes => changeNoteVelocities(notes, new Set(['a', 'b']), .125, 'relative'))).toBe(true); }
    else { expected.patterns[0].notes[0].tick = 120; expected.patterns[0].notes[1].tick = 360; test.first.quantizeNoteSelection(); }
    const next = test.projectRef.current; expect(model(next)).toEqual(model(expected)); expect(test.history.current).toHaveLength(1); expect(test.future.current).toEqual([]); expect(test.state.dirty).toBe(true);
    expect(await test.render().save()).toBe(true); expect(model(openNbsx(test.files[0]))).toEqual(model(expected)); expect(test.state.dirty).toBe(false);
    test.render().undo(); expect(test.projectRef.current).toBe(test.initial); expect(test.selection()).toEqual(test.selectionBefore); expect(test.state.dirty).toBe(true);
    test.render().redo(); expect(test.projectRef.current).toBe(next); expect(test.selection()).toEqual(test.selectionBefore); expect(test.state.dirty).toBe(false);
    expect(test.before.assets).toEqual(next.assets); expect(test.before.midi).toEqual(next.midi); expect(test.before.patterns[0].midiEvents).toEqual(next.patterns[0].midiEvents);
  });

  it('propagates a rejected numeric edit as false without an update-success message or history write', () => {
    const test = fixture(); expect(test.first.commitNoteNumber({ velocity: Number.NaN })).toBe(false); unchanged(test);
    expect(test.setMessage.mock.calls.some(call => String(call[0]).includes('已更新音符属性'))).toBe(false);
  });

  it('accepts MAX duration independently of the onset, without growing the source from its tail', async () => {
    const test = fixture(), expected = structuredClone(test.before); expected.patterns[0].notes[0].duration = expected.patterns[0].notes[1].duration = 1e12;
    expect(test.first.commitNoteNumber({ duration: 1e12 })).not.toBe(false); expect(model(test.projectRef.current)).toEqual(model(expected)); expect(test.history.current).toHaveLength(1);
    expect(test.projectRef.current.patterns[0].length).toBe(1920); expect(await test.render().save()).toBe(true); expect(model(openNbsx(test.files[0]))).toEqual(model(expected));
  });

  it('keeps an equivalent note callback as a true no-op, retaining the real redo entry', () => {
    const test = fixture(); expect(test.first.editNotes('Same values', notes => notes.map(note => ({ ...note })))).toBe(true); unchanged(test);
  });

  it('rejects an invalid in-place callback before it can mutate the source, history or redo', () => {
    const test = fixture();
    expect(test.first.editNotes('Invalid in-place resize', notes => { notes[0].duration = 1e12 + 1; return notes; })).toBe(false);
    unchanged(test); expect(test.setMessage).toHaveBeenCalled();
  });

  it('preflights a valid in-place callback as one transaction and preserves complete save/Undo data', async () => {
    const test = fixture(), expected = structuredClone(test.before); expected.patterns[0].notes[0].velocity = .375;
    expect(test.first.editNotes('In-place velocity', notes => { notes[0].velocity = .375; return notes; })).toBe(true);
    expect(model(test.projectRef.current)).toEqual(model(expected)); expect(test.history.current).toHaveLength(1); expect(test.future.current).toEqual([]);
    expect(await test.render().save()).toBe(true); expect(model(openNbsx(test.files[0]))).toEqual(model(expected));
    test.render().undo(); expect(test.projectRef.current).toBe(test.initial); expect(test.selection()).toEqual(test.selectionBefore);
  });

  it('lets a retained numeric callback use the latest recorded notes, while rejecting the same stale ordinary edit callback', async () => {
    const test = fixture(), expected = structuredClone(test.before);
    const recorded = { ...newNote(1200, 69, 180), id: 'recorded-after-draft', velocity: .625, midiSource: { onOrder: 8, offOrder: 9, releaseVelocity: 27, offSourceTrack: 3 } };
    expected.patterns[0].notes.push(recorded);
    test.first.commit('Record append', project => { project.patterns[0].notes.push(recorded); }, true);
    const recordedProject = test.projectRef.current;
    expect(test.numberEditOwner.current.generation).toBe(0); expect(test.numberEditOwner.current.project).toBe(recordedProject);
    test.render(); // Real rerender keeps the same generation/selection numeric context.
    expect(test.first.editNotes('Late ordinary drag', notes => dragNotes(notes, new Set(['a', 'b']), 'move', 120))).toBe(false);
    expect(test.projectRef.current).toBe(recordedProject); expect(test.history.current).toHaveLength(1);
    expected.patterns[0].notes[0].velocity = expected.patterns[0].notes[1].velocity = .5;
    expect(test.first.commitNoteNumber({ velocity: .5 })).not.toBe(false);
    expect(model(test.projectRef.current)).toEqual(model(expected)); expect(test.history.current).toHaveLength(2);
    expect(test.projectRef.current.patterns[0].notes.at(-1)).toEqual(recorded);
    expect(await test.render().save()).toBe(true); expect(model(openNbsx(test.files[0]))).toEqual(model(expected));
    test.render().undo(); expect(test.projectRef.current).toBe(recordedProject);
  });

  it('rejects a draw that would double an already-full loop expansion before appending any source note', () => {
    const test = fixture(project => {
      project.patterns[0].length = 1; project.regions[0].length = 2000000; project.regions[0].loop = true;
      project.patterns[0].notes = [{ ...newNote(0, 66, 1), id: 'selected' }];
    });
    expect(test.first.editNotes('Draw', notes => [...notes, { ...newNote(0, 67, 1), id: 'would-overflow' }])).toBe(false);
    unchanged(test); expect(test.setMessage).toHaveBeenCalled();
  });

  it('rejects a mismatched live region/track tuple even when the command context claims to be current', () => {
    const test = fixture(project => { project.tracks.push({ ...project.tracks[0], id: 'other-track' }); });
    const context = { pattern: test.initial.patterns[0], region: test.initial.regions[0], track: test.initial.tracks[1], current: () => true };
    expect(test.first.editNotes('Wrong target', notes => dragNotes(notes, new Set(['a']), 'move', 120), context)).toBe(false);
    unchanged(test);
  });

  it('rejects locked targets and late callbacks captured before an external document write', () => {
    const locked = fixture(project => { project.tracks[0].locked = true; }); expect(locked.first.editNotes('Locked', notes => dragNotes(notes, new Set(['a']), 'move', 120))).toBe(false); unchanged(locked);
    const stale = fixture(), replacement = produce(stale.initial, draft => { draft.tracks[0].name = 'Externally changed'; }); stale.external(replacement);
    const owner = stale.numberEditOwner.current, redo = stale.future.current;
    expect(stale.first.editNotes('Late release', notes => dragNotes(notes, new Set(['a']), 'move', 120))).toBe(false);
    stale.first.commitNoteNumber({ velocity: .5 });
    expect(stale.projectRef.current).toBe(replacement); expect(stale.numberEditOwner.current).toBe(owner); expect(stale.history.current).toEqual([]); expect(stale.future.current).toBe(redo); expect(stale.selection()).toEqual(stale.selectionBefore); expect(stale.state.dirty).toBe(false);
  });
});
