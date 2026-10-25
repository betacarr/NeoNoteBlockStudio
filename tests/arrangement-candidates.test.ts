import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { playbackEndTick } from '../src/core/reference';
import { filterTracks } from '../src/core/track-filter';
import type { Project } from '../src/core/types';
import { ArrangementNoteCache } from '../src/ui/arrangement-note-cache';
import { regionPreviewGeometry } from '../src/ui/arrangement-preview';
import { regionDragPreview } from '../src/ui/region-drag-preview';
import { captureEditorPointer } from '../src/ui/pointer-capture';
import { startHorizontalEdgeScroll, startVerticalEdgeScroll } from '../src/ui/edge-scroll';
import { arrangementTrackAt } from '../src/ui/arrangement-track-drop';
import { ArrangementGroupGesture } from '../src/ui/arrangement-group-gesture';

// Run actual Arrangement -> RegionClip -> MiniNotes, including memo dependencies,
// observer callbacks, effects and cleanups. Elements/canvas/viewport remain inert;
// this is component integration and candidate-work evidence, not GUI or FPS.
const source = readFileSync(new URL('../src/ui/Arrangement.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('function MiniNotes(');
if (start < 0) throw new Error('Actual arrangement thumbnail components were not found');
const componentCode = transformSync(source.slice(start).replace('export function Arrangement(', 'function Arrangement('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderArrangementElement' }).code;
type ArrangementProps = Parameters<typeof import('../src/ui/Arrangement').Arrangement>[0];
type Index = NonNullable<ReturnType<ArrangementNoteCache['get']>>;
type ElementNode = { type: any; props: Record<string, any>; dom?: any };
type Instance = { hooks: any[]; cursor: number; seen: boolean };
const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

function arrangementProject() {
  const project = createProject('Arrangement candidates'); project.ppq = 480;
  project.patterns[0].length = project.regions[0].length = 1920;
  project.patterns[0].notes = [{ ...newNote(0, 60, 120), id: 'first' }, { ...newNote(960, 67, 240), id: 'second' }];
  project.regions.push({ ...project.regions[0], id: 'second-copy', start: 2400 }); return project;
}

function arrangementFixture(project = arrangementProject(), initialProps: Partial<ArrangementProps> = {}) {
  const instances = new Map<string, Instance>(), dom = new Map<string, any>(), pending: (() => void)[] = [];
  const geometryCalls: { pattern: Project['patterns'][number]; index: Index | undefined; result: ReturnType<typeof regionPreviewGeometry> }[] = [];
  const cacheGets: { cache: ArrangementNoteCache; id: string; index: Index | undefined }[] = [], createdIndexes: { id: string; index: Index }[] = [];
  const knownIndexes = new Set<Index>(), miniProps: Record<string, any>[] = [], paints: { canvas: any; rect: number[] }[] = [];
  let active: Instance, dirty = false, disconnects = 0, tree: ElementNode;
  let renderedRegions: Record<string, any>[] = [];
  const slot = () => { const index = active.cursor++; return { owner: active, index, value: active.hooks[index] }; };
  const useRef = (initial: unknown) => { const state = slot(); return state.owner.hooks[state.index] ??= { current: initial }; };
  const useState = (initial: any) => {
    const state = slot(); if (!(state.index in state.owner.hooks)) state.owner.hooks[state.index] = typeof initial === 'function' ? initial() : initial;
    return [state.owner.hooks[state.index], (next: any) => { const before = state.owner.hooks[state.index], value = typeof next === 'function' ? next(before) : next; if (!Object.is(before, value)) { state.owner.hooks[state.index] = value; dirty = true; } }];
  };
  const useMemo = (create: () => unknown, deps: unknown[]) => {
    const state = slot(); if (!state.value || !sameDeps(state.value.deps, deps)) state.owner.hooks[state.index] = { deps, value: create() };
    return state.owner.hooks[state.index].value;
  };
  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const state = slot(); if (state.value && sameDeps(state.value.deps, deps)) return;
    const next: { kind: string; deps?: unknown[]; cleanup?: () => void } = { kind: 'effect', deps }; state.owner.hooks[state.index] = next;
    pending.push(() => { state.value?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') next.cleanup = cleanup; });
  };
  const observers = new Set<ResizeObserverStub>();
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0, time = 0;
  const view = { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }) };
  let scrollElement: any;
  const verticalWrites: number[] = [];
  class ResizeObserverStub {
    target: any;
    constructor(readonly callback: (entries: any[]) => void) {}
    observe(target: any) { this.target = target; observers.add(this); this.notify(); }
    notify() { this.callback([{ contentRect: { width: this.target.clientWidth, height: this.target.clientHeight } }]); }
    disconnect() { observers.delete(this); disconnects++; }
  }
  class ObservedCache extends ArrangementNoteCache {
    get(id: string) {
      const index = super.get(id); cacheGets.push({ cache: this, id, index });
      if (index && !knownIndexes.has(index)) { knownIndexes.add(index); createdIndexes.push({ id, index }); } return index;
    }
  }
  const element = (type: unknown, props: any, ...children: unknown[]): ElementNode => ({ type, props: { ...props, children } });
  const measuredGeometry = (...args: Parameters<typeof regionPreviewGeometry>) => {
    const result = regionPreviewGeometry(...args); geometryCalls.push({ pattern: args[0] as Project['patterns'][number], index: args[3], result }); return result;
  };
  const decoration = () => null;
  const dependencies = { useRef, useState, useMemo, useEffect, useLayoutEffect: useEffect, renderArrangementElement: element, ArrangementNoteCache: ObservedCache,
    playbackEndTick, filterTracks, regionPreviewGeometry: measuredGeometry, regionDragPreview, arrangementTrackAt, ArrangementGroupGesture, captureEditorPointer, startHorizontalEdgeScroll, startVerticalEdgeScroll, ResizeObserver: ResizeObserverStub,
    window: view, LockSimple: decoration, Plus: decoration, InstrumentBlock: decoration, ReferenceHeader: decoration, ReferenceLane: decoration,
    requestAnimationFrame: view.requestAnimationFrame, cancelAnimationFrame: view.cancelAnimationFrame };
  const components = Function(...Object.keys(dependencies), `${componentCode}\nreturn {Arrangement,RegionClip,MiniNotes};`)(...Object.values(dependencies));
  const actualComponents = new Set(Object.values(components));
  let props: ArrangementProps = { project, meter: createMeterMap(project), snap: 16, selectedRegion: project.regions[0]?.id ?? '', selectedTrack: project.tracks[0].id, zoom: 96, playhead: 0,
    onSelect: vi.fn(), onTrack: vi.fn(), onTrackChange: vi.fn(), onRegionChange: vi.fn(), onTrimRegion: vi.fn(), onAddTrack: vi.fn(), onCreateRegion: vi.fn(), onSeek: vi.fn(), onFocus: vi.fn(), onReferenceChange: vi.fn(), onReferenceRemove: vi.fn(), ...initialProps };
  function renderComponent(component: any, attributes: any, path: string): ElementNode {
    let instance = instances.get(path); if (!instance) { instance = { hooks: [], cursor: 0, seen: true }; instances.set(path, instance); }
    const previous = active; active = instance; instance.cursor = 0; instance.seen = true;
    if (component === components.MiniNotes) miniProps.push(attributes);
    if (component === components.RegionClip) renderedRegions.push(attributes);
    const rendered = component(attributes); active = previous; return resolveNode(rendered, path);
  }
  function resolveNode(node: any, path: string): any {
    if (!node || typeof node !== 'object' || !('type' in node)) return node;
    if (typeof node.type === 'function') return actualComponents.has(node.type) ? renderComponent(node.type, node.props, `${path}/${node.type.name}`) : node;
    let target = dom.get(path);
    if (!target) {
      const captures = new Set<number>(); let left = 0, top = 0;
      target = { scrollTop: 0, scrollWidth: 900, clientWidth: 900, clientHeight: 230, clientTop: 0, clientLeft: 0, width: 0, height: 0, addEventListener: vi.fn(), removeEventListener: vi.fn(), ownerDocument: { defaultView: view },
        setPointerCapture: (pointer: number) => captures.add(pointer), hasPointerCapture: (pointer: number) => captures.has(pointer), releasePointerCapture: (pointer: number) => captures.delete(pointer),
        getBoundingClientRect: () => ({ left: 0, right: 900, top: 0, bottom: 230 }), focus: vi.fn(), scrollIntoView: vi.fn(() => { throw new Error('Must not scroll the document or app'); }) };
      const element = target;
      Object.defineProperty(element, 'scrollTop', { get: () => top, set: (value: number) => { top = value; if (element === scrollElement) verticalWrites.push(value); } });
      Object.defineProperty(element, 'scrollLeft', { get: () => left, set: (value: number) => { const next = Math.max(0, Math.min(Math.max(0, element.scrollWidth - element.clientWidth), value)); if (next !== left) { left = next; element.scrollHandler?.({ currentTarget: element }); } } });
      if (node.type === 'canvas') target.getContext = () => ({ scale() {}, fillRect: (...rect: number[]) => paints.push({ canvas: target, rect }), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
      dom.set(path, target);
    }
    if (node.props.className === 'arrangement-scroll') { scrollElement = target; target.scrollHandler = node.props.onScroll; }
    if (node.props.className === 'arrangement-content' && scrollElement) { scrollElement.scrollWidth = node.props.style.width; scrollElement.scrollHeight = node.props.style.height; scrollElement.scrollLeft = scrollElement.scrollLeft; }
    if (node.type === 'canvas') { target.clientWidth = node.props.style.width; target.clientHeight = 46; }
    if (node.props.ref) node.props.ref.current = target;
    const children = (node.props.children ?? []).flat(Infinity).map((child: any, index: number) => resolveNode(child, `${path}/${child?.props?.key ?? index}`));
    return { ...node, props: { ...node.props, children }, dom: target };
  }
  const render = () => {
    let attempts = 0;
    do {
      dirty = false; renderedRegions = []; for (const instance of instances.values()) instance.seen = false;
      tree = renderComponent(components.Arrangement, props, 'arrangement');
      for (const [path, instance] of instances) if (!instance.seen) { for (const hook of instance.hooks) if (hook?.kind === 'effect') hook.cleanup?.(); instances.delete(path); }
      while (pending.length) pending.shift()!(); if (++attempts > 20) throw new Error('Arrangement component harness did not settle');
    } while (dirty);
  };
  const elements = (node: any): ElementNode[] => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(elements)];
  render();
  return { geometryCalls, cacheGets, createdIndexes, miniProps, paints, render, frames, view, verticalWrites, scrollElement: () => scrollElement, elements: () => elements(tree), regions: () => renderedRegions, props: () => props, cache: () => miniProps.at(-1)!.indexes as ArrangementNoteCache,
    update: (change: Partial<ArrangementProps>) => { props = { ...props, ...change }; if (change.project) props.meter = createMeterMap(change.project); render(); },
    scroll: (left: number, top = 0) => { const node = elements(tree).find(node => node.props.className === 'arrangement-scroll')!; node.dom.scrollLeft = left; node.dom.scrollTop = top; node.props.onScroll({ currentTarget: node.dom }); render(); },
    headerWheel: (deltaY: number, ctrlKey = false) => {
      const header = elements(tree).find(node => node.props.className === 'track-headers')!;
      const listener = header.dom.addEventListener.mock.calls.find(([name]: [string]) => name === 'wheel')?.[1];
      if (!listener) throw new Error('Actual track-header wheel listener missing');
      const event = { deltaY, ctrlKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }; listener(event); render(); return event;
    },
    resizeCanvases: () => { for (const observer of [...observers]) if (observer.target.getContext) observer.notify(); },
    resizeViewport: (height: number) => { scrollElement.clientHeight = height; for (const observer of [...observers]) if (observer.target === scrollElement) observer.notify(); render(); },
    frame: (elapsed = 16) => { time += elapsed; for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(time); render(); },
    activeCanvasObservers: () => [...observers].filter(observer => observer.target.getContext).length,
    disconnects: () => disconnects };
}

describe('Arrangement actual thumbnail components and current-source cache (no physical input)', () => {
  it('shares one lazy source index between two visible copies and redraws without rebuilding for scroll, zoom or resize', () => {
    const state = arrangementFixture(), initial = state.createdIndexes[0].index;
    expect(state.createdIndexes).toHaveLength(1); expect(state.activeCanvasObservers()).toBe(2);
    expect(new Set(state.geometryCalls.map(call => call.index))).toEqual(new Set([initial])); expect(state.geometryCalls.every(call => call.index)).toBe(true);
    const draws = state.geometryCalls.length; state.scroll(100); state.update({ zoom: 120 }); state.resizeCanvases();
    expect(state.geometryCalls.length).toBeGreaterThan(draws); expect(state.createdIndexes).toHaveLength(1);
    expect(state.geometryCalls.every(call => call.index === initial)).toBe(true); expect(state.paints.length).toBeGreaterThan(0);
    expect(state.paints.map(paint => [paint.rect[0], paint.rect[2], paint.rect[3]])).toEqual(state.geometryCalls.flatMap(call => call.result.notes.map(note => [note.x, note.width, 2])));
    expect(state.props().onRegionChange).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
  });

  it('replaces a shared index for new notes or a new period, but not a pattern rename', () => {
    const state = arrangementFixture(), original = state.props().project, first = state.createdIndexes[0].index;
    const renamed = { ...original, patterns: original.patterns.map(pattern => ({ ...pattern, name: 'Renamed' })) };
    state.update({ project: renamed }); expect(state.createdIndexes).toHaveLength(1); expect(state.cache().get(original.patterns[0].id)).toBe(first);
    const changed = { ...renamed, patterns: renamed.patterns.map(pattern => ({ ...pattern, notes: [...pattern.notes, { ...newNote(480, 72, 120), id: 'new-note' }] })) };
    state.update({ project: changed }); const second = state.createdIndexes.at(-1)!.index;
    expect(second).not.toBe(first); expect(state.createdIndexes).toHaveLength(2);
    state.update({ project: { ...changed, patterns: changed.patterns.map(pattern => ({ ...pattern, length: 3840 })) } });
    expect(state.createdIndexes).toHaveLength(3); expect(state.createdIndexes.at(-1)!.index).not.toBe(second);
  });

  it('does not retain old undo/new-document source entries and evicts removed patterns without resetting the component', () => {
    const state = arrangementFixture(), original = state.props().project, cache = state.cache(), first = state.createdIndexes[0].index;
    const changed = { ...original, patterns: original.patterns.map(pattern => ({ ...pattern, notes: pattern.notes.slice(0, 1) })) };
    state.update({ project: changed }); const edited = state.createdIndexes.at(-1)!.index;
    state.update({ project: original }); const undone = state.createdIndexes.at(-1)!.index;
    expect(state.cache()).toBe(cache); expect(undone).not.toBe(first); expect(undone).not.toBe(edited);
    const reopened = structuredClone(original); reopened.id = 'new-document-same-pattern-ids'; state.update({ project: reopened });
    const reopenedIndex = state.createdIndexes.at(-1)!.index; expect(state.cache()).toBe(cache); expect(reopenedIndex).not.toBe(undone);
    const disconnects = state.disconnects(); state.update({ project: { ...reopened, patterns: [], regions: [] } });
    expect(cache.get(original.patterns[0].id)).toBeUndefined(); expect(state.activeCanvasObservers()).toBe(0); expect(state.disconnects()).toBeGreaterThan(disconnects);
    state.update({ project: original }); expect(state.cache()).toBe(cache); expect(state.createdIndexes.at(-1)!.index).not.toBe(reopenedIndex);
  });

  it('never builds sources outside horizontal or lane visibility, then builds once when the lane is scrolled into view', () => {
    const project = arrangementProject(); let hiddenReads = 0;
    const hiddenNote = (id: string) => Object.defineProperty({ ...newNote(0, 60, 120), id }, 'tick', { enumerable: true, get: () => { hiddenReads++; return 0; } });
    project.patterns.push({ id: 'far', name: 'Far', length: 1920, notes: [hiddenNote('far-note')] }, { id: 'hidden-lane', name: 'Hidden lane', length: 1920, notes: [hiddenNote('hidden-note')] });
    for (let i = 1; i < 10; i++) project.tracks.push({ ...project.tracks[0], id: `track-${i}` });
    project.regions.push({ ...project.regions[0], id: 'far-region', patternId: 'far', start: 100000 }, { ...project.regions[0], id: 'hidden-region', patternId: 'hidden-lane', trackId: 'track-9' });
    const state = arrangementFixture(project);
    expect(hiddenReads).toBe(0); expect(state.cacheGets.some(get => get.id === 'far' || get.id === 'hidden-lane')).toBe(false);
    state.scroll(0, 26 + 9 * 52); expect(state.createdIndexes.filter(entry => entry.id === 'hidden-lane')).toHaveLength(1);
    expect(state.cacheGets.some(get => get.id === 'far')).toBe(false); expect(hiddenReads).toBeGreaterThan(0);
  });

  it('preserves per-track source order and exact pattern/instrument lookup after rename and track selection changes', () => {
    const project = arrangementProject(), trackA = project.tracks[0], trackB = { ...trackA, id: 'track-b', instrumentId: project.instruments[1].id, name: 'Track B' };
    project.tracks = [trackA, trackB]; project.instruments[0].name = 'Lookup Harp'; project.instruments[1].name = 'Lookup Bass'; project.instruments.reverse();
    const patternA = { ...project.patterns[0], id: 'pattern-a', name: 'Pattern A' }, patternB = { ...patternA, id: 'pattern-b', name: 'Pattern B' }, patternC = { ...patternA, id: 'pattern-c', name: 'Pattern C' };
    project.patterns = [patternB, patternA, patternC];
    const base = project.regions[0]; project.regions = [
      { ...base, id: 'b-first', trackId: trackB.id, patternId: patternB.id, start: 0 },
      { ...base, id: 'a-first', patternId: patternC.id, start: 240 },
      { ...base, id: 'b-second', trackId: trackB.id, patternId: patternA.id, start: 0 },
      { ...base, id: 'a-second', patternId: patternB.id, start: 0 },
    ];
    const original = structuredClone(project.regions), state = arrangementFixture(project);
    const order = () => state.regions().map(({ track, region, pattern }) => [track.id, region.id, pattern.id, pattern.name]);
    expect(order()).toEqual([[trackA.id, 'a-first', 'pattern-c', 'Pattern C'], [trackA.id, 'a-second', 'pattern-b', 'Pattern B'], ['track-b', 'b-first', 'pattern-b', 'Pattern B'], ['track-b', 'b-second', 'pattern-a', 'Pattern A']]);
    const text = (node: any): string => typeof node === 'string' ? node : (node?.props?.children ?? []).map(text).join('');
    const headers = state.elements().filter(node => node.props['data-testid'] === 'track-header');
    expect(text(headers[0])).toContain('Lookup Harp'); expect(text(headers[1])).toContain('Lookup Bass');
    state.update({ selectedTrack: trackB.id, project: { ...project, patterns: [patternC, patternA, { ...patternB, name: 'Renamed B' }] } });
    expect(order()).toEqual([[trackA.id, 'a-first', 'pattern-c', 'Pattern C'], [trackA.id, 'a-second', 'pattern-b', 'Renamed B'], ['track-b', 'b-first', 'pattern-b', 'Renamed B'], ['track-b', 'b-second', 'pattern-a', 'Pattern A']]);
    expect(state.elements().filter(node => node.props['data-testid'] === 'track-header').map(node => node.props.className)).toEqual(['track-header ', 'track-header active']);
    expect(project.regions).toEqual(original); expect(state.props().onRegionChange).not.toHaveBeenCalled();
  });

  it('bounds 100k sparse-source redraw field reads while reusing the shared source index', () => {
    const project = arrangementProject(); let reads = 0, measuring = false;
    const notes = Array.from({ length: 100000 }, (_, index) => {
      const tick = index * 9600; return Object.defineProperty({ ...newNote(tick, 60, 60), id: `sparse-${index}` }, 'tick', { enumerable: true, get: () => { if (measuring) reads++; return tick; } });
    });
    project.patterns[0].notes = notes; project.patterns[0].length = 960000000; for (const region of project.regions) region.length = 960000000;
    const state = arrangementFixture(project), cache = state.cache(), first = state.createdIndexes[0].index;
    const measure = (action: () => void) => { reads = 0; measuring = true; try { action(); return reads; } finally { measuring = false; } };
    expect(measure(() => state.scroll(100))).toBeLessThan(500); expect(measure(() => state.update({ zoom: 120 }))).toBeLessThan(500);
    expect(measure(() => state.resizeCanvases())).toBeLessThan(500); expect(state.createdIndexes).toHaveLength(1); expect(state.cache()).toBe(cache);
    expect(state.geometryCalls.every(call => call.index === first && call.result.notes.length < 10)).toBe(true);
    expect(project.patterns[0].notes).toBe(notes); expect(notes[0].tick).toBe(0); expect(notes.at(-1)!.tick).toBe(99999 * 9600);
    expect(state.props().onRegionChange).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
  });

  it('extends the real parent content width for a right-edge drag, scrolls beyond the old edge and keeps the shared source cache', () => {
    const state = arrangementFixture(), original = state.props().project, index = state.createdIndexes[0].index;
    const width = () => state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.width;
    const regionNode = () => state.elements().filter(node => node.props['data-testid'] === 'region')[1];
    const event = (node: ElementNode, x: number) => ({ clientX: x, clientY: 52, pointerId: 7, button: 0, currentTarget: node.dom, target: { classList: { contains: () => false } }, preventDefault() {}, stopPropagation() {} });
    const oldWidth = width(); state.scroll(1e9); const oldRight = state.scrollElement().scrollLeft;
    let node = regionNode(); node.props.onPointerDown(event(node, 100)); node.props.onPointerMove(event(node, 899)); state.render();
    expect(width()).toBeGreaterThan(oldWidth); expect(state.props().project).toBe(original);
    for (let frame = 0; frame < 5; frame++) state.frame();
    expect(state.scrollElement().scrollLeft).toBeGreaterThan(oldRight); expect(state.createdIndexes).toHaveLength(1);
    expect(state.geometryCalls.every(call => call.index === index)).toBe(true); expect(state.props().onRegionChange).not.toHaveBeenCalled();
    node = regionNode(); node.props.onPointerUp(event(node, 899)); state.render();
    expect(state.props().onRegionChange).toHaveBeenCalledOnce(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
    expect(width()).toBe(oldWidth); expect(state.frames.size).toBe(0); expect(state.props().project).toBe(original);
  });

  it('clears an active parent extent when a reopened document replaces the source without leaving queued scrolling', () => {
    const state = arrangementFixture(), original = state.props().project;
    const width = () => state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.width;
    const node = state.elements().find(node => node.props['data-testid'] === 'region')!;
    const event = (x: number) => ({ clientX: x, clientY: 52, pointerId: 7, button: 0, currentTarget: node.dom, target: { classList: { contains: () => false } }, preventDefault() {}, stopPropagation() {} });
    const baseWidth = width(); node.props.onPointerDown(event(100)); node.props.onPointerMove(event(899)); state.render(); expect(width()).toBeGreaterThan(baseWidth);
    const reopened = structuredClone(original); reopened.id = 'reopened-document'; state.update({ project: reopened });
    expect(width()).toBe(baseWidth); expect(state.frames.size).toBe(0); expect(state.props().onRegionChange).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
  });

  it('keeps the newer preview owner extent when an older owner reports cleanup', () => {
    const state = arrangementFixture(), width = () => state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.width;
    const report = state.regions()[0].onPreviewExtent, first = {}, second = {}, baseWidth = width();
    report(first, 9000); state.render(); report(second, 13000); state.render(); const secondWidth = width();
    expect(secondWidth).toBeGreaterThan(baseWidth); report(first, undefined); state.render(); expect(width()).toBe(secondWidth);
    report(second, undefined); state.render(); expect(width()).toBe(baseWidth); expect(state.createdIndexes).toHaveLength(1);
  });
});

function manyTracks(count = 10) {
  const project = arrangementProject(), base = project.tracks[0], region = project.regions[0];
  project.tracks = Array.from({ length: count }, (_, index) => ({ ...base, id: `track-${index}`, name: `Track ${index + 1}`, instrumentId: index % 2 ? 'bass' : 'harp' }));
  project.regions = project.tracks.map((track, index) => ({ ...region, id: `region-${index}`, trackId: track.id }));
  return project;
}
const textContent = (node: any): string => typeof node === 'string' ? node : (node?.props?.children ?? []).map(textContent).join('');

describe('Arrangement instrument view filter and local selection visibility (inert component boundary)', () => {
  it('reveals the selected destination again when opening a mixer shrinks the arrangement viewport', () => {
    const state = arrangementFixture(manyTracks(4)); state.update({ selectedTrack: 'track-2' });
    expect(state.scrollElement().scrollTop).toBe(0);
    state.scroll(120); state.resizeViewport(100);
    expect(state.scrollElement().scrollTop).toBe(82); expect(state.scrollElement().scrollLeft).toBe(120);
    expect(state.elements().find(node => node.props.className === 'track-header-list')!.dom.scrollTop).toBe(82);
    expect(state.props().onRegionChange).not.toHaveBeenCalled();
    const writes = state.verticalWrites.length; state.render(); expect(state.verticalWrites.length).toBe(writes);
  });

  it('passes filtered rows/reference height to a cross-track preview while reusing the real shared source index', () => {
    const project = manyTracks(6), original = structuredClone(project);
    project.assets.push({ id: 'guide', name: 'Guide', mime: 'audio/wav' }); project.reference = { assetId: 'guide', startTick: 0, gain: 1 };
    const state = arrangementFixture(project, { instrumentFilter: 'bass' }), index = state.createdIndexes[0].index;
    const source = () => state.elements().find(node => node.props['data-region-id'] === 'region-1')!;
    const event = (node: ElementNode, x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 7, button: 0, currentTarget: node.dom,
      target: { classList: { contains: () => false } }, preventDefault() {}, stopPropagation() {} });
    expect(state.regions()[0].tracks.map((track: Project['tracks'][number]) => track.id)).toEqual(['track-1', 'track-3', 'track-5']);
    expect(state.regions()[0].trackTop).toBe(78);
    let node = source(); node.props.onPointerDown(event(node, 100, 104)); node.props.onPointerMove(event(node, 148, 208)); state.render();
    node = source(); expect(node.props.style.transform).toBe('translateY(104px)'); expect(node.props['data-drop-track-id']).toBe('track-5');
    const destination = state.elements().find(row => String(row.props.className).startsWith('arrangement-lane') && row.props['data-track-id'] === 'track-5')!;
    expect(destination.props.className).toContain('track-drop-target'); expect(state.createdIndexes).toHaveLength(1);
    expect(state.geometryCalls.every(call => call.index === index)).toBe(true); expect(state.props().onRegionChange).not.toHaveBeenCalled();
    node.props.onPointerUp(event(node, 148, 208)); state.render();
    expect(state.props().onRegionChange).toHaveBeenCalledExactlyOnceWith('region-1', { start: 240, trackId: 'track-5' });
    expect(state.props().onTrimRegion).not.toHaveBeenCalled(); expect(state.frames.size).toBe(0); expect(state.createdIndexes).toHaveLength(1);
    expect(state.elements().some(row => String(row.props.className).includes('track-drop-target'))).toBe(false);
    expect(project.regions).toEqual(original.regions); expect(project.patterns).toEqual(original.patterns);
  });

  it('filters headers and lanes in source order while keeping original numbers and the complete project intact', () => {
    const project = manyTracks(), before = structuredClone(project);
    // A note override does not change its track's filter category.
    project.patterns[0].notes[0].instrumentId = 'bass'; before.patterns[0].notes[0].instrumentId = 'bass';
    const state = arrangementFixture(project, { instrumentFilter: 'bass' });
    const headers = () => state.elements().filter(node => node.props['data-testid'] === 'track-header');
    expect(headers().map(node => node.props['data-track-id'])).toEqual(['track-1', 'track-3', 'track-5', 'track-7', 'track-9']);
    expect(headers().map(node => textContent(node.props.children.find((child: any) => child?.props?.className === 'track-number')))).toEqual(['02', '04', '06', '08', '10']);
    expect(state.regions().map(row => row.track.id)).toEqual(['track-1', 'track-3', 'track-5', 'track-7', 'track-9']);
    expect(state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.height).toBe(286);
    expect(state.props().project).toBe(project); expect(project).toEqual(before);
    expect(state.props().onTrack).not.toHaveBeenCalled(); expect(state.props().onSelect).not.toHaveBeenCalled();
    state.update({ instrumentFilter: '' });
    expect(headers().map(node => node.props['data-track-id'])).toEqual(project.tracks.map(track => track.id));
    expect(state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.height).toBe(546);
  });

  it('keeps the reference visible with no matching tracks, exposes a status, and has no hidden-track creation surface', () => {
    const project = manyTracks(); project.assets.push({ id: 'reference', name: 'Guide.wav', mime: 'audio/wav', data: 'AA==' });
    project.reference = { assetId: 'reference', startTick: 480, gain: .7 };
    const state = arrangementFixture(project, { instrumentFilter: 'missing-instrument' });
    expect(state.elements().filter(node => node.props['data-testid'] === 'track-header')).toEqual([]); expect(state.regions()).toEqual([]);
    expect(state.elements().filter(node => String(node.props.className).startsWith('arrangement-lane'))).toEqual([]);
    const reference = state.elements().find(node => node.props.project === project)!;
    expect(reference.props.project).toBe(project); expect(reference.props.project.tracks).toHaveLength(10);
    expect(state.elements().some(node => node.props.reference === project.reference)).toBe(true);
    expect(state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.height).toBe(78);
    expect(textContent(state.elements().find(node => node.props.role === 'status'))).toBe('没有使用所选音色的轨道');
    expect(state.props().onTrack).not.toHaveBeenCalled(); expect(state.props().onCreateRegion).not.toHaveBeenCalled();
    const empty = { ...project, tracks: [], regions: [] };
    state.update({ project: empty, instrumentFilter: '' });
    expect(textContent(state.elements().find(node => node.props.role === 'status'))).toBe('尚无轨道，请添加轨道');
  });

  it('scrolls a selected visible lane into view without moving horizontally or invoking document scrolling', () => {
    const state = arrangementFixture(manyTracks()); state.scroll(120);
    state.update({ selectedTrack: 'track-9' });
    expect(state.scrollElement().scrollTop).toBe(316); expect(state.scrollElement().scrollLeft).toBe(120);
    expect(state.elements().find(node => node.props.className === 'track-header-list')!.dom.scrollTop).toBe(316);
    expect(state.regions().find(row => row.track.id === 'track-9')!.visibleLane).toBe(true);
    const writes = state.verticalWrites.length;
    state.update({ playhead: 480 }); state.update({ playhead: 960 }); state.render();
    expect(state.verticalWrites).toHaveLength(writes); expect(state.scrollElement().scrollTop).toBe(316);
    // The adjacent lane already fits completely; choosing it must not jump.
    state.update({ selectedTrack: 'track-8' }); expect(state.verticalWrites).toHaveLength(writes);
    state.update({ selectedTrack: 'track-0' }); expect(state.scrollElement().scrollTop).toBe(0); expect(state.scrollElement().scrollLeft).toBe(120);
  });

  it('uses filtered row positions plus reference/ruler heights rather than original track indices', () => {
    const project = manyTracks(); project.assets.push({ id: 'reference', name: 'Guide', mime: 'audio/wav' }); project.reference = { assetId: 'reference', startTick: 0, gain: 1 };
    const state = arrangementFixture(project, { instrumentFilter: 'bass' });
    state.update({ selectedTrack: 'track-9' });
    expect(state.scrollElement().scrollTop).toBe(108); // ruler26 + reference52 + 5*52 - viewport230
    expect(state.regions().find(row => row.track.id === 'track-9')!.visibleLane).toBe(true);
    state.update({ selectedTrack: 'track-1' }); expect(state.scrollElement().scrollTop).toBe(52);
    expect(state.elements().find(node => node.props.className === 'track-header-list')!.dom.scrollTop).toBe(52);
  });

  it('does not select a hidden track or clear the filter, and clamps a shortened list while refreshing mini-note visibility', () => {
    const state = arrangementFixture(manyTracks()); state.update({ selectedTrack: 'track-9' });
    state.update({ instrumentFilter: 'harp' });
    expect(state.scrollElement().scrollTop).toBe(56); expect(state.props().selectedTrack).toBe('track-9'); expect(state.props().instrumentFilter).toBe('harp');
    expect(state.props().onTrack).not.toHaveBeenCalled(); expect(state.props().onSelect).not.toHaveBeenCalled();
    expect(state.regions().find(row => row.track.id === 'track-8')!.visibleLane).toBe(true);
    state.update({ instrumentFilter: 'no-match' }); expect(state.scrollElement().scrollTop).toBe(0);
    expect(state.elements().find(node => node.props.className === 'track-header-list')!.dom.scrollTop).toBe(0);
  });

  it('updates header and thumbnail viewport immediately after the actual header wheel callback', () => {
    const state = arrangementFixture(manyTracks()), event = state.headerWheel(316);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(state.scrollElement().scrollTop).toBe(316); expect(state.elements().find(node => node.props.className === 'track-header-list')!.dom.scrollTop).toBe(316);
    expect(state.regions().find(row => row.track.id === 'track-9')!.visibleLane).toBe(true);
    expect(state.regions().find(row => row.track.id === 'track-0')!.visibleLane).toBe(false);
    const ctrl = state.headerWheel(20, true); expect(ctrl.preventDefault).not.toHaveBeenCalled(); expect(state.scrollElement().scrollTop).toBe(316);
  });

  it('provides a native name button for locked-track selection while preserving independent controls and creation locks', () => {
    const project = manyTracks(2); project.tracks[1].locked = true;
    const state = arrangementFixture(project, { instrumentFilter: 'bass' });
    const header = state.elements().find(node => node.props['data-testid'] === 'track-header')!;
    expect(header.props.role).toBe('group');
    const name = state.elements().find(node => node.props['aria-label'] === '选择轨道 Track 2')!;
    expect(name.type).toBe('button'); expect(name.props.disabled).not.toBe(true); expect(name.props['aria-pressed']).toBe(false);
    const event = { stopPropagation: vi.fn() }; name.props.onClick(event); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(state.props().onTrack).toHaveBeenCalledExactlyOnceWith(project.tracks[1]);
    const mute = state.elements().find(node => node.props.title === '静音')!; mute.props.onClick(event);
    expect(state.props().onTrackChange).toHaveBeenCalledExactlyOnceWith(project.tracks[1].id, { muted: true }); expect(state.props().onTrack).toHaveBeenCalledTimes(1);
    const lane = state.elements().find(node => node.props['data-track-id'] === project.tracks[1].id && String(node.props.className).startsWith('arrangement-lane'))!;
    lane.props.onDoubleClick({ target: lane.dom, currentTarget: lane.dom, clientX: 100 }); expect(state.props().onCreateRegion).not.toHaveBeenCalled();
    state.update({ project: { ...project, tracks: project.tracks.map(track => ({ ...track, locked: false })) } });
    const unlocked = state.elements().find(node => String(node.props.className).startsWith('arrangement-lane'))!;
    unlocked.props.onDoubleClick({ target: unlocked.dom, currentTarget: unlocked.dom, clientX: 100 }); expect(state.props().onCreateRegion).toHaveBeenCalledExactlyOnceWith(project.tracks[1].id, 0);
    expect(state.props().onRegionChange).not.toHaveBeenCalled();
  });

  it('cancels a filtered-out captured clip, clearing its temporary extent and pending scroll frames', () => {
    const state = arrangementFixture(manyTracks(2)), original = state.props().project;
    const width = () => state.elements().find(node => node.props.className === 'arrangement-content')!.props.style.width;
    const node = state.elements().find(node => node.props['data-testid'] === 'region')!, baseline = width();
    const event = (x: number) => ({ clientX: x, clientY: 52, pointerId: 7, button: 0, currentTarget: node.dom, target: { classList: { contains: () => false } }, preventDefault() {}, stopPropagation() {} });
    node.props.onPointerDown(event(100)); node.props.onPointerMove(event(899)); state.render();
    expect(node.dom.hasPointerCapture(7)).toBe(true); expect(state.frames.size).toBeGreaterThan(0); expect(width()).toBeGreaterThan(baseline);
    state.update({ instrumentFilter: 'bass' });
    expect(node.dom.hasPointerCapture(7)).toBe(false); expect(state.frames.size).toBe(0); expect(width()).toBe(baseline);
    expect(state.props().project).toBe(original); expect(state.props().onRegionChange).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
  });
});
