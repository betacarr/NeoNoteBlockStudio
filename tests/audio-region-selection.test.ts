import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { createTempoMap } from '../src/core/time';
import { regionChords } from '../src/core/chord-track';
import { audioClipEnd } from '../src/core/audio-clips';
import type { AudioClip } from '../src/core/types';
import { captureEditorPointer } from '../src/ui/pointer-capture';

const source = readFileSync(new URL('../src/ui/AudioRegion.tsx', import.meta.url), 'utf8');
const code = transformSync(source.slice(source.indexOf('export function AudioRegion(')).replace('export function', 'function'), { loader: 'tsx', jsxFactory: 'element' }).code;
function fixture(locked = false, selected = false) {
  const project = createProject(), clip: AudioClip = { id: 'audio', trackId: project.tracks[0].id, assetId: 'asset', name: 'Audio', start: 0, durationSeconds: 2, offsetSeconds: 0 };
  project.tracks[0].kind = 'audio'; project.tracks[0].locked = locked;
  const select = vi.fn(), move = vi.fn(), menu = vi.fn(), cleanup: (() => void)[] = [];
  const dependencies = { useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()], useMemo: (value: () => unknown) => value(), useLayoutEffect: (effect: () => void) => effect(), useEffect: (effect: () => (() => void) | void) => { const result = effect(); if (result) cleanup.push(result); },
    element: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...(props as object), children } }), createTempoMap, audioClipEnd, captureEditorPointer, regionChords };
  const component = Function(...Object.keys(dependencies), `${code}\nreturn AudioRegion;`)(...Object.values(dependencies));
  const node = component({ project, clip, scale: .1, meter: createMeterMap(project), step: 240, onSelect: select, onMove: move, onMenu: menu, selected });
  return { node, clip, select, move, menu, cleanup };
}
describe('AudioRegion selection target', () => {
  it('exposes selected state and toggles Shift selection without starting a move', () => {
    const state = fixture(false, true), capture = vi.fn();
    expect(state.node.props['aria-pressed']).toBe(true); expect(state.node.props.className).toContain('selected');
    state.node.props.onPointerDown({ button: 0, shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { setPointerCapture: capture } });
    expect(state.select).toHaveBeenCalledExactlyOnceWith(true); expect(capture).not.toHaveBeenCalled(); expect(state.move).not.toHaveBeenCalled();
  });
  it('allows selecting a locked audio clip without permitting a drag', () => {
    const state = fixture(true), capture = vi.fn();
    state.node.props.onPointerDown({ button: 0, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { setPointerCapture: capture } });
    expect(state.select).toHaveBeenCalledExactlyOnceWith(false); expect(capture).not.toHaveBeenCalled(); expect(state.move).not.toHaveBeenCalled();
  });
  it('right-click targets the actual audio clip and preserves an existing group selection', () => {
    const focus = vi.fn();
    const event = { clientX: 30, clientY: 40, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { focus } };
    const state = fixture(); state.node.props.onContextMenu(event);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(state.select).toHaveBeenCalledOnce(); expect(state.menu).toHaveBeenCalledExactlyOnceWith(state.clip, 30, 40);
    const selected = fixture(false, true); selected.node.props.onContextMenu(event);
    expect(selected.select).not.toHaveBeenCalled(); expect(selected.menu).toHaveBeenCalledOnce();
  });
});
