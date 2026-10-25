import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { vi } from 'vitest';
import { createProject, newNote } from '../../src/core/project';
import { createMeterMap } from '../../src/core/meter';
import type { Region, Track } from '../../src/core/types';
import { ArrangementNoteCache } from '../../src/ui/arrangement-note-cache';
import { captureEditorPointer } from '../../src/ui/pointer-capture';
import { startHorizontalEdgeScroll, startVerticalEdgeScroll } from '../../src/ui/edge-scroll';
import { regionDragPreview } from '../../src/ui/region-drag-preview';
import { arrangementTrackAt } from '../../src/ui/arrangement-track-drop';

// Actual RegionClip and pointer helper; inert hooks/refs/listener targets only.
// Callback delivery below is not physical input, DOM focus or browser capture.
const source = readFileSync(new URL('../../src/ui/Arrangement.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function compile(componentSource: string) {
  const start = componentSource.indexOf('function RegionClip('), end = componentSource.indexOf('\nexport function Arrangement(', start);
  if (start < 0 || end < 0) throw new Error('Actual arrangement clip source boundary missing');
  return transformSync(componentSource.slice(start, end), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderRegionElement' }).code;
}
const defaultCode = compile(source);
type InertElement = { type: unknown; props: Record<string, any> };
type EffectSlot = { deps?: unknown[]; cleanup?: () => void };
type Edge = 'start' | 'end' | null;

class ListenerTarget {
  readonly listeners = new Map<string, Map<Function, boolean>>();
  readonly addEventListener = vi.fn((name: string, listener: Function, options?: boolean | { capture?: boolean }) => {
    const entries = this.listeners.get(name) ?? new Map<Function, boolean>(); entries.set(listener, typeof options === 'boolean' ? options : !!options?.capture); this.listeners.set(name, entries);
  });
  readonly removeEventListener = vi.fn((name: string, listener: Function, options?: boolean | { capture?: boolean }) => {
    const entries = this.listeners.get(name), capture = typeof options === 'boolean' ? options : !!options?.capture;
    if (entries?.get(listener) === capture) entries.delete(listener);
  });
  fire(name: string, extra: Record<string, unknown> = {}) {
    const event = { type: name, target: this, currentTarget: this, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    for (const listener of [...(this.listeners.get(name)?.keys() ?? [])]) listener(event); return event;
  }
  count() { return [...this.listeners.values()].reduce((count, entries) => count + entries.size, 0); }
}

export function createRegionGestureHarness(options: { locked?: boolean; region?: Partial<Region>; sourceText?: string; synchronousLostCapture?: boolean;
  tracks?: readonly Track[]; sourceTrackIndex?: number; trackTop?: number;
  scroll?: { left?: number; width?: number; scrollWidth?: number; scrollHeight?: number; boundsLeft?: number; boundsTop?: number; clientTop?: number; top?: number; height?: number } } = {}) {
  const project = createProject(), region = project.regions[0], pattern = project.patterns[0];
  if (options.tracks) { project.tracks = [...options.tracks]; region.trackId = project.tracks[options.sourceTrackIndex ?? 0].id; }
  region.start = 1920; region.length = pattern.length = 1920; Object.assign(region, options.region);
  const sourceTrack = project.tracks.find(track => track.id === region.trackId)!;
  pattern.notes = [newNote(0, 60, 120), newNote(960, 67, 120)];
  if (options.locked !== undefined) sourceTrack.locked = options.locked;
  const original = structuredClone(project), hooks: any[] = [], pending: (() => void)[] = [], captures = new Set<number>();
  let hook = 0, dirty = false, mounted = true, stateAfterUnmount = 0, node: InertElement, liveOwner: object = {};
  let onCapture = () => {}, onRelease = () => {}, onFocusTarget = () => {};
  const frames = new Map<number, FrameRequestCallback>(), frameCallbacks = new Map<number, FrameRequestCallback>(); let frameId = 0, time = 0;
  const view = Object.assign(new ListenerTarget(), {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); frameCallbacks.set(id, callback); return id; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
  }), targetEvents = new ListenerTarget(), document = { activeElement: null as unknown, defaultView: view };
  let scrollLeft = options.scroll?.left ?? 0, scrollTop = options.scroll?.top ?? 0;
  const scrollWrites: { requested: number; actual: number }[] = [];
  const scroller = { ownerDocument: document, clientWidth: options.scroll?.width ?? 800, scrollWidth: options.scroll?.scrollWidth ?? 1600,
    clientHeight: options.scroll?.height ?? 230, clientTop: options.scroll?.clientTop ?? 0, clientLeft: 0, scrollHeight: options.scroll?.scrollHeight ?? 0,
    get scrollTop() { return scrollTop; }, set scrollTop(value: number) { scrollTop = options.scroll?.scrollHeight === undefined ? value : Math.max(0, Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), value)); },
    getBoundingClientRect: () => ({ left: options.scroll?.boundsLeft ?? -100, top: options.scroll?.boundsTop ?? 0 }),
    get scrollLeft() { return scrollLeft; }, set scrollLeft(value: number) { scrollLeft = Math.max(0, Math.min(Math.max(0, scroller.scrollWidth - scroller.clientWidth), value)); scrollWrites.push({ requested: value, actual: scrollLeft }); } };
  const target = Object.assign(targetEvents, { ownerDocument: document,
    focus: vi.fn(() => { document.activeElement = target; onFocusTarget(); }),
    setPointerCapture: vi.fn((pointer: number) => { captures.add(pointer); onCapture(); }),
    hasPointerCapture: (pointer: number) => captures.has(pointer),
    releasePointerCapture: vi.fn((pointer: number) => {
      captures.delete(pointer);
      if (options.synchronousLostCapture) node.props.onLostPointerCapture(event(0, pointer));
      onRelease();
    }),
  });
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useState = (initial: any) => {
    const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], (next: any) => { if (!mounted) stateAfterUnmount++; const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }];
  };
  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous: EffectSlot | undefined = hooks[index];
    if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      const next: EffectSlot = { deps }; hooks[index] = next;
      pending.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') next.cleanup = cleanup; });
    }
  };
  const element = (type: unknown, attributes: any, ...children: any[]): InertElement => { if (attributes?.ref) attributes.ref.current = target; return { type, props: { ...attributes, children } }; };
  const mini = () => undefined, dependencies = { useRef, useState, useEffect, useLayoutEffect: useEffect, renderRegionElement: element, MiniNotes: mini, regionDragPreview, arrangementTrackAt, captureEditorPointer, startHorizontalEdgeScroll, startVerticalEdgeScroll, window: view };
  const Component = Function(...Object.keys(dependencies), `${options.sourceText ? compile(options.sourceText.replaceAll('\r\n', '\n')) : defaultCode}\nreturn RegionClip;`)(...Object.values(dependencies));
  const onTrimRegion = vi.fn(), onRegionChange = vi.fn(), onSelect = vi.fn(), onFocus = vi.fn(), onPreviewExtent = vi.fn((_owner: object, _end?: number) => {});
  const onTrackDropPreview = vi.fn((_owner: object, _trackId?: string, _blocked?: boolean) => {});
  const indexes = new ArrangementNoteCache(); indexes.update(project.patterns);
  let props = { pattern, region, track: sourceTrack, tracks: options.tracks ?? project.tracks, trackTop: options.trackTop ?? 26, scale: .1, meter: createMeterMap(project), step: 120, selected: true,
    scroll: { current: scroller }, left: 0, viewportWidth: scroller.clientWidth, visibleLane: true, indexes,
    gestureOwner: liveOwner, getGestureOwner: () => liveOwner, onPreviewExtent, onTrackDropPreview, onSelect, onFocus, onTrimRegion, onRegionChange };
  const render = (effects = true): InertElement => {
    let attempts = 0;
    do { hook = 0; dirty = false; node = Component(props); if (effects) while (pending.length) pending.shift()!(); if (++attempts > 20) throw new Error('Region callback harness did not settle'); } while (effects && dirty);
    return node;
  };
  const event = (x: number, pointer = 7, edge: Edge = 'start', extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: 52, pointerId: pointer, button: 0,
    target: { classList: { contains: (name: string) => edge !== null && (name === 'region-resize' || edge === 'start' && name === 'region-resize-start') } },
    currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
  const thumbnail = (value = render()): InertElement => value.props.children.find((child: any) => child?.type === mini);
  render();
  return { project, pattern, region, original, render, event, thumbnail, target, view, document, captures, onSelect, onFocus, onTrimRegion, onRegionChange, onPreviewExtent, onTrackDropPreview, frames, frameCallbacks, scroller, scrollWrites,
    props: () => props, capture: () => [...captures][0] ?? -1,
    update: (change: Partial<typeof props>, effects = true) => { props = { ...props, ...change }; return render(effects); },
    setLiveOwner: (owner: object) => { liveOwner = owner; },
    onCapture: (callback: () => void) => { onCapture = callback; }, onRelease: (callback: () => void) => { onRelease = callback; },
    onTargetFocus: (callback: () => void) => { onFocusTarget = callback; },
    fireWindow: (name: string, extra?: Record<string, unknown>) => { const result = view.fire(name, extra); render(); return result; },
    fireTarget: (name: string, extra?: Record<string, unknown>) => { const result = targetEvents.fire(name, extra); render(); return result; },
    listeners: () => view.count() + targetEvents.count(),
    frame: (elapsed = 16) => { time += elapsed; for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(time); if (mounted) render(); },
    deliverLateFrame: (id: number) => { frames.delete(id); frameCallbacks.get(id)?.(time + 100); if (mounted) render(); },
    unmount: () => { mounted = false; for (const value of hooks) value?.cleanup?.(); }, stateAfterUnmount: () => stateAfterUnmount };
}

export type RegionGestureHarness = ReturnType<typeof createRegionGestureHarness>;
export type RegionGestureProps = ReturnType<RegionGestureHarness['props']>;
