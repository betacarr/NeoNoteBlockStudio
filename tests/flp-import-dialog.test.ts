import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { flpChannelChoiceError, importFlp, type FlpImportChannel, type FlpImportPlan } from '../src/core/flp-import';
import { INSTRUMENTS } from '../src/core/instruments';
import type { FlpImportDialogProps } from '../src/ui/FlpImportDialog';
import { createNumberInputHarness } from './helpers/commit-number-harness';

// Actual dialog hooks, JSX and callbacks with inert elements/focus. A constructed
// parser-plan boundary is used here, not a FLP binary parsing or GUI acceptance.
const source = readFileSync(new URL('../src/ui/FlpImportDialog.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('interface Review');
if (start < 0) throw new Error('Actual FLP review implementation was not found');
const code = transformSync(source.slice(start).replace('export function FlpImportDialog(', 'function FlpImportDialog('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderFlpElement', jsxFragment: 'FlpFragment' }).code;
type Node = { type: unknown; props: Record<string, any> };
const NumberInput = () => undefined;
const row = (patch: Partial<FlpImportChannel> = {}): FlpImportChannel => ({ id: 0, name: 'Verified harp', sample: 'note/harp.ogg', kind: 0, enabled: true, noteCount: 2, activeNoteCount: 2,
  instrumentId: 'harp', baselineMidi: 66, verified: true, confirmed: false, selected: true, issues: [], ...patch });
function plan(channels: FlpImportChannel[] = [row()]): FlpImportPlan {
  return { filename: 'review-fixture.flp', bytes: Uint8Array.of(1, 2, 3), sourceSha256: 'a'.repeat(64), channels, warnings: [], blockers: [],
    source: { version: '21.0.3', ppq: 960, bpm: 123.5, beatsBar: 4, channels: Object.fromEntries(channels.map(channel => [channel.id, {
      id: channel.id, name: channel.name, sample: channel.sample, kind: channel.kind, enabled: channel.enabled, root: 64, pitch: 0, fine: 0, pan: 6400, volume: 12800, sampler: {}, issues: [],
    }])), patterns: { 1: channels.flatMap(channel => Array.from({ length: channel.noteCount }, (_, index) => ({ position: index * 240, channel: channel.id, key: 64, length: 120, velocity: 100, pan: 64, fine: 120, flags: 0 }))) },
      clips: [{ pattern: 1, position: 0, length: 960, offset: 0, end: 960, track: 1, muted: false }], tracks: { 1: true }, issues: [], warnings: [], metadata: {} } };
}
function fixture(value = plan()) {
  const hooks: any[] = [], effects: (() => void)[] = []; let hook = 0, dirty = false, tree: Node;
  const previous = { isConnected: true, focus: vi.fn(() => { document.activeElement = previous; }) };
  const document = { activeElement: previous as unknown };
  const dialog = { ownerDocument: document, focus: vi.fn(() => { document.activeElement = dialog; }), contains: (element: unknown) => element === dialog };
  const useRef = (initial: unknown) => { const index = hook++; return hooks[index] ??= { current: initial }; };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useLayoutEffect = (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = hook++, previous = hooks[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      const next: { deps: unknown[]; cleanup?: () => void } = { deps }; hooks[index] = next;
      effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (cleanup) next.cleanup = cleanup; });
    }
  };
  const renderFlpElement = (type: unknown, attributes: any, ...children: any[]): Node => { if (attributes?.ref) attributes.ref.current = dialog; return { type, props: { ...attributes, children } }; };
  let onFlush = () => true;
  const flushActiveNumberInput = vi.fn(() => onFlush()), onCancel = vi.fn(), onImport = vi.fn();
  let props: FlpImportDialogProps = { plan: value, onCancel, onImport };
  const scope = { useRef, useState, useLayoutEffect, INSTRUMENTS, flpChannelChoiceError, CommitNumberInput: NumberInput, flushActiveNumberInput, renderFlpElement, FlpFragment: Symbol('flp-fragment') };
  const Component = Function(...Object.keys(scope), `${code}\nreturn FlpImportDialog;`)(...Object.values(scope));
  const render = () => { let attempts = 0; do { hook = 0; dirty = false; tree = Component(props); while (effects.length) effects.shift()!(); if (++attempts > 20) throw new Error('FLP dialog hooks did not settle'); } while (dirty); return tree; };
  const elements = (node: Node): Node[] => [node, ...(node.props.children ?? []).flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
  const find = (label: string) => elements(render()).find(node => node.props['aria-label'] === label)!;
  const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? (node.props?.children ?? []).flat(Infinity).map(text).join('') : '';
  const importButton = () => elements(render()).find(node => node.type === 'button' && text(node) === '导入为可编辑工程')!;
  const check = (label: string, checked = true) => find(label).props.onChange({ currentTarget: { checked } });
  render();
  return { render, find, check, importButton, import: () => importButton().props.onClick(), onCancel, onImport, dialog, previous, document, flushActiveNumberInput,
    select: (id: number, instrumentId: string) => find(`声道 ${id} 音色`).props.onChange({ currentTarget: { value: instrumentId } }),
    number: (id = 0) => { const node = find(`声道 ${id} 采样基准`); expect(node.type).toBe(NumberInput); return node.props; },
    text: () => text(render()), elements: (root = render()) => elements(root), update: (next: FlpImportPlan) => { props = { ...props, plan: next }; render(); }, useFlush: (flush: () => boolean) => { onFlush = flush; },
    unmount: () => { for (const slot of hooks) slot?.cleanup?.(); } };
}

describe('FLP import review actual component callbacks (unit scope)', () => {
  it('reviews the source and verified mapping without modifying it or claiming plugin audio equivalence', () => {
    const source = plan(), before = structuredClone(source), test = fixture(source);
    expect(test.find('导入 FL Studio 工程').props).toMatchObject({ role: 'dialog', 'aria-modal': 'true', tabIndex: -1 });
    expect(test.text()).toContain('21.0.3'); expect(test.text()).toContain('123.5 BPM'); expect(test.text()).toContain('PPQ 960');
    expect(test.text()).toContain('保留音符时值，片段转换为独立副本'); expect(test.text()).toContain('插件音频、效果器和自动化不会转换');
    expect(test.text()).toContain('FL 原根键：64（只读）'); expect(test.text()).toContain('原版采样已按哈希核对');
    expect(test.find('确认声道 0 映射')).toBeUndefined(); expect(test.importButton().props.disabled).toBe(false); test.import();
    expect(test.onImport).toHaveBeenCalledExactlyOnceWith([{ id: 0, instrumentId: 'harp', baselineMidi: 66, confirmed: false, selected: true }], false);
    expect(source).toEqual(before); expect(test.dialog.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('never assigns harp to an unknown sample and requires an explicit mapping confirmation', () => {
    const test = fixture(plan([row({ name: 'harp-like name', sample: 'unknown.wav', instrumentId: '', verified: false })]));
    expect(test.find('声道 0 音色').props.value).toBe(''); expect(test.find('确认声道 0 映射').props.checked).toBe(false);
    expect(test.importButton().props.disabled).toBe(true); test.import(); expect(test.onImport).not.toHaveBeenCalled();
    test.select(0, 'bass'); expect(test.find('确认声道 0 映射').props.checked).toBe(false); test.import(); expect(test.onImport).not.toHaveBeenCalled();
    test.check('确认声道 0 映射'); test.import();
    expect(test.onImport.mock.calls[0][0]).toEqual([{ id: 0, instrumentId: 'bass', baselineMidi: 66, confirmed: true, selected: true }]);
  });

  it('requires renewed confirmation after manual instrument or baseline changes, even when reverting to the original', () => {
    const test = fixture(); test.select(0, 'bell'); expect(test.importButton().props.disabled).toBe(true); test.check('确认声道 0 映射');
    test.select(0, 'harp'); expect(test.find('确认声道 0 映射').props.checked).toBe(false); test.import(); expect(test.onImport).not.toHaveBeenCalled();
    test.check('确认声道 0 映射'); test.number().onCommit(66.375); expect(test.find('确认声道 0 映射').props.checked).toBe(false);
    test.check('确认声道 0 映射'); test.import(); expect(test.onImport.mock.calls[0][0][0]).toMatchObject({ baselineMidi: 66.375, confirmed: true });
  });

  it('prevents unsupported channels from being selected and allows a disabled sampler to import as muted', () => {
    const source = plan([row({ id: 0, selected: false }), row({ id: 1, enabled: false, activeNoteCount: 0, selected: false }),
      row({ id: 2, kind: 2, selected: true }), row({ id: 3, kind: 4, selected: true }), row({ id: 4, kind: 5, selected: true })]);
    const test = fixture(source);
    for (const id of [2, 3, 4]) { expect(test.find(`导入声道 ${id}`).props).toMatchObject({ disabled: true, checked: false }); test.check(`导入声道 ${id}`); }
    expect(test.importButton().props.disabled).toBe(true); test.check('导入声道 1'); expect(test.number(1).disabled).toBe(false);
    expect(test.text()).toContain('选入后保持静音'); test.import(); const [choices, acknowledgeWarnings] = test.onImport.mock.calls[0];
    const converted = importFlp(source, choices, { acknowledgeWarnings }).project;
    expect(converted.tracks).toHaveLength(1); expect(converted.tracks[0].muted).toBe(true); expect(converted.patterns[0].notes).toHaveLength(2);
    expect(choices.filter((choice: { selected: boolean }) => choice.selected).map((choice: { id: number }) => choice.id)).toEqual([1]);
    expect(test.text()).toContain('跳过 4 个声道');
  });

  it('requires the explicit total-warning acknowledgement and forwards it separately from channel confirmation', () => {
    const source = plan(); source.warnings = ['忽略自动化', '初始速度固定']; const test = fixture(source);
    expect(test.text()).toContain('转换警告（2）'); expect(test.importButton().props.disabled).toBe(true); test.import(); expect(test.onImport).not.toHaveBeenCalled();
    test.check('确认 FLP 转换警告'); test.import(); expect(test.onImport).toHaveBeenCalledExactlyOnceWith(expect.any(Array), true);
    test.check('确认 FLP 转换警告', false); test.import(); expect(test.onImport).toHaveBeenCalledOnce();
  });

  it('cannot bypass blockers or unsupported source parameters through direct button/confirmation callbacks', () => {
    for (const blocker of [true, false]) {
      const source = plan([row({ verified: false, issues: blocker ? [] : ['不支持滑音'] })]); if (blocker) source.blockers = ['无法识别播放列表布局'];
      const test = fixture(source); test.check('确认声道 0 映射'); expect(test.importButton().props.disabled).toBe(true); test.import(); expect(test.onImport).not.toHaveBeenCalled();
      expect(test.text()).toContain(blocker ? '无法识别播放列表布局' : '不支持滑音');
    }
  });

  it('requires at least one selected row and keeps deselected fields disabled', () => {
    const test = fixture(); test.check('导入声道 0', false);
    expect(test.number().disabled).toBe(true); expect(test.find('声道 0 音色').props.disabled).toBe(true); expect(test.importButton().props.disabled).toBe(true);
    test.import(); expect(test.onImport).not.toHaveBeenCalled(); expect(test.text()).toContain('请选择至少一个采样声道');
  });

  it('bounds the baseline without rounding fractional calibration or accepting nonfinite direct callbacks', () => {
    const test = fixture(); expect(test.number()).toMatchObject({ min: 0, max: 127, step: .01 }); expect(test.number().integer).not.toBe(true);
    for (const invalid of [-1, 128, Infinity, -Infinity, NaN]) expect(test.number().onCommit(invalid)).toBe(false);
    expect(test.number().value).toBe(66);
    for (const valid of [0, 127, 66.375]) { test.number().onCommit(valid); expect(test.number().value).toBe(valid); }
  });

  it('flushes the real numeric draft before import and rechecks the resulting unconfirmed mapping synchronously', () => {
    const test = fixture(), input = createNumberInputHarness(test.number()); test.useFlush(input.flush); input.input.validity.stepMismatch = true;
    input.change('66.375'); expect(test.text()).toContain('请完成采样基准输入'); test.import();
    expect(test.flushActiveNumberInput).toHaveBeenCalledOnce(); expect(test.number().value).toBe(66.375); expect(test.onImport).not.toHaveBeenCalled();
    expect(test.find('确认声道 0 映射').props.checked).toBe(false); test.check('确认声道 0 映射'); test.import();
    expect(test.onImport.mock.calls[0][0][0]).toMatchObject({ baselineMidi: 66.375, confirmed: true }); input.unmount();
  });

  it('does not import an invalid real numeric draft; Escape cancels that draft without changing calibration', () => {
    const test = fixture(), input = createNumberInputHarness(test.number()); test.useFlush(input.flush);
    input.change('128'); input.key('Enter'); test.import(); expect(test.onImport).not.toHaveBeenCalled(); expect(input.render().props['aria-invalid']).toBe(true);
    expect(test.number().value).toBe(66); input.key('Escape'); test.import(); expect(test.onImport.mock.calls[0][0][0].baselineMidi).toBe(66); input.unmount();
  });

  it('resets local choices, warnings and pending ownership for another file and rejects old callbacks', () => {
    const source = plan(); source.warnings = ['限制']; const test = fixture(source); test.check('确认 FLP 转换警告');
    const oldImport = test.importButton().props.onClick, oldMapping = test.find('声道 0 音色').props.onChange, oldPending = test.number().onPendingChange;
    oldPending(true); const next = plan(); next.filename = 'other.flp'; next.sourceSha256 = 'b'.repeat(64); next.warnings = ['新限制'];
    test.update(next); oldImport(); oldMapping({ currentTarget: { value: 'bass' } }); oldPending(true);
    expect(test.onImport).not.toHaveBeenCalled(); expect(test.find('声道 0 音色').props.value).toBe('harp');
    expect(test.find('确认 FLP 转换警告').props.checked).toBe(false); expect(test.text()).not.toContain('请完成采样基准输入');
    expect(test.number().contextKey).toContain('b'.repeat(64));
  });

  it('cancels on Escape/backdrop only and leaves Space to App transport while cleaning its focus owner', () => {
    const test = fixture(), capture = test.render().props.onKeyDownCapture;
    for (const key of [' ', 'Enter']) { const event = { key, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }; capture(event); expect(event.preventDefault).not.toHaveBeenCalled(); }
    capture({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault: vi.fn(), stopPropagation: vi.fn() }); expect(test.onCancel).not.toHaveBeenCalled();
    const escape = { key: 'Escape', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }; capture(escape);
    expect(test.onCancel).toHaveBeenCalledOnce(); expect(escape.preventDefault).toHaveBeenCalledOnce(); expect(escape.stopPropagation).toHaveBeenCalledOnce();
    const backdrop = test.render(); backdrop.props.onPointerDown({ target: {}, currentTarget: backdrop }); expect(test.onCancel).toHaveBeenCalledOnce();
    backdrop.props.onPointerDown({ target: backdrop, currentTarget: backdrop }); expect(test.onCancel).toHaveBeenCalledTimes(2);
    test.unmount(); expect(test.previous.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(test.document.activeElement).toBe(test.previous);
  });

  it('keeps initially skipped rows in a collapsed stable group and opens it when no row was initially selected', () => {
    const test = fixture(plan([row(), row({ id: 1, selected: false, enabled: false, activeNoteCount: 0 }), row({ id: 2, selected: false, kind: 2 })]));
    const details = () => test.elements().find(node => node.type === 'details')!;
    expect(details().props.open).toBeUndefined(); expect(test.text()).toContain('初始未选入的声道（2）');
    expect(test.elements(details()).filter(node => node.type === 'article').map(node => node.props['data-channel-id'])).toEqual([1, 2]);
    test.check('导入声道 1');
    expect(test.elements(details()).filter(node => node.type === 'article').map(node => node.props['data-channel-id'])).toEqual([1, 2]);
    expect(test.number(1).disabled).toBe(false); expect(test.text()).toContain('初始未选入的声道（2）'); expect(details().props.open).toBeUndefined();
    const empty = fixture(plan([row({ selected: false })])); expect(empty.elements().find(node => node.type === 'details')!.props.open).toBe(true);
  });

  it('uses the actual plan calibration for the verified badge instead of a hard-coded MIDI value', () => {
    const test = fixture(plan([row({ baselineMidi: 65.875 })]));
    expect(test.text()).toContain('原版采样已按哈希核对'); expect(test.find('确认声道 0 映射')).toBeUndefined();
    expect(test.importButton().props.disabled).toBe(false);
  });

  it('cancels an invalid real numeric draft from the header without committing it or importing', () => {
    const test = fixture(), onCommit = vi.fn((value: number): void | boolean => test.number().onCommit(value)), input = createNumberInputHarness({ ...test.number(), onCommit });
    input.change('128'); input.key('Enter'); expect(input.render().props['aria-invalid']).toBe(true);
    test.find('关闭 FLP 导入').props.onClick(); input.blurEvent(); input.unmount(); test.unmount();
    expect(test.onCancel).toHaveBeenCalledOnce(); expect(onCommit).not.toHaveBeenCalled(); expect(test.onImport).not.toHaveBeenCalled();
  });
});
