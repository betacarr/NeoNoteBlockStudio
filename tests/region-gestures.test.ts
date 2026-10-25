import { describe, expect, it } from 'vitest';
import { createMeterMap } from '../src/core/meter';
import { newTrack } from '../src/core/project';
import { createRegionGestureHarness as fixture, type RegionGestureHarness, type RegionGestureProps } from './helpers/region-gesture-harness';

// Actual RegionClip callbacks, hooks/effects and captureEditorPointer listeners.
// Inert listener delivery is unit integration, not physical pointer/keyboard input.
const modes = [{ name: 'move', edge: null }, { name: 'left trim', edge: 'start' }, { name: 'right trim', edge: 'end' }] as const;
const begin = (state: RegionGestureHarness, edge: 'start' | 'end' | null = null) => {
  state.render().props.onPointerDown(state.event(0, 7, edge)); state.render().props.onPointerMove(state.event(48, 7, edge));
};
const expectCancelled = (state: RegionGestureHarness) => {
  expect(state.captures.size).toBe(0); expect(state.listeners()).toBe(0); expect(state.frames.size).toBe(0);
  expect(state.onRegionChange).not.toHaveBeenCalled(); expect(state.onTrimRegion).not.toHaveBeenCalled();
};
const invalidations: { name: string; change: (state: RegionGestureHarness) => Partial<RegionGestureProps> }[] = [
  { name: 'region reference', change: state => ({ region: { ...state.props().region } }) },
  { name: 'source notes', change: state => ({ pattern: { ...state.props().pattern, notes: state.props().pattern.notes.slice() } }) },
  { name: 'source identity', change: state => ({ pattern: { ...state.props().pattern, id: 'another-source' } }) },
  { name: 'source period', change: state => ({ pattern: { ...state.props().pattern, length: state.props().pattern.length + 120 } }) },
  { name: 'track identity', change: state => ({ track: { ...state.props().track, id: 'another-track' } }) },
  { name: 'track lock', change: state => ({ track: { ...state.props().track, locked: true } }) },
  { name: 'scale', change: state => ({ scale: state.props().scale * 2 }) },
  { name: 'snap grid', change: state => ({ step: 240 }) },
  { name: 'meter map', change: state => ({ meter: createMeterMap(state.project) }) },
  { name: 'scroll element', change: state => ({ scroll: { current: { ...state.props().scroll.current } } }) },
  { name: 'document owner', change: state => { const owner = {}; state.setLiveOwner(owner); return { gestureOwner: owner }; } },
];

describe('RegionClip cancellable gestures and stale targets (no physical input)', () => {
  it.each(modes)('commits $name once after release with rolling scroll delta and removes every active listener', ({ edge }) => {
    const state = fixture({ synchronousLostCapture: true });
    expect(state.render().props.tabIndex).toBe(-1); expect(state.listeners()).toBe(0); begin(state, edge);
    expect(state.onSelect).toHaveBeenCalledOnce(); expect(state.onFocus).toHaveBeenCalledOnce();
    expect(state.target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(state.listeners()).toBe(3);
    expect(state.onRegionChange).not.toHaveBeenCalled(); expect(state.onTrimRegion).not.toHaveBeenCalled();
    state.props().scroll.current.scrollLeft = 12; state.render().props.onPointerUp(state.event(48, 7, edge));
    if (edge) { expect(state.onTrimRegion).toHaveBeenCalledExactlyOnceWith(state.region.id, edge, edge === 'end' ? 4440 : 2520); expect(state.onRegionChange).not.toHaveBeenCalled(); }
    else { expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 2520 }); expect(state.onTrimRegion).not.toHaveBeenCalled(); }
    expect(state.listeners()).toBe(0); expect(state.captures.size).toBe(0); expect(state.target.releasePointerCapture).toHaveBeenCalledOnce();
    state.render().props.onPointerUp(state.event(48)); state.render().props.onLostPointerCapture(state.event(48));
    state.fireWindow('keydown', { key: 'Escape' }); state.fireWindow('blur'); state.fireTarget('blur');
    expect(state.onRegionChange.mock.calls.length + state.onTrimRegion.mock.calls.length).toBe(1); expect(state.project).toEqual(state.original);
  });

  it.each(modes)('Escape cancels $name, restores the preview and leaves a later release inert', ({ edge }) => {
    const state = fixture({ synchronousLostCapture: true }); begin(state, edge);
    const event = state.fireWindow('keydown', { key: 'Escape' });
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expectCancelled(state);
    expect(state.thumbnail().props.region).toBe(state.region); state.render().props.onPointerUp(state.event(48, 7, edge));
    expectCancelled(state); expect(state.project).toEqual(state.original);
  });

  it.each(['window', 'target'] as const)('%s blur cancels the preview and releases capture without editing', target => {
    const state = fixture({ synchronousLostCapture: true }); begin(state);
    if (target === 'window') state.fireWindow('blur'); else state.fireTarget('blur');
    expectCancelled(state); state.render().props.onPointerUp(state.event(48, 7, null)); expectCancelled(state);
    expect(state.target.releasePointerCapture).toHaveBeenCalledOnce(); expect(state.project).toEqual(state.original);
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])('%s ignores foreign pointers but cancels the active pointer', callback => {
    const state = fixture(); begin(state);
    state.render().props[callback](state.event(48, 99, null)); state.render().props.onPointerUp(state.event(48, 99, null));
    expect(state.capture()).toBe(7); expect(state.listeners()).toBe(3); expect(state.thumbnail().props.region.start).toBe(2400);
    state.render().props[callback](state.event(48, 7, null)); expectCancelled(state);
    state.render().props.onPointerUp(state.event(48, 7, null)); expectCancelled(state);
  });

  it('ignores a second press entirely and keeps the first pointer anchor and selection callback', () => {
    const state = fixture(); begin(state);
    state.render().props.onPointerDown(state.event(100, 99, 'end'));
    expect(state.onSelect).toHaveBeenCalledOnce(); expect(state.onFocus).toHaveBeenCalledOnce(); expect(state.target.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    state.render().props.onPointerMove(state.event(200, 99, null)); state.render().props.onPointerUp(state.event(200, 99, null));
    state.render().props.onPointerUp(state.event(48, 7, null)); expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 2400 });
    expect(state.onTrimRegion).not.toHaveBeenCalled(); expect(state.listeners()).toBe(0);
  });

  it.each([{ locked: true, button: 0 }, { locked: false, button: 2 }])('does not register active gesture listeners for inactive presses: %j', ({ locked, button }) => {
    const state = fixture({ locked }); state.render().props.onPointerDown(state.event(0, 7, null, { button }));
    expect(state.target.focus).not.toHaveBeenCalled(); expect(state.target.setPointerCapture).not.toHaveBeenCalled(); expectCancelled(state);
  });

  it('cleans a stationary click without emitting a region edit', () => {
    const state = fixture(); state.render().props.onPointerDown(state.event(0, 7, null)); state.render().props.onPointerUp(state.event(0, 7, null)); expectCancelled(state);
  });

  it.each(invalidations)('cancels when $name changes during a gesture', ({ change }) => {
    const state = fixture({ synchronousLostCapture: true }); begin(state); state.update(change(state));
    expectCancelled(state); state.render().props.onPointerUp(state.event(48, 7, null)); expectCancelled(state);
    expect(state.project).toEqual(state.original);
  });

  it.each(invalidations.filter(test => ['region reference', 'source notes', 'track lock', 'document owner'].includes(test.name)))('rechecks $name on release before layout effects run', ({ change }) => {
    const state = fixture({ synchronousLostCapture: true }); begin(state);
    const node = state.update(change(state), false); expect(state.capture()).toBe(7);
    node.props.onPointerUp(state.event(48, 7, null)); expectCancelled(state); state.render(); expectCancelled(state);
  });

  it('rechecks a changed region scalar even without a new object or render', () => {
    const state = fixture(); begin(state); const release = state.render().props.onPointerUp;
    state.props().region.offset = 120; release(state.event(48, 7, null)); expectCancelled(state); expect(state.region.offset).toBe(120);
  });

  it('rejects the live owner changed between events without any component render', () => {
    const state = fixture(); begin(state); const release = state.render().props.onPointerUp;
    state.setLiveOwner({}); release(state.event(48, 7, null)); expectCancelled(state); expect(state.project).toEqual(state.original);
  });

  it('rejects a new press when its rendered document owner is already stale', () => {
    const state = fixture(); state.setLiveOwner({}); state.render().props.onPointerDown(state.event(0, 7, null));
    expect(state.onSelect).not.toHaveBeenCalled(); expect(state.onFocus).not.toHaveBeenCalled(); expect(state.target.focus).not.toHaveBeenCalled(); expectCancelled(state);
  });

  it('rechecks the owner after synchronous release callbacks before committing', () => {
    const state = fixture({ synchronousLostCapture: true }); begin(state);
    state.onRelease(() => state.setLiveOwner({})); state.render().props.onPointerUp(state.event(48, 7, null)); expectCancelled(state);
    expect(state.target.releasePointerCapture).toHaveBeenCalledOnce();
  });

  it('cleans listeners when capture synchronously cancels before the cleanup function is returned', () => {
    const state = fixture({ synchronousLostCapture: true });
    state.onCapture(() => state.render().props.onPointerCancel(state.event(0, 7, null)));
    state.render().props.onPointerDown(state.event(0, 7, null)); expectCancelled(state); expect(state.target.releasePointerCapture).toHaveBeenCalledOnce();
  });

  it.each(['live owner', 'layout cancellation'] as const)('cleans capture when target focus synchronously changes the %s', change => {
    const state = fixture({ synchronousLostCapture: true });
    state.onTargetFocus(() => {
      const owner = {}; state.setLiveOwner(owner);
      if (change === 'layout cancellation') state.update({ gestureOwner: owner });
    });
    state.render().props.onPointerDown(state.event(0, 7, null)); expectCancelled(state);
    expect(state.target.releasePointerCapture).toHaveBeenCalledOnce(); state.render().props.onPointerUp(state.event(48, 7, null)); expectCancelled(state);
  });

  it('unmount releases active capture and listeners without a preview state update or duplicate cleanup', () => {
    const state = fixture({ synchronousLostCapture: true }); begin(state); state.unmount(); state.unmount();
    expectCancelled(state); expect(state.stateAfterUnmount()).toBe(0); expect(state.target.releasePointerCapture).toHaveBeenCalledOnce();
    state.view.fire('keydown', { key: 'Escape' }); state.target.fire('blur'); expectCancelled(state);
  });
});

describe('RegionClip cross-track gesture callbacks (no physical input)', () => {
  const crossFixture = (options: { locked?: number; sourceTrackIndex?: number; trackTop?: number; region?: Partial<RegionGestureProps['region']>; scroll?: NonNullable<Parameters<typeof fixture>[0]>['scroll'] } = {}) => {
    const tracks = [newTrack('Source', 0), newTrack('Middle', 1, 'bass'), newTrack('Destination', 2, 'bell')];
    // IDs deliberately have a different order from the visible rows.
    tracks.forEach((track, index) => { track.id = ['z-source', 'a-middle', 'q-destination'][index]; });
    if (options.locked !== undefined) tracks[options.locked].locked = true;
    return fixture({ tracks, sourceTrackIndex: options.sourceTrackIndex, trackTop: options.trackTop, region: options.region, scroll: options.scroll });
  };
  const yFor = (state: RegionGestureHarness, row: number) => state.scroller.getBoundingClientRect().top + state.scroller.clientTop - state.scroller.scrollTop + state.props().trackTop + row * 52 + 26;
  const event = (state: RegionGestureHarness, x: number, y: number, edge: 'start' | 'end' | null = null) => state.event(x, 7, edge, { clientY: y });
  const drag = (state: RegionGestureHarness, x: number, y: number, edge: 'start' | 'end' | null = null) => {
    const source = state.props().tracks.findIndex(track => track.id === state.region.trackId);
    state.render().props.onPointerDown(event(state, 100, yFor(state, source), edge));
    state.render().props.onPointerMove(event(state, x, y, edge));
  };

  it.each(modes.flatMap(mode => [0, 1.5].map(jitter => ({ ...mode, jitter }))))('keeps a $name click inert after a 31px heading reflow, with $jitter px pointer jitter', ({ edge, jitter }) => {
    const scroll = { boundsTop: 31 }, state = crossFixture({ scroll, region: { start: 1927.25 } }), y = yFor(state, 0);
    state.render().props.onPointerDown(event(state, 100, y, edge));
    // Selecting an unselected clip removes the locked-group warning. The
    // viewport moves upward while the pointer and all model/owner refs stay put.
    scroll.boundsTop = 0; const node = state.render();
    if (jitter) node.props.onPointerMove(event(state, 100 + jitter, y, edge));
    expect(state.render().props['data-drop-track-id']).toBeUndefined(); expect(state.onPreviewExtent).not.toHaveBeenCalled();
    state.render().props.onPointerUp(event(state, 100 + jitter, y, edge));
    expectCancelled(state); expect(state.props().region.start).toBe(1927.25); expect(state.project).toEqual(state.original);
    expect(state.target.releasePointerCapture).toHaveBeenCalledOnce(); expect(state.render().props.className).not.toContain('dragging');
    state.render().props.onPointerUp(event(state, 100 + jitter, y, edge)); expectCancelled(state);
  });

  it.each([
    { name: 'horizontal move', edge: null, x: 148, destination: 0, start: 2400 },
    { name: 'vertical move', edge: null, x: 100, destination: 1, start: 1927.25 },
    { name: 'left trim', edge: 'start', x: 148, destination: 0, tick: 2400 },
    { name: 'right trim', edge: 'end', x: 148, destination: 0, tick: 4320 },
  ] as const)('accepts a genuine $name from final release coordinates without an intervening pointermove', ({ edge, x, destination, start, tick }) => {
    const state = crossFixture({ region: { start: 1927.25 } }); state.render().props.onPointerDown(event(state, 100, yFor(state, 0), edge));
    state.render().props.onPointerUp(event(state, x, yFor(state, destination), edge));
    if (edge) { expect(state.onTrimRegion).toHaveBeenCalledExactlyOnceWith(state.region.id, edge, tick); expect(state.onRegionChange).not.toHaveBeenCalled(); }
    else { expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start, ...(destination ? { trackId: state.props().tracks[destination].id } : {}) }); expect(state.onTrimRegion).not.toHaveBeenCalled(); }
    expect(state.frames.size).toBe(0); expect(state.listeners()).toBe(0); expect(state.captures.size).toBe(0); expect(state.project).toEqual(state.original);
  });

  it.each(['horizontal', 'vertical'] as const)('preserves a real %s scroll delta without requiring a pointermove', axis => {
    const state = crossFixture(), y = yFor(state, 0); state.render().props.onPointerDown(event(state, 100, y));
    if (axis === 'horizontal') state.scroller.scrollLeft = 12; else state.scroller.scrollTop = 52;
    state.render().props.onPointerUp(event(state, 100, y));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, axis === 'horizontal' ? { start: 2040 } : { start: 1920, trackId: state.props().tracks[1].id });
    expect(state.listeners()).toBe(0); expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0); expect(state.project).toEqual(state.original);
  });

  it.each([
    { source: 0, destination: 1, x: 100, start: 1920 },
    { source: 0, destination: 2, x: 148, start: 2400 },
    { source: 2, destination: 0, x: 100, start: 1920 },
  ])('previews the target track and commits time/track exactly once: %j', ({ source, destination, x, start }) => {
    const state = crossFixture({ sourceTrackIndex: source }), target = state.props().tracks[destination]; drag(state, x, yFor(state, destination));
    const node = state.render(), token = state.onTrackDropPreview.mock.calls[0][0];
    expect(state.thumbnail(node).props.region).toMatchObject({ trackId: target.id, start });
    expect(node.props.style.transform).toBe(`translateY(${(destination - source) * 52}px)`);
    expect(node.props.style.backgroundColor).toBe(target.color); expect(node.props['data-drop-track-id']).toBe(target.id);
    expect(node.props.children.find((child: any) => child?.props?.role === 'status')?.props.children).toEqual([`→ ${target.name}`]);
    expect(state.onRegionChange).not.toHaveBeenCalled(); expect(state.project).toEqual(state.original);
    node.props.onPointerUp(event(state, x, yFor(state, destination)));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start, trackId: target.id });
    expect(state.onTrimRegion).not.toHaveBeenCalled(); expect(state.frames.size).toBe(0); expect(state.listeners()).toBe(0); expect(state.captures.size).toBe(0);
    expect(state.onTrackDropPreview.mock.calls.at(-1)).toEqual([token]);
    state.render().props.onPointerUp(event(state, x, yFor(state, destination))); expect(state.onRegionChange).toHaveBeenCalledOnce();
    expect(state.project).toEqual(state.original);
  });

  it('uses visible filtered IDs, reference height, viewport border and fresh scrollTop', () => {
    const state = crossFixture({ trackTop: 78, scroll: { boundsTop: 50, clientTop: 2, top: 52 } });
    const filtered = [state.props().tracks[0], state.props().tracks[2]]; state.update({ tracks: filtered });
    drag(state, 100, yFor(state, 1));
    expect(state.render().props.style.transform).toBe('translateY(52px)');
    expect(state.render().props['data-drop-track-id']).toBe('q-destination');
    state.render().props.onPointerUp(event(state, 100, yFor(state, 1)));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 1920, trackId: 'q-destination' });
  });

  it.each([
    { name: 'ruler', x: 148, y: 10, trackTop: 26 },
    { name: 'reference lane', x: 148, y: 52, trackTop: 78 },
    { name: 'empty space below tracks', x: 148, y: 210, trackTop: 26 },
    { name: 'outside viewport', x: 148, y: 230, trackTop: 26 },
    { name: 'outside horizontal cross-track boundary', x: 701, y: 104, trackTop: 26 },
    { name: 'locked destination', x: 148, y: 104, trackTop: 26, locked: 1 },
  ])('rejects $name without silently committing the horizontal part', ({ x, y, trackTop, locked }) => {
    const state = crossFixture({ trackTop, locked }); drag(state, x, y);
    const node = state.render(); expect(node.props.className).toContain('drop-blocked'); expect(node.props['data-drop-blocked']).toBe(true);
    expect(state.onTrackDropPreview.mock.calls.at(-1)?.[2]).toBe(true);
    node.props.onPointerUp(event(state, x, y)); expectCancelled(state); expect(state.project).toEqual(state.original);
  });

  it('recovers from a locked target and commits the final valid destination', () => {
    const state = crossFixture({ locked: 1 }); drag(state, 148, yFor(state, 1)); expect(state.render().props['data-drop-blocked']).toBe(true);
    state.render().props.onPointerMove(event(state, 148, yFor(state, 2)));
    const node = state.render(); expect(node.props['data-drop-blocked']).toBeUndefined(); expect(node.props['data-drop-track-id']).toBe('q-destination');
    node.props.onPointerUp(event(state, 148, yFor(state, 2)));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 2400, trackId: 'q-destination' });
  });

  it.each(['another track', 'outside'] as const)('resolves the final mouseup coordinates afresh: %s', final => {
    const state = crossFixture(); drag(state, 148, yFor(state, 1));
    state.render().props.onPointerUp(event(state, 148, final === 'another track' ? yFor(state, 2) : 240));
    if (final === 'another track') expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 2400, trackId: 'q-destination' });
    else expectCancelled(state);
  });

  it.each(['start', 'end'] as const)('keeps %s trim on the source track while crossing a locked row', edge => {
    const state = crossFixture({ locked: 1 }); drag(state, 148, yFor(state, 1), edge);
    const node = state.render(); expect(node.props['data-drop-blocked']).toBeUndefined(); expect(node.props.style.transform).toBeUndefined();
    expect(state.thumbnail(node).props.region.trackId).toBe(state.region.trackId);
    node.props.onPointerUp(event(state, 148, yFor(state, 1), edge));
    expect(state.onTrimRegion).toHaveBeenCalledExactlyOnceWith(state.region.id, edge, edge === 'start' ? 2400 : 4320);
    expect(state.onRegionChange).not.toHaveBeenCalled();
  });

  it.each(['filter order', 'reference geometry', 'destination lock'] as const)('cancels stale %s before effects run', change => {
    const state = crossFixture(); drag(state, 148, yFor(state, 1));
    const patch = change === 'filter order' ? { tracks: state.props().tracks.slice().reverse() }
      : change === 'reference geometry' ? { trackTop: 78 }
      : { tracks: state.props().tracks.map((track, index) => index === 1 ? { ...track, locked: true } : track) };
    const node = state.update(patch, false); node.props.onPointerUp(event(state, 148, 104)); expectCancelled(state); state.render(); expectCancelled(state);
  });

  it.each(['Escape', 'live owner', 'blur'] as const)('clears cross-track feedback and ignores queued frames on %s', cancel => {
    const state = crossFixture({ scroll: { left: 200 } }); drag(state, 699, yFor(state, 2));
    const token = state.onTrackDropPreview.mock.calls[0][0], queued = [...state.frames.keys()][0], left = state.scroller.scrollLeft;
    expect(queued).toBeDefined();
    if (cancel === 'Escape') state.fireWindow('keydown', { key: 'Escape' }); else if (cancel === 'blur') state.fireWindow('blur'); else state.setLiveOwner({});
    state.deliverLateFrame(queued); state.render().props.onPointerUp(event(state, 699, yFor(state, 2)));
    expectCancelled(state); expect(state.scroller.scrollLeft).toBe(left); expect(state.onTrackDropPreview.mock.calls.at(-1)).toEqual([token]);
    expect(state.project).toEqual(state.original);
  });

  it('updates a stationary bottom-edge drop after real vertical helper frames and commits once', () => {
    const tracks = Array.from({ length: 7 }, (_, index) => newTrack(`Track ${index}`, index));
    const state = fixture({ tracks, scroll: { height: 130, scrollHeight: 390 } });
    state.render().props.onPointerDown(event(state, 100, 52)); state.render().props.onPointerMove(event(state, 100, 128));
    const firstTarget = state.render().props['data-drop-track-id']; expect(state.frames.size).toBe(2);
    for (let index = 0; index < 12; index++) state.frame();
    expect(state.scroller.scrollTop).toBeGreaterThan(0);
    const destination = state.render().props['data-drop-track-id']; expect(destination).not.toBe(firstTarget);
    expect(state.props().tracks.some(track => track.id === destination)).toBe(true); expect(state.onRegionChange).not.toHaveBeenCalled();
    // The original row has scrolled away; the translated target ghost still
    // needs its miniature notes, without allocating an offscreen source view.
    state.update({ visibleLane: false }); expect(state.thumbnail().props.region.trackId).toBe(destination);
    state.render().props.onPointerUp(event(state, 100, 128));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: 1920, trackId: destination });
    expect(state.frames.size).toBe(0); expect(state.listeners()).toBe(0); expect(state.captures.size).toBe(0); expect(state.project).toEqual(state.original);
  });
});

describe('RegionClip actual edge-scroll frames (no physical input)', () => {
  const startEdge = (state: RegionGestureHarness, side: 'left' | 'right', edge: 'start' | 'end' | null = null) => {
    const from = side === 'right' ? 650 : -50, to = side === 'right' ? 699 : -99;
    state.render().props.onPointerDown(state.event(from, 7, edge)); state.render().props.onPointerMove(state.event(to, 7, edge)); return to;
  };
  const shown = (state: RegionGestureHarness) => { const node = state.render(); return { start: node.props.style.left / state.props().scale, length: node.props.style.width / state.props().scale }; };

  it.each(['right', 'left'] as const)('continues a stationary-pointer %s preview over multiple actual helper frames and commits once', side => {
    const state = fixture({ scroll: { left: 200 } }), pointer = startEdge(state, side), initial = shown(state), scroll = state.scroller.scrollLeft;
    expect(state.frames.size).toBe(1); state.frame(); expect(state.scroller.scrollLeft).toBe(scroll);
    for (let frame = 0; frame < 4; frame++) state.frame();
    const after = shown(state), direction = side === 'right' ? 1 : -1;
    expect((state.scroller.scrollLeft - scroll) * direction).toBeGreaterThan(0); expect((after.start - initial.start) * direction).toBeGreaterThan(0);
    expect(state.onRegionChange).not.toHaveBeenCalled(); expect(state.onTrimRegion).not.toHaveBeenCalled(); expect(state.project).toEqual(state.original);
    const updates = state.onPreviewExtent.mock.calls.filter(([, end]) => end !== undefined);
    expect(updates.length).toBeGreaterThan(1); expect(new Set(updates.map(([owner]) => owner)).size).toBe(1);
    expect(updates.at(-1)![1]).toBe(after.start + after.length);
    const lateFrame = [...state.frames.keys()][0]; state.render().props.onPointerUp(state.event(pointer, 7, null));
    expect(state.onRegionChange).toHaveBeenCalledExactlyOnceWith(state.region.id, { start: after.start }); expect(state.onTrimRegion).not.toHaveBeenCalled();
    expect(state.onPreviewExtent.mock.calls.at(-1)).toEqual([updates[0][0], undefined]); expect(state.frames.size).toBe(0); expect(state.listeners()).toBe(0);
    state.deliverLateFrame(lateFrame); expect(state.onRegionChange).toHaveBeenCalledOnce(); expect(state.frames.size).toBe(0);
  });

  it.each(['start', 'end'] as const)('recalculates the %s trim preview during frames without another pointermove', edge => {
    const state = fixture({ scroll: { left: 200 } }), pointer = startEdge(state, 'right', edge), initial = shown(state);
    for (let frame = 0; frame < 5; frame++) state.frame(); const after = shown(state);
    expect(edge === 'start' ? after.start > initial.start : after.length > initial.length).toBe(true);
    expect(state.onTrimRegion).not.toHaveBeenCalled(); state.render().props.onPointerUp(state.event(pointer, 7, edge));
    expect(state.onTrimRegion).toHaveBeenCalledExactlyOnceWith(state.region.id, edge, edge === 'start' ? after.start : after.start + after.length);
    expect(state.onRegionChange).not.toHaveBeenCalled(); expect(state.frames.size).toBe(0); expect(state.project).toEqual(state.original);
  });

  it('does not arm scrolling until actual movement or a changed scroll delta', () => {
    const state = fixture(); state.render().props.onPointerDown(state.event(699, 7, null));
    expect(state.frames.size).toBe(0); state.render().props.onPointerMove(state.event(700, 7, null));
    expect(state.frames.size).toBe(0); expect(state.onPreviewExtent).not.toHaveBeenCalled();
    state.scroller.scrollLeft = 12; state.render().props.onPointerMove(state.event(699, 7, null));
    expect(state.frames.size).toBe(1); expect(state.onPreviewExtent).toHaveBeenCalledOnce(); state.fireWindow('keydown', { key: 'Escape' }); expectCancelled(state);
  });

  it('never moves left of zero and emits no extra preview reports when the browser cannot scroll', () => {
    const state = fixture(), pointer = startEdge(state, 'left'), reports = state.onPreviewExtent.mock.calls.length;
    for (let frame = 0; frame < 6; frame++) state.frame();
    expect(state.scroller.scrollLeft).toBe(0); expect(state.scrollWrites.every(write => write.requested >= 0 && write.actual >= 0)).toBe(true);
    expect(state.onPreviewExtent.mock.calls).toHaveLength(reports); state.fireTarget('blur'); expectCancelled(state);
    state.render().props.onPointerUp(state.event(pointer, 7, null)); expectCancelled(state);
  });

  it.each(['Escape', 'live owner'] as const)('does not scroll or commit if %s invalidates the gesture before a queued frame', cancel => {
    const state = fixture({ scroll: { left: 200 } }), pointer = startEdge(state, 'right'), frame = [...state.frames.keys()][0], scroll = state.scroller.scrollLeft;
    if (cancel === 'Escape') state.fireWindow('keydown', { key: 'Escape' }); else state.setLiveOwner({});
    state.deliverLateFrame(frame); expect(state.scroller.scrollLeft).toBe(scroll); expectCancelled(state);
    state.render().props.onPointerUp(state.event(pointer, 7, null)); state.deliverLateFrame(frame); expectCancelled(state);
    expect(state.project).toEqual(state.original);
  });

  it('continues against a newly extended live scrollWidth after reaching the former right boundary', () => {
    const state = fixture({ scroll: { left: 795 } }); startEdge(state, 'right');
    for (let frame = 0; frame < 3; frame++) state.frame(); expect(state.scroller.scrollLeft).toBe(800); const before = shown(state);
    // Browser layout is the boundary here; the parent component's real extent
    // callback and resulting content width are tested separately.
    state.scroller.scrollWidth += 400; for (let frame = 0; frame < 4; frame++) state.frame();
    expect(state.scroller.scrollLeft).toBeGreaterThan(800); expect(shown(state).start).toBeGreaterThan(before.start);
    state.fireWindow('keydown', { key: 'Escape' }); expectCancelled(state);
  });

  it.each(['owner change', 'unmount'] as const)('does not arm RAF when reporting preview extent synchronously causes %s', change => {
    const state = fixture();
    state.onPreviewExtent.mockImplementation((_owner, end) => { if (end !== undefined) { if (change === 'owner change') state.setLiveOwner({}); else state.unmount(); } });
    state.render().props.onPointerDown(state.event(650, 7, null)); state.render().props.onPointerMove(state.event(699, 7, null));
    expectCancelled(state); expect(state.view.requestAnimationFrame).not.toHaveBeenCalled(); expect(state.stateAfterUnmount()).toBe(0);
    // A callback that tears down the gesture must not restore its old parent
    // track highlight after finish has already reported owner-only cleanup.
    expect(state.onTrackDropPreview.mock.calls.at(-1)).toHaveLength(1);
    expect(state.project).toEqual(state.original);
  });
});
