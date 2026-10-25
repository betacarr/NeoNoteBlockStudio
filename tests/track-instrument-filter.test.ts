import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { newTrack } from '../src/core/project';
import type { Instrument } from '../src/core/types';
import { TrackInstrumentFilter, type TrackInstrumentFilterProps } from '../src/ui/TrackInstrumentFilter';

// Call the actual stateless component and its rendered JSX callbacks; no DOM or GUI simulation.
type Element = ReactElement<Record<string, any>>;
const elements = (node: ReactNode): Element[] => Children.toArray(node).flatMap(child => isValidElement<Record<string, any>>(child) ? [child, ...elements(child.props.children)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<Record<string, any>>(child) ? text(child.props.children) : String(child)).join('');
const instrument = (id: string, name = id): Instrument => ({ id, name, englishName: id, block: 'fixture', color: '#abc', rootMidi: 66, gmProgram: 0 });
function fixture(patch: Partial<TrackInstrumentFilterProps> = {}) {
  const props: TrackInstrumentFilterProps = { tracks: [newTrack('A', 0, 'harp'), newTrack('B', 1, 'custom'), newTrack('C', 2, 'harp')],
    instruments: [instrument('custom', '我的采样'), instrument('harp', '钢琴')], value: '', onChange: vi.fn(), context: '编曲区', ...patch };
  const tree = TrackInstrumentFilter(props), nodes = elements(tree);
  return { props, tree, nodes, select: nodes.find(node => node.type === 'select')!, button: nodes.find(node => node.type === 'button')!, options: nodes.filter(node => node.type === 'option') };
}

describe('TrackInstrumentFilter actual render and callbacks', () => {
  it.each(['编曲区', '混音器'] as const)('labels the %s control and clear action, with project-order counts', context => {
    const test = fixture({ context });
    expect(test.tree.props.className).toBe('track-instrument-filter');
    expect(test.select.props['aria-label']).toBe(`${context}乐器筛选`); expect(test.select.props.value).toBe('');
    expect(test.button.props).toMatchObject({ type: 'button', 'aria-label': `清除${context}乐器筛选`, disabled: true });
    expect(test.options.map(node => [node.props.value, text(node)])).toEqual([['', '全部乐器（3）'], ['custom', '我的采样（1）'], ['harp', '钢琴（2）']]);
    expect(text(test.tree)).toContain('显示 3 / 3 轨');
    expect(test.select.props.title).toContain('默认乐器'); expect(test.select.props.title).toContain('仅影响显示'); expect(test.select.props.title).toContain('单音符音色不参与');
  });

  it('shows the filtered count without renumbering, copying or muting tracks', () => {
    const test = fixture({ value: 'harp' }), before = structuredClone(test.props.tracks);
    expect(text(test.tree)).toContain('显示 2 / 3 轨'); expect(test.button.props.disabled).toBe(false);
    expect(test.props.tracks).toEqual(before); expect(test.props.onChange).not.toHaveBeenCalled();
  });

  it('forwards a selection and clear only through onChange, without mutating source data', () => {
    const test = fixture({ value: 'custom' }), beforeTracks = structuredClone(test.props.tracks), beforeInstruments = structuredClone(test.props.instruments);
    test.select.props.onChange({ currentTarget: { value: 'harp' } }); test.button.props.onClick();
    expect(test.props.onChange).toHaveBeenNthCalledWith(1, 'harp'); expect(test.props.onChange).toHaveBeenNthCalledWith(2, '');
    expect(test.props.value).toBe('custom'); expect(test.props.tracks).toEqual(beforeTracks); expect(test.props.instruments).toEqual(beforeInstruments);
  });

  it('does not emit a redundant clear when the filter is already all instruments', () => {
    const test = fixture(); test.button.props.onClick(); expect(test.props.onChange).not.toHaveBeenCalled();
  });

  it('keeps the controlled zero-result selection available for clearing', () => {
    const test = fixture({ value: 'deleted' });
    expect(test.select.props.value).toBe('deleted'); expect(text(test.tree)).toContain('显示 0 / 3 轨');
    expect(test.options.at(-1)?.props.value).toBe('deleted'); expect(text(test.options.at(-1))).toBe('未知乐器 · deleted（0）');
    test.button.props.onClick(); expect(test.props.onChange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('renders an empty project and a known unused custom selection without auto-resetting it', () => {
    const test = fixture({ tracks: [], value: 'custom' });
    expect(test.options.map(node => text(node))).toEqual(['全部乐器（0）', '我的采样（0）']);
    expect(text(test.tree)).toContain('显示 0 / 0 轨'); expect(test.props.onChange).not.toHaveBeenCalled();
  });
});
