import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote, newTrack, uid } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { createTempoMap } from '../src/core/time';
import { inNoteBlockRange, noteName } from '../src/core/instruments';
import { gmPercussionName } from '../src/core/gm-percussion';
import { createNumberInputHarness } from './helpers/commit-number-harness';

type Node = { type: unknown; props: Record<string, any> };
const TextField = () => undefined, NumberField = () => undefined, RangeField = () => undefined;
const element = (type: unknown, props: any, ...children: any[]): Node => ({ type, props: { ...props, children } });
const elements = (node: Node): Node[] => [node, ...node.props.children.flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
function source(name: string, before?: string): string {
  const text = readFileSync(new URL(`../src/ui/${name}.tsx`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  return transformSync((before ? text.slice(0, text.indexOf(before)) : text).replace(/^import .*;$/gm, '').replaceAll('export function ', 'function '), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
}

describe('editor property transaction bindings', () => {
  it('TimingEditor keeps intermediate BPM text local and records one complete node edit', () => {
    let project = createProject('Tempo transactions'); const history: typeof project[] = [], pending = vi.fn();
    const onEdit = (_label: string, edit: (draft: typeof project) => void) => { history.push(project); project = produce(project, edit); };
    const TimingEditor = Function('element', 'useMemo', 'CommitNumberInput', 'Plus', 'Trash', `${source('TimingEditor')}\nreturn TimingEditor;`)(element, (read: () => unknown) => read(), NumberField, 'plus', 'trash');
    const render = () => TimingEditor({ project, meter: createMeterMap(project), tempo: createTempoMap(project), playhead: 0, onEdit, onSeek: vi.fn(), onNumberPending: pending });
    const field = elements(render()).find(node => node.type === NumberField && node.props['aria-label'].startsWith('速度 '))!;
    const input = createNumberInputHarness(field.props);
    for (const value of ['1', '13', '135']) input.change(value);
    expect(project.tempos[0].bpm).toBe(120); expect(history).toHaveLength(0);
    input.key('Enter'); input.blur();
    expect(history).toHaveLength(1); expect(project.tempos[0].bpm).toBe(135); expect(history[0].tempos[0].bpm).toBe(120);
    expect(pending.mock.calls).toEqual([['tempo-0', true], ['tempo-0', false]]);
  });
  it('TimingEditor retains precise existing BPM and stages multi-digit meter numerators', () => {
    const project = createProject('Precise tempo'); project.tempos[0].bpm = 120.123456789;
    const onEdit = vi.fn();
    const TimingEditor = Function('element', 'useMemo', 'CommitNumberInput', 'Plus', 'Trash', `${source('TimingEditor')}\nreturn TimingEditor;`)(element, (read: () => unknown) => read(), NumberField, 'plus', 'trash');
    const nodes = elements(TimingEditor({ project, meter: createMeterMap(project), tempo: createTempoMap(project), playhead: 0, onEdit, onSeek: vi.fn() }));
    const bpm = createNumberInputHarness(nodes.find(node => node.type === NumberField && node.props['aria-label'].startsWith('速度 '))!.props);
    expect(bpm.render().props.value).toBe('120.123456789'); bpm.blur(); expect(onEdit).not.toHaveBeenCalled();
    const meter = createNumberInputHarness(nodes.find(node => node.type === NumberField && node.props['aria-label'].startsWith('拍号分子 '))!.props);
    meter.change('1'); meter.change('12'); expect(onEdit).not.toHaveBeenCalled(); meter.blur();
    expect(onEdit).toHaveBeenCalledOnce(); const changed = produce(project, onEdit.mock.calls[0][1]); expect(changed.timeSignatures[0].numerator).toBe(12);
  });
  it('ReferenceHeader uses a staged start value and invalidates the draft when its reference is replaced', () => {
    let hook = 0; const refs: any[] = [], useRef = (value: unknown) => refs[hook++] ??= { current: value };
    const ReferenceHeader = Function('element', 'useRef', 'CommitNumberInput', 'CommitRangeInput', 'flushActiveNumberInput', 'Waveform', 'X', `${source('ReferenceTrack', 'interface Props ')}\nreturn ReferenceHeader;`)(element, useRef, NumberField, RangeField, () => true, 'wave', 'close');
    let props = { name: 'reference.wav', reference: { assetId: 'source', startTick: 480, gain: .7 }, ppq: 480, onChange: vi.fn(), onRemove: vi.fn() };
    const render = () => { hook = 0; return ReferenceHeader(props); };
    const start = () => elements(render()).find(node => node.type === NumberField)!;
    const input = createNumberInputHarness(start().props); input.change('12.5'); expect(props.onChange).not.toHaveBeenCalled(); input.blur();
    expect(props.onChange.mock.calls).toEqual([[{ startTick: 6000 }]]);
    input.input.focus(); input.change('20'); props = { ...props, reference: { ...props.reference } }; input.update(start().props); input.blur();
    expect(props.onChange).toHaveBeenCalledOnce();
    const gain = elements(render()).find(node => node.type === RangeField)!;
    gain.props.onPreview(.2); gain.props.onPreview(.4); expect(props.onChange).toHaveBeenCalledOnce();
    gain.props.onCommit(.4); expect(props.onChange.mock.calls.at(-1)).toEqual([{ gain: .4 }]);
  });
});

function drumFixture() {
  const project = createProject('Drum transactions'); project.tracks[0].drumPresetId = 'kit';
  project.drumPresets = [{ id: 'kit', name: 'Kit', mappings: [{ id: 'kick', trigger: 36, name: 'Kick', notes: [{ id: 'hit', instrumentId: 'basedrum', midi: 66, offsetBeats: 0, durationBeats: .25, velocity: 1 }] }] }];
  const hooks: any[] = []; let hook = 0;
  const useRef = (value: unknown) => hooks[hook++] ??= { current: value };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; };
  let flushText = () => true;
  const dependencies = { element, React: { Fragment: 'fragment' }, useRef, useState, useMemo: (read: () => unknown) => read(), useLayoutEffect: () => {},
    CommitTextInput: TextField, CommitNumberInput: NumberField, PianoRoll: () => undefined,
    flushActiveTextInput: () => flushText(), flushActiveNumberInput: () => true,
    createProject, newNote, newTrack, uid, createMeterMap, inNoteBlockRange, noteName, gmPercussionName };
  const Component = Function(...Object.keys(dependencies), `${source('DrumPresetDialog')}\nreturn DrumPresetDialog;`)(...Object.values(dependencies));
  const onApply = vi.fn(), props = { project, trackId: project.tracks[0].id, onApply, onClose: vi.fn(), onStop: vi.fn(), onAudition: vi.fn() };
  const render = () => { hook = 0; return Component(props); };
  const fields = () => elements(render());
  return { project, onApply, fields, flushText: (flush: () => boolean) => { flushText = flush; } };
}

describe('drum name transaction integration', () => {
  it('undoes a complete preset/mapping rename and can redo it without changing the parent project', () => {
    const t = drumFixture(), original = structuredClone(t.project);
    for (const [label, value, originalName] of [['鼓组预设名称', 'Jazz Kit ABC', 'Kit'], ['映射名称', 'Low Kick ABC', 'Kick']]) {
      const field = () => t.fields().find(node => node.type === TextField && node.props['aria-label'] === label)!;
      field().props.onCommit(value); expect(field().props.value).toBe(value);
      t.fields().find(node => node.type === 'button' && node.props.children.includes('撤销'))!.props.onClick(); expect(field().props.value).toBe(originalName);
      t.fields().find(node => node.type === 'button' && node.props.children.includes('重做'))!.props.onClick(); expect(field().props.value).toBe(value);
    }
    expect(t.project).toEqual(original); expect(t.onApply).not.toHaveBeenCalled();
  });
  it('flushes a pending rename before local undo, using the newly added history entry in the same event', () => {
    const t = drumFixture(), field = () => t.fields().find(node => node.type === TextField && node.props['aria-label'] === '鼓组预设名称')!;
    const undo = t.fields().find(node => node.type === 'button' && node.props.children.includes('撤销'))!.props.onClick;
    t.flushText(() => { t.flushText(() => true); field().props.onCommit('Pending name'); return true; });
    undo(); expect(field().props.value).toBe('Kit');
    t.fields().find(node => node.type === 'button' && node.props.children.includes('重做'))!.props.onClick(); expect(field().props.value).toBe('Pending name');
  });
  it('refuses Apply when flushing a pending empty preset name makes the draft invalid', () => {
    const t = drumFixture(), apply = t.fields().find(node => node.type === 'button' && node.props.children.includes('应用修改'))!.props.onClick;
    t.flushText(() => { t.flushText(() => true); t.fields().find(node => node.type === TextField && node.props['aria-label'] === '鼓组预设名称')!.props.onCommit(''); return true; });
    apply(); expect(t.onApply).not.toHaveBeenCalled(); expect(t.fields().find(node => node.type === 'button' && node.props.children.includes('应用修改'))!.props.disabled).toBe(true);
  });
});
