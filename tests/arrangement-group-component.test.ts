import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote, newTrack } from '../src/core/project';
import { createMeterMap } from '../src/core/meter';
import { playbackEndTick } from '../src/core/reference';
import { filterTracks } from '../src/core/track-filter';
import { ArrangementNoteCache } from '../src/ui/arrangement-note-cache';
import { regionPreviewGeometry } from '../src/ui/arrangement-preview';
import { regionDragPreview } from '../src/ui/region-drag-preview';
import { arrangementTrackAt } from '../src/ui/arrangement-track-drop';
import { ArrangementGroupGesture } from '../src/ui/arrangement-group-gesture';
import { captureEditorPointer } from '../src/ui/pointer-capture';
import { startHorizontalEdgeScroll, startVerticalEdgeScroll } from '../src/ui/edge-scroll';

// Compile the actual parent -> clip -> canvas tree, reusing the existing inert
// hook/memo/effect/ResizeObserver harness without executing its test cases.
// Callback delivery models event bubbling explicitly; it is not browser input.
const source = readFileSync(new URL('../src/ui/Arrangement.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const componentStart = source.indexOf('function MiniNotes(');
if (componentStart < 0) throw new Error('Actual Arrangement source boundary missing');
const componentCode = transformSync(source.slice(componentStart).replace('export function Arrangement(', 'function Arrangement('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderArrangementElement' }).code;
const harnessSource = readFileSync(new URL('./arrangement-candidates.test.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = harnessSource.indexOf('function arrangementProject('), end = harnessSource.indexOf('\ndescribe(', start);
if (start < 0 || end < 0) throw new Error('Existing Arrangement harness boundaries missing');
const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const dependencies = { componentCode, sameDeps, createProject, newNote, createMeterMap, playbackEndTick, filterTracks, ArrangementNoteCache, regionPreviewGeometry, regionDragPreview, arrangementTrackAt, ArrangementGroupGesture, captureEditorPointer, startHorizontalEdgeScroll, startVerticalEdgeScroll, vi };
const arrangementFixture = Function(...Object.keys(dependencies), `${transformSync(harnessSource.slice(start, end), { loader: 'ts', target: 'es2022' }).code}\nreturn arrangementFixture;`)(...Object.values(dependencies));

function fixture(selected = ['c'], instrumentFilter = '') {
  const project = createProject('Group component fixture'); project.ppq = 480;
  project.tracks = Array.from({ length: 5 }, (_, index) => ({ ...newTrack(`Track ${index}`, index, index === 1 ? 'bass' : 'harp'), id: `t${index}`, locked: index === 3 }));
  project.patterns = ['a', 'b', 'c', 'e'].map(id => ({ id: `p-${id}`, name: `Pattern ${id}`, length: 960, notes: [{ ...newNote(120, 60, 180), id: `n-${id}`, instrumentId: 'bass', pan: .2, detune: 7.5, height: -.5 }] }));
  project.regions = [
    { id: 'a', trackId: 't0', patternId: 'p-a', start: 240, length: 480, offset: 120, loop: false },
    { id: 'b', trackId: 't1', patternId: 'p-b', start: 960, length: 720, offset: 240, loop: true },
    { id: 'c', trackId: 't2', patternId: 'p-c', start: 0, length: 240, offset: 0, loop: false },
    { id: 'e', trackId: 't4', patternId: 'p-e', start: 1920, length: 480, offset: 0, loop: false },
  ];
  if (selected.includes('locked')) project.regions.push({ id: 'locked', trackId: 't3', patternId: 'p-c', start: 1440, length: 480, offset: 0, loop: false });
  const original = structuredClone(project); let pending: { selectedRegions: Set<string>; selectedRegion: string } | undefined;
  const selection = vi.fn((ids: Set<string>, primary?: string) => { pending = { selectedRegions: new Set(ids), selectedRegion: primary ?? '' }; }), groupChange = vi.fn(), message = vi.fn();
  const state = arrangementFixture(project, { selectedRegions: new Set(selected), selectedRegion: selected[0] ?? '', onRegionSelection: selection, onRegionGroupChange: groupChange, onGestureMessage: message, instrumentFilter });
  const node = (id: string) => state.elements().find((item: any) => item.props['data-region-id'] === id)!;
  const scroll = () => state.elements().find((item: any) => item.props.className === 'arrangement-scroll')!;
  const event = (target: any, x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, pointerId: 7, button: 0, currentTarget: target.dom,
    target: { classList: { contains: () => false } }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
  const flush = () => { if (pending) { const next = pending; pending = undefined; state.update(next); } else state.render(); };
  const move = (x: number, y: number) => { const root = scroll(); root.props.onPointerMove(event(root, x, y)); flush(); };
  const up = (x: number, y: number) => { const root = scroll(); root.props.onPointerUp(event(root, x, y)); flush(); };
  const noEdit = () => { expect(groupChange).not.toHaveBeenCalled(); expect(state.props().onRegionChange).not.toHaveBeenCalled(); expect(state.props().onTrimRegion).not.toHaveBeenCalled(); expect(project).toEqual(original); };
  return { ...state, project, original, node, scroll, event, flush, move, up, selection, groupChange, message, noEdit };
}

describe('Arrangement actual group component callbacks (no physical input)', () => {
  it.each(['body', 'right edge', 'blank'] as const)('Ctrl starts replacement marquee from %s instead of moving/trimming', origin => {
    const s = fixture();
    const target = origin === 'blank' ? s.elements().find((item: any) => String(item.props.className).startsWith('arrangement-lane')) : s.node('a');
    const x = origin === 'body' ? 60 : origin === 'right edge' ? 143 : 20;
    const down = s.event(target, x, origin === 'blank' ? 31 : 52, { ctrlKey: true, target: origin === 'blank' ? target.dom : { classList: { contains: (name: string) => origin === 'right edge' && name === 'region-resize' } } });
    target.props.onPointerDown(down); s.flush(); s.move(340, 126);
    expect(s.elements().some((item: any) => item.props['data-testid'] === 'region-marquee')).toBe(true);
    expect(s.props().selectedRegions).toEqual(new Set(['c'])); expect(s.selection).not.toHaveBeenCalled(); s.noEdit();
    s.up(340, 126); expect(s.props().selectedRegions).toEqual(new Set(['a', 'b'])); expect(s.props().selectedRegion).toBe('a');
    expect(s.elements().some((item: any) => item.props['data-testid'] === 'region-marquee')).toBe(false); s.noEdit();
  });

  it('Cmd+Shift from a clip adds the marquee results to the original selection', () => {
    const s = fixture(), target = s.node('a'); target.props.onPointerDown(s.event(target, 60, 52, { metaKey: true, shiftKey: true })); s.flush(); s.move(340, 126); s.up(340, 126);
    expect(s.props().selectedRegions).toEqual(new Set(['c', 'a', 'b'])); expect(s.props().selectedRegion).toBe('c'); s.noEdit();
  });

  it('Shift click toggles clips without starting a drag', () => {
    const s = fixture(['a']); let target = s.node('b'); target.props.onPointerDown(s.event(target, 210, 104, { shiftKey: true })); s.flush();
    expect(s.props().selectedRegions).toEqual(new Set(['a', 'b'])); expect(s.props().selectedRegion).toBe('b'); expect(target.dom.hasPointerCapture(7)).toBe(false);
    target = s.node('a'); target.props.onPointerDown(s.event(target, 60, 52, { shiftKey: true })); s.flush(); s.move(340, 126); s.up(340, 126);
    expect(s.props().selectedRegions).toEqual(new Set(['b'])); expect(s.frames.size).toBe(0); s.noEdit();
  });

  it.each([false, true])('blank left drag replaces or appends selection (Shift=%s)', shiftKey => {
    const s = fixture(), target = s.elements().find((item: any) => String(item.props.className).startsWith('arrangement-lane'));
    target.props.onPointerDown(s.event(target, 400, 52, { shiftKey, target: target.dom })); s.flush(); s.move(20, 126); s.up(20, 126);
    expect(s.props().selectedRegions).toEqual(new Set(shiftKey ? ['c', 'a', 'b'] : ['a', 'b'])); s.noEdit();
  });

  it('moves the selected group through the parent callbacks, preserving source indexes and committing once', () => {
    const s = fixture(['a', 'b']), target = s.node('b'), indexes = s.createdIndexes.map((entry: any) => entry.index);
    target.props.onPointerDown(s.event(target, 210, 104)); s.flush();
    expect(s.props().onSelect).toHaveBeenCalledWith(s.project.regions[1]); expect(s.props().selectedRegions).toEqual(new Set(['a', 'b']));
    s.move(258, 156);
    expect(s.node('a').props.style.transform).toBe('translateY(52px)'); expect(s.node('b').props.style.transform).toBe('translateY(52px)');
    expect(s.node('a').props.style.left).toBe(96); expect(s.node('b').props.style.left).toBe(240);
    expect(s.createdIndexes.map((entry: any) => entry.index)).toEqual(indexes); s.noEdit();
    s.up(258, 156); expect(s.groupChange).toHaveBeenCalledExactlyOnceWith([{ id: 'a', start: 480, trackId: 't1' }, { id: 'b', start: 1200, trackId: 't2' }]);
    expect(s.props().onRegionChange).not.toHaveBeenCalled(); expect(s.props().onTrimRegion).not.toHaveBeenCalled(); expect(s.frames.size).toBe(0); expect(s.project).toEqual(s.original);
  });

  it('keeps the group on body press but a click release selects only the anchor without editing', () => {
    const s = fixture(['a', 'b']), target = s.node('b');
    target.props.onPointerDown(s.event(target, 210, 104)); s.flush();
    expect(s.props().selectedRegions).toEqual(new Set(['a', 'b'])); expect(s.selection).not.toHaveBeenCalled();
    s.up(211, 105);
    expect(s.selection).toHaveBeenCalledExactlyOnceWith(new Set(['b']), 'b'); expect(s.props().selectedRegions).toEqual(new Set(['b'])); expect(s.props().selectedRegion).toBe('b');
    expect(s.frames.size).toBe(0); expect(target.dom.hasPointerCapture(7)).toBe(false); s.noEdit();
  });

  it.each([
    { name: 'hidden member', selected: ['a', 'b'], filter: 'harp', anchor: 'a', x: 60, y: 52 },
    { name: 'locked member', selected: ['a', 'locked'], filter: '', anchor: 'a', x: 60, y: 52 },
    { name: 'locked anchor', selected: ['a', 'locked'], filter: '', anchor: 'locked', x: 300, y: 208 },
  ])('allows a plain click to isolate a member from a group with a $name', ({ selected, filter, anchor, x, y }) => {
    const s = fixture(selected, filter), target = s.node(anchor); target.props.onPointerDown(s.event(target, x, y)); s.flush();
    expect(s.props().selectedRegions).toEqual(new Set(selected)); expect(target.dom.hasPointerCapture(7)).toBe(true);
    s.up(x + 1, y + 1);
    expect(s.selection).toHaveBeenCalledExactlyOnceWith(new Set([anchor]), anchor); expect(s.props().selectedRegions).toEqual(new Set([anchor])); expect(s.props().selectedRegion).toBe(anchor);
    expect(s.message).not.toHaveBeenCalled(); expect(target.dom.hasPointerCapture(7)).toBe(false); expect(s.frames.size).toBe(0); s.noEdit();
  });

  it('retains the whole locked-member group and rejects an actual drag without moving its unlocked subset', () => {
    const s = fixture(['a', 'locked']), target = s.node('a'); target.props.onPointerDown(s.event(target, 60, 52)); s.flush(); s.move(108, 104); s.up(108, 104);
    expect(s.selection).not.toHaveBeenCalled(); expect(s.props().selectedRegions).toEqual(new Set(['a', 'locked'])); expect(s.message).toHaveBeenCalledOnce(); expect(s.message.mock.calls[0][0]).toContain('锁定');
    expect(s.frames.size).toBe(0); expect(target.dom.hasPointerCapture(7)).toBe(false); s.noEdit();
  });

  it('trimming first collapses selection and uses only the local trim path', () => {
    const s = fixture(['a', 'b']); let target = s.node('a');
    target.props.onPointerDown(s.event(target, 143, 52, { target: { classList: { contains: (name: string) => name === 'region-resize' } } })); s.flush();
    expect(s.props().selectedRegions).toEqual(new Set(['a'])); target = s.node('a'); target.props.onPointerMove(s.event(target, 191, 156)); s.flush();
    target = s.node('a'); target.props.onPointerUp(s.event(target, 191, 156)); s.flush();
    expect(s.props().onTrimRegion).toHaveBeenCalledExactlyOnceWith('a', 'end', 960); expect(s.groupChange).not.toHaveBeenCalled(); expect(s.props().onRegionChange).not.toHaveBeenCalled(); expect(s.project).toEqual(s.original);
  });

  it('cancels marquee without changing actual selection and ignores a foreign pointer cancel', () => {
    const s = fixture(), target = s.node('a'); target.props.onPointerDown(s.event(target, 60, 52, { ctrlKey: true })); s.flush(); s.move(340, 126);
    let root = s.scroll(); root.props.onPointerCancel(s.event(root, 340, 126, { pointerId: 99 })); s.flush(); expect(s.elements().some((item: any) => item.props['data-testid'] === 'region-marquee')).toBe(true);
    root = s.scroll(); root.props.onPointerCancel(s.event(root, 340, 126)); s.flush(); s.up(340, 126);
    expect(s.selection).not.toHaveBeenCalled(); expect(s.props().selectedRegions).toEqual(new Set(['c'])); expect(s.frames.size).toBe(0); s.noEdit();
  });

  it('rejects a group containing a filtered-out member without changing the visible subset', () => {
    const s = fixture(['a', 'b'], 'harp'), target = s.node('a');
    expect(s.node('b')).toBeUndefined(); target.props.onPointerDown(s.event(target, 60, 52)); s.flush(); s.move(108, 104); s.up(108, 104);
    expect(s.message).toHaveBeenCalledOnce(); expect(s.props().selectedRegions).toEqual(new Set(['a', 'b'])); expect(target.dom.hasPointerCapture(7)).toBe(false); s.noEdit();
  });
});
