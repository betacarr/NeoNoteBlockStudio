import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { growEditedPattern } from '../src/core/editor-interaction';
import { normalizeEditorSelection, resolveEditorSelection } from '../src/core/editor-selection';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { previewRecordingProject, recordingProjectsEqual } from '../src/core/recording';
import type { Note, Project } from '../src/core/types';
import type { CommitNumberInputProps } from '../src/ui/CommitNumberInput';
import { createNumberInputHarness } from './helpers/commit-number-harness';

// Actual input component, App functions and JSX bindings, real timing preflight,
// Immer, and NBSX bytes. Hooks, focus and desktop dialogs are inert boundaries;
// these are source-derived integration checks, not physical input or GUI tests.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Inspector timing App boundary missing: ${start} / ${end}`);
  return source.slice(from, to);
}
const code = transformSync([
  section('  function commit(', '\n  const changeTrack ='),
  section('  const changeRegion =', '\n  function trimCurrentRegion('),
  section('  function editNotes(', '\n  function updateNotes('),
  section('  function updateNotes(', '\n  function moveNoteSelection('),
  section('  function projectForSave(', '\n  async function saveOriginalMidi('),
  section('  async function save(', '\n  async function newProject('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const contexts = transformSync(section('  const numberGeneration =', '\n  const liveNumberContext ='), { loader: 'ts', target: 'es2022' }).code;
const evaluateContext = Function('project', 'numberEditOwner', 'region', 'pattern', 'selectedNotes', 'editorDocumentKey', `${contexts}\nreturn {numberGeneration,numberContext};`);
const labels = { tick: '音符开始拍', duration: '音符显示时值', region: '片段长度', height: '音符上下位置' } as const;
type Field = keyof typeof labels;
const NumberMarker = () => undefined;
const element = (type: unknown, props: Record<string, any>) => ({ type, props });
const bindings = Object.fromEntries(Object.entries(labels).map(([field, label]) => {
  const start = source.indexOf(`<CommitNumberInput aria-label="${label}"`), end = source.indexOf(' />', start);
  if (start < 0 || end < 0) throw new Error(`Actual inspector number binding missing: ${label}`);
  return [field, transformSync(`return ${source.slice(start, end + 3)};`, { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code];
})) as Record<Field, string>;
interface AppFunctions {
  setNumberPending: (field: string, pending: boolean) => void;
  commitNoteNumber: (patch: Partial<Note>) => void | boolean;
  commitRegionLength: (value: number) => void | boolean;
  finishNumberDraft: () => boolean;
  save: () => Promise<boolean>;
}

function fixture(field: Field, setup: (project: Project) => void = () => {}) {
  const initial = createProject('Inspector timing fixture'); initial.ppq = 480;
  initial.patterns[0].notes = [
    { ...newNote(17.25, 60, 91.5), id: 'selected-note', velocity: .7, pan: -.2, detune: 9.125, height: .25, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 3 } },
    { ...newNote(137.25, 67, 360), id: 'other-note', velocity: .4, pan: .3, detune: -12.5, height: -.5 },
  ];
  initial.patterns[0].midiEvents = [{ id: 'untouched-controller', tick: 240, order: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127 } }];
  setup(initial);
  const before = structuredClone(initial), state = { project: initial, revision: 0, dirty: false, pending: false };
  const projectRef = { current: initial }, numberEditOwner = { current: { project: initial, generation: 0 } }, savedSnapshot = { current: initial as Project | undefined };
  const selectedNotes = new Set(['selected-note']), liveNumberContext = { current: '' }, numberDrafts = { current: new Set<string>() };
  const history = { current: [] as unknown[] }, future = { current: [{ label: 'preserved-redo', project: initial }] as unknown[] };
  const files: Uint8Array[] = [], commits: { value: number; result: void | boolean }[] = [], pendingEvents: boolean[] = [];
  const setMessage = vi.fn(), encode = vi.fn(saveNbsx);
  const desktop = { saveFile: vi.fn(async (_name: string, bytes: Uint8Array) => { files.push(bytes.slice()); return 'saved.nbsx'; }), clearRecovery: vi.fn(async () => {}) };
  let input: ReturnType<typeof createNumberInputHarness>, app: AppFunctions;
  function parentRender() {
    const project = state.project;
    const { region, pattern, track, notes } = resolveEditorSelection(project, { trackId: initial.tracks[0].id, regionId: initial.regions[0].id, noteIds: [...selectedNotes], focus: 'piano' });
    const context = evaluateContext(project, numberEditOwner, region, pattern, selectedNotes, 4);
    liveNumberContext.current = context.numberContext;
    const scope = { project, projectRef, numberEditOwner, ...context, liveNumberContext, region, pattern, track, selectedNotes, numberDrafts,
      selectedRegions: new Set([initial.regions[0].id]), selectedRegionsRef: { current: new Set([initial.regions[0].id]) }, regionGroupIssue: '',
      setHasNumberDraft: (value: boolean) => { state.pending = value; }, setMessage, produce, history, future,
      selectionSnapshot: (value = projectRef.current) => normalizeEditorSelection(value, { trackId: track?.id, regionId: region?.id, noteIds: [...selectedNotes], focus: 'piano' }),
      setProject: (value: Project) => { state.project = value; }, setDirty: (value: boolean) => { state.dirty = value; }, setRevision: (update: (value: number) => number) => { state.revision = update(state.revision); },
      changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, inspectorBeatTicks, noteTimingError, regionLengthError,
      portable: false, library: undefined, flattenNotes, bytesToBase64, saveNbsx: encode,
      flushActiveNumberInput: () => input.flush(), previewRecordingProject, recordingProjectsEqual, keysHeld: { current: new Map() }, engine: { position: () => undefined }, editorDocumentKey: 4,
      savedSnapshot, filePath: undefined, setFilePath: vi.fn(), setRecovery: vi.fn(), window: { desktop }, localStorage: { removeItem: vi.fn() } };
    app = Function(...Object.keys(scope), `${code}\nreturn {setNumberPending,commitNoteNumber,commitRegionLength,finishNumberDraft,save};`)(...Object.values(scope)) as AppFunctions;
    const jsxScope = { ...scope, ...app, firstNote: notes[0], MAX_PROJECT_TICK, CommitNumberInput: NumberMarker, element };
    const { props: actual } = Function(...Object.keys(jsxScope), bindings[field])(...Object.values(jsxScope)) as { props: CommitNumberInputProps };
    const props = { ...actual, onCommit: (value: number) => { const result = actual.onCommit(value); commits.push({ value, result }); return result; },
      onPendingChange: (pending: boolean) => { pendingEvents.push(pending); actual.onPendingChange?.(pending); } };
    if (input) input.update(props); else input = createNumberInputHarness(props);
  }
  parentRender();
  return { before, state, projectRef, numberEditOwner, savedSnapshot, numberDrafts, history, future, commits, pendingEvents, files, desktop, setMessage, encode, parentRender,
    input: () => input, app: () => app, saved: () => openNbsx(files.at(-1)!) };
}
const withoutTimestamp = (project: Project) => { const copy = structuredClone(project); delete (copy as Partial<Project>).modifiedAt; return copy; };

describe('inspector timing through actual input and App callbacks (isolated integration)', () => {
  it.each(['tick', 'duration', 'region'] as const)('rejects a huge %s scalar at the actual JSX max without calling the business callback', async field => {
    const test = fixture(field), input = test.input(), max = MAX_PROJECT_TICK / test.before.ppq, future = test.future.current;
    expect(input.props().max).toBe(max); input.change(String(max * 2)); input.key('Enter');
    expect(await test.app().save()).toBe(false); expect(test.commits).toEqual([]); expect(input.render().props['aria-invalid']).toBe(true);
    expect(test.projectRef.current).toBe(test.savedSnapshot.current); expect(test.projectRef.current).toEqual(test.before);
    expect(test.history.current).toHaveLength(0); expect(test.future.current).toBe(future); expect(test.encode).not.toHaveBeenCalled(); expect(test.desktop.saveFile).not.toHaveBeenCalled();
  });

  it('rejects a scalar inside max whose bar-ceiling overflows, preserves blurred pending, then saves the corrected full project', async () => {
    const test = fixture('tick'), input = test.input(), value = (MAX_PROJECT_TICK - 1) / test.before.ppq, future = test.future.current;
    expect(value).toBeLessThan(input.props().max!); input.change(String(value)); input.key('Enter');
    expect(test.commits).toEqual([{ value, result: false }]); expect(test.setMessage.mock.calls.some(([message]) => String(message).includes('小节进位'))).toBe(true);
    expect(await test.app().save()).toBe(false); expect(input.document.activeElement).toBe(input.input);
    input.blur(); input.document.activeElement = { anotherField: true };
    expect(input.flush()).toBe(true); expect(input.render().props.value).toBe(String(value)); expect(input.render().props['aria-invalid']).toBe(true);
    expect(test.state.pending).toBe(true); expect(test.numberDrafts.current).toEqual(new Set(['tick']));
    expect(await test.app().save()).toBe(false); expect(test.encode).not.toHaveBeenCalled(); expect(test.desktop.saveFile).not.toHaveBeenCalled();
    expect(test.projectRef.current).toEqual(test.before); expect(test.history.current).toHaveLength(0); expect(test.future.current).toBe(future);
    input.input.focus(); input.change('1.25'); expect(await test.app().save()).toBe(true);
    const expected = structuredClone(test.before); expected.patterns[0].notes[0].tick = 600;
    expect(withoutTimestamp(test.saved())).toEqual(withoutTimestamp(expected)); expect(test.history.current).toHaveLength(1);
    expect(test.state.pending).toBe(false); expect(test.numberDrafts.current.size).toBe(0); expect(test.state.dirty).toBe(false);
  });

  it('rejects a loop expansion above two million occurrences without allocating or changing the source', async () => {
    const test = fixture('region', project => {
      project.ppq = 1; project.patterns[0].length = project.regions[0].length = 1; project.regions[0].loop = true;
      project.patterns[0].notes = [{ ...newNote(0, 60, 1), id: 'selected-note' }]; project.patterns[0].midiEvents = [];
    });
    test.input().change('2000001'); test.input().key('Enter'); expect(await test.app().save()).toBe(false);
    expect(test.commits.every(commit => commit.result === false)).toBe(true); expect(test.commits.length).toBeGreaterThan(0);
    expect(test.setMessage.mock.calls.some(([message]) => String(message).includes('200 万'))).toBe(true);
    expect(test.projectRef.current).toEqual(test.before); expect(test.history.current).toHaveLength(0); expect(test.encode).not.toHaveBeenCalled();
    expect(test.input().render().props['aria-invalid']).toBe(true); expect(test.state.pending).toBe(true);
  });

  it.each(['selected', 'unselected'] as const)('does not grow a source when a height edit leaves a legacy far %s note onset untouched', async far => {
    const test = fixture('height', project => { project.patterns[0].notes[far === 'selected' ? 0 : 1].tick = MAX_PROJECT_TICK - 1; });
    test.input().change('1.875'); expect(await test.app().save()).toBe(true);
    const expected = structuredClone(test.before); expected.patterns[0].notes[0].height = 1.875;
    expect(withoutTimestamp(test.saved())).toEqual(withoutTimestamp(expected)); expect(test.projectRef.current.patterns[0].length).toBe(test.before.patterns[0].length);
    expect(test.projectRef.current.regions[0].length).toBe(test.before.regions[0].length); expect(test.history.current).toHaveLength(1);
  });

  it.each([21, 27, 480, 32767])('accepts the maximum independent duration at PPQ %s even when onset plus duration exceeds the scalar limit', async ppq => {
    const test = fixture('duration', project => { project.ppq = ppq; }); test.input().change(String(MAX_PROJECT_TICK / test.before.ppq)); expect(await test.app().save()).toBe(true);
    const expected = structuredClone(test.before); expected.patterns[0].notes[0].duration = MAX_PROJECT_TICK;
    expect(withoutTimestamp(test.saved())).toEqual(withoutTimestamp(expected)); expect(test.history.current).toHaveLength(1);
    expect(test.projectRef.current.patterns[0].notes[0].tick + test.projectRef.current.patterns[0].notes[0].duration).toBeGreaterThan(MAX_PROJECT_TICK);
  });

  it('keeps the loop period unchanged for a fractional onset still inside the source end', async () => {
    const test = fixture('tick', project => {
      project.ppq = 1; project.patterns[0].length = 1; project.regions[0].length = 8; project.regions[0].loop = true;
      project.patterns[0].notes = [{ ...newNote(.25, 60, .5), id: 'selected-note' }]; project.patterns[0].midiEvents = [];
    });
    test.input().change('.9375'); expect(await test.app().save()).toBe(true);
    const expected = structuredClone(test.before); expected.patterns[0].notes[0].tick = .9375;
    expect(withoutTimestamp(test.saved())).toEqual(withoutTimestamp(expected)); expect(test.projectRef.current.patterns[0].length).toBe(1);
    expect(test.projectRef.current.regions[0].length).toBe(8); expect(test.history.current).toHaveLength(1);
  });
});
