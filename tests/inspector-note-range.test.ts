import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { changeSelectedNotes } from '../src/core/editor-commands';
import { normalizeEditorSelection } from '../src/core/editor-selection';
import { applyNoteEdit } from '../src/core/note-edit';
import { createProject, newNote } from '../src/core/project';
import { captureEditorPointer } from '../src/ui/pointer-capture';
import type { CommitRangeInputProps } from '../src/ui/CommitRangeInput';
import type { Note, Project } from '../src/core/types';
import { createNumberInputHarness } from './helpers/commit-number-harness';

// Actual component callbacks + App functions/JSX with inert hooks and an engine
// observation boundary. These are not browser input or acoustic assertions.
const rangeSource = readFileSync(new URL('../src/ui/CommitRangeInput.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const rangeCode = transformSync(rangeSource.replace(/^import .*;$/gm, '').replaceAll('export function ', 'function '), { loader: 'tsx', target: 'es2022', jsxFactory: 'element' }).code;
type Node = { type: unknown; props: Record<string, any> };
class Events {
  listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(name: string, callback: (event: any) => void) { const set = this.listeners.get(name) ?? new Set(); set.add(callback); this.listeners.set(name, set); }
  removeEventListener(name: string, callback: (event: any) => void) { this.listeners.get(name)?.delete(callback); }
  fire(name: string, event: any = {}) { for (const callback of [...(this.listeners.get(name) ?? [])]) callback(event); }
  count() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
function rangeFixture(options: Partial<CommitRangeInputProps> = {}) {
  let liveOwner = {}, props: CommitRangeInputProps = { value: 50, min: 0, max: 100, 'aria-label': 'Inspector test', contextKey: 'selection-a', owner: liveOwner, getOwner: () => liveOwner,
    onCommit: vi.fn(), onPreview: vi.fn(), formatValue: value => value + '%', ...options };
  if (options.owner) liveOwner = options.owner;
  const hooks: any[] = [], effects: (() => void)[] = [], view = new Events(), document = { activeElement: null as unknown, defaultView: view };
  let hook = 0, dirty = false, mounted = true, writesAfterUnmount = 0, tree: Node, node: Node, afterFlush = () => {};
  const captures = new Set<number>();
  const input: any = Object.assign(new Events(), { ownerDocument: document, value: '',
    focus: vi.fn(() => { if (document.activeElement === input) return; document.activeElement = input; node.props.onFocus?.(); input.focusHook?.(); }),
    blur: () => { if (document.activeElement !== input) return; document.activeElement = null; node.props.onBlur(); },
    setPointerCapture: vi.fn((pointer: number) => captures.add(pointer)), hasPointerCapture: (pointer: number) => captures.has(pointer),
    releasePointerCapture: vi.fn((pointer: number) => { captures.delete(pointer); node.props.onLostPointerCapture({ pointerId: pointer }); input.releaseHook?.(); }),
  });
  const useRef = (initial: unknown) => { const index = hook++; return hooks[index] ??= { current: initial }; };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], (next: any) => { if (!mounted) writesAfterUnmount++; const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous = hooks[index];
    if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const next: any = { deps }; hooks[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
  };
  const element = (type: unknown, attributes: any, ...children: any[]): Node => ({ type, props: { ...attributes, children } });
  const flushSync = (callback: () => void) => { callback(); afterFlush(); render(); };
  const dependencies = { useRef, useState, useEffect, useLayoutEffect: useEffect, element, flushSync, captureEditorPointer };
  const Component = Function(...Object.keys(dependencies), rangeCode + '\nreturn CommitRangeInput;')(...Object.values(dependencies));
  function render(layout = true) {
    let attempts = 0;
    do { hook = 0; dirty = false; tree = Component(props); node = tree.props.children.find((child: Node) => child.type === 'input'); input.value = String(node.props.value);
      if (layout) while (effects.length) effects.shift()!(); if (++attempts > 20) throw Error('Range callback harness did not settle');
    } while (layout && dirty); return node;
  }
  const event = (patch: Record<string, unknown> = {}) => ({ currentTarget: input, button: 0, pointerId: 7, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch });
  render();
  return { input, view, document, captures, render, props: () => props, afterFlush: (callback: () => void) => { afterFlush = callback; },
    update: (patch: Partial<CommitRangeInputProps>, layout = true) => { props = { ...props, ...patch }; return render(layout); },
    down: (patch: Record<string, unknown> = {}) => { const e = event(patch); render().props.onPointerDown(e); render(); return e; },
    change: (value: number) => { render(); input.value = String(value); node.props.onChange({ currentTarget: input }); render(); },
    up: (pointerId = 7) => { render().props.onPointerUp(event({ pointerId })); render(); },
    key: (key: string) => { const e = event({ key }); render().props.onKeyDown(e); render(); return e; },
    cancel: (pointerId = 7) => { render().props.onPointerCancel(event({ pointerId })); render(); },
    blur: () => { input.blur(); render(); }, setLiveOwner: (owner: object) => { liveOwner = owner; },
    listeners: () => view.count() + input.count(),
    unmount: () => { mounted = false; for (const slot of hooks) slot?.cleanup?.(); }, writesAfterUnmount: () => writesAfterUnmount,
  };
}

const appSource = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string) { const from = appSource.indexOf(start), to = appSource.indexOf(end, from + start.length); if (from < 0 || to < 0) throw Error('Inspector App boundary missing: ' + start); return appSource.slice(from, to); }
const appCode = transformSync([
  section('  function commit(', '\n  const changeTrack ='),
  section('  function updateRealtimeProject(', '\n  function filterInstruments('),
  section('  function editNotes(', '\n  function setNumberPending('),
  section('  function commitNoteNumber(', '\n  function commitRegionLength('),
  section('  function finishNumberDraft(', '\n  function changeTrackDelay('),
  section('  function undo()', '\n  function copyNotes('),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;
const contextCode = transformSync(section('  const numberGeneration =', '\n  const liveNumberContext =') + '\n' + appSource.split('\n').find(line => line.startsWith('  const noteRangeContext =')),
  { loader: 'ts', target: 'es2022' }).code;
function binding(label: string) { const start = appSource.indexOf(`<CommitRangeInput aria-label="${label}"`), end = appSource.indexOf(' />', start); if (start < 0 || end < 0) throw Error('Actual inspector slider binding missing: ' + label);
  return transformSync('return ' + appSource.slice(start, end + 3) + ';', { loader: 'tsx', target: 'es2022', jsxFactory: 'element' }).code; }
const bindings = { velocity: binding('音符力度'), pan: binding('音符左右声像') };
function appFixture() {
  const initial = createProject('Inspector drag fixture'); initial.ppq = 480; initial.patterns[0].length = initial.regions[0].length = 1920;
  initial.patterns[0].notes = [
    { ...newNote(0, 60, 240), id: 'a', velocity: .25, pan: -.25, detune: 12.5, midiSource: { onOrder: 1, offOrder: 4, releaseVelocity: 35, offSourceTrack: 3 } },
    { ...newNote(480, 64, 720), id: 'b', velocity: .75, pan: .5, instrumentId: 'bell', height: .25, midiSource: { onOrder: 5, offOrder: 8, releaseVelocity: 63, offSourceTrack: 3 } },
    { ...newNote(1200, 72, 120), id: 'guard', velocity: .125, pan: -.5 },
  ];
  initial.patterns[0].midiEvents = [{ id: 'controller', tick: 120, sourceTrack: 1, order: 2, event: { type: 'controller', deltaTime: 0, channel: 1, controllerType: 11, value: 96 } }];
  const projectRef = { current: initial }, numberEditOwner = { current: { project: initial, generation: 0 } }, noteRangePreview = { current: undefined as any }, liveNumberContext = { current: '' }, numberDrafts = { current: new Set<string>() };
  const history = { current: [] as any[] }, future = { current: [{ label: 'original-redo', project: initial }] as any[] }, savedSnapshot = { current: initial };
  const state = { dirty: false, selected: new Set(['a', 'b']) }, setMessage = vi.fn(), updateProject = vi.fn((_project: Project) => true);
  const engine = { updateProject, playing: true }, finishHeld = { current: vi.fn() }; let flush = () => true;
  const element = (_type: unknown, props: CommitRangeInputProps) => props;
  function functions() {
    const project = projectRef.current, region = project.regions[0], pattern = project.patterns.find(item => item.id === region.patternId)!, track = project.tracks.find(item => item.id === region.trackId)!, selectedNotes = state.selected;
    const dependencies: any = { project, region, pattern, track, selectedNotes, numberEditOwner, editorDocumentKey: 4, useMemo: (create: () => unknown) => create() };
    const context = Function(...Object.keys(dependencies), contextCode + '\nreturn {numberGeneration,numberContext,noteRangeContext};')(...Object.values(dependencies));
    liveNumberContext.current = context.numberContext;
    const scope: any = { ...dependencies, ...context, projectRef, noteRangePreview, liveNumberContext, numberDrafts, produce, applyNoteEdit, changeSelectedNotes, history, future, savedSnapshot,
      engine, setMessage, finishHeld, playbackMode: 'realtime', stop: vi.fn(), setProject: vi.fn(), setDirty: (value: boolean) => { state.dirty = value; }, setRevision: vi.fn(), restoreSelection: vi.fn(),
      flushActiveNumberInput: () => flush(), selectionSnapshot: (value = projectRef.current) => normalizeEditorSelection(value, { trackId: track.id, regionId: region.id, noteIds: [...selectedNotes], focus: 'piano' }),
      firstNote: pattern.notes.find(note => selectedNotes.has(note.id)), CommitRangeInput: 'actual-range-marker', element };
    const app = Function(...Object.keys(scope), appCode + '\nreturn {commit,editNotes,updateNotes,commitNoteNumber,previewNoteRange,updateRealtimeProject,finishNumberDraft,undo,redo};')(...Object.values(scope));
    return { ...app, input: (field: 'velocity' | 'pan'): CommitRangeInputProps => Function(...Object.keys(scope), ...Object.keys(app), bindings[field])(...Object.values(scope), ...Object.values(app)) };
  }
  return { initial, projectRef, numberEditOwner, noteRangePreview, liveNumberContext, numberDrafts, history, future, state, engine, setMessage, functions,
    setFlush: (callback: () => boolean) => { flush = callback; },
    external: (change: (project: Project) => void) => { const next = produce(projectRef.current, change); projectRef.current = next; numberEditOwner.current = { project: next, generation: numberEditOwner.current.generation + 1 }; },
    range: (field: 'velocity' | 'pan') => { const range = rangeFixture(functions().input(field)); range.afterFlush(() => range.update(functions().input(field), false)); return range; } };
}
const model = (project: Project) => { const { modifiedAt: _stamp, ...rest } = project; return rest; };

describe('CommitRangeInput actual callbacks (unit scope)', () => {
  it('auditions every pointer change, then commits once before clearing the preview', () => {
    const calls: any[] = [], test = rangeFixture({ onPreview: value => calls.push(['preview', value]), onCommit: value => { calls.push(['commit', value]); } });
    test.down(); for (const value of [55, 70, 89]) test.change(value);
    expect(calls).toEqual([['preview', 55], ['preview', 70], ['preview', 89]]); expect(test.render().props.value).toBe(89);
    test.up(); test.up(); expect(calls.slice(-2)).toEqual([['commit', 89], ['preview', undefined]]); expect(test.listeners()).toBe(0); expect(test.captures.size).toBe(0);
  });
  it.each(['Escape', 'cancel', 'blur', 'window-blur'])('cancels %s without committing and suppresses a late native change', kind => {
    const test = rangeFixture(); test.down(); test.change(89);
    if (kind === 'Escape') test.key('Escape'); else if (kind === 'cancel') test.cancel(); else if (kind === 'blur') test.blur(); else test.view.fire('blur');
    test.change(89); test.up(); expect(test.props().onCommit).not.toHaveBeenCalled(); expect(test.props().onPreview).toHaveBeenLastCalledWith(undefined); expect(test.listeners()).toBe(0);
  });
  it('ignores foreign pointers and second presses while preserving the original drag', () => {
    const test = rangeFixture(); test.down(); test.change(60); test.cancel(8); test.up(8); test.down({ pointerId: 9 }); test.change(70); test.up();
    expect(test.props().onCommit).toHaveBeenCalledExactlyOnceWith(70); expect(test.input.setPointerCapture).toHaveBeenCalledTimes(1);
  });
  it.each([{ contextKey: 'selection-b' }, { disabled: true }, { value: 30 }, { owner: {} }])('invalidates before effects/release when the target changes: %j', patch => {
    const test = rangeFixture(); test.down(); test.change(80); test.update(patch, false); test.up(); expect(test.props().onCommit).not.toHaveBeenCalled(); expect(test.props().onPreview).toHaveBeenLastCalledWith(undefined);
  });
  it('checks live owner before change and again after capture release', () => {
    const test = rangeFixture(); test.down(); test.change(80); test.setLiveOwner({}); test.up(); expect(test.props().onCommit).not.toHaveBeenCalled();
    const next = rangeFixture(); next.down(); next.change(85); next.input.releaseHook = () => next.setLiveOwner({}); next.up(); expect(next.props().onCommit).not.toHaveBeenCalled(); expect(next.listeners()).toBe(0);
  });
  it('retains precise values on a click or return-to-origin, and keeps keyboard range commits functional after cancellation', () => {
    const test = rangeFixture({ value: 12.3456789, min: -100 }); test.down(); test.up(); test.down(); test.change(30); test.change(12.3456789); test.up();
    expect(test.props().onCommit).not.toHaveBeenCalled(); test.down(); test.change(40); test.key('Escape'); test.key('ArrowRight'); test.change(13.3456789);
    expect(test.props().onCommit).toHaveBeenCalledExactlyOnceWith(13.3456789);
  });
  it('cleans up an unmounted gesture without state writes or a later release commit', () => {
    const test = rangeFixture(); test.down(); test.change(80); test.unmount(); expect(test.writesAfterUnmount()).toBe(0); expect(test.listeners()).toBe(0); expect(test.captures.size).toBe(0); expect(test.props().onCommit).not.toHaveBeenCalled();
  });
});

describe('actual Inspector bindings and App history/preview boundary (isolated integration)', () => {
  it.each(['velocity', 'pan'] as const)('previews batch %s immutably and commits one complete Undo/Redo transaction', field => {
    const test = appFixture(), before = structuredClone(test.initial), redo = test.future.current, range = test.range(field), final = field === 'velocity' ? 89 : -35;
    range.down(); for (const value of [55, 70, final]) range.change(value);
    expect(test.projectRef.current).toBe(test.initial); expect(test.projectRef.current).toEqual(before); expect(test.history.current).toEqual([]); expect(test.future.current).toBe(redo); expect(test.state.dirty).toBe(false);
    const preview = test.engine.updateProject.mock.calls.at(-1)![0]; expect(preview).not.toBe(test.initial);
    expect(preview.patterns[0].notes.slice(0, 2).map(note => note[field])).toEqual([final / 100, final / 100]); expect(preview.patterns[0].notes[2]).toEqual(before.patterns[0].notes[2]);
    test.functions().updateRealtimeProject(test.initial); expect(test.engine.updateProject).toHaveBeenLastCalledWith(preview);
    range.up(); const next = test.projectRef.current, expected = structuredClone(before); expected.patterns[0].notes[0][field] = expected.patterns[0].notes[1][field] = final / 100;
    expect(model(next)).toEqual(model(expected)); expect(test.history.current).toHaveLength(1); expect(test.future.current).toEqual([]); expect(test.noteRangePreview.current).toBeUndefined(); expect(test.engine.updateProject).toHaveBeenLastCalledWith(next);
    expect(model(openNbsx(saveNbsx(next)))).toEqual(model(expected)); test.functions().undo(); expect(test.projectRef.current).toBe(test.initial); test.functions().redo(); expect(test.projectRef.current).toBe(next);
  });
  it('keeps a new preview when an old callback clears, and restores the latest external document on stale cancellation', () => {
    const test = appFixture(), first = test.functions().previewNoteRange('velocity'), next = test.functions().previewNoteRange('pan'); first(80); next(-25);
    const preview = test.noteRangePreview.current; first(undefined); expect(test.noteRangePreview.current).toBe(preview); expect(test.engine.updateProject).toHaveBeenLastCalledWith(preview.project);
    test.external(project => { project.tracks[0].name = 'External write'; }); next(undefined); expect(test.engine.updateProject).toHaveBeenLastCalledWith(test.projectRef.current); expect(test.history.current).toEqual([]);
  });
  it.each(['selection', 'lock', 'undo', 'same-ID replacement'])('cancels %s changes without overwriting the newer source or redo', kind => {
    const test = appFixture(), range = test.range('velocity'); range.down(); range.change(90);
    if (kind === 'selection') test.state.selected = new Set(['guard']);
    else if (kind === 'lock') test.external(project => { project.tracks[0].locked = true; });
    else if (kind === 'same-ID replacement') test.external(project => { project.name = 'Reopened document with unchanged IDs'; });
    else { test.functions().commit('Other edit', (project: Project) => { project.tracks[0].name = 'Other edit'; }); test.functions().undo(); }
    const latest = test.projectRef.current, history = [...test.history.current], future = test.future.current;
    range.update(test.functions().input('velocity')); range.up(); expect(test.projectRef.current).toBe(latest); expect(test.history.current).toEqual(history); expect(test.future.current).toBe(future); expect(test.engine.updateProject).toHaveBeenLastCalledWith(latest);
  });
  it('flushes a real numeric draft before capturing the fresh owner, preserving both edits', () => {
    const test = appFixture(), original = test.functions(), number = createNumberInputHarness({ value: 12.5, min: -32768, max: 32767, onCommit: value => original.commitNoteNumber({ detune: value }), onPendingChange: pending => { if (pending) test.numberDrafts.current.add('detune'); else test.numberDrafts.current.delete('detune'); } });
    number.change('123.5'); test.setFlush(number.flush); const range = test.range('velocity'); range.down(); range.change(89); range.up();
    expect(test.history.current).toHaveLength(2); expect(test.projectRef.current.patterns[0].notes.slice(0, 2).map(note => [note.detune, note.velocity])).toEqual([[123.5, .89], [123.5, .89]]);
    expect(test.numberDrafts.current.size).toBe(0); number.unmount();
  });
  it('does not start a range drag or publish a keyboard edit when a rejected numeric draft remains pending', () => {
    const test = appFixture(), number = createNumberInputHarness({ onCommit: () => false, onPendingChange: pending => { if (pending) test.numberDrafts.current.add('detune'); else test.numberDrafts.current.delete('detune'); } });
    number.change('2.5'); number.blur(); test.setFlush(number.flush); const range = test.range('pan'); range.down(); range.change(-50); range.up();
    expect(range.captures.size).toBe(0); expect(test.projectRef.current).toBe(test.initial); expect(test.history.current).toEqual([]); expect(test.engine.updateProject).not.toHaveBeenCalled(); expect(test.numberDrafts.current.has('detune')).toBe(true); number.unmount();
  });
  it('prevents default focus on a refused press and suppresses its native change even if the parse-invalid draft later blurs', () => {
    const test = appFixture(), number = createNumberInputHarness({ value: 12.5, min: -32768, max: 32767, onPendingChange: pending => { if (pending) test.numberDrafts.current.add('detune'); else test.numberDrafts.current.delete('detune'); } });
    number.change(''); test.setFlush(number.flush); const range = test.range('velocity'), down = range.down();
    expect(down.preventDefault).toHaveBeenCalledOnce(); expect(number.document.activeElement).toBe(number.input); expect(number.render().props.value).toBe('');
    expect(range.input.focus).not.toHaveBeenCalled(); expect(range.captures.size).toBe(0);
    // Explicit inert default-boundary negative: even an external focus/blur
    // after rejection must not reinterpret this pointer's late change as keys.
    number.blur(); range.input.focus(); range.change(89); range.up();
    expect(test.numberDrafts.current.size).toBe(0); expect(test.projectRef.current).toBe(test.initial); expect(test.history.current).toEqual([]); expect(test.engine.updateProject).not.toHaveBeenCalled();
    const accepted = range.down(); expect(accepted.preventDefault).not.toHaveBeenCalled(); range.change(89); range.up(); expect(test.history.current).toHaveLength(1); number.unmount();
  });
});
