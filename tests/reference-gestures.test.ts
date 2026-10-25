import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { createTempoMap } from '../src/core/time';
import { captureEditorPointer } from '../src/ui/pointer-capture';
import { startHorizontalEdgeScroll } from '../src/ui/edge-scroll';

type Props = Parameters<typeof import('../src/ui/ReferenceTrack').ReferenceLane>[0];
type Node = { type: unknown; props: Record<string, any> };
type Effect = { deps?: unknown[]; cleanup?: () => void };

// Real ReferenceLane source and real capture helper run on inert hooks and
// listener targets. This exercises callback ownership, not browser or hardware
// pointer/focus/keyboard delivery, canvas rendering or reference audio playback.
const source = readFileSync(new URL('../src/ui/ReferenceTrack.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('interface Props ');
if (start < 0) throw Error('ReferenceLane source boundary missing');
const code = transformSync(source.slice(start).replace('export function ReferenceLane(', 'function ReferenceLane('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;

class InertTarget extends EventTarget {
  registrations: { type: string; callback: EventListenerOrEventListenerObject; capture: boolean }[] = [];
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (callback) this.registrations.push({ type, callback, capture: typeof options === 'boolean' ? options : !!options?.capture });
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.registrations = this.registrations.filter(item => item.type !== type || item.callback !== callback || item.capture !== capture);
    super.removeEventListener(type, callback, options);
  }
}

function fixture() {
  const project = createProject('Reference gesture fixture'); project.ppq = 480;
  project.assets = [{ id: 'reference-asset', name: 'reference.wav', mime: 'audio/wav', data: 'AAEC', path: 'reference.wav' }];
  project.reference = { assetId: 'reference-asset', startTick: 240, gain: .7 };
  const original = structuredClone(project), view = new InertTarget(), target = new InertTarget();
  const captures = new Set<number>(), hooks: any[] = [], effects: (() => void)[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0, now = 0;
  Object.assign(view, { requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
  let scrollLeft = 10;
  const scrollElement = { ownerDocument: { defaultView: view }, clientWidth: 200, clientLeft: 0, scrollWidth: 2000,
    getBoundingClientRect: () => ({ left: 100, right: 300, width: 200 }),
    get scrollLeft() { return scrollLeft; }, set scrollLeft(value: number) { scrollLeft = Math.max(0, Math.min(Math.max(0, this.scrollWidth - this.clientWidth), value)); } };
  let hook = 0, dirty = false, node: Node, tree: Node, mounted = true, owner: object = {};
  let releaseMutation: (() => void) | undefined;
  Object.assign(target, { ownerDocument: { defaultView: view } });
  const focus = vi.fn((_options?: FocusOptions) => {}), setPointerCapture = vi.fn((pointer: number) => { captures.add(pointer); });
  const releasePointerCapture = vi.fn((pointer: number) => {
    captures.delete(pointer); releaseMutation?.();
    // Inert boundary for the browser's synchronous capture-loss notification.
    node?.props.onLostPointerCapture(event(0, pointer));
  });
  Object.assign(target, { focus, setPointerCapture, hasPointerCapture: (pointer: number) => captures.has(pointer), releasePointerCapture });
  const onChange = vi.fn(), onSeek = vi.fn(), onPreviewExtent = vi.fn();
  let props: Props = { project, name: 'reference.wav', peaks: { duration: 2, values: Float32Array.from([0, .5, 1]) }, meter: createMeterMap(project),
    step: 120, scale: .25, scroll: { current: scrollElement as unknown as HTMLDivElement }, left: 0, width: 800, onChange, onSeek, onPreviewExtent,
    gestureOwner: owner, getGestureOwner: () => owner };
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useState = (initial: any) => {
    const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }];
  };
  const same = (left: unknown[] | undefined, right: unknown[] | undefined) => !!left && !!right && left.length === right.length && right.every((value, index) => Object.is(value, left[index]));
  const useMemo = (calculate: () => unknown, deps: unknown[]) => { const index = hook++; if (!hooks[index] || !same(hooks[index].deps, deps)) hooks[index] = { deps, value: calculate() }; return hooks[index].value; };
  const useLayoutEffect = (callback: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous: Effect | undefined = hooks[index];
    if (!previous || !same(previous.deps, deps)) {
      const next: Effect = { deps }; hooks[index] = next;
      effects.push(() => { previous?.cleanup?.(); const cleanup = callback(); if (typeof cleanup === 'function') next.cleanup = cleanup; });
    }
  };
  const element = (type: unknown, attributes: Record<string, any> | null, ...children: any[]): Node => ({ type, props: { ...attributes, children } });
  const ReferenceWaveform = () => undefined;
  const dependencies = { useRef, useState, useMemo, useLayoutEffect, element, createTempoMap, captureEditorPointer, startHorizontalEdgeScroll, ReferenceWaveform };
  const Component = Function(...Object.keys(dependencies), `${code}\nreturn ReferenceLane;`)(...Object.values(dependencies));
  const elements = (item: Node): Node[] => [item, ...(item.props.children ?? []).flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
  const render = (runEffects = true) => {
    if (!mounted) return node;
    let attempts = 0;
    do {
      dirty = false; hook = 0; tree = Component(props);
      node = elements(tree).find(item => item.props.role === 'slider')!;
      if (runEffects) while (effects.length) effects.shift()!();
      if (++attempts > 20) throw Error('ReferenceLane callbacks did not settle');
    } while (runEffects && dirty);
    return node;
  };
  function event(x: number, pointerId = 7, button = 0) { return { clientX: x, pointerId, button, currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn() }; }
  const down = (x = 10, pointer = 7, button = 0) => { const value = event(x, pointer, button); render().props.onPointerDown(value); render(); return value; };
  const move = (x = 70, pointer = 7) => { render().props.onPointerMove(event(x, pointer)); render(); };
  const up = (x = 70, pointer = 7) => { render().props.onPointerUp(event(x, pointer)); render(); };
  const key = (key: string) => { const value = { key, preventDefault: vi.fn() }; render().props.onKeyDown(value); render(); return value; };
  const escape = () => { const value = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }); view.dispatchEvent(value); render(); return value; };
  const previewTick = () => Number(render().props['aria-valuenow']) * props.project.ppq;
  render();
  return { project, original, view, target, captures, focus, setPointerCapture, releasePointerCapture, onChange, onSeek, onPreviewExtent, scrollElement, frames,
    event, render, down, move, up, key, escape, previewTick, props: () => props, last: () => node, lane: () => tree,
    update: (change: Partial<Props>, runEffects = true) => { props = { ...props, ...change }; return render(runEffects); },
    replaceOwnerWithoutRender: () => (owner = {}),
    onRelease: (callback: () => void) => { releaseMutation = callback; },
    advance: (milliseconds = 16) => { now += milliseconds; const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(now); render(); },
    unmount: () => { if (!mounted) return; mounted = false; for (const item of hooks) item?.cleanup?.(); },
  };
}

describe('ReferenceLane real callbacks and scoped pointer helper', () => {
  it('focuses/captures once, previews only, includes live scroll and commits once on release', () => {
    const state = fixture(); state.down(); state.move();
    expect(state.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(state.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(state.previewTick()).toBe(480); expect(state.onChange).not.toHaveBeenCalled();
    state.props().scroll.current!.scrollLeft = 40; state.move();
    expect(state.previewTick()).toBe(600); expect(state.project).toEqual(state.original);
    state.up(); state.up();
    expect(state.onChange).toHaveBeenCalledExactlyOnceWith({ startTick: 600 });
    expect(state.captures.size).toBe(0); expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
  });

  it.each(['Escape', 'window blur', 'target blur', 'pointer cancel', 'lost capture'])('restores the model on %s and ignores its later release', cause => {
    const state = fixture(); state.down(); state.move(); expect(state.previewTick()).toBe(480);
    if (cause === 'Escape') expect(state.escape().defaultPrevented).toBe(true);
    else if (cause === 'window blur') state.view.dispatchEvent(new Event('blur'));
    else if (cause === 'target blur') state.target.dispatchEvent(new Event('blur'));
    else state.render().props[cause === 'pointer cancel' ? 'onPointerCancel' : 'onLostPointerCapture'](state.event(70));
    expect(state.previewTick()).toBe(240); state.up();
    expect(state.onChange).not.toHaveBeenCalled(); expect(state.project).toEqual(state.original);
    expect(state.captures.size).toBe(0); expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
  });

  it('ignores foreign cancellation and a second pointer without replacing the first gesture', () => {
    const state = fixture(); state.down(); state.move(); state.down(100, 8);
    state.render().props.onPointerCancel(state.event(100, 8)); state.render().props.onLostPointerCapture(state.event(100, 8));
    state.move(150, 8); state.up(150, 8);
    expect(state.previewTick()).toBe(480); expect(state.captures.has(7)).toBe(true);
    expect(state.setPointerCapture).toHaveBeenCalledTimes(1); state.up();
    expect(state.onChange).toHaveBeenCalledExactlyOnceWith({ startTick: 480 });
  });

  it('rejects a stale release and stale new pointerdown immediately when the live owner changes before React renders', () => {
    const state = fixture(); state.down(); state.move(); state.replaceOwnerWithoutRender(); state.up();
    expect(state.onChange).not.toHaveBeenCalled(); expect(state.previewTick()).toBe(240);
    state.down(); expect(state.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(state.captures.size).toBe(0);
  });

  it('cleans up capture when focus synchronously invalidates the owner before cleanup was installed', () => {
    const state = fixture(); state.focus.mockImplementation(() => { state.replaceOwnerWithoutRender(); });
    state.down(); state.up();
    expect(state.onChange).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0);
    expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
  });

  it('cleans up a capture returned after focus synchronously unmounts and clears the gesture', () => {
    const state = fixture(); state.focus.mockImplementation(() => state.unmount()); state.down();
    expect(state.captures.size).toBe(0); expect(state.onChange).not.toHaveBeenCalled();
    expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
  });

  it('checks the owner again after synchronous release listeners, before committing', () => {
    const state = fixture(); state.down(); state.move(); state.onRelease(() => state.replaceOwnerWithoutRender()); state.up();
    expect(state.onChange).not.toHaveBeenCalled(); expect(state.previewTick()).toBe(240); expect(state.captures.size).toBe(0);
  });

  const mutations: { name: string; change: (props: Props) => Partial<Props> }[] = [
    { name: 'reference identity', change: p => ({ project: { ...p.project, reference: { ...p.project.reference! } } }) },
    { name: 'reference start', change: p => { p.project.reference!.startTick = 360; return { project: p.project }; } },
    { name: 'reference gain', change: p => { p.project.reference!.gain = .2; return { project: p.project }; } },
    { name: 'reference asset ID', change: p => ({ project: { ...p.project, reference: { ...p.project.reference!, assetId: 'replacement' }, assets: [{ ...p.project.assets[0], id: 'replacement' }] } }) },
    { name: 'asset identity', change: p => ({ project: { ...p.project, assets: [{ ...p.project.assets[0] }] } }) },
    { name: 'asset bytes', change: p => { p.project.assets[0].data = 'AwQF'; return { project: p.project }; } },
    { name: 'asset path', change: p => { p.project.assets[0].path = 'other.wav'; return { project: p.project }; } },
    { name: 'PPQ', change: p => ({ project: { ...p.project, ppq: 960 } }) },
    { name: 'tempos', change: p => ({ project: { ...p.project, tempos: [{ tick: 0, bpm: 137 }] } }) },
    { name: 'scale', change: p => ({ scale: p.scale * 2 }) },
    { name: 'meter', change: p => ({ meter: createMeterMap({ ...p.project, timeSignatures: [{ tick: 0, numerator: 3, denominator: 4 }] }) }) },
    { name: 'grid step', change: p => ({ step: p.step * 2 }) },
    { name: 'waveform geometry', change: p => ({ peaks: { ...p.peaks!, duration: 4 } }) },
    { name: 'scroll ref', change: p => ({ scroll: { current: p.scroll.current } }) },
    { name: 'scroll element', change: p => { p.scroll.current = { scrollLeft: 10 } as HTMLDivElement; return { scroll: p.scroll }; } },
    { name: 'opaque owner prop', change: () => ({ gestureOwner: {} }) },
    { name: 'document ID', change: p => ({ project: { ...p.project, id: 'another-document' } }) },
  ];
  it.each(mutations)('cancels on $name, both in layout and on an old release before the effect runs', ({ change }) => {
    for (const layout of [true, false]) {
      const state = fixture(); state.down(); state.move();
      const oldRelease = state.last().props.onPointerUp;
      state.update(change(state.props()), layout);
      oldRelease(state.event(70));
      expect(state.onChange).not.toHaveBeenCalled();
      expect(state.previewTick()).toBe(state.props().project.reference?.startTick);
      expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
    }
  });

  it.each([['ArrowLeft', 120], ['ArrowRight', 360], ['Home', 0]] as const)('cancels a pointer preview before %s and performs one model-based keyboard edit', (key, expected) => {
    const state = fixture(); state.down(); state.move(); expect(state.previewTick()).toBe(480);
    expect(state.key(key).preventDefault).toHaveBeenCalledTimes(1); state.up();
    expect(state.onChange).toHaveBeenCalledExactlyOnceWith({ startTick: expected });
    expect(state.view.registrations).toEqual([]);
  });

  it('rejects Arrow/Home edits from stale props when the live owner changes before rendering', () => {
    for (const key of ['ArrowRight', 'Home']) for (const dragging of [false, true]) {
      const state = fixture(); if (dragging) { state.down(); state.move(); }
      state.replaceOwnerWithoutRender(); state.key(key); state.up();
      expect(state.onChange).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0);
      expect(state.view.registrations).toEqual([]);
    }
  });

  it('rejects Arrow/Home when capture cleanup synchronously replaces the owner', () => {
    for (const key of ['ArrowRight', 'Home']) for (const renderNewOwner of [false, true]) {
      const state = fixture(); state.down(); state.move(); state.onRelease(() => {
        const next = state.replaceOwnerWithoutRender();
        if (renderNewOwner) state.update({ gestureOwner: next });
      });
      state.key(key); state.up();
      expect(state.onChange).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0);
      expect(state.view.registrations).toEqual([]);
    }
  });

  it('keeps harmless viewport/name/callback changes active and uses the latest callback', () => {
    const state = fixture(), latest = vi.fn(); state.down(); state.move();
    state.update({ name: 'renamed label', left: 100, width: 600, onChange: latest }); state.up();
    expect(state.onChange).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledExactlyOnceWith({ startTick: 480 });
  });

  it('retains ordinary arrow/Home editing and snapped double-click seek without starting capture', () => {
    const state = fixture(); state.key('ArrowLeft'); state.key('ArrowRight'); state.key('Home');
    expect(state.onChange.mock.calls).toEqual([[{ startTick: 120 }], [{ startTick: 360 }], [{ startTick: 0 }]]);
    state.lane().props.onDoubleClick({ clientX: 190, currentTarget: { getBoundingClientRect: () => ({ left: 100 }) } });
    expect(state.onSeek).toHaveBeenCalledExactlyOnceWith(360);
    expect(state.setPointerCapture).not.toHaveBeenCalled(); expect(state.view.registrations).toEqual([]);
  });

  it('removes active listeners on unmount and releases only its own pointer', () => {
    const state = fixture(); state.down(); state.move(); state.captures.add(99);
    state.unmount(); state.unmount();
    expect(state.captures.has(7)).toBe(false); expect(state.captures.has(99)).toBe(true);
    expect(state.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(state.view.registrations).toEqual([]); expect(state.target.registrations).toEqual([]);
    state.view.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
    expect(state.onChange).not.toHaveBeenCalled();
  });
});

describe('ReferenceLane horizontal edge scrolling with the real RAF helper', () => {
  it('does not start a loop for pointerdown, a click, or sub-two-pixel movement', () => {
    const state = fixture(); state.down(310);
    expect(state.frames.size).toBe(0); expect(state.onPreviewExtent).not.toHaveBeenCalled();
    state.move(311); expect(state.frames.size).toBe(0); expect(state.onPreviewExtent).not.toHaveBeenCalled();
    state.up(311); expect(state.frames.size).toBe(0); expect(state.onChange).not.toHaveBeenCalled();
    state.down(310); state.move(312); expect(state.frames.size).toBe(1);
    expect(state.onPreviewExtent.mock.calls.at(-1)?.[1]).toBe(2160);
    state.escape(); expect(state.frames.size).toBe(0);
  });

  it('starts after a manual scroll delta even if the pointer itself has not moved', () => {
    const state = fixture(); state.down(310); state.scrollElement.scrollLeft = 40; state.move(310);
    expect(state.previewTick()).toBe(360); expect(state.frames.size).toBe(1);
    expect(state.onPreviewExtent.mock.calls.at(-1)?.[1]).toBe(2280);
    state.escape(); expect(state.frames.size).toBe(0);
  });

  it('reports tempo-aware waveform end before starting the loop and clears the same gesture token', () => {
    const state = fixture();
    state.update({ project: { ...state.project, tempos: [{ tick: 0, bpm: 120 }, { tick: 480, bpm: 60 }] } });
    state.onPreviewExtent.mockImplementation((_owner, end) => { if (end !== undefined) expect(state.frames.size).toBe(0); });
    state.down(10); state.move(40);
    // Start 360 ticks=.375s, then two seconds: .125s to tick480,
    // followed by 1.875s at 480 ticks/s => end tick1380.
    expect(state.previewTick()).toBe(360);
    const [token, end] = state.onPreviewExtent.mock.calls[0]; expect(end).toBe(1380); expect(state.frames.size).toBe(1);
    state.escape(); expect(state.onPreviewExtent.mock.calls.at(-1)).toEqual([token, undefined]); expect(state.frames.size).toBe(0);
  });

  it('updates preview from stationary right-edge scrolling, follows the latest pointer, and commits only on release', () => {
    const state = fixture(); state.down(280); state.move(310);
    const initialPreview = state.previewTick(), initialScroll = state.scrollElement.scrollLeft;
    state.advance(); expect(state.scrollElement.scrollLeft).toBe(initialScroll);
    state.advance(50); expect(state.scrollElement.scrollLeft).toBeGreaterThan(initialScroll);
    expect(state.previewTick()).toBeGreaterThan(initialPreview); expect(state.onChange).not.toHaveBeenCalled();
    expect(state.onPreviewExtent.mock.calls.at(-1)?.[1]).toBe(state.previewTick() + 1920);
    state.move(200); const centeredScroll = state.scrollElement.scrollLeft;
    state.advance(50); expect(state.scrollElement.scrollLeft).toBe(centeredScroll);
    const finalTick = state.previewTick(); state.up(200);
    expect(state.onChange).toHaveBeenCalledExactlyOnceWith({ startTick: finalTick }); expect(state.frames.size).toBe(0);
    state.advance(50); expect(state.scrollElement.scrollLeft).toBe(centeredScroll);
  });

  it('can leave the original right bound after the extent callback makes room, without scrolling below zero on the left', () => {
    const state = fixture(); state.scrollElement.scrollWidth = 210;
    state.onPreviewExtent.mockImplementation((_token, end) => { if (end !== undefined) state.scrollElement.scrollWidth = Math.max(state.scrollElement.scrollWidth, end * .25 + 200); });
    state.down(280); state.move(310); expect(state.scrollElement.scrollWidth).toBeGreaterThan(210);
    state.advance(); state.advance(50); expect(state.scrollElement.scrollLeft).toBeGreaterThan(10); state.escape();
    state.scrollElement.scrollLeft = 10; state.down(120); state.move(100); state.advance(); state.advance(50); state.advance(50);
    expect(state.scrollElement.scrollLeft).toBe(0); expect(state.previewTick()).toBeGreaterThanOrEqual(0); state.escape();
  });

  it.each(['Escape', 'window blur', 'target blur', 'pointer cancel', 'lost capture', 'unmount'])('stops scrolling and clears preview extent on %s', cause => {
    const state = fixture(); state.down(280); state.move(310); state.advance(); state.advance(16);
    const scroll = state.scrollElement.scrollLeft, token = state.onPreviewExtent.mock.calls[0][0];
    if (cause === 'Escape') state.escape();
    else if (cause === 'window blur') state.view.dispatchEvent(new Event('blur'));
    else if (cause === 'target blur') state.target.dispatchEvent(new Event('blur'));
    else if (cause === 'unmount') state.unmount();
    else state.render().props[cause === 'pointer cancel' ? 'onPointerCancel' : 'onLostPointerCapture'](state.event(310));
    expect(state.frames.size).toBe(0); expect(state.onPreviewExtent.mock.calls.at(-1)).toEqual([token, undefined]);
    state.advance(50); expect(state.scrollElement.scrollLeft).toBe(scroll); expect(state.onChange).not.toHaveBeenCalled();
  });

  it('checks live ownership before scrolling a frame and cancels without a late model write', () => {
    const state = fixture(); state.down(280); state.move(310); state.advance();
    const scroll = state.scrollElement.scrollLeft, token = state.onPreviewExtent.mock.calls[0][0];
    state.replaceOwnerWithoutRender(); state.advance(50);
    expect(state.scrollElement.scrollLeft).toBe(scroll); expect(state.previewTick()).toBe(240); expect(state.frames.size).toBe(0);
    expect(state.onPreviewExtent.mock.calls.at(-1)).toEqual([token, undefined]); state.up(310); expect(state.onChange).not.toHaveBeenCalled();
  });

  it('rejects changed geometry in the frame guard before a pending layout effect', () => {
    const state = fixture(); state.down(280); state.move(310); state.advance();
    state.update({ scale: .5 }, false); const scroll = state.scrollElement.scrollLeft; state.advance(50);
    expect(state.scrollElement.scrollLeft).toBe(scroll); expect(state.frames.size).toBe(0); expect(state.previewTick()).toBe(240);
    expect(state.onChange).not.toHaveBeenCalled();
  });

  it('cannot let old cleanup clear a new gesture extent or preview started synchronously during release', () => {
    const state = fixture(); let extent: { token: object; end: number } | undefined;
    state.onPreviewExtent.mockImplementation((token, end) => { if (end === undefined) { if (extent?.token === token) extent = undefined; } else extent = { token, end }; });
    state.down(280); state.move(310); const oldToken = extent!.token;
    state.onRelease(() => { state.onRelease(() => {}); state.down(280, 8); state.move(340, 8); });
    state.render().props.onPointerCancel(state.event(310));
    expect(extent).toBeDefined(); expect(extent!.token).not.toBe(oldToken); expect(state.previewTick()).toBe(480);
    expect(state.frames.size).toBe(1); expect(state.captures.has(8)).toBe(true); expect(state.onChange).not.toHaveBeenCalled();
    state.up(340, 8); expect(extent).toBeUndefined(); expect(state.frames.size).toBe(0);
  });
});
