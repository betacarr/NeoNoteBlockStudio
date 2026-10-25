import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { clamp, createProject, newNote } from '../src/core/project';
import { noteName } from '../src/core/instruments';
import { createMeterMap } from '../src/core/meter';
import { constrainNoteMovement, dragNotes, dragPlacedNote, noteResizeHandleWidth, planRegionTrim, regionSourceRanges } from '../src/core/editor-interaction';
import { noteAt, notesAlongStroke } from '../src/ui/piano-hit-test';
import { clampPianoZoom, planPianoView, planPianoRowZoom } from '../src/ui/piano-view';
import { PianoNoteIndex, type PianoNoteQuery, type PianoNoteQueryStats } from '../src/ui/piano-note-index';
import { previewPianoNotes } from '../src/ui/piano-preview';
import { velocityBounds, constrainVelocityDelta, changeNoteVelocities } from '../src/core/note-velocity';

// Execute the real component's returned callbacks on inert refs/hooks. These are
// component-callback unit tests, not physical pointer/keyboard or browser tests.
const source = readFileSync(new URL('../src/ui/PianoRoll.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('const KEYBOARD =');
if (start < 0) throw new Error('PianoRoll component constants were not found');
const componentCode = transformSync(source.slice(start).replace('export function PianoRoll(', 'function PianoRoll('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
type RollProps = Parameters<typeof import('../src/ui/PianoRoll').PianoRoll>[0];
type InertElement = { type: unknown; props: Record<string, any> };
type EffectSlot = { deps?: unknown[]; cleanup?: () => void };
type PaintCommand = { kind: 'body' | 'rectangle'; args: number[]; style: string };

function pianoFixture(options: { notes?: RollProps['pattern']['notes']; selected?: string[]; viewKey?: string; length?: number; paint?: boolean; size?: { width: number; height: number } } = {}) {
  const project = createProject(), pattern = project.patterns[0], region = project.regions[0];
  const dimensions = options.size ?? { width: 800, height: 400 };
  pattern.length = region.length = options.length ?? 1920;
  pattern.notes = options.notes ?? [{ ...newNote(240, 84, 240), id: 'a', velocity: .6 }, { ...newNote(480, 83, 240), id: 'b', velocity: .45 }];
  const originalNotes = structuredClone(pattern.notes), hooks: any[] = [], pending: (() => void)[] = [];
  const captures = new Set<number>(), frames = new Map<number, FrameRequestCallback>();
  const indexWork = { builds: [] as number[], queries: [] as { source: number; count: number; tested: number }[], starts: [] as { source: number; count: number; tested: number }[], selections: [] as number[] };
  // Delegate every result to the real index. Counts describe candidate work,
  // including initial construction separately; they are not frame-rate claims.
  class ObservedNoteIndex extends PianoNoteIndex {
    constructor(notes: readonly RollProps['pattern']['notes'][number][]) { super(notes); indexWork.builds.push(notes.length); }
    query(query: PianoNoteQuery, stats?: PianoNoteQueryStats) {
      const measured = stats ?? { visitedNodes: 0, testedNotes: 0 }, result = super.query(query, measured);
      indexWork.queries.push({ source: this.notes.length, count: result.length, tested: measured.testedNotes }); return result;
    }
    starts(start: number, end: number, stats?: PianoNoteQueryStats) {
      const measured = stats ?? { visitedNodes: 0, testedNotes: 0 }, result = super.starts(start, end, measured);
      indexWork.starts.push({ source: this.notes.length, count: result.length, tested: measured.testedNotes }); return result;
    }
    forIds(ids: ReadonlySet<string>) { const result = super.forIds(ids); indexWork.selections.push(result.length); return result; }
  }
  const paints: PaintCommand[][] = [];
  const recordPaint = (kind: PaintCommand['kind'], args: number[]) => { if (!paints.length) paints.push([]); paints.at(-1)!.push({ kind, args, style: context.fillStyle }); };
  const context = { fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', lineWidth: 1,
    setTransform() {}, clearRect() { paints.push([]); }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, strokeRect() {}, setLineDash() {}, fillText() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    roundRect: (...args: number[]) => recordPaint('body', args), fillRect: (...args: number[]) => recordPaint('rectangle', args) };
  let hook = 0, frame = 0, dirty = false;
  const canvas = { ...dimensions, style: { cursor: '' }, focus: vi.fn(), getContext: () => options.paint ? context : null,
    getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) };
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useState = (initial: unknown) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous: EffectSlot | undefined = hooks[index];
    if (!previous || !deps || !previous.deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i])) || deps.length !== previous.deps.length) {
      const slot: EffectSlot = { deps }; hooks[index] = slot;
      pending.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') slot.cleanup = cleanup; });
    }
  };
  const element = (type: unknown, attributes: any, ...children: any[]): InertElement => {
    if (attributes?.ref) attributes.ref.current = type === 'canvas' ? canvas : {};
    return { type, props: { ...attributes, children } };
  };
  class ResizeObserverStub { constructor(private readonly callback: (entries: any[]) => void) {} observe() { this.callback([{ contentRect: dimensions }]); } disconnect() {} }
  // Explicit inert React-event flush boundary: settle queued parent props and
  // layout effects before the handler continues, without claiming a DOM mount.
  const flushBoundary = vi.fn((update: () => void) => { update(); render(); });
  const dependencies = { useRef, useState, useEffect, useLayoutEffect: useEffect, useId: () => 'piano-unit-canvas', element, clamp, newNote, noteName, constrainNoteMovement, dragNotes, dragPlacedNote, noteResizeHandleWidth, planRegionTrim, regionSourceRanges, noteAt, notesAlongStroke, clampPianoZoom, planPianoView, planPianoRowZoom,
    PianoNoteIndex: ObservedNoteIndex, previewPianoNotes, velocityBounds, constrainVelocityDelta, changeNoteVelocities, flushSync: flushBoundary,
    EditorScrollbar: () => undefined, ResizeObserver: ResizeObserverStub, window: { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++frame; frames.set(id, callback); return id; }, cancelAnimationFrame: (id: number) => frames.delete(id) };
  const Component = Function(...Object.keys(dependencies), `${componentCode}\nreturn PianoRoll;`)(...Object.values(dependencies));
  const onSelect = vi.fn((ids: Set<string>) => { props = { ...props, selected: new Set(ids) }; dirty = true; });
  const onEdit = vi.fn((_label: string, change: (notes: typeof pattern.notes) => typeof pattern.notes) => { props = { ...props, pattern: { ...props.pattern, notes: change(structuredClone(props.pattern.notes)) } }; dirty = true; });
  const onZoom = vi.fn((zoom: number) => { if (zoom !== props.zoom) { props = { ...props, zoom }; dirty = true; } });
  let props: RollProps = { pattern, region, viewKey: options.viewKey, track: project.tracks[0], ppq: 480, selected: new Set(options.selected ?? ['b']), tool: 'draw', snap: 16, noteLength: 16, zoom: 96, playhead: -1, meter: createMeterMap(project), origin: 0, preset: 'fl', onSelect, onEdit,
    onZoom, onAudition: vi.fn(), onFocus: vi.fn(), onSeek: vi.fn(), onTrimRegion: vi.fn() };
  const elements = (node: InertElement): InertElement[] => [node, ...(node.props.children ?? []).flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(elements)];
  let tree: InertElement;
  // React-style parent zoom/selection updates and hook state settle together.
  // The real ResizeObserver callback runs; no navigation effect is disabled.
  const render = (effects = true) => {
    let attempts = 0;
    do { dirty = false; hook = 0; tree = Component(props); if (effects) while (pending.length) pending.shift()!(); if (++attempts > 20) throw new Error('PianoRoll callback harness did not settle'); } while (effects && dirty);
    return elements(tree).find(node => node.type === 'canvas')!;
  };
  const scrollbar = (orientation: 'horizontal' | 'vertical') => { render(); return elements(tree).find(node => node.props.orientation === orientation)!.props; };
  const view = () => { const horizontal = scrollbar('horizontal'), vertical = scrollbar('vertical'); return { x: horizontal.value, y: vertical.value, row: vertical.contentSize / 128, width: horizontal.viewportSize, height: vertical.viewportSize, zoom: props.zoom, scale: props.zoom / props.ppq }; };
  const rect = (note: string | RollProps['pattern']['notes'][number]) => { const n = typeof note === 'string' ? props.pattern.notes.find(n => n.id === note)! : note, v = view(); return { x: 58 + n.tick * v.scale - v.x, y: 42 + (127 - n.midi) * v.row - v.y, width: Math.max(6, n.duration * v.scale), height: Math.max(1, v.row - 2) }; };
  const point = (note = 'a') => { const r = rect(note); return { x: r.x + Math.min(6, r.width / 3), y: r.y + r.height / 2 }; };
  const gridPoint = (tick: number, midi: number) => { const v = view(); return { x: 58 + tick * v.scale - v.x, y: 42 + (127 - midi + .45) * v.row - v.y }; };
  const velocityPoint = (value: number, note = 'a') => ({ x: rect(note).x + 2, y: dimensions.height - 10 - value * (78 - 22) });
  const movePoints = () => { const from = point(), v = view(); return { from, to: { x: from.x + 240 * v.scale, y: from.y + v.row } }; };
  const event = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, pointerId: 7, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, currentTarget: canvas, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
  const at = (position: { x: number; y: number }, extra: Record<string, unknown> = {}) => event(position.x, position.y, extra);
  const dispatch = (name: string, value: ReturnType<typeof event>) => { const handler = render().props[name]; expect(handler, `Actual canvas callback ${name}`).toBeTypeOf('function'); handler(value); };
  render();
  return { originalNotes, onSelect, onEdit, onZoom, event, at, point, gridPoint, velocityPoint, movePoints, rect, view, scrollbar, dispatch, render, captures, frames, indexWork, paints, canvas, flushBoundary,
    lastPaint: () => paints.at(-1) ?? [], props: () => props,
    wheelZoom: (x: number, deltaY: number) => { const handle = canvas.addEventListener.mock.calls.find(call => call[0] === 'wheel')?.[1]; if (!handle) throw new Error('Actual wheel listener missing'); handle({ clientX: x, deltaY, ctrlKey: true, metaKey: false, preventDefault() {}, stopPropagation() {} }); render(); },
    wheelRows: (y: number, deltaY: number, meta = false) => { const handle = canvas.addEventListener.mock.calls.find(call => call[0] === 'wheel')?.[1]; if (!handle) throw new Error('Actual wheel listener missing'); handle({ clientY: y, deltaY, shiftKey: true, ctrlKey: !meta, metaKey: meta, preventDefault() {}, stopPropagation() {} }); render(); },
    scroll: (orientation: 'horizontal' | 'vertical', value: number) => { scrollbar(orientation).onChange(value); render(); },
    deferProps: (change: Partial<RollProps>) => { props = { ...props, ...change }; dirty = true; },
    update: (change: Partial<RollProps>, effects = true) => { props = { ...props, ...change }; return render(effects); } };
}

describe('PianoRoll component gesture callbacks (no physical input)', () => {
  it('ignores right-button drags in the velocity lane without changing selection or notes', () => {
    const state = pianoFixture();
    state.dispatch('onPointerDown', state.at(state.velocityPoint(.75), { button: 2 }));
    state.dispatch('onPointerMove', state.at(state.velocityPoint(.3), { button: 2 }));
    state.dispatch('onPointerUp', state.at(state.velocityPoint(.3), { button: 2 }));
    expect(state.onSelect).not.toHaveBeenCalled(); expect(state.onEdit).not.toHaveBeenCalled();
    expect([...state.props().selected]).toEqual(['b']); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  it('still applies a left-button velocity drag to its selected note only', () => {
    const state = pianoFixture();
    state.dispatch('onPointerDown', state.at(state.velocityPoint(.5)));
    state.dispatch('onPointerMove', state.at(state.velocityPoint(.75)));
    expect(state.onEdit).not.toHaveBeenCalled();
    state.dispatch('onPointerUp', state.at(state.velocityPoint(.75)));
    expect(state.onEdit).toHaveBeenCalledTimes(1); expect(state.onEdit.mock.calls[0][0]).toBe('调整力度');
    expect([...state.props().selected]).toEqual(['a']);
    expect(state.props().pattern.notes).toEqual([{ ...state.originalNotes[0], velocity: .75 }, state.originalNotes[1]]);
  });

  it('starts Shift marquee on an existing note without moving either note', () => {
    const state = pianoFixture();
    state.dispatch('onPointerDown', state.at(state.point('a'), { shiftKey: true }));
    state.dispatch('onPointerMove', state.at(state.point('b'), { shiftKey: true }));
    expect(state.onEdit).not.toHaveBeenCalled();
    state.dispatch('onPointerUp', state.at(state.point('b'), { shiftKey: true }));
    expect(new Set(state.props().selected)).toEqual(new Set(['a', 'b']));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  it.each(['draw', 'move'])('Escape cancels %s and restores the prior selection without committing on later release', kind => {
    const state = pianoFixture(), from = kind === 'draw' ? state.gridPoint(840, 81) : state.point(), v = state.view(), to = { x: from.x + 240 * v.scale, y: from.y - v.row };
    state.dispatch('onPointerDown', state.at(from));
    expect([...state.props().selected]).not.toEqual(['b']);
    state.dispatch('onPointerMove', state.at(to));
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape', code: 'Escape' }));
    expect([...state.props().selected]).toEqual(['b']); expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
    state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])('a non-active pointer sent to %s does not cancel the active move', cancel => {
    const state = pianoFixture(), { from, to } = state.movePoints();
    state.dispatch('onPointerDown', state.at(from));
    state.dispatch(cancel, state.at(from, { pointerId: 99 }));
    expect(state.captures.has(7)).toBe(true);
    state.dispatch('onPointerMove', state.at(to));
    state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).toHaveBeenCalledTimes(1); expect(state.onEdit.mock.calls[0][0]).toBe('移动音符');
    expect(state.props().pattern.notes).toEqual([{ ...state.originalNotes[0], tick: 480, midi: 83 }, state.originalNotes[1]]);
  });

  it('erases every note crossed between two sparse pointer samples with one edit on release', () => {
    const state = pianoFixture(), notes = Array.from({ length: 4 }, (_, i) => ({ ...newNote(240 + i * 240, 84, 120), id: `stroke-${i}` }));
    state.update({ pattern: { ...state.props().pattern, notes }, selected: new Set(['stroke-1']), tool: 'erase' });
    const first = state.rect(notes[0]), last = state.rect(notes[3]), y = first.y + first.height / 2;
    state.dispatch('onPointerDown', state.event(first.x - 12, y));
    state.dispatch('onPointerMove', state.event(last.x + last.width + 12, y));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(notes);
    state.dispatch('onPointerUp', state.event(last.x + last.width + 12, y));
    expect(state.onEdit).toHaveBeenCalledTimes(1); expect(state.onEdit.mock.calls[0][0]).toBe('擦除音符');
    expect(state.props().pattern.notes).toEqual([]); expect(state.props().selected.size).toBe(0);
  });

  it('erases only the top overlapping note on a stationary click, but every crossed layer in a stroke', () => {
    for (const stroke of [false, true]) {
      const state = pianoFixture(), notes = [state.originalNotes[0], { ...state.originalNotes[0], id: 'overlap-top' }, state.originalNotes[1]];
      state.update({ pattern: { ...state.props().pattern, notes } });
      const r = state.rect('a'), from = stroke ? { x: r.x - 12, y: r.y + r.height / 2 } : state.point('a'), to = stroke ? { x: r.x + r.width + 12, y: from.y } : from;
      state.dispatch('onPointerDown', state.at(from, { button: 2 }));
      if (stroke) state.dispatch('onPointerMove', state.at(to, { button: 2 }));
      expect(state.onEdit).not.toHaveBeenCalled();
      state.dispatch('onPointerUp', state.at(to, { button: 2 }));
      expect(state.onEdit).toHaveBeenCalledTimes(1);
      expect(state.props().pattern.notes).toEqual(stroke ? [state.originalNotes[1]] : state.originalNotes);
    }
  });

  it.each(['erase', 'velocity', 'trim'])('Escape cancels %s without a note or region commit on later release', kind => {
    const state = pianoFixture(), v = state.view(), end = state.gridPoint(state.props().region!.offset + state.props().region!.length, 84), button = kind === 'erase' ? 2 : 0;
    const from = kind === 'velocity' ? state.velocityPoint(.5) : kind === 'trim' ? { x: end.x - 3, y: 34 } : state.point();
    const to = kind === 'velocity' ? state.velocityPoint(.75) : { x: from.x + 240 * v.scale, y: from.y };
    state.dispatch('onPointerDown', state.at(from, { button }));
    expect(state.captures.has(7)).toBe(true);
    state.dispatch('onPointerMove', state.at(to, { button }));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape', code: 'Escape' }));
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0); expect([...state.props().selected]).toEqual(['b']);
    state.dispatch('onPointerUp', state.at(to, { button }));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
    expect(state.props().pattern.notes).toEqual(state.originalNotes); expect(state.props().region).toMatchObject({ length: 1920, offset: 0 });
  });

  it('canvas blur cancels the preview, restores the old selection and releases pointer capture', () => {
    const state = pianoFixture(), { from, to } = state.movePoints();
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
    expect([...state.props().selected]).toEqual(['a']); expect(state.captures.has(7)).toBe(true);
    state.dispatch('onBlur', state.event(0, 0));
    expect([...state.props().selected]).toEqual(['b']); expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
    state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  for (const reason of ['region', 'locked'] as const) {
    const changeTarget = (state: ReturnType<typeof pianoFixture>) => reason === 'region' ? { region: { ...state.props().region!, id: 'another-copy' } } : { track: { ...state.props().track, locked: true } };
    it(`cancels a pending move when ${reason === 'region' ? 'the same pattern is opened through another region' : 'the track becomes locked'}`, () => {
      const state = pianoFixture(), { from, to } = state.movePoints();
      state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
      state.update(changeTarget(state));
      expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
      state.dispatch('onPointerUp', state.at(to));
      expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
      expect(state.captures.size).toBe(0);
    });

    it(`rechecks ${reason} at release even before the cancellation effect runs`, () => {
      const state = pianoFixture(), { from, to } = state.movePoints();
      state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
      const node = state.update(changeTarget(state), false);
      node.props.onPointerUp(state.at(to));
      expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
    });
  }
});

describe('PianoRoll live gesture owners and numeric preparation (inert event boundary)', () => {
  type State = ReturnType<typeof pianoFixture>;
  const begin = (state: State, kind: 'draw' | 'move' | 'resize' | 'erase' | 'velocity' | 'select' | 'trim') => {
    const from = kind === 'draw' ? state.gridPoint(960, 84) : kind === 'velocity' ? state.velocityPoint(.3)
      : kind === 'resize' ? { x: state.rect('a').x + state.rect('a').width - 1, y: state.point('a').y }
      : kind === 'trim' ? { x: state.gridPoint(state.props().region!.length, 84).x - 3, y: 34 } : state.point('a');
    const to = kind === 'velocity' ? state.velocityPoint(.7) : { x: from.x + 48, y: from.y };
    const extra = kind === 'erase' ? { button: 2 } : kind === 'select' ? { ctrlKey: true } : {};
    state.dispatch('onPointerDown', state.at(from, extra)); state.dispatch('onPointerMove', state.at(to, extra)); return { to, extra };
  };

  it.each(['draw', 'move', 'resize', 'erase', 'velocity', 'select', 'trim'] as const)('cancels %s after a history-only owner change without restoring its old selection', kind => {
    const state = pianoFixture(), first = {}, next = {}; let live = first;
    state.update({ gestureOwner: first, getGestureOwner: () => live }); const { to, extra } = begin(state, kind), selections = state.onSelect.mock.calls.length;
    live = next; state.update({ gestureOwner: next, track: { ...state.props().track, volume: .25 }, selected: new Set(['b']) });
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0); expect(state.onSelect).toHaveBeenCalledTimes(selections);
    state.dispatch('onPointerUp', state.at(to, extra)); expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled();
    expect([...state.props().selected]).toEqual(['b']); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  it.each(['release', 'frame'] as const)('checks the live owner on %s before any new React render', boundary => {
    const state = pianoFixture(), owner = {}; let live = owner; state.update({ gestureOwner: owner, getGestureOwner: () => live }); const { to } = begin(state, 'move');
    live = {}; const selections = state.onSelect.mock.calls.length;
    if (boundary === 'frame') { const [id, callback] = [...state.frames][0]; state.frames.delete(id); callback(16); }
    else state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0); expect(state.onSelect).toHaveBeenCalledTimes(selections);
  });

  it('rejects a rendered stale owner before preparing, focusing or changing selection', () => {
    const state = pianoFixture(), owner = {}, prepare = vi.fn(() => true); let live = owner;
    state.update({ gestureOwner: owner, getGestureOwner: () => live, onPrepareGesture: prepare }); live = {};
    state.dispatch('onPointerDown', state.at(state.point()));
    expect(prepare).not.toHaveBeenCalled(); expect(state.canvas.focus).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0);
  });

  it('keeps selection-only rerenders in the same owner valid until a normal release', () => {
    const state = pianoFixture(), owner = {}; state.update({ gestureOwner: owner, getGestureOwner: () => owner }); const { to } = begin(state, 'move');
    expect([...state.props().selected]).toEqual(['a']); expect(state.captures.has(7)).toBe(true); state.render(); state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).toHaveBeenCalledOnce(); expect(state.props().pattern.notes[0].tick).toBe(480); expect(state.captures.size).toBe(0);
  });

  it.each(['capture', 'release'] as const)('rejects an owner changed synchronously during pointer %s', boundary => {
    const state = pianoFixture(), owner = {}; let live = owner; state.update({ gestureOwner: owner, getGestureOwner: () => live });
    if (boundary === 'capture') { const original = state.canvas.setPointerCapture; state.canvas.setPointerCapture = id => { live = {}; return original(id); }; }
    const { to } = begin(state, 'move');
    if (boundary === 'release') { const original = state.canvas.releasePointerCapture; state.canvas.releasePointerCapture = id => { live = {}; return original(id); }; }
    state.dispatch('onPointerUp', state.at(to)); expect(state.onEdit).not.toHaveBeenCalled(); expect(state.frames.size).toBe(0); expect(state.captures.size).toBe(0);
  });

  it('blocks an invalid pending number before focus and leaves that input boundary and selection untouched', () => {
    const state = pianoFixture(), prepare = vi.fn(() => false); state.update({ onPrepareGesture: prepare }); const press = state.at(state.gridPoint(960, 84));
    state.dispatch('onPointerDown', press); expect(prepare).toHaveBeenCalledOnce(); expect(state.flushBoundary).toHaveBeenCalledOnce(); expect(press.preventDefault).toHaveBeenCalledOnce();
    expect(state.canvas.focus).not.toHaveBeenCalled(); expect(state.props().onFocus).not.toHaveBeenCalled(); expect(state.props().onAudition).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
    expect([...state.props().selected]).toEqual(['b']); expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
  });

  it.each(['draw', 'move'] as const)('starts the first %s from freshly flushed notes/owner/callbacks instead of losing the gesture', kind => {
    const state = pianoFixture(), original = {}, next = {}; let live = original;
    const edit = vi.fn((label: string, change: Parameters<RollProps['onEdit']>[1]) => state.onEdit(label, change));
    const audition = vi.fn();
    state.update({ gestureOwner: original, getGestureOwner: () => live, onPrepareGesture: () => {
      live = next; state.deferProps({ gestureOwner: next, pattern: { ...state.props().pattern, notes: state.props().pattern.notes.map(note => ({ ...note, velocity: .25, detune: 100 })) }, onEdit: edit, onAudition: audition }); return true;
    } });
    const from = kind === 'draw' ? state.gridPoint(960, 84) : state.point('a'), to = kind === 'draw' ? from : { x: from.x + 48, y: from.y };
    state.dispatch('onPointerDown', state.at(from)); expect(state.captures.has(7)).toBe(true); state.dispatch('onPointerMove', state.at(to)); state.dispatch('onPointerUp', state.at(to));
    expect(state.flushBoundary).toHaveBeenCalledOnce(); expect(edit).toHaveBeenCalledOnce(); expect(state.onEdit).toHaveBeenCalledOnce(); expect(audition).toHaveBeenCalled();
    expect(state.props().pattern.notes).toHaveLength(kind === 'draw' ? 3 : 2); expect(state.props().pattern.notes.find(note => note.id === 'a')).toMatchObject({ tick: kind === 'draw' ? 240 : 480, velocity: .25, detune: 100 });
  });

  it('also settles a source update delivered by the real focus callback boundary before capturing its owner', () => {
    const state = pianoFixture(), first = {}, next = {}; let live = first;
    state.update({ gestureOwner: first, getGestureOwner: () => live, onPrepareGesture: () => true });
    state.canvas.focus.mockImplementationOnce(() => { live = next; state.deferProps({ gestureOwner: next, pattern: { ...state.props().pattern, notes: state.props().pattern.notes.map(note => ({ ...note, detune: 150 })) } }); });
    const at = state.gridPoint(960, 84); state.dispatch('onPointerDown', state.at(at)); state.dispatch('onPointerUp', state.at(at));
    expect(state.onEdit).toHaveBeenCalledOnce(); expect(state.props().pattern.notes).toHaveLength(3); expect(state.props().pattern.notes[1].detune).toBe(150);
  });

  it('uses the current preparation callback if the flush first settles a pending parent focus render', () => {
    const state = pianoFixture(), oldPrepare = vi.fn(() => false), currentPrepare = vi.fn(() => true);
    state.update({ onPrepareGesture: oldPrepare });
    state.flushBoundary.mockImplementationOnce(update => { state.deferProps({ onPrepareGesture: currentPrepare }); state.render(); update(); state.render(); });
    const at = state.gridPoint(960, 84); state.dispatch('onPointerDown', state.at(at)); state.dispatch('onPointerUp', state.at(at));
    expect(oldPrepare).not.toHaveBeenCalled(); expect(currentPrepare).toHaveBeenCalledOnce(); expect(state.onEdit).toHaveBeenCalledOnce(); expect(state.props().pattern.notes).toHaveLength(3);
  });

  it('does not start after preparation replaces the document view even with identical region/source IDs', () => {
    const state = pianoFixture({ viewKey: 'document-a:region' }), first = {}, next = {}; let live = first;
    state.update({ gestureOwner: first, getGestureOwner: () => live, onPrepareGesture: () => { live = next; state.deferProps({ gestureOwner: next, viewKey: 'document-b:region', selected: new Set(['a']) }); return true; } });
    const at = state.gridPoint(960, 84); state.dispatch('onPointerDown', state.at(at)); state.dispatch('onPointerUp', state.at(at));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled(); expect(state.captures.size).toBe(0); expect([...state.props().selected]).toEqual(['a']);
  });

  it.each(['draw', 'move', 'resize', 'erase', 'velocity'] as const)('restores the pre-gesture selection when the App rejects a %s edit', kind => {
    const state = pianoFixture(), owner = {}, rejected = vi.fn(() => false); state.update({ gestureOwner: owner, getGestureOwner: () => owner, onEdit: rejected });
    const { to, extra } = begin(state, kind); state.dispatch('onPointerUp', state.at(to, extra));
    expect(rejected).toHaveBeenCalledOnce(); expect(state.props().pattern.notes).toEqual(state.originalNotes); expect([...state.props().selected]).toEqual(['b']);
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
  });

  it('does not roll back somebody else\'s restored selection after a rejected stale edit', () => {
    const state = pianoFixture(), owner = {}, next = {}; let live = owner;
    state.update({ gestureOwner: owner, getGestureOwner: () => live, onEdit: () => { live = next; state.deferProps({ gestureOwner: next, selected: new Set(['b']) }); return false; } });
    const { to } = begin(state, 'move'), selections = state.onSelect.mock.calls.length; state.dispatch('onPointerUp', state.at(to));
    expect(state.onSelect).toHaveBeenCalledTimes(selections); expect([...state.props().selected]).toEqual(['b']); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });
});

describe('PianoRoll component view navigation (no physical input)', () => {
  const expectVisible = (state: ReturnType<typeof pianoFixture>, notes = state.props().pattern.notes) => {
    for (const note of notes) {
      const r = state.rect(note);
      expect(r.x).toBeGreaterThanOrEqual(58); expect(r.x + r.width).toBeLessThanOrEqual(800);
      expect(r.y).toBeGreaterThanOrEqual(42); expect(r.y + r.height).toBeLessThanOrEqual(322);
    }
  };

  it('locates a low-register clip after the actual ResizeObserver measurement', () => {
    const notes = [{ ...newNote(240, 28, 240), id: 'low-a' }, { ...newNote(480, 31, 240), id: 'low-b' }];
    const state = pianoFixture({ notes, selected: ['low-b'], viewKey: 'low-clip' });
    expectVisible(state); expect([...state.props().selected]).toEqual(['low-b']);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
  });

  it('does not relocate the view after an ordinary note edit under the same view key', () => {
    const state = pianoFixture({ viewKey: 'same-clip' });
    state.scroll('vertical', 600);
    const before = state.view();
    state.dispatch('onPointerDown', state.at(state.velocityPoint(.5)));
    state.dispatch('onPointerUp', state.at(state.velocityPoint(.35)));
    expect(state.onEdit).toHaveBeenCalledTimes(1);
    expect(state.props().pattern.notes[0].velocity).toBeCloseTo(.35);
    expect(state.view()).toEqual(before);
  });

  it('locates the new register when the project/region view key changes', () => {
    const state = pianoFixture({ viewKey: 'old-copy' }), previous = state.view();
    const notes = [{ ...newNote(240, 28, 240), id: 'new-low-a' }, { ...newNote(480, 31, 240), id: 'new-low-b' }];
    state.update({ viewKey: 'new-copy', pattern: { ...state.props().pattern, notes } });
    expectVisible(state); expect(state.view().y).not.toBe(previous.y);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
  });

  it('fits all notes and then the selection through view requests without changing project data or selection', () => {
    const notes = [{ ...newNote(240, 28, 240), id: 'low' }, { ...newNote(4000, 96, 240), id: 'selected' }, { ...newNote(6000, 48, 240), id: 'late' }];
    const state = pianoFixture({ notes, selected: ['selected'], length: 7000 }), pattern = state.props().pattern, region = state.props().region;
    state.update({ viewRequest: { id: 1, mode: 'all' } });
    expectVisible(state);
    const all = state.view();
    expect(all.row).toBeLessThan(18); expect(all.zoom).toBeLessThan(96);
    state.update({ viewRequest: { id: 2, mode: 'selection' } });
    expectVisible(state, [notes[1]]);
    expect(state.view().zoom).toBeGreaterThan(all.zoom); expect(state.view().row).toBeGreaterThan(all.row);
    expect(state.onZoom).toHaveBeenCalled(); expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
    expect(state.props().onTrimRegion).not.toHaveBeenCalled(); expect([...state.props().selected]).toEqual(['selected']);
    expect(state.props().pattern).toBe(pattern); expect(state.props().region).toBe(region);
    // Redo belongs to App history and is checked independently through real menus.
  });

  it('keeps the viewport center tick fixed when the parent changes horizontal zoom', () => {
    const notes = [{ ...newNote(240, 60, 240), id: 'start' }, { ...newNote(10000, 64, 240), id: 'late' }];
    const state = pianoFixture({ notes, length: 12000 });
    state.scroll('horizontal', 400);
    const before = state.view(), tick = (before.x + before.width / 2) / before.scale;
    state.update({ zoom: 144 });
    const after = state.view();
    expect((after.x + after.width / 2) / after.scale).toBeCloseTo(tick, 10);
    expect(after.y).toBe(before.y); expect(after.row).toBe(before.row);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
  });

  it('anchors wheel zoom at the pointer and keeps later button zoom working at a clamp boundary', () => {
    const notes = [{ ...newNote(240, 60, 240), id: 'start' }, { ...newNote(10000, 64, 240), id: 'late' }];
    const state = pianoFixture({ notes, length: 12000 });
    state.scroll('horizontal', 400);
    const before = state.view(), anchor = 200, tick = (before.x + anchor) / before.scale;
    state.wheelZoom(58 + anchor, -120);
    expect((state.view().x + anchor) / state.view().scale).toBeCloseTo(tick, 10);
    state.update({ zoom: 220 }); state.wheelZoom(58 + anchor, -120);
    const maximum = state.view(), centerTick = (maximum.x + maximum.width / 2) / maximum.scale;
    state.update({ zoom: 180 });
    expect((state.view().x + state.view().width / 2) / state.view().scale).toBeCloseTo(centerTick, 10);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
  });

  it('changes row height independently, keeps center pitch and publishes the actual fitted height', () => {
    const state = pianoFixture(); const publish = vi.fn(); state.update({ onRowHeight: publish });
    const before = state.view(), center = (before.y + before.height / 2) / before.row;
    state.update({ rowHeight: 30 });
    const after = state.view();
    expect(after.row).toBe(30); expect((after.y + after.height / 2) / after.row).toBeCloseTo(center, 10);
    expect(after.x).toBe(before.x); expect(after.scale).toBe(before.scale);
    expect(publish).toHaveBeenLastCalledWith(30);
    state.update({ viewRequest: { id: 1, mode: 'all' } });
    expect(publish).toHaveBeenLastCalledWith(state.view().row);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.onSelect).not.toHaveBeenCalled();
  });

  it.each([false,true])('anchors Ctrl/Cmd+Shift wheel vertically with meta=%s', meta => {
    const state = pianoFixture(), before = state.view(), anchor = 110;
    state.wheelRows(42 + anchor, -120, meta);
    const after = state.view();
    expect(after.row).toBeCloseTo(before.row * 1.1);
    expect((after.y + anchor) / after.row).toBeCloseTo((before.y + anchor) / before.row, 10);
    expect(after.x).toBe(before.x); expect(after.scale).toBe(before.scale);
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });

  it('cancels an in-flight note move before changing pitch geometry', () => {
    const state = pianoFixture(), { from,to } = state.movePoints();
    state.dispatch('onPointerDown',state.at(from)); state.dispatch('onPointerMove',state.at(to));
    state.update({ rowHeight: 28 }); state.dispatch('onPointerUp',state.at(to));
    expect(state.captures.size).toBe(0); expect(state.onEdit).not.toHaveBeenCalled();
    expect(state.props().pattern.notes).toEqual(state.originalNotes);
  });
});

describe('PianoRoll indexed candidates and actual paint callbacks (no physical input)', () => {
  const bodies = (state: ReturnType<typeof pianoFixture>) => state.lastPaint().filter(command => command.kind === 'body');
  const stems = (state: ReturnType<typeof pianoFixture>) => state.lastPaint().filter(command => command.kind === 'rectangle' && command.args[2] === 4 && command.args[3] === 3 && command.args[1] >= 322);

  it('paints and hits a long body entering from the left without drawing its offscreen onset velocity', () => {
    const notes = [{ ...newNote(0, 84, 5000), id: 'long' }, { ...newNote(6000, 84, 120), id: 'later' }];
    const state = pianoFixture({ notes, selected: [], length: 8000, paint: true }); state.scroll('horizontal', 400);
    const rect = state.rect('long'); expect(rect.x).toBeLessThan(58); expect(rect.x + rect.width).toBeGreaterThan(58);
    expect(bodies(state)).toHaveLength(1); expect(bodies(state)[0].args[0]).toBe(rect.x + 1); expect(stems(state)).toHaveLength(0);
    state.dispatch('onPointerDown', state.event(100, rect.y + rect.height / 2)); expect([...state.props().selected]).toEqual(['long']);
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape' }));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toBe(notes); expect(notes).toEqual(state.originalNotes);
  });

  it('keeps a zero-duration six-pixel body selectable at its closed right edge by marquee', () => {
    const notes = [{ ...newNote(240, 84, 0), id: 'zero' }, { ...newNote(480, 83, 120), id: 'other' }];
    const state = pianoFixture({ notes, selected: [], paint: true }), rect = state.rect('zero');
    expect(rect.width).toBe(6); expect(bodies(state).some(command => command.args[0] === rect.x + 1 && command.args[2] === 4)).toBe(true);
    const contact = { x: rect.x + rect.width, y: rect.y + rect.height };
    state.dispatch('onPointerDown', state.at(contact, { shiftKey: true })); state.dispatch('onPointerUp', state.at(contact, { shiftKey: true }));
    expect([...state.props().selected]).toEqual(['zero']); expect(state.onEdit).not.toHaveBeenCalled(); expect(notes).toEqual(state.originalNotes);
  });

  it('retains unsorted source paint order and topmost point selection after indexing', () => {
    const notes = [{ ...newNote(480, 84, 480), id: 'later-first' }, { ...newNote(240, 84, 720), id: 'bottom' }, { ...newNote(240, 84, 600), id: 'top' }];
    const state = pianoFixture({ notes, selected: [], paint: true });
    expect(bodies(state).map(command => command.args[2])).toEqual(notes.map(note => state.rect(note).width - 2));
    state.dispatch('onPointerDown', state.at(state.point('top'))); expect([...state.props().selected]).toEqual(['top']);
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape' })); expect(state.onEdit).not.toHaveBeenCalled(); expect(notes).toEqual(state.originalNotes);
  });

  it('previews a selected offscreen note moving into the viewport and commits the whole selection once', () => {
    const notes = [{ ...newNote(3840, 84, 120), id: 'anchor' }, { ...newNote(0, 84, 120), id: 'offscreen' }];
    const state = pianoFixture({ notes, selected: ['anchor', 'offscreen'], length: 9000, paint: true }); state.scroll('horizontal', 600);
    expect(state.rect('offscreen').x + state.rect('offscreen').width).toBeLessThan(58);
    const from = state.point('anchor'), to = { x: from.x + 3360 * state.view().scale, y: from.y };
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toBe(notes); expect(notes).toEqual(state.originalNotes);
    const moved = { ...notes[1], tick: 3360 }, rect = state.rect(moved);
    expect(bodies(state)).toHaveLength(1); expect(bodies(state)[0].args[0]).toBe(rect.x + 1); expect(stems(state)).toHaveLength(1);
    state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).toHaveBeenCalledTimes(1); expect(state.props().pattern.notes).toEqual(notes.map(note => ({ ...note, tick: note.tick + 3360 })));
    expect(notes).toEqual(state.originalNotes); expect(state.captures.size).toBe(0);
  });

  it('preserves closed viewport-right body and onset candidates before exact canvas clipping', () => {
    const notes = [{ ...newNote(0, 84, 60), id: 'first' }, { ...newNote(4800, 84, 0), id: 'seam' }];
    const state = pianoFixture({ notes, selected: [], length: 8000, paint: true }); state.scroll('horizontal', 218);
    const rect = state.rect('seam'); expect(rect.x).toBe(800);
    expect(bodies(state)).toHaveLength(1); expect(bodies(state)[0].args[0]).toBe(801);
    expect(stems(state)).toHaveLength(1); expect(stems(state)[0].args[0]).toBe(800);
    state.dispatch('onPointerDown', state.event(800, rect.y + rect.height / 2)); expect([...state.props().selected]).toEqual(['seam']);
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape' })); expect(state.onEdit).not.toHaveBeenCalled();
  });

  it('hits the topmost one-pixel body and erases all contacted layers when fit rows are subpixel', () => {
    const notes = Array.from({ length: 128 }, (_, midi) => ({ ...newNote(0, midi, 1000), id: `pitch-${midi}` }));
    const state = pianoFixture({ notes, selected: [], paint: true, size: { width: 800, height: 180 } });
    state.update({ viewRequest: { id: 1, mode: 'all' } });
    expect(state.view().row).toBeLessThan(1); expect(state.rect('pitch-119').height).toBe(1);
    const contact = { x: 100, y: state.rect('pitch-119').y + .93 };
    state.dispatch('onPointerDown', state.at(contact)); expect([...state.props().selected]).toEqual(['pitch-119']);
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape' })); expect(state.onEdit).not.toHaveBeenCalled();
    const from = { x: 80, y: contact.y }, to = { x: 120, y: contact.y };
    state.dispatch('onPointerDown', state.at(from, { button: 2 })); state.dispatch('onPointerMove', state.at(to, { button: 2 }));
    expect(state.onEdit).not.toHaveBeenCalled(); state.dispatch('onPointerUp', state.at(to, { button: 2 }));
    expect(state.onEdit).toHaveBeenCalledTimes(1);
    expect(state.props().pattern.notes).toEqual(notes.filter(note => note.midi < 117 || note.midi > 119));
    expect(notes).toEqual(state.originalNotes);
  });

  it('reuses a 100k sparse-source index and bounds repaint, hover and move preview work by candidates', () => {
    let reads = 0, measuring = false;
    const notes = Array.from({ length: 100000 }, (_, index) => {
      const tick = index * 9600, note = { ...newNote(tick, 84, 60), id: `sparse-${index}` };
      Object.defineProperty(note, 'tick', { enumerable: true, get: () => { if (measuring) reads++; return tick; } }); return note;
    });
    const state = pianoFixture({ notes, selected: ['sparse-0'], length: 960000000, paint: true }), from = state.point('sparse-0');
    const measure = (action: () => void) => { reads = 0; measuring = true; try { action(); return reads; } finally { measuring = false; } };
    const repaintReads = measure(() => state.update({ playhead: 0 }));
    const hoverReads = measure(() => state.dispatch('onPointerMove', state.at(from)));
    state.dispatch('onPointerDown', state.at(from)); const to = { x: from.x + 240 * state.view().scale, y: from.y };
    const moveReads = measure(() => state.dispatch('onPointerMove', state.at(to)));
    // These count actual source tick accesses, not elapsed time or FPS. Full
    // source construction and the eventual one-time edit are separate phases.
    expect(repaintReads).toBeLessThan(500); expect(hoverReads).toBeLessThan(500); expect(moveReads).toBeLessThan(500);
    expect(state.indexWork.builds.filter(count => count === 100000)).toHaveLength(1); expect(state.indexWork.builds.filter(count => count === 1)).toHaveLength(1);
    expect(state.indexWork.queries.some(query => query.source === 100000)).toBe(true);
    expect(state.indexWork.queries.every(query => query.count < 10 && query.tested < 10)).toBe(true);
    expect(state.indexWork.starts.every(query => query.count < 10 && query.tested < 10)).toBe(true);
    expect(bodies(state)).toHaveLength(1); expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toBe(notes);
    state.dispatch('onKeyDown', state.event(0, 0, { key: 'Escape' })); expect(state.onEdit).not.toHaveBeenCalled(); expect(notes).toEqual(state.originalNotes);
  });
});

describe('PianoRoll relative multi-note velocity callbacks (no physical input)', () => {
  const fixture = () => pianoFixture({ paint: true, selected: ['a', 'b'], notes: [
    { ...newNote(240, 84, 240), id: 'a', velocity: .25, pan: -.125, detune: 7.5, height: .25, instrumentId: 'flute', midiSource: { onOrder: 2, offOrder: 7, releaseVelocity: 45, offSourceTrack: 5 } },
    { ...newNote(480, 83, 720), id: 'b', velocity: .75, pan: .25, detune: -12, height: -.5, midiSource: { onOrder: 8, offOrder: 12, releaseVelocity: 63, offSourceTrack: 4 } },
    { ...newNote(720, 82, 120), id: 'unselected', velocity: .5 },
  ] });
  const movedPoint = (state: ReturnType<typeof fixture>, delta: number) => { const from = state.velocityPoint(.75, 'b'); return { from, to: { x: from.x, y: from.y - delta * 56 } }; };

  it('previews a common relative delta without changing source, then commits once with full note metadata', () => {
    const state = fixture(), { from, to } = movedPoint(state, .125), before = state.props().pattern.notes;
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toBe(before);
    const heads = state.lastPaint().filter(command => command.kind === 'rectangle' && command.args[2] === 4 && command.args[3] === 3 && command.args[1] >= 322);
    for (const [id, y] of [['a', 368], ['b', 340], ['unselected', 361]] as const) expect(heads.find(command => command.args[0] === state.rect(id).x)?.args[1]).toBe(y);
    state.dispatch('onPointerUp', state.at(to)); expect(state.onEdit).toHaveBeenCalledTimes(1);
    expect(state.props().pattern.notes).toEqual([{ ...state.originalNotes[0], velocity: .375 }, { ...state.originalNotes[1], velocity: .875 }, state.originalNotes[2]]);
    expect(before).toEqual(state.originalNotes); expect([...state.props().selected]).toEqual(['a', 'b']);
  });

  it.each([{ delta: 1, velocities: [.5, 1, .5] }, { delta: -1, velocities: [0, .5, .5] }])('clamps the common delta at the whole selection bounds: $delta', ({ delta, velocities }) => {
    const state = fixture(), { from, to } = movedPoint(state, delta);
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to)); state.dispatch('onPointerUp', state.at(to));
    expect(state.onEdit).toHaveBeenCalledTimes(1); expect(state.props().pattern.notes.map(note => note.velocity)).toEqual(velocities);
    expect(state.props().pattern.notes[1].velocity - state.props().pattern.notes[0].velocity).toBe(.5);
  });

  it.each(['stationary', 'return-to-origin'])('%s leaves multi-note dynamics and history boundary unchanged', mode => {
    const state = fixture(), { from, to } = movedPoint(state, .125);
    state.dispatch('onPointerDown', state.at(from));
    if (mode === 'return-to-origin') state.dispatch('onPointerMove', state.at(to));
    state.dispatch('onPointerUp', state.at(from));
    expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toEqual(state.originalNotes);
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
  });

  it.each(['Escape', 'blur', 'source-change', 'locked'])('%s cancels relative preview without committing or changing source data', reason => {
    const state = fixture(), { from, to } = movedPoint(state, .125);
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
    if (reason === 'Escape') state.dispatch('onKeyDown', state.at(to, { key: 'Escape' }));
    else if (reason === 'blur') state.dispatch('onBlur', state.at(to));
    else if (reason === 'source-change') state.update({ pattern: { ...state.props().pattern, notes: structuredClone(state.originalNotes) } }, false);
    else state.update({ track: { ...state.props().track, locked: true } }, false);
    state.dispatch('onPointerUp', state.at(to)); expect(state.onEdit).not.toHaveBeenCalled();
    expect(state.props().pattern.notes).toEqual(state.originalNotes); expect([...state.props().selected]).toEqual(['a', 'b']);
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
  });

  it('ignores foreign pointer cancellation during a relative drag and commits only the active release', () => {
    const state = fixture(), { from, to } = movedPoint(state, .125);
    state.dispatch('onPointerDown', state.at(from)); state.dispatch('onPointerMove', state.at(to));
    state.dispatch('onPointerCancel', state.at(to, { pointerId: 99 })); state.dispatch('onPointerUp', state.at(to, { pointerId: 99 }));
    expect(state.captures.has(7)).toBe(true); expect(state.onEdit).not.toHaveBeenCalled();
    state.dispatch('onPointerUp', state.at(to)); expect(state.onEdit).toHaveBeenCalledOnce();
    expect(state.props().pattern.notes.map(note => note.velocity)).toEqual([.375, .875, .5]);
  });

  it('does not rescan 100k selected velocities on every preview frame', () => {
    let measuring = false, velocityReads = 0;
    const notes = Array.from({ length: 100000 }, (_, index) => {
      const velocity = index % 2 ? .75 : .25, note = { ...newNote(index * 9600, 84, 60), id: 'large-velocity-' + index };
      Object.defineProperty(note, 'velocity', { enumerable: true, get: () => { if (measuring) velocityReads++; return velocity; } }); return note;
    });
    const state = pianoFixture({ notes, selected: notes.map(note => note.id), length: 960000000, paint: true }), from = state.velocityPoint(.25, notes[0].id);
    state.dispatch('onPointerDown', state.at(from));
    measuring = true;
    try { state.dispatch('onPointerMove', state.at({ x: from.x, y: from.y - 7 })); state.dispatch('onPointerMove', state.at({ x: from.x, y: from.y - 10.5 })); }
    finally { measuring = false; }
    // Actual source-field accesses, not time or FPS. Initial bounds/index
    // construction and the final whole-source transaction are separate phases.
    expect(velocityReads).toBeLessThan(500); expect(state.onEdit).not.toHaveBeenCalled(); expect(state.props().pattern.notes).toBe(notes);
    state.dispatch('onKeyDown', state.at(from, { key: 'Escape' })); expect(state.onEdit).not.toHaveBeenCalled();
  });
});
