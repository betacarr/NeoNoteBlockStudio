import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote, newTrack } from '../src/core/project';
import { filterTracks, trackInstrumentOptions } from '../src/core/track-filter';
import type { Project } from '../src/core/types';
import type { MixerProps } from '../src/ui/Mixer';
import { captureEditorPointer } from '../src/ui/pointer-capture';
import { createNumberInputHarness } from './helpers/commit-number-harness';

// Actual Mixer, parameter, meter and filter components with persistent hooks and
// real capture helper. DOM, listeners and meter readings are inert boundaries;
// these are callback integration tests, not browser gestures or audio measurement.
const source = readFileSync(new URL('../src/ui/Mixer.tsx', import.meta.url), 'utf8');
const filterSource = readFileSync(new URL('../src/ui/TrackInstrumentFilter.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const ownerIds ='), filterStart = filterSource.indexOf('export function TrackInstrumentFilter(');
if (start < 0 || filterStart < 0) throw new Error('Actual mixer source boundaries missing');
const code = transformSync(source.slice(start).replace('export function Mixer(', 'function Mixer('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderMixerElement' }).code;
const filterCode = transformSync(filterSource.slice(filterStart).replace('export function ', 'function '), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderMixerElement' }).code;
type Node = { type: any; props: Record<string, any>; dom?: any };
type Instance = { hooks: any[]; cursor: number; seen: boolean; mounted: boolean };
class Target {
  listeners = new Map<string, Set<Function>>();
  addEventListener = vi.fn((name: string, callback: Function) => { const list = this.listeners.get(name) ?? new Set(); list.add(callback); this.listeners.set(name, list); });
  removeEventListener = vi.fn((name: string, callback: Function) => { this.listeners.get(name)?.delete(callback); });
  fire(name: string, extra: Record<string, any> = {}) { const event = { key: '', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }; for (const callback of [...(this.listeners.get(name) ?? [])]) callback(event); return event; }
  count() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}
function projectFixture() {
  const project = createProject('Mixer fixture'); project.tracks = [newTrack('Piano'), newTrack('Bass', 1, 'bass'), newTrack('Bell', 2, 'bell'), newTrack('Custom', 3, 'custom-one')];
  project.tracks.forEach((track, index) => { track.id = `track-${index}`; });
  project.tracks[0].volume = 2.75; project.tracks[0].pan = .125; project.regions[0].trackId = project.tracks[0].id;
  project.patterns[0].notes = [newNote(0, 66, 240)];
  project.instruments.push({ ...project.instruments[0], id: 'custom-one', name: 'Custom sample', nbsIndex: 20 }); return project;
}
interface WorkspaceLayout { top: number; clientHeight: number; mixerTop: number; mixerBottom: number; scrollTop?: number; scrollLeft?: number; clientTop?: number }
function fixture(project = projectFixture(), overrides: Partial<MixerProps> = {}, layout?: WorkspaceLayout) {
  const instances = new Map<string, Instance>(), hosts = new Map<string, any>(), effects: (() => void)[] = [], view = new Target();
  const document = { defaultView: view, activeElement: null as unknown }, iconProps: Record<string, any>[] = [];
  const workspaceWrites: number[] = [], initialTop = layout?.scrollTop ?? 0;
  let workspaceTop = initialTop;
  const workspace = layout ? {
    clientTop: layout.clientTop ?? 0, clientHeight: layout.clientHeight, scrollLeft: layout.scrollLeft ?? 0,
    get scrollTop() { return workspaceTop; }, set scrollTop(value: number) { workspaceTop = value; workspaceWrites.push(value); },
    getBoundingClientRect: () => ({ top: layout.top }),
    scrollIntoView: vi.fn(() => { throw new Error('Must reveal only through local scrollTop'); }),
  } : undefined;
  let active: Instance, tree: Node, dirty = false, writesAfterUnmount = 0, liveOwner: object = {}, liveNumber = 'document:0', stripIndex = 0;
  const mixerEvents: { type: string; value?: unknown }[] = [];
  const onSelect = vi.fn((track: Project['tracks'][number]) => { props = { ...props, selectedTrack: track.id }; });
  const onTrackChange = vi.fn((id: string, patch: Partial<Project['tracks'][number]>) => { mixerEvents.push({ type: 'track-commit', value: patch }); props = { ...props, project: { ...props.project, tracks: props.project.tracks.map(track => track.id === id ? { ...track, ...patch } : track) } }; });
  const onMasterChange = vi.fn((gain: number) => { mixerEvents.push({ type: 'master-commit', value: gain }); props = { ...props, project: { ...props.project, audio: { ...props.project.audio, masterGain: gain } } }; });
  const onTrackPreview = vi.fn((_id: string, patch: Partial<Project['tracks'][number]> | undefined) => { mixerEvents.push({ type: 'track-preview', value: patch }); });
  const onMasterPreview = vi.fn((gain: number | undefined) => { mixerEvents.push({ type: 'master-preview', value: gain }); });
  const onInstrumentFilter = vi.fn((instrumentFilter: string) => { props = { ...props, instrumentFilter }; }), onNumberPending = vi.fn();
  let props: MixerProps = { project, selectedTrack: project.tracks[0].id, instrumentFilter: '', onInstrumentFilter, onSelect, onTrackChange, onMasterChange, onTrackPreview, onMasterPreview,
    meters: Object.fromEntries([...project.tracks.map((track, index) => [track.id, (index + 1) / 10]), ['__master', .6]]), masterMeter: .6, playing: true, meterScope: 'tracks',
    gestureOwner: liveOwner, getGestureOwner: () => liveOwner, numberContextKey: liveNumber, getNumberContextKey: () => liveNumber, onNumberPending, ...overrides };
  if (overrides.gestureOwner) liveOwner = overrides.gestureOwner;
  const slot = () => { const index = active.cursor++; return { instance: active, index, previous: active.hooks[index] }; };
  const useRef = (initial: unknown) => { const s = slot(); return s.instance.hooks[s.index] ??= { current: initial }; };
  const useState = (initial: any) => { const s = slot(); if (!(s.index in s.instance.hooks)) s.instance.hooks[s.index] = typeof initial === 'function' ? initial() : initial; return [s.instance.hooks[s.index], (next: any) => { if (!s.instance.mounted) writesAfterUnmount++; const value = typeof next === 'function' ? next(s.instance.hooks[s.index]) : next; if (!Object.is(value, s.instance.hooks[s.index])) { s.instance.hooks[s.index] = value; dirty = true; } }]; };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const useMemo = (create: () => unknown, deps: unknown[]) => { const s = slot(); if (!s.previous || !same(s.previous.deps, deps)) s.instance.hooks[s.index] = { deps, value: create() }; return s.instance.hooks[s.index].value; };
  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => { const s = slot(); if (s.previous && same(s.previous.deps, deps)) return; const next: any = { deps }; s.instance.hooks[s.index] = next; effects.push(() => { s.previous?.cleanup?.(); next.cleanup = effect(); }); };
  const renderMixerElement = (type: any, attributes: any, ...children: any[]): Node => ({ type, props: { ...attributes, children } });
  const NumberInput = () => undefined, InstrumentBlock = () => undefined;
  const scope = { useRef, useState, useMemo, useEffect, useLayoutEffect: useEffect, renderMixerElement, filterTracks, trackInstrumentOptions, captureEditorPointer, CommitNumberInput: NumberInput, InstrumentBlock };
  const components = Function(...Object.keys(scope), `${filterCode}\n${code}\nreturn {Mixer,MixerParameter,MixerMeter,TrackInstrumentFilter};`)(...Object.values(scope));
  const actual = new Set(Object.values(components)); let seenHosts = new Set<string>();
  const resolve = (node: any, path: string): any => {
    if (!node || typeof node !== 'object' || !('type' in node)) return node;
    if (typeof node.type === 'function') {
      if (node.type === NumberInput) return node;
      if (node.type === InstrumentBlock) { iconProps.push(node.props); return node; }
      if (!actual.has(node.type)) return null;
      let instance = instances.get(path); if (!instance) { instance = { hooks: [], cursor: 0, seen: true, mounted: true }; instances.set(path, instance); }
      instance.seen = true; instance.cursor = 0; const previous = active; active = instance; const result = node.type(node.props); active = previous; return resolve(result, `${path}/${node.type.name}`);
    }
    let target = hosts.get(path); if (!target) {
      const events = new Target(), captures = new Set<number>();
      target = Object.assign(events, { ownerDocument: document, value: '', scrollLeft: 0, scrollTop: 37, clientWidth: 220, offsetLeft: 0, offsetWidth: 110, ref: undefined as any,
        focus: vi.fn(() => { document.activeElement = target; target.node.props.onFocus?.(); target.focusHook?.(); }),
        hasPointerCapture: (pointer: number) => captures.has(pointer), setPointerCapture: vi.fn((pointer: number) => captures.add(pointer)),
        releasePointerCapture: vi.fn((pointer: number) => { captures.delete(pointer); target.node.props.onLostPointerCapture?.({ pointerId: pointer }); target.releaseHook?.(); }),
        captures, scrollIntoView: vi.fn(() => { throw new Error('Mixer must not scroll the page'); }),
        closest: vi.fn((selector: string) => selector === '.center-workspace' ? workspace : null),
        getBoundingClientRect: () => layout ? ({ top: layout.mixerTop + initialTop - workspaceTop, bottom: layout.mixerBottom + initialTop - workspaceTop, height: layout.mixerBottom - layout.mixerTop }) : ({ top: 0, bottom: 0, height: 0 }),
      }); hosts.set(path, target);
    }
    seenHosts.add(path); target.node = node; target.value = node.props.value ?? target.value;
    if (node.props['data-track-id']) { target.offsetLeft = stripIndex++ * 110; target.offsetWidth = 110; }
    target.ref = node.props.ref; if (typeof target.ref === 'function') target.ref(target); else if (target.ref) target.ref.current = target;
    return { ...node, dom: target, props: { ...node.props, children: (node.props.children ?? []).flat(Infinity).map((child: any, index: number) => resolve(child, `${path}/${child?.props?.key ?? index}`)) } };
  };
  const render = () => { let attempts = 0; do { dirty = false; stripIndex = 0; seenHosts = new Set(); for (const instance of instances.values()) instance.seen = false;
    tree = resolve({ type: components.Mixer, props }, 'root');
    for (const [path, host] of hosts) if (!seenHosts.has(path) && host.ref) { if (typeof host.ref === 'function') host.ref(null); else host.ref.current = null; hosts.delete(path); }
    for (const [path, instance] of instances) if (!instance.seen) { instance.mounted = false; for (const hook of instance.hooks) hook?.cleanup?.(); instances.delete(path); }
    while (effects.length) effects.shift()!(); if (++attempts > 20) throw new Error('Mixer harness did not settle'); } while (dirty); return tree; };
  const elements = (node: any): Node[] => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(elements)];
  const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? (node.props?.children ?? []).map(text).join('') : '';
  const find = (label: string) => elements(render()).find(node => node.props['aria-label'] === label)!;
  const event = (node: Node, patch: Record<string, unknown> = {}) => ({ currentTarget: node.dom, pointerId: 7, button: 0, key: '', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch });
  render();
  return { props: () => props, render, find, event, iconProps, view, document, onSelect, onTrackChange, onMasterChange, onTrackPreview, onMasterPreview, mixerEvents, onInstrumentFilter, onNumberPending, workspace, workspaceWrites,
    update: (patch: Partial<MixerProps>) => { props = { ...props, ...patch }; render(); },
    elements: (node = render()) => elements(node), text: () => text(render()), strips: () => elements(render()).filter(node => node.props['data-track-id']),
    number: (label: string) => find(`${label}百分比`).props,
    down: (label: string) => { const node = find(label); node.props.onPointerDown(event(node)); render(); },
    change: (label: string, value: number) => { const node = find(label); node.dom.value = String(value); node.props.onChange({ currentTarget: node.dom }); render(); },
    up: (label: string, pointerId = 7) => { const node = find(label); node.props.onPointerUp(event(node, { pointerId })); render(); },
    setLiveOwner: (owner: object) => { liveOwner = owner; }, setLiveNumber: (key: string) => { liveNumber = key; },
    listeners: () => view.count() + [...hosts.values()].reduce((sum, target) => sum + target.count(), 0),
    unmount: () => { for (const instance of instances.values()) { instance.mounted = false; for (const hook of instance.hooks) hook?.cleanup?.(); } }, writesAfterUnmount: () => writesAfterUnmount };
}

describe('Mixer actual components and parameter callbacks (unit scope)', () => {
  it('reveals the complete newly mounted console only inside its nearest center workspace', () => {
    const test = fixture(projectFixture(), {}, { top: 153, clientHeight: 539, mixerTop: 541, mixerBottom: 793, scrollLeft: 42 });
    expect(test.workspaceWrites).toEqual([101]); expect(test.workspace!.scrollTop).toBe(101); expect(test.workspace!.scrollLeft).toBe(42);
    const console = test.find('混音器'), bounds = console.dom.getBoundingClientRect();
    expect(bounds.top).toBe(440); expect(bounds.bottom).toBe(692);
    expect(console.dom.closest).toHaveBeenCalledExactlyOnceWith('.center-workspace');
    expect(console.dom.scrollIntoView).not.toHaveBeenCalled(); expect(test.workspace!.scrollIntoView).not.toHaveBeenCalled();
    expect(test.find('混音器轨道').dom.scrollTop).toBe(37);
    // Moving away afterward is intentional user navigation. Neither meters,
    // selection nor filter changes may re-run the initial vertical reveal.
    test.workspace!.scrollTop = 0; const count = test.workspaceWrites.length;
    test.update({ meters: { 'track-0': .7 }, masterMeter: .8 }); test.update({ selectedTrack: 'track-3' }); test.update({ instrumentFilter: 'bell' });
    expect(test.workspaceWrites).toHaveLength(count); expect(test.workspace!.scrollTop).toBe(0);
  });

  it('does not scroll when the complete console already fits, including exact inner border bounds', () => {
    const test = fixture(projectFixture(), {}, { top: 150, clientTop: 3, clientHeight: 539, mixerTop: 440, mixerBottom: 692, scrollTop: 17 });
    expect(test.workspaceWrites).toEqual([]); expect(test.workspace!.scrollTop).toBe(17);
    test.render(); expect(test.workspaceWrites).toEqual([]);
  });

  it('reveals an above-viewport console upward without moving horizontally', () => {
    const test = fixture(projectFixture(), {}, { top: 150, clientTop: 3, clientHeight: 539, mixerTop: 100, mixerBottom: 352, scrollTop: 100, scrollLeft: 23 });
    expect(test.workspaceWrites).toEqual([47]); expect(test.workspace!.scrollLeft).toBe(23);
    expect(test.find('混音器').dom.getBoundingClientRect()).toMatchObject({ top: 153, bottom: 405 });
  });

  it('aligns the top if a console is taller than the local viewport and safely handles no workspace', () => {
    const test = fixture(projectFixture(), {}, { top: 153, clientHeight: 100, mixerTop: 541, mixerBottom: 793 });
    expect(test.workspaceWrites).toEqual([388]); expect(test.find('混音器').dom.getBoundingClientRect().top).toBe(153);
    const isolated = fixture(); expect(isolated.workspace).toBeUndefined(); expect(isolated.workspaceWrites).toEqual([]);
  });

  it('retains gain above unity, precise percentages, original numbering and custom instrument identities', () => {
    const test = fixture();
    expect(test.find('Piano 音量').props).toMatchObject({ min: 0, max: 400, value: 275 });
    expect(test.number('Piano 音量')).toMatchObject({ value: 275, max: 400 }); expect(test.number('Piano 声像')).toMatchObject({ value: 12.5, min: -100, max: 100 });
    expect(test.number('总输出音量')).toMatchObject({ value: 70, min: 0, max: 200 }); expect(test.text()).toContain('8.8 dB');
    expect(test.iconProps.some(props => props.instrumentId === 'custom-one' && props.label === 'Custom sample')).toBe(true);
    expect(test.find('选择轨道 4 Custom')).toBeDefined(); expect(test.text()).toContain('实时试听：音量、声像与 M/S 即时生效');
  });

  it('uses the actual filter while keeping master fixed, source order and a clear hidden-selection/empty result', () => {
    const test = fixture(); test.update({ instrumentFilter: 'bell' });
    expect(test.strips().map(node => node.props['data-track-id'])).toEqual(['track-2']); expect(test.find('选择轨道 3 Bell')).toBeDefined();
    expect(test.text()).toContain('显示 1 / 4 轨'); expect(test.text()).toContain('被筛选隐藏'); expect(test.find('总输出音量')).toBeDefined();
    const show = test.elements().find(node => node.type === 'button' && node.props.children.includes('显示所选音色'))!; show.props.onClick(); test.render(); expect(test.onInstrumentFilter).toHaveBeenLastCalledWith('harp');
    test.update({ instrumentFilter: 'missing' }); expect(test.strips()).toEqual([]); expect(test.text()).toContain('没有匹配此音色的轨道'); expect(test.find('总输出音量')).toBeDefined();
  });

  it('selects a different strip from its header, blank space or control focus without reselecting the active track', () => {
    const test = fixture(), first = test.strips()[0]; first.props.onPointerDownCapture(); first.props.onFocusCapture(); test.find('选择轨道 1 Piano').props.onClick();
    expect(test.onSelect).not.toHaveBeenCalled(); const second = test.strips()[1]; second.props.onPointerDownCapture(); test.render();
    expect(test.onSelect).toHaveBeenCalledExactlyOnceWith(test.props().project.tracks[1]); const node = test.strips()[1]; expect(node.props.className).toContain('active'); expect(node.props['aria-current']).toBe('true');
    node.props.onFocusCapture(); expect(test.onSelect).toHaveBeenCalledOnce();
  });

  it('shows real scoped meters without dimming the selected border, including an actual __master track ID', () => {
    const project = projectFixture(); project.tracks[0].id = '__master'; project.tracks[1].solo = true; project.tracks[0].muted = true;
    const test = fixture(project, { meters: { __master: .9, 'track-1': .4 }, masterMeter: .25 });
    expect(test.find('Piano 电平').props['aria-valuenow']).toBe(.9); expect(test.find('总输出电平').props['aria-valuenow']).toBe(.25);
    expect(test.find('Piano 电平').props.className).toContain('quiet'); expect(test.strips()[0].props.className).toBe('mixer-strip active');
    test.update({ meterScope: 'master' }); expect(test.find('Piano 电平不可用').props.role).toBeUndefined(); expect(test.find('总输出电平').props['aria-valuenow']).toBe(.25); expect(test.text()).toContain('分轨电平不可用');
  });

  it('does not turn inherited meter properties into NaN styles', () => {
    const project = projectFixture(); project.tracks[0].id = '__proto__'; project.tracks[1].id = 'toString'; const test = fixture(project, { meters: {}, masterMeter: 0 });
    expect(test.find('Piano 电平不可用').props.children[0].props.style.height).toBe('0%'); expect(test.find('Bass 电平不可用').props.children[0].props.style.height).toBe('0%');
    expect(test.find('总输出电平').props['aria-valuenow']).toBe(0);
  });

  it.each([
    { peak: 0, height: 0, db: '−∞' }, { peak: .0001, height: 0, db: '-80.0' }, { peak: .001, height: 0, db: '-60.0' },
    { peak: .01, height: 33.333333333333336, db: '-40.0' }, { peak: .1, height: 66.66666666666667, db: '-20.0' },
    { peak: 1, height: 100, db: '0.0' }, { peak: 2, height: 100, db: '6.0' },
  ])('maps literal peak $peak to the -60..0 dBFS visual scale without changing its ARIA reading', ({ peak, height, db }) => {
    const test = fixture(projectFixture(), { meters: { 'track-0': peak }, masterMeter: peak });
    for (const label of ['Piano 电平', '总输出电平']) {
      const node = test.find(label); expect(Number.parseFloat(node.props.children[0].props.style.height)).toBeCloseTo(height, 10);
      expect(node.props['aria-valuenow']).toBe(Math.min(1, peak)); expect(node.props.title).toContain(`${db} dBFS`); expect(node.props.title).toContain('标尺 −60～0 dBFS');
    }
    expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.onMasterChange).not.toHaveBeenCalled();
  });

  it('makes an actually quiet .002 peak visible while preserving its exact measured value and unavailable/paused zero', () => {
    const test = fixture(projectFixture(), { meters: { 'track-0': .002 }, masterMeter: .002 });
    const node = test.find('Piano 电平'), height = Number.parseFloat(node.props.children[0].props.style.height);
    expect(node.props['aria-valuenow']).toBe(.002); expect(height).toBeCloseTo(10.034333188799373, 10); expect(height / 100 * 71).toBeGreaterThan(7);
    expect(node.props.title).toContain('-54.0 dBFS');
    test.update({ playing: false }); expect(test.find('Piano 电平').props.children[0].props.style.height).toBe('0%');
    test.update({ playing: true, meterScope: 'master' }); expect(test.find('Piano 电平不可用').props.children[0].props.style.height).toBe('0%');
  });

  it('previews many pointer changes without modifying the document, then commits once before clearing the overlay', () => {
    const test = fixture(), original = structuredClone(test.props().project); test.down('Piano 音量');
    for (const value of [290, 325, 375.125]) test.change('Piano 音量', value);
    expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.props().project).toEqual(original); expect(test.find('Piano 音量').props.value).toBe(375.125);
    expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 2.9 }], ['track-0', { volume: 3.25 }], ['track-0', { volume: 3.75125 }]]);
    test.up('Piano 音量', 99); expect(test.onTrackChange).not.toHaveBeenCalled(); test.up('Piano 音量');
    expect(test.onTrackChange).toHaveBeenCalledExactlyOnceWith('track-0', { volume: 3.75125 }); expect(test.listeners()).toBe(0); test.up('Piano 音量'); expect(test.onTrackChange).toHaveBeenCalledOnce();
    expect(test.mixerEvents.slice(-2)).toEqual([{ type: 'track-commit', value: { volume: 3.75125 } }, { type: 'track-preview', value: undefined }]);
    // Parent restoration of an accepted history snapshot is a controlled input
    // boundary here, not an App Undo execution. It must not emit another commit.
    const owner = {}; test.setLiveOwner(owner); test.update({ project: original, gestureOwner: owner });
    expect(test.onTrackChange).toHaveBeenCalledOnce(); expect(test.onTrackPreview).toHaveBeenCalledTimes(4);
  });

  it.each(['Escape', 'pointercancel', 'lostcapture', 'target blur', 'window blur'])('discards the local drag on %s and ignores a late change/release', cancel => {
    const test = fixture(); test.down('Piano 声像'); test.change('Piano 声像', -75); const node = test.find('Piano 声像');
    if (cancel === 'Escape') test.view.fire('keydown', { key: 'Escape' }); else if (cancel === 'window blur') test.view.fire('blur');
    else if (cancel === 'target blur') node.dom.fire('blur'); else node.props[cancel === 'pointercancel' ? 'onPointerCancel' : 'onLostPointerCapture'](test.event(node));
    test.render(); test.change('Piano 声像', -75); test.up('Piano 声像');
    expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.find('Piano 声像').props.value).toBe(12.5); expect(test.listeners()).toBe(0); expect(node.dom.captures.size).toBe(0);
    expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { pan: -.75 }], ['track-0', undefined]]);
  });

  it('rejects a live owner changed without render and rechecks owner after capture release', () => {
    const test = fixture(); test.down('Piano 音量'); test.change('Piano 音量', 330); test.setLiveOwner({}); test.up('Piano 音量'); expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.listeners()).toBe(0);
    const next = fixture(); next.down('Piano 音量'); next.change('Piano 音量', 330); next.find('Piano 音量').dom.releaseHook = () => next.setLiveOwner({}); next.up('Piano 音量');
    expect(next.onTrackChange).not.toHaveBeenCalled(); expect(next.listeners()).toBe(0);
    for (const state of [test, next]) expect(state.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 3.3 }], ['track-0', undefined]]);
  });

  it('cancels a lock/value/document change and removes unmounted gesture listeners without setting state', () => {
    for (const change of ['lock', 'value', 'document']) {
      const test = fixture(); test.down('Piano 音量'); test.change('Piano 音量', 330); const project = structuredClone(test.props().project);
      if (change === 'lock') project.tracks[0].locked = true; else if (change === 'value') project.tracks[0].volume = 2; else { const owner = {}; test.setLiveOwner(owner); test.update({ gestureOwner: owner }); }
      test.update({ project }); test.up('Piano 音量'); expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.listeners()).toBe(0);
      expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 3.3 }], ['track-0', undefined]]);
    }
    const test = fixture(); test.down('Piano 音量'); test.change('Piano 音量', 330); test.unmount(); expect(test.listeners()).toBe(0); expect(test.writesAfterUnmount()).toBe(0); expect(test.onTrackChange).not.toHaveBeenCalled();
    expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 3.3 }], ['track-0', undefined]]);
  });

  it('locks volume/pan/reset while retaining M/S and accessible pressed state', () => {
    const project = projectFixture(); project.tracks[0].locked = true; const test = fixture(project);
    expect(test.number('Piano 音量').disabled).toBe(true); expect(test.find('Piano 声像').props.disabled).toBe(true); expect(test.find('Piano 音量恢复100%').props.disabled).toBe(true);
    test.down('Piano 音量'); test.change('Piano 音量', 300); test.number('Piano 音量').onCommit(300); test.find('Piano 音量恢复100%').props.onClick(); expect(test.onTrackChange).not.toHaveBeenCalled();
    test.find('Piano 静音').props.onClick(); test.render(); expect(test.find('Piano 静音').props['aria-pressed']).toBe(true); test.find('Piano 独奏').props.onClick();
    expect(test.onTrackChange.mock.calls).toEqual([['track-0', { muted: true }], ['track-0', { solo: true }]]);
  });

  it('commits native keyboard range changes, reset buttons and title double-clicks without redundant no-ops', () => {
    const test = fixture(); let node = test.find('Piano 声像'); node.props.onKeyDown(test.event(node, { key: 'ArrowLeft' })); test.change('Piano 声像', 10);
    expect(test.onTrackChange).toHaveBeenLastCalledWith('track-0', { pan: .1 }); test.find('Piano 声像恢复居中').props.onClick(); test.render(); test.find('Piano 声像恢复居中').props.onClick();
    expect(test.onTrackChange).toHaveBeenCalledTimes(2);
    const parameter = test.elements().find(node => node.props.className?.includes('mixer-parameter') && test.elements(node).some(child => child.props['aria-label'] === 'Piano 音量'))!;
    parameter.props.children[0].props.children[0].props.onDoubleClick(); test.render(); expect(test.onTrackChange).toHaveBeenLastCalledWith('track-0', { volume: 1 }); expect(test.onTrackChange).toHaveBeenCalledTimes(3);
    expect(test.onTrackPreview).not.toHaveBeenCalled();
  });

  it('keeps a real numeric draft across recording-only owner changes and preserves all appended notes', () => {
    const test = fixture(), input = createNumberInputHarness(test.number('Piano 音量')), key = input.props().contextKey;
    input.change('350.125'); expect(test.onTrackPreview).not.toHaveBeenCalled(); expect(test.onTrackChange).not.toHaveBeenCalled(); const project = { ...test.props().project, patterns: test.props().project.patterns.map(pattern => ({ ...pattern, notes: [...pattern.notes, newNote(480, 72, 600)] })) };
    const notes = structuredClone(project.patterns[0].notes), owner = {}; test.setLiveOwner(owner); test.update({ project, gestureOwner: owner }); input.update(test.number('Piano 音量'));
    expect(input.props().contextKey).toBe(key); expect(input.render().props.value).toBe('350.125'); expect(input.flush()).toBe(true); test.render();
    expect(test.onTrackChange).toHaveBeenCalledExactlyOnceWith('track-0', { volume: 3.50125 }); expect(test.props().project.patterns[0].notes).toEqual(notes);
    expect(test.onNumberPending.mock.calls).toEqual([[key, true], [key, false]]); input.unmount();
    expect(test.onTrackPreview).not.toHaveBeenCalled();
  });

  it('rejects stale numeric generations before rerender and invalidates the actual draft when ownership changes', () => {
    const test = fixture(), input = createNumberInputHarness(test.number('Piano 音量')), stale = test.number('Piano 音量').onCommit;
    input.change('350'); test.setLiveNumber('document:1'); expect(stale(350)).toBe(false); expect(test.onTrackChange).not.toHaveBeenCalled();
    test.update({ numberContextKey: 'document:1' }); input.update(test.number('Piano 音量')); expect(input.render().props.value).toBe('275'); expect(test.onNumberPending.mock.calls.at(-1)?.[1]).toBe(false); input.unmount();
  });

  it('uses real numeric parsing for the gain ceiling and master fraction instead of clipping legal values', () => {
    const test = fixture(), input = createNumberInputHarness(test.number('Piano 音量')); input.change('400.1'); input.key('Enter'); expect(test.onTrackChange).not.toHaveBeenCalled(); expect(input.render().props['aria-invalid']).toBe(true); input.key('Escape'); input.unmount();
    const master = createNumberInputHarness(test.number('总输出音量')); master.change('175.5'); expect(master.flush()).toBe(true); expect(test.onMasterChange).toHaveBeenCalledExactlyOnceWith(1.755); master.unmount();
  });

  it('scrolls only the local horizontal channel viewport when selection changes, preserving vertical position', () => {
    const test = fixture(), viewport = test.elements().find(node => node.props.className === 'mixer-scroll')!.dom;
    viewport.scrollTop = 37; viewport.scrollLeft = 0; test.update({ selectedTrack: 'track-3' }); expect(viewport.scrollLeft).toBe(220); expect(viewport.scrollTop).toBe(37);
    viewport.scrollLeft = 0; test.update({ meters: { ...test.props().meters, 'track-0': .5 } }); expect(viewport.scrollLeft).toBe(0);
    expect(test.strips().every(node => !node.dom.scrollIntoView.mock.calls.length)).toBe(true);
  });

  it('previews master gain in gain units, commits once and only then clears its temporary value', () => {
    const test = fixture(); test.down('总输出音量'); test.change('总输出音量', 150); test.change('总输出音量', 175.5);
    expect(test.onMasterChange).not.toHaveBeenCalled(); expect(test.props().project.audio.masterGain).toBe(.7);
    expect(test.onMasterPreview.mock.calls).toEqual([[1.5], [1.755]]); test.up('总输出音量');
    expect(test.onMasterChange).toHaveBeenCalledExactlyOnceWith(1.755);
    expect(test.mixerEvents.slice(-2)).toEqual([{ type: 'master-commit', value: 1.755 }, { type: 'master-preview', value: undefined }]);
    expect(test.onTrackPreview).not.toHaveBeenCalled();
  });

  it('retains a preview across meter/callback rerenders and sends eventual updates/clear to the latest callback', () => {
    const first = vi.fn(), second = vi.fn(), test = fixture(projectFixture(), { onTrackPreview: first });
    test.down('Piano 音量'); test.change('Piano 音量', 320); test.update({ meters: { 'track-0': .9 }, onTrackPreview: second });
    expect(first.mock.calls).toEqual([['track-0', { volume: 3.2 }]]); expect(second).not.toHaveBeenCalled();
    test.change('Piano 音量', 340); test.up('Piano 音量');
    expect(second.mock.calls).toEqual([['track-0', { volume: 3.4 }], ['track-0', undefined]]);
    expect(test.onTrackChange).toHaveBeenCalledExactlyOnceWith('track-0', { volume: 3.4 });
  });

  it('does not let the previous release clear a newer drag started synchronously by the commit callback', () => {
    const test = fixture();
    const commit = vi.fn((id: string, patch: Partial<Project['tracks'][number]>) => {
      const owner = {}, project = { ...test.props().project, tracks: test.props().project.tracks.map(track => track.id === id ? { ...track, ...patch } : track) };
      test.setLiveOwner(owner); test.update({ project, gestureOwner: owner }); test.down('Piano 音量'); test.change('Piano 音量', 360);
    });
    test.update({ onTrackChange: commit }); test.down('Piano 音量'); test.change('Piano 音量', 330); test.up('Piano 音量');
    expect(commit).toHaveBeenCalledExactlyOnceWith('track-0', { volume: 3.3 });
    expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 3.3 }], ['track-0', { volume: 3.6 }]]);
    expect(test.find('Piano 音量').props.value).toBe(360); test.view.fire('keydown', { key: 'Escape' });
    expect(test.onTrackPreview.mock.calls.at(-1)).toEqual(['track-0', undefined]); expect(commit).toHaveBeenCalledOnce(); expect(test.listeners()).toBe(0);
  });

  it.each(['owner change', 'unmount'] as const)('clears without committing when the preview callback synchronously causes %s', action => {
    const test = fixture(), preview = vi.fn((_id: string, patch: Partial<Project['tracks'][number]> | undefined) => {
      if (patch === undefined) return;
      if (action === 'owner change') test.setLiveOwner({}); else test.unmount();
    });
    test.update({ onTrackPreview: preview }); test.down('Piano 声像'); test.change('Piano 声像', -25);
    expect(preview.mock.calls).toEqual([['track-0', { pan: -.25 }], ['track-0', undefined]]);
    expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.listeners()).toBe(0); expect(test.writesAfterUnmount()).toBe(0);
  });

  it('clears an active overlay when its strip is filtered out without a document commit', () => {
    const test = fixture(); test.down('Piano 音量'); test.change('Piano 音量', 320); test.update({ instrumentFilter: 'bell' });
    expect(test.onTrackPreview.mock.calls).toEqual([['track-0', { volume: 3.2 }], ['track-0', undefined]]);
    expect(test.onTrackChange).not.toHaveBeenCalled(); expect(test.listeners()).toBe(0); expect(test.writesAfterUnmount()).toBe(0);
  });
});
