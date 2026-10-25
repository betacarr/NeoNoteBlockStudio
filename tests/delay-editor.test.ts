import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultDelay, delayEnvelope, validateDelayEffect } from '../src/core/delay';
import type { DelayEffect } from '../src/core/types';
import type { DelayEditorProps } from '../src/ui/DelayEditor';
import { createNumberInputHarness } from './helpers/commit-number-harness';

// Execute the actual panel and its child props/callbacks. Selected cases also
// pass those props to the actual CommitNumberInput through inert hook callbacks;
// this is not browser input, App history or audio acceptance.
const source = readFileSync(new URL('../src/ui/DelayEditor.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const TIME_FIELDS =');
if (start < 0) throw new Error('DelayEditor implementation was not found');
const code = transformSync(source.slice(start).replace('export function DelayEditor(', 'function DelayEditor('), { loader: 'tsx', jsx: 'transform', jsxFactory: 'renderElement', target: 'es2022' }).code;
type InertElement = { type: unknown; props: Record<string, any> };
const NumberInput = () => undefined;
const renderElement = (type: unknown, props: any, ...children: any[]): InertElement => ({ type, props: { ...props, children } });
const Component = Function('createDefaultDelay', 'delayEnvelope', 'CommitNumberInput', 'renderElement', `${code}\nreturn DelayEditor;`)(createDefaultDelay, delayEnvelope, NumberInput, renderElement);

function fixture(options: Partial<DelayEditorProps> = {}) {
  const onPendingChange = vi.fn(), onChange = vi.fn((value: DelayEffect) => { props = { ...props, value }; });
  let props: DelayEditorProps = { value: createDefaultDelay(), contextKey: 'project:track-a', previewDuration: { beats: 1, seconds: .5 }, onChange, onPendingChange, ...options };
  const elements = (node: InertElement): InertElement[] => [node, ...(node.props.children ?? []).flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
  const render = () => Component(props) as InertElement;
  const find = (label: string) => elements(render()).find(node => node.props['aria-label'] === label)!;
  const number = (label: string) => { const node = find(`Delay ${label}`); expect(node?.type).toBe(NumberInput); return node.props; };
  const select = (label: string, value: string) => find(label).props.onChange({ currentTarget: { value } });
  return { render, find, number, select, onChange, onPendingChange, elements: () => elements(render()), value: () => props.value!, update: (next: Partial<DelayEditorProps>) => { props = { ...props, ...next }; } };
}

describe('DelayEditor track settings callbacks (unit scope)', () => {
  it('uses core defaults when absent and keeps bypassed parameters editable', () => {
    const test = fixture({ value: undefined });
    expect(test.render().props.className).toBe('inspector-section delay-editor');
    expect(test.find('启用轨道 Delay').props.checked).toBe(false);
    expect(test.number('回声间隔').disabled).toBe(false);
    test.find('启用轨道 Delay').props.onChange({ currentTarget: { checked: true } });
    expect(test.value()).toEqual({ ...createDefaultDelay(), enabled: true }); expect(test.onChange).toHaveBeenCalledOnce();
  });

  it('edits percentage fields as ratios in new settings objects while bypassed', () => {
    const original = Object.freeze(createDefaultDelay()), before = structuredClone(original), test = fixture({ value: original });
    test.number('每次保留').onCommit(37.5); test.number('回声力度').onCommit(25); test.number('保持 S').onCommit(40);
    expect(test.value()).toEqual({ ...before, feedback: .375, wet: .25, sustain: .4 });
    expect(test.value()).not.toBe(original); expect(original).toEqual(before); expect(test.value().enabled).toBe(false);
  });

  it('switches between time-linked and independent-tail views while preserving hidden settings', () => {
    const test = fixture(), original = test.value();
    expect(test.elements().some(node => node.type === 'svg')).toBe(true);
    test.select('Delay 模式', 'tail');
    expect(test.value()).toEqual({ ...original, mode: 'tail' }); expect(test.elements().some(node => node.type === 'svg')).toBe(false);
    expect(test.number('独立尾长').value).toBe(original.tail);
    test.number('独立尾长').onCommit(8); test.select('Delay 模式', 'gate');
    expect(test.value()).toEqual({ ...original, tail: 8 }); expect(test.number('释放 R').value).toBe(original.release);
  });

  it('applies note-length presets in quarter-note beats and retains precise custom intervals', () => {
    const test = fixture();
    test.find('Delay 间隔 1/16 音符').props.onClick();
    expect(test.value().interval).toBe(.25); expect(test.find('Delay 间隔 1/16 音符').props['aria-pressed']).toBe(true);
    expect(test.number('回声间隔')).toMatchObject({ min: 1 / 128, max: 256 });
    test.number('回声间隔').onCommit(.333333333333);
    expect(test.value().interval).toBe(.333333333333);
  });

  it('shows milliseconds but commits seconds, including fractional milliseconds and negative release offsets', () => {
    const test = fixture({ value: { ...createDefaultDelay(), timeUnit: 'seconds', interval: .125, releaseOffset: -.05 } });
    expect(test.number('回声间隔')).toMatchObject({ value: 125, min: 1, max: 256000, step: 1 });
    expect(test.number('释放偏移').value).toBe(-50);
    test.number('回声间隔').onCommit(37.5); test.number('释放偏移').onCommit(-125);
    expect(test.value().interval).toBe(.0375); expect(test.value().releaseOffset).toBe(-.125); expect(validateDelayEffect(test.value())).toBe(true);
  });

  it('converts every time field using the supplied tempo ratio and constrains the new unit domain', () => {
    const test = fixture({ value: { ...createDefaultDelay(), interval: 1, attack: .2, decay: .4, release: .6, releaseOffset: -2, tail: 8 } });
    test.select('Delay 时间单位', 'seconds');
    expect(test.value()).toEqual({ ...createDefaultDelay(), timeUnit: 'seconds', interval: .5, attack: .1, decay: .2, release: .3, releaseOffset: -1, tail: 4 });
    test.select('Delay 时间单位', 'beats');
    expect(test.value()).toEqual({ ...createDefaultDelay(), interval: 1, attack: .2, decay: .4, release: .6, releaseOffset: -2, tail: 8 });
    const limited = fixture({ value: { ...createDefaultDelay(), timeUnit: 'seconds', interval: .001, attack: 256, releaseOffset: -256 } });
    limited.select('Delay 时间单位', 'beats');
    expect(limited.value()).toMatchObject({ interval: 1 / 128, attack: 256, releaseOffset: -256 }); expect(validateDelayEffect(limited.value())).toBe(true);
  });

  it('does not invent a beat-to-second ratio when preview timing is absent or invalid', () => {
    for (const previewDuration of [undefined, { beats: 0, seconds: 0 }, { beats: 1e-300, seconds: 1e300 }]) {
      const test = fixture({ previewDuration });
      expect(test.find('Delay 时间单位').props.disabled).toBe(true);
      test.select('Delay 时间单位', 'seconds'); expect(test.onChange).not.toHaveBeenCalled();
    }
  });

  it('uses explicit tempo for unit conversion even with a zero-duration preview or a different average duration ratio', () => {
    for (const previewDuration of [{ beats: 0, seconds: 0 }, { beats: 1, seconds: 2 }]) {
      const test = fixture({ previewDuration, secondsPerBeat: .5 });
      expect(test.find('Delay 时间单位').props.disabled).toBe(false);
      expect(test.find('Delay ADSR 回声力度曲线').props['data-note-duration']).toBe(previewDuration.beats);
      test.select('Delay 时间单位', 'seconds');
      expect(test.value().interval).toBe(.25);
      expect(test.find('Delay ADSR 回声力度曲线').props['data-note-duration']).toBe(previewDuration.seconds);
      expect(validateDelayEffect(test.value())).toBe(true); expect(test.onChange).toHaveBeenCalledOnce();
    }
  });

  it('disables the locked panel and rejects direct control callbacks without emitting settings', () => {
    const test = fixture({ disabled: true });
    expect(test.find('启用轨道 Delay').props.disabled).toBe(true); expect(test.number('回声间隔').disabled).toBe(true);
    expect(test.find('Delay 模式').props.disabled).toBe(true); expect(test.find('Delay 时间单位').props.disabled).toBe(true);
    test.find('启用轨道 Delay').props.onChange({ currentTarget: { checked: true } });
    test.select('Delay 模式', 'tail'); test.select('Delay 时间单位', 'seconds'); test.number('每次保留').onCommit(25); test.find('Delay 间隔 1/16 音符').props.onClick();
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('draws an early release from the actual attack level instead of jumping to sustain', () => {
    const test = fixture({ value: { ...createDefaultDelay(), attack: 2, sustain: .7, releaseOffset: -.5, release: .25 } });
    const svg = test.find('Delay ADSR 回声力度曲线');
    expect(svg.props).toMatchObject({ 'data-note-duration': 1, 'data-release-start': .5, 'data-release-level': .25 });
    const points = test.elements().find(node => node.props['data-testid'] === 'delay-envelope-line')!.props.points.split(' ').map((point: string) => point.split(',').map(Number));
    expect(points).toContainEqual([94, 42.5]); expect(points).toContainEqual([137, 54]);
    expect(points.every(([x, y]: number[]) => Number.isFinite(x) && Number.isFinite(y) && x >= 8 && x <= 180 && y >= 8 && y <= 54)).toBe(true);
    const noteOff = test.elements().find(node => node.props['data-testid'] === 'delay-note-off')!;
    expect(noteOff.props.x1).toBe(180); expect(noteOff.props.strokeDasharray).toBe('3 3');
  });

  it('forwards field-specific pending state and independent numeric ownership keys', () => {
    const test = fixture(), before = test.number('释放偏移').contextKey;
    test.number('释放偏移').onPendingChange(true); test.number('释放偏移').onPendingChange(false);
    expect(test.onPendingChange.mock.calls).toEqual([['delay-releaseOffset', true], ['delay-releaseOffset', false]]);
    expect(before).toContain('project:track-a:delay:releaseOffset');
    test.update({ contextKey: 'project:track-b' });
    expect(test.number('释放偏移').contextKey).not.toBe(before); expect(test.onChange).not.toHaveBeenCalled();
  });

  it('displays both new defaults and legacy missing pan as zero without emitting a no-op change', () => {
    const { panAmount: _panAmount, ...legacy } = createDefaultDelay();
    for (const value of [undefined, legacy]) {
      const test = fixture({ value });
      expect(test.number('左右摆幅')).toMatchObject({ value: 0, min: 0, max: 100, step: 1, disabled: false });
      test.number('左右摆幅').onCommit(0); expect(test.onChange).not.toHaveBeenCalled();
      expect(test.elements().some(node => node.props.children?.includes('逐次左 / 右交替；相对原音声像，0% 关闭。'))).toBe(true);
    }
    expect(createDefaultDelay().panAmount).toBe(0);
  });

  it('displays and edits pan as a percentage while bypassed without changing the source settings object', () => {
    const original = Object.freeze({ ...createDefaultDelay(), panAmount: .375 }), before = structuredClone(original), test = fixture({ value: original });
    expect(test.number('左右摆幅').value).toBe(37.5); test.number('左右摆幅').onCommit(12.5);
    expect(test.value()).toEqual({ ...before, panAmount: .125 }); expect(test.value().enabled).toBe(false);
    expect(test.value()).not.toBe(original); expect(original).toEqual(before); expect(test.onChange).toHaveBeenCalledOnce();
  });

  it('rejects nonfinite pan callbacks, clamps finite callbacks and suppresses equivalent values', () => {
    const test = fixture({ value: { ...createDefaultDelay(), panAmount: .375 } });
    for (const value of [NaN, Infinity, -Infinity]) test.number('左右摆幅').onCommit(value);
    test.number('左右摆幅').onCommit(37.5); expect(test.onChange).not.toHaveBeenCalled();
    test.number('左右摆幅').onCommit(-10); expect(test.value().panAmount).toBe(0);
    test.number('左右摆幅').onCommit(120); expect(test.value().panAmount).toBe(1);
    test.number('左右摆幅').onCommit(100); expect(test.onChange).toHaveBeenCalledTimes(2); expect(validateDelayEffect(test.value())).toBe(true);
  });

  it('preserves nonzero pan across both modes and unit conversions', () => {
    const test = fixture({ value: { ...createDefaultDelay(), panAmount: .375 } });
    for (const mode of ['tail', 'gate']) { test.select('Delay 模式', mode); expect(test.value().panAmount).toBe(.375); expect(test.number('左右摆幅').value).toBe(37.5); }
    for (const unit of ['seconds', 'beats']) { test.select('Delay 时间单位', unit); expect(test.value().panAmount).toBe(.375); expect(test.number('左右摆幅').value).toBe(37.5); }
    expect(test.onChange).toHaveBeenCalledTimes(4);
  });

  it('locks pan consistently with the rest of the track and rejects direct stale callbacks', () => {
    const test = fixture({ disabled: true, value: { ...createDefaultDelay(), panAmount: .375 } });
    expect(test.number('左右摆幅').disabled).toBe(true); test.number('左右摆幅').onCommit(50);
    expect(test.value().panAmount).toBe(.375); expect(test.onChange).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'blur'] as const)('commits fractional pan once through the real numeric input on %s', mode => {
    const test = fixture(), input = createNumberInputHarness(test.number('左右摆幅'));
    expect(input.props().contextKey).toBe('project:track-a:delay:panAmount'); input.input.validity.stepMismatch = true;
    input.change('37.5'); expect(test.onChange).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([['delay-panAmount', true]]);
    if (mode === 'Enter') input.key('Enter'); else input.blur(); input.blurEvent();
    expect(test.value().panAmount).toBe(.375); expect(test.onChange).toHaveBeenCalledOnce();
    expect(test.onPendingChange.mock.calls).toEqual([['delay-panAmount', true], ['delay-panAmount', false]]);
    expect(input.render().props['aria-invalid']).toBeUndefined(); input.unmount();
  });

  it('cancels the actual pan draft with Escape and clears only its field pending notification', () => {
    const test = fixture({ value: { ...createDefaultDelay(), panAmount: .375 } }), input = createNumberInputHarness(test.number('左右摆幅'));
    input.change('62.5'); input.key('Escape'); input.blurEvent();
    expect(input.render().props.value).toBe('37.5'); expect(test.value().panAmount).toBe(.375); expect(test.onChange).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([['delay-panAmount', true], ['delay-panAmount', false]]); input.unmount();
  });

  it('invalidates an actual pan draft when the selected track context changes', () => {
    const test = fixture(), input = createNumberInputHarness(test.number('左右摆幅')); input.change('37.5');
    test.update({ contextKey: 'project:track-b', value: { ...createDefaultDelay(), panAmount: .25 } }); input.update(test.number('左右摆幅'));
    input.blurEvent(); expect(input.props().contextKey).toBe('project:track-b:delay:panAmount'); expect(input.render().props.value).toBe('25');
    expect(test.value().panAmount).toBe(.25); expect(test.onChange).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([['delay-panAmount', true], ['delay-panAmount', false]]); input.unmount();
  });
});
