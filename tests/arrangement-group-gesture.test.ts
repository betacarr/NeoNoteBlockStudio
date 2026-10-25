import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote, newTrack } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { ArrangementGroupGesture, type ArrangementGestureContext, type ArrangementGroupPreview } from '../src/ui/arrangement-group-gesture';

// Real group controller, core planner, pointer capture and edge-scroll helpers.
// Listener/RAF delivery is inert unit integration, not physical input or GUI.
class Target {
  listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(name: string, fn: (event: any) => void) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); }
  removeEventListener(name: string, fn: (event: any) => void) { this.listeners.get(name)?.delete(fn); }
  fire(name: string, extra: Record<string, unknown> = {}) { const event = { key: '', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }; for (const listener of [...this.listeners.get(name) ?? []]) listener(event); return event; }
  get count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture(options: { selected?: string[]; trackTop?: number; height?: number; scrollHeight?: number } = {}) {
  const project = createProject('Group callback fixture'); project.ppq = 480;
  project.tracks = Array.from({ length: 5 }, (_, index) => ({ ...newTrack(`Track ${index + 1}`, index), id: `t${index}`, locked: index === 3 }));
  project.patterns = ['a', 'b', 'c', 'e'].map(id => ({ id: `p-${id}`, name: id, length: 960, notes: [{ ...newNote(120, 60, 180), id: `n-${id}`, pan: .2, detune: 3.5, height: -.5 }] }));
  project.regions = [
    { id: 'a', trackId: 't0', patternId: 'p-a', start: 240, length: 480, offset: 120, loop: false },
    { id: 'b', trackId: 't1', patternId: 'p-b', start: 960, length: 720, offset: 240, loop: true },
    { id: 'c', trackId: 't2', patternId: 'p-c', start: 0, length: 240, offset: 0, loop: false },
    { id: 'e', trackId: 't4', patternId: 'p-e', start: 1920, length: 480, offset: 0, loop: false },
  ];
  const original = structuredClone(project), frames = new Map<number, FrameRequestCallback>(), queued = new Map<number, FrameRequestCallback>(); let frameId = 0, time = 0, liveOwner: object = {};
  const view = Object.assign(new Target(), { requestAnimationFrame: (fn: FrameRequestCallback) => { const id = ++frameId; frames.set(id, fn); queued.set(id, fn); return id; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
  const document = { defaultView: view, activeElement: undefined as unknown }, captures = new Set<number>(); let onRelease = () => {};
  const target = Object.assign(new Target(), { ownerDocument: document, focus: vi.fn(() => { document.activeElement = target; }),
    setPointerCapture: (pointer: number) => captures.add(pointer), hasPointerCapture: (pointer: number) => captures.has(pointer),
    releasePointerCapture: (pointer: number) => { captures.delete(pointer); onRelease(); } });
  const scroller = { ownerDocument: document, clientLeft: 0, clientTop: 0, clientWidth: 800, clientHeight: options.height ?? 230,
    scrollWidth: 5000, scrollHeight: options.scrollHeight ?? 0, scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  let context: ArrangementGestureContext = { project, tracks: project.tracks, selected: new Set(options.selected ?? ['a', 'b']), primary: (options.selected ?? ['a', 'b'])[0], scale: .1, meter: createMeterMap(project), step: 120, trackTop: options.trackTop ?? 26, scroll: scroller as unknown as HTMLElement, owner: liveOwner, liveOwner: () => liveOwner };
  let shown: ArrangementGroupPreview | null = null;
  const publish = vi.fn((preview: ArrangementGroupPreview | null, owner: object) => { if (preview) shown = preview; else if (shown?.owner === owner) shown = null; });
  const select = vi.fn((ids: Set<string>, primary?: string) => { context = { ...context, selected: ids, primary }; }), commit = vi.fn(), message = vi.fn();
  const controller = new ArrangementGroupGesture({ read: () => context, publish, select, commit, message });
  const event = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, pointerId: 7, currentTarget: target as unknown as HTMLElement, ...extra });
  const begin = () => { controller.startMove(event(100, 52), project.regions[0]); };
  return { project, original, controller, target, view, captures, scroller, frames, publish, select, commit, message, event, begin, preview: () => shown,
    context: () => context, update: (patch: Partial<ArrangementGestureContext>) => { context = { ...context, ...patch }; }, owner: (value: object) => { liveOwner = value; }, onRelease: (fn: () => void) => { onRelease = fn; },
    frame: () => { time += 16; for (const [id, fn] of [...frames]) if (frames.delete(id)) fn(time); }, lateFrame: (id: number) => { frames.delete(id); queued.get(id)?.(time + 100); } };
}

describe('ArrangementGroupGesture actual controller callbacks', () => {
  it('replaces selection by rectangle intersection and preserves the project on release', () => {
    const s = fixture({ selected: ['e'] });
    s.controller.startMarquee(s.event(20, 31)); s.controller.move(s.event(170, 125));
    expect(s.preview()?.selected).toEqual(new Set(['a', 'b'])); expect(s.preview()?.box).toEqual({ left: 20, top: 31, width: 150, height: 94 });
    expect(s.select).not.toHaveBeenCalled(); s.controller.end(s.event(170, 125));
    expect(s.select).toHaveBeenCalledExactlyOnceWith(new Set(['a', 'b']), 'a'); expect(s.commit).not.toHaveBeenCalled(); expect(s.project).toEqual(s.original);
  });

  it('adds Shift marquee results but excludes hidden track regions', () => {
    const s = fixture({ selected: ['e'] }); s.update({ tracks: [s.project.tracks[0], s.project.tracks[2]], primary: 'e' });
    s.controller.startMarquee(s.event(0, 30, { shiftKey: true })); s.controller.end(s.event(200, 130));
    expect(s.select).toHaveBeenCalledExactlyOnceWith(new Set(['e', 'a', 'c']), 'e'); expect(s.commit).not.toHaveBeenCalled();
  });

  it('does not start marquee on the sticky ruler, reference lane or outside the viewport', () => {
    const s = fixture({ trackTop: 78 });
    for (const y of [10, 26, 52, 77.99, 230]) s.controller.startMarquee(s.event(20, y));
    expect(s.controller.busy).toBe(false); expect(s.captures.size).toBe(0); expect(s.publish).not.toHaveBeenCalled(); expect(s.select).not.toHaveBeenCalled();
  });

  it('previews and commits one common time/row delta, preserving each occurrence and source', () => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, 104));
    expect([...s.preview()!.regions!.values()].map(item => item.region)).toEqual([
      { ...s.original.regions[0], start: 720, trackId: 't1' }, { ...s.original.regions[1], start: 1440, trackId: 't2' },
    ]);
    expect([...s.preview()!.regions!.values()].map(item => item.offsetY)).toEqual([52, 52]); expect(s.preview()?.end).toBe(2160);
    expect(s.commit).not.toHaveBeenCalled(); s.controller.end(s.event(148, 104));
    expect(s.commit).toHaveBeenCalledExactlyOnceWith([{ id: 'a', start: 720, trackId: 't1' }, { id: 'b', start: 1440, trackId: 't2' }]);
    expect(s.controller.busy).toBe(false); expect(s.frames.size).toBe(0); expect(s.captures.size).toBe(0); expect(s.project).toEqual(s.original);
  });

  it('clamps the whole time delta at zero without flattening time spacing', () => {
    const s = fixture(); s.update({ primary: 'b' }); s.controller.startMove(s.event(200, 104), s.project.regions[1]); s.controller.end(s.event(80, 104));
    expect(s.commit).toHaveBeenCalledExactlyOnceWith([{ id: 'a', start: 0, trackId: 't0' }, { id: 'b', start: 720, trackId: 't1' }]);
  });

  it('keeps the group selected after a real drag returns to its starting point without a commit', () => {
    const s = fixture(), before = s.context().selected; s.begin(); s.controller.move(s.event(148, 104)); s.controller.move(s.event(100, 52)); s.controller.end(s.event(100, 52));
    expect(s.context().selected).toBe(before); expect(s.select).not.toHaveBeenCalled(); expect(s.commit).not.toHaveBeenCalled();
    expect(s.controller.busy).toBe(false); expect(s.frames.size).toBe(0); expect(s.project).toEqual(s.original);
  });

  it('uses actual release displacement for a group move even when pointermove was not delivered', () => {
    const s = fixture(); s.begin(); s.controller.end(s.event(148, 104));
    expect(s.commit).toHaveBeenCalledExactlyOnceWith([{ id: 'a', start: 720, trackId: 't1' }, { id: 'b', start: 1440, trackId: 't2' }]);
    expect(s.select).not.toHaveBeenCalled(); expect(s.context().selected).toEqual(new Set(['a', 'b'])); expect(s.captures.size).toBe(0); expect(s.project).toEqual(s.original);
  });

  it.each(['hidden member', 'locked member'] as const)('captures a group with a %s for selection but rejects real movement atomically', kind => {
    const s = fixture();
    if (kind === 'hidden member') s.update({ tracks: [s.project.tracks[0], s.project.tracks[2]] });
    else s.update({ selected: new Set(['a', 'locked-region']), project: { ...s.project, regions: [...s.project.regions, { ...s.project.regions[1], id: 'locked-region', trackId: 't3' }] } });
    s.begin(); expect(s.controller.busy).toBe(true); expect(s.preview()?.blocked).toBe(true); expect(s.captures.has(7)).toBe(true); expect(s.message).not.toHaveBeenCalled();
    s.controller.move(s.event(148, 104)); s.controller.end(s.event(148, 104));
    expect(s.controller.busy).toBe(false); expect(s.message).toHaveBeenCalledOnce(); expect(s.captures.size).toBe(0); expect(s.commit).not.toHaveBeenCalled(); expect(s.select).not.toHaveBeenCalled();
  });

  it.each([{ y: 156, name: 'locked row' }, { y: 224, name: 'whole-group row overflow' }, { y: 240, name: 'outside viewport' }])('rejects $name atomically rather than moving a subset', ({ y }) => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, y)); expect(s.preview()?.blocked).toBe(true);
    expect([...s.preview()!.regions!.values()].every(item => item.blocked && item.offsetY === 0)).toBe(true);
    s.controller.end(s.event(148, y)); expect(s.commit).not.toHaveBeenCalled(); expect(s.message).toHaveBeenCalledOnce(); expect(s.preview()).toBeNull();
  });

  it('recovers from an invalid destination and resolves the final release position', () => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, 156)); expect(s.preview()?.blocked).toBe(true);
    s.controller.move(s.event(148, 52)); expect(s.preview()?.blocked).toBe(false);
    s.controller.end(s.event(148, 104)); expect(s.commit).toHaveBeenCalledExactlyOnceWith([{ id: 'a', start: 720, trackId: 't1' }, { id: 'b', start: 1440, trackId: 't2' }]);
  });

  it.each(['Escape', 'window blur', 'target blur', 'pointercancel'] as const)('%s cancels without a document commit and restores selection', cancel => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, 104));
    if (cancel === 'Escape') s.view.fire('keydown', { key: 'Escape' }); else if (cancel === 'window blur') s.view.fire('blur'); else if (cancel === 'target blur') s.target.fire('blur'); else s.controller.pointerCancel(7);
    expect(s.select).toHaveBeenCalledExactlyOnceWith(new Set(['a', 'b']), 'a'); expect(s.commit).not.toHaveBeenCalled(); expect(s.preview()).toBeNull(); expect(s.frames.size).toBe(0); expect(s.captures.size).toBe(0); expect(s.view.count + s.target.count).toBe(0);
    s.controller.end(s.event(148, 104)); expect(s.commit).not.toHaveBeenCalled(); expect(s.project).toEqual(s.original);
  });

  it('ignores foreign pointers and second presses without replacing the active anchor', () => {
    const s = fixture(); s.begin(); s.controller.startMarquee(s.event(0, 30, { pointerId: 99 })); s.controller.pointerCancel(99); s.controller.move(s.event(500, 156, { pointerId: 99 }));
    s.controller.end(s.event(500, 156, { pointerId: 99 })); expect(s.controller.busy).toBe(true);
    s.controller.end(s.event(148, 104)); expect(s.commit).toHaveBeenCalledOnce();
  });

  it.each(['project', 'track order', 'owner', 'selection', 'grid'] as const)('rejects stale %s before release and queued frames', field => {
    const s = fixture(); s.begin(); s.controller.move(s.event(799, 104)); const frame = [...s.frames.keys()][0], left = s.scroller.scrollLeft;
    if (field === 'project') s.update({ project: structuredClone(s.project) }); else if (field === 'track order') s.update({ tracks: s.context().tracks.slice().reverse() }); else if (field === 'owner') s.owner({}); else if (field === 'selection') s.update({ selected: new Set(['a']) }); else s.update({ step: 240 });
    s.lateFrame(frame); s.controller.end(s.event(799, 104)); expect(s.commit).not.toHaveBeenCalled(); expect(s.controller.busy).toBe(false); expect(s.frames.size).toBe(0); expect(s.scroller.scrollLeft).toBe(left); expect(s.captures.size).toBe(0);
  });

  it('recomputes stationary-pointer time preview on real edge-scroll frames', () => {
    const s = fixture(); s.begin(); s.controller.move(s.event(799, 104)); const first = s.preview()!.regions!.get('a')!.region.start;
    for (let i = 0; i < 5; i++) s.frame(); expect(s.scroller.scrollLeft).toBeGreaterThan(0); expect(s.preview()!.regions!.get('a')!.region.start).toBeGreaterThan(first);
    s.controller.end(s.event(799, 104)); expect(s.commit).toHaveBeenCalledOnce(); expect(s.frames.size).toBe(0);
  });

  it('unmount cancellation is silent and an inactive cancellation never publishes', () => {
    const s = fixture(); s.controller.cancel(false); expect(s.publish).not.toHaveBeenCalled(); s.begin(); s.publish.mockClear(); s.controller.cancel(false);
    expect(s.publish).not.toHaveBeenCalled(); expect(s.select).not.toHaveBeenCalled(); expect(s.commit).not.toHaveBeenCalled(); expect(s.captures.size).toBe(0); expect(s.controller.busy).toBe(false);
  });

  it('marquee cancellation leaves actual selection untouched without a redundant selection callback', () => {
    const s = fixture({ selected: ['e'] }), before = s.context().selected;
    s.controller.startMarquee(s.event(20, 31)); s.controller.move(s.event(170, 125)); s.view.fire('keydown', { key: 'Escape' });
    expect(s.context().selected).toBe(before); expect(s.context().primary).toBe('e'); expect(s.select).not.toHaveBeenCalled(); expect(s.commit).not.toHaveBeenCalled(); expect(s.preview()).toBeNull();
  });

  it('does not commit an old release after synchronous capture cleanup changes the owner', () => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, 104)); s.onRelease(() => s.owner({})); s.controller.end(s.event(148, 104));
    expect(s.commit).not.toHaveBeenCalled(); expect(s.captures.size).toBe(0);
  });

  it.each([false, true])('does not commit an old release after capture cleanup starts a new gesture (then cancels=%s)', cancelNew => {
    const s = fixture(); s.begin(); s.controller.move(s.event(148, 104));
    s.onRelease(() => { s.onRelease(() => {}); s.controller.startMarquee(s.event(300, 130)); if (cancelNew) s.controller.cancel(); }); s.controller.end(s.event(148, 104));
    expect(s.commit).not.toHaveBeenCalled(); expect(s.controller.busy).toBe(!cancelNew); expect(s.preview()?.kind).toBe(cancelNew ? undefined : 'select'); s.controller.cancel();
  });
});
