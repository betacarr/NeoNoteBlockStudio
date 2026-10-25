import { applyNoteEdit } from '../src/core/note-edit';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { createNumberInputHarness } from './helpers/commit-number-harness';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { changeSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { growEditedPattern } from '../src/core/editor-interaction';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { normalizeEditorSelection, resolveEditorSelection } from '../src/core/editor-selection';
import { beginRecordedPress, finishRecordedPress, previewRecordingProject, recordingProjectsEqual, type RecordedPress } from '../src/core/recording';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createDefaultDelay, delayEnvelope } from '../src/core/delay';
import type { DelayEffect, Note, Project } from '../src/core/types';
import type { CommitNumberInputProps } from '../src/ui/CommitNumberInput';

// Actual component callbacks, App closures/contexts/JSX bindings, and recording
// completion run together. Hook, desktop and audio boundaries remain inert;
// these assertions do not claim DOM focus, synthesized input or GUI acceptance.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`App draft/recording boundary missing: ${start} / ${end}`);
  return source.slice(from, to);
}
const code = transformSync([
  section('  function commit(', '\n  const changeTrack ='),
  section('  const changeRegion =', '\n  function trimCurrentRegion('),
  section('  function editNotes(', '\n  function updateNotes('),
  section('  function updateNotes(', '\n  function moveNoteSelection('),
  section('  function projectForSave(', '\n  async function saveOriginalMidi('),
  section('  async function save(', '\n  async function newProject('),
  section('  finishHeld.current = (keys =', '\n  midiUp.current ='),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const contexts = transformSync(section('  const numberGeneration =', '\n  const liveNumberContext =')
  + section('  const delayContext =', '\n  const liveDelayContext ='), { loader: 'ts', target: 'es2022' }).code;
const evaluateContexts = Function('project', 'numberEditOwner', 'region', 'pattern', 'track', 'selectedNotes', 'editorDocumentKey', `${contexts}\nreturn {numberGeneration,numberContext,delayContext};`);

type Element = { type: unknown; props: Record<string, any> };
const NumberMarker = () => undefined;
const element = (type: unknown, props: any, ...children: any[]): Element => ({ type, props: { ...props, children } });
function bindingCode(start: string) {
  const from = source.indexOf(start), end = source.indexOf(' />', from);
  if (from < 0 || end < 0) throw new Error(`Actual App number input missing: ${start}`);
  return transformSync(`return ${source.slice(from, end + 3)};`, { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
}
const heightBinding = bindingCode('<CommitNumberInput aria-label="音符上下位置"');
const regionBinding = bindingCode('<CommitNumberInput aria-label="片段长度"');
const delayBinding = bindingCode('<DelayEditor value={track.delay}');
const panelSource = readFileSync(new URL('../src/ui/DelayEditor.tsx', import.meta.url), 'utf8');
const panelCode = transformSync(panelSource.slice(panelSource.indexOf('const TIME_FIELDS =')).replace('export function DelayEditor(', 'function DelayEditor('),
  { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
const DelayPanel = Function('createDefaultDelay', 'delayEnvelope', 'CommitNumberInput', 'element', `${panelCode}\nreturn DelayEditor;`)(createDefaultDelay, delayEnvelope, NumberMarker, element);
function elements(node: Element): Element[] {
  return [node, ...(node.props.children ?? []).flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
}

interface AppFunctions {
  commit: (label: string, change: (project: Project) => void, preserveNumberDraft?: boolean) => void;
  commitNoteNumber: (patch: Partial<Note>) => void;
  commitRegionLength: (value: number) => void;
  changeTrackDelay: (value: DelayEffect) => void;
  setNumberPending: (field: string, pending: boolean) => void;
  finishNumberDraft: () => boolean;
  save: () => Promise<boolean>;
  finishHeld: (keys?: string[]) => void;
}

function fixture(field: 'height' | 'region' | 'delay' = 'height') {
  const initial = createProject('Draft and recording'); initial.ppq = 480;
  initial.patterns[0].length = initial.regions[0].length = 960;
  initial.patterns[0].notes = [{ ...newNote(0, 60, 120), id: 'selected-note', height: .25 }, { ...newNote(120, 64, 240), id: 'other-note', height: -.5 }];
  initial.tracks[0].delay = createDefaultDelay();
  const state = { project: initial, revision: 0, dirty: false, pending: false, documentKey: 4, playhead: 0 };
  const selectedNotes = new Set(['selected-note']), projectRef = { current: initial }, numberEditOwner = { current: { project: initial, generation: 0 } };
  const history = { current: [] as any[] }, future = { current: [] as any[] }, numberDrafts = { current: new Set<string>() };
  const savedSnapshot = { current: initial as Project | undefined }, keysHeld = { current: new Map<string, RecordedPress>() }, positionRef = { current: 0 };
  const liveNumberContext = { current: '' }, liveDelayContext = { current: '' };
  const pendingEvents: boolean[] = [], committedValues: number[] = [], files: Uint8Array[] = [];
  const setMessage = vi.fn(), engine = { position: () => undefined };
  const window = { desktop: { saveFile: vi.fn(async (_name: string, bytes: Uint8Array) => { files.push(bytes.slice()); return 'saved.nbsx'; }), clearRecovery: vi.fn(async () => {}) } };
  let input: ReturnType<typeof createNumberInputHarness>, app: AppFunctions, currentContext: { numberGeneration: number; numberContext: string; delayContext: string };
  function parentRender() {
    const project = state.project;
    const { region, pattern, track, notes } = resolveEditorSelection(project, { trackId: initial.tracks[0].id, regionId: initial.regions[0].id, noteIds: [...selectedNotes], focus: 'piano' });
    const selectedRegions = new Set(region ? [region.id] : []), selectedRegionsRef = { current: selectedRegions };
    currentContext = evaluateContexts(project, numberEditOwner, region, pattern, track, selectedNotes, state.documentKey);
    liveNumberContext.current = currentContext.numberContext; liveDelayContext.current = currentContext.delayContext;
    const finishHeld = { current: (_keys?: string[]) => {} };
    const scope = { project, projectRef, numberEditOwner, ...currentContext, liveNumberContext, liveDelayContext, region, pattern, track, selectedNotes, selectedRegions, selectedRegionsRef, regionGroupIssue: '',
      produce, history, future, numberDrafts, setHasNumberDraft: (value: boolean) => { state.pending = value; }, setMessage,
      selectionSnapshot: (value = projectRef.current) => normalizeEditorSelection(value, { trackId: track?.id, regionId: region?.id, noteIds: [...selectedNotes], focus: 'piano' }),
      setProject: (value: Project) => { state.project = value; }, setDirty: (value: boolean) => { state.dirty = value; }, setRevision: (update: (value: number) => number) => { state.revision = update(state.revision); },
      changeSelectedNotes, notesUnchanged, applyNoteEdit, growEditedPattern, MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError, portable: false, library: undefined, flattenNotes, bytesToBase64, saveNbsx,
      flushActiveNumberInput: () => input.flush(), previewRecordingProject, recordingProjectsEqual, finishRecordedPress, keysHeld, engine, editorDocumentKey: state.documentKey,
      savedSnapshot, filePath: undefined, setFilePath: vi.fn(), setRecovery: vi.fn(), window, localStorage: { removeItem: vi.fn() }, finishHeld,
      setHasHeldRecording: vi.fn(), positionRef, setPlayhead: (value: number) => { state.playhead = value; } };
    app = Function(...Object.keys(scope), `${code}\nreturn {commit,commitNoteNumber,commitRegionLength,changeTrackDelay,setNumberPending,finishNumberDraft,save,finishHeld:finishHeld.current};`)(...Object.values(scope)) as AppFunctions;
    const jsxScope = { ...scope, ...app, firstNote: notes[0], CommitNumberInput: NumberMarker, DelayEditor: NumberMarker, element,
      delayPreviewDuration: { beats: 1, seconds: .5 }, tempoMap: { at: () => ({ bpm: 120 }) }, delayPreviewOrigin: 0 };
    const compiledBinding = field === 'height' ? heightBinding : field === 'region' ? regionBinding : delayBinding;
    const binding = Function(...Object.keys(jsxScope), compiledBinding)(...Object.values(jsxScope)) as Element;
    const actual = field === 'delay' ? elements(DelayPanel(binding.props)).find(node => node.type === NumberMarker && node.props['aria-label'] === 'Delay 回声间隔')!.props : binding.props;
    const props = { ...actual, onCommit: (value: number) => { committedValues.push(value); return actual.onCommit(value); },
      onPendingChange: (pending: boolean) => { pendingEvents.push(pending); actual.onPendingChange(pending); } } as CommitNumberInputProps;
    if (input) input.update(props); else input = createNumberInputHarness(props);
    return app;
  }
  parentRender();
  function appendRecording(tick = 240) {
    const current = projectRef.current, region = current.regions[0];
    const press = beginRecordedPress(current, region, 72, .6, tick, undefined, true, 16, 8, state.documentKey)!;
    const key = `held:${press.noteId}`; keysHeld.current.set(key, press); app.finishHeld([key]); return press;
  }
  return { state, projectRef, numberEditOwner, numberDrafts, pendingEvents, committedValues, files, window, parentRender, appendRecording,
    input: () => input, app: () => app, context: () => currentContext, selectedNotes };
}

describe('real numeric drafts through App recording commits (callback integration)', () => {
  it('retains the actual draft and pending across a parent rerender, then Enter edits the latest project', () => {
    const test = fixture(), context = test.context().numberContext;
    test.input().change('2.75'); const recorded = test.appendRecording(); test.parentRender();
    expect(test.state.revision).toBe(1); expect(test.numberEditOwner.current.generation).toBe(0); expect(test.context().numberContext).toBe(context);
    expect(test.input().render().props.value).toBe('2.75'); expect(test.state.pending).toBe(true); expect(test.pendingEvents).toEqual([true]);
    test.input().key('Enter');
    expect(test.projectRef.current.patterns[0].notes.map(note => note.id)).toEqual(['selected-note', 'other-note', recorded.noteId]);
    expect(test.projectRef.current.patterns[0].notes[0].height).toBe(2.75); expect(test.projectRef.current.patterns[0].notes[1].height).toBe(-.5);
    expect(test.committedValues).toEqual([2.75]); expect(test.pendingEvents).toEqual([true, false]); expect(test.state.pending).toBe(false);
  });

  it.each([false, true])('Save flush commits after recording append, with a parent rerender: %s', async rerender => {
    const test = fixture(); test.input().change('3.125'); const recorded = test.appendRecording(); if (rerender) test.parentRender();
    const expected = structuredClone(test.projectRef.current); expected.patterns[0].notes[0].height = 3.125;
    expect(await test.app().save()).toBe(true);
    expect(test.committedValues).toEqual([3.125]); expect(test.state.pending).toBe(false); expect(test.window.desktop.saveFile).toHaveBeenCalledOnce();
    const saved = openNbsx(test.files[0]);
    expect(recordingProjectsEqual(test.projectRef.current, expected)).toBe(true);
    expect(recordingProjectsEqual(saved, expected)).toBe(true);
    expect(saved.patterns[0].notes[0].height).toBe(3.125); expect(saved.patterns[0].notes.map(note => note.id)).toEqual(['selected-note', 'other-note', recorded.noteId]);
    expect(saved.patterns[0].notes.at(-1)).toEqual(test.projectRef.current.patterns[0].notes.at(-1));
  });

  it('cancels a region-length draft when recording changes that same model value', () => {
    const test = fixture('region'); test.input().change('3.5'); const recorded = test.appendRecording(1000); test.parentRender();
    expect(test.projectRef.current.regions[0].length).toBe(1920); expect(test.input().render().props.value).toBe('4');
    expect(test.pendingEvents).toEqual([true, false]); test.input().key('Enter');
    expect(test.committedValues).toEqual([]); expect(test.projectRef.current.regions[0].length).toBe(1920);
    expect(test.projectRef.current.patterns[0].notes.at(-1)?.id).toBe(recorded.noteId);
  });

  it('rejects a stale region-length callback even before the changed value reaches the component', () => {
    const test = fixture('region'); test.input().change('3.5'); test.appendRecording(1000);
    expect(test.input().flush()).toBe(true); expect(test.committedValues).toEqual([3.5]);
    expect(test.projectRef.current.regions[0].length).toBe(1920); test.parentRender(); expect(test.input().render().props.value).toBe('4');
  });

  it('keeps a real Delay field draft across recording and commits through the actual panel and App callback', () => {
    const test = fixture('delay'), context = test.context().delayContext;
    test.input().change('1.25'); const recorded = test.appendRecording(); test.parentRender();
    expect(test.context().delayContext).toBe(context); expect(test.input().render().props.value).toBe('1.25'); expect(test.state.pending).toBe(true);
    test.input().key('Enter');
    expect(test.projectRef.current.tracks[0].delay!.interval).toBe(1.25); expect(test.projectRef.current.patterns[0].notes.at(-1)?.id).toBe(recorded.noteId);
    expect(test.pendingEvents).toEqual([true, false]); expect(test.committedValues).toEqual([1.25]);
  });

  it('ordinary edits still invalidate a note draft on the parent rerender', () => {
    const test = fixture(); test.input().change('2.75');
    test.app().commit('普通编辑', project => { project.description = 'Unrelated ordinary edit'; }); test.parentRender();
    expect(test.numberEditOwner.current.generation).toBe(1); expect(test.input().render().props.value).toBe('0.25');
    expect(test.pendingEvents).toEqual([true, false]); test.input().key('Enter'); expect(test.committedValues).toEqual([]);
    expect(test.projectRef.current.patterns[0].notes[0].height).toBe(.25);
  });

  it('retains an invalid pending draft after recording and rejects the actual App Save flush', async () => {
    const test = fixture(); test.input().change('-'); const recorded = test.appendRecording(); test.parentRender();
    expect(test.input().render().props.value).toBe('-'); expect(test.state.pending).toBe(true);
    expect(test.input().flush()).toBe(false); expect(test.app().finishNumberDraft()).toBe(false); expect(await test.app().save()).toBe(false);
    expect(test.input().render().props.value).toBe('-'); expect(test.input().render().props['aria-invalid']).toBe(true);
    expect(test.input().document.activeElement).toBe(test.input().input); expect(test.state.pending).toBe(true);
    expect(test.pendingEvents).toEqual([true]); expect(test.committedValues).toEqual([]); expect(test.window.desktop.saveFile).not.toHaveBeenCalled();
    expect(test.projectRef.current.patterns[0].notes[0].height).toBe(.25); expect(test.projectRef.current.patterns[0].notes.at(-1)?.id).toBe(recorded.noteId);
  });
});
