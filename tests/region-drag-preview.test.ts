import { describe, expect, it } from 'vitest';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { trimRegion } from '../src/core/editor-interaction';
import { regionDragPreview } from '../src/ui/region-drag-preview';
import { regionPreviewGeometry } from '../src/ui/arrangement-preview';
import { createRegionGestureHarness as clipFixture } from './helpers/region-gesture-harness';

// Run the actual component callbacks on inert objects. This is not browser input
// or a substitute for the independent pointer/capture CUA acceptance.
describe('arrangement drag thumbnail matches its eventual playback', () => {
  it('feeds live trim offset to the thumbnail and commits once, only on release', () => {
    const state = clipFixture();
    state.render().props.onPointerDown(state.event(0));
    for (const x of [12, 24, 36, 48]) state.render().props.onPointerMove(state.event(x));
    const moved = state.render(), thumbnail = state.thumbnail(moved);
    expect(moved.props.style).toMatchObject({ left: 240, width: 144 });
    expect(thumbnail.props.region).toMatchObject({ start: 2400, length: 1440, offset: 480 });
    expect(thumbnail.props.prepend).toBe(0);
    expect(state.project).toEqual(state.original);
    expect(state.onTrimRegion).not.toHaveBeenCalled();
    expect(state.onRegionChange).not.toHaveBeenCalled();
    expect(state.capture()).toBe(7);
    moved.props.onPointerUp(state.event(48));
    expect(state.onTrimRegion).toHaveBeenCalledExactlyOnceWith(state.region.id, 'start', 2400);
    expect(state.onRegionChange).not.toHaveBeenCalled();
    expect(state.capture()).toBe(-1);
    state.render().props.onLostPointerCapture(state.event(48));
    expect(state.onTrimRegion).toHaveBeenCalledTimes(1);
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])('restores the original preview without a project edit after %s', cancel => {
    const state = clipFixture();
    state.render().props.onPointerDown(state.event(0));
    state.render().props.onPointerMove(state.event(-48));
    expect(state.thumbnail(state.render()).props).toMatchObject({ prepend: 480, region: { start: 1440, offset: 0, length: 2400 } });
    state.render().props[cancel](state.event(-48));
    expect(state.render().props.style).toMatchObject({ left: 192, width: 192 });
    expect(state.thumbnail(state.render()).props.region).toBe(state.region);
    expect(state.project).toEqual(state.original);
    expect(state.onTrimRegion).not.toHaveBeenCalled();
    expect(state.onRegionChange).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'crop left', edge: 'start' as const, tick: 2400, loop: false, offset: 0 },
    { name: 'prepend source silence', edge: 'start' as const, tick: 1440, loop: false, offset: 0 },
    { name: 'restore cropped left', edge: 'start' as const, tick: 1680, loop: false, offset: 480 },
    { name: 'crop right', edge: 'end' as const, tick: 3000, loop: false, offset: 0 },
    { name: 'loop wrap left', edge: 'start' as const, tick: 1440, loop: true, offset: 120 },
    { name: 'loop crop left with far source offset', edge: 'start' as const, tick: 2400, loop: true, offset: 501 * 1920 + 480 },
  ])('$name uses the retained onsets and absolute timing before release', ({ edge, tick, loop, offset }) => {
    const project = createProject(), pattern = project.patterns[0], region = project.regions[0];
    pattern.length = 1920; region.start = 1920; region.length = loop ? 7680 : 1920; region.offset = offset; region.loop = loop;
    pattern.notes = [newNote(0, 60, 120), newNote(960, 67, 120)];
    const original = structuredClone(project), preview = regionDragPreview(region, pattern.length, edge, tick);
    expect(project).toEqual(original);
    const committed = structuredClone(project);
    trimRegion(committed, region.id, edge, tick);
    const finalRegion = committed.regions[0];
    expect(preview.region).toEqual(finalRegion);
    const view = { offset: 0, width: preview.region.length, regionWidth: preview.region.length };
    // Before commit the source itself is unchanged. A virtual source shift
    // must agree with final project playback, including newly prepended silence.
    const drawingRegion = { ...preview.region, offset: preview.region.offset - preview.prepend };
    const geometry = regionPreviewGeometry(pattern, drawingRegion, view);
    const actual = geometry.notes.map(note => [note.midi, note.x + preview.region.start]).sort((a, b) => a[1] - b[1]);
    const expected = flattenNotes(committed).map(note => [note.midi, note.absoluteTick]).sort((a, b) => a[1] - b[1]);
    expect(actual).toEqual(expected);
    if (edge === 'start' && !loop) {
      const retained = flattenNotes(original).filter(note => note.absoluteTick >= tick && note.absoluteTick < finalRegion.start + finalRegion.length);
      expect(expected).toEqual(retained.map(note => [note.midi, note.absoluteTick]));
    }
  });

  it('moves a far visible loop window without changing its phase or allocating the full region width', () => {
    const project = createProject(), pattern = project.patterns[0], region = project.regions[0];
    pattern.length = 1920; pattern.notes = [newNote(960, 67, 120)];
    region.start = 1920; region.length = 1920 * 501; region.offset = 501 * 1920 + 480; region.loop = true;
    const preview = regionDragPreview(region, pattern.length, null, 2400);
    expect(preview.region).toEqual({ ...region, start: 2400 });
    expect(preview.prepend).toBe(0);
    const view = { offset: 60000, width: 800, regionWidth: region.length * .1 };
    const geometry = regionPreviewGeometry(pattern, preview.region, view);
    const committed = structuredClone(project); committed.regions[0].start = 2400;
    const expected = flattenNotes(committed).filter(note => {
      const x = (note.absoluteTick - preview.region.start) * .1;
      return x + 12 > view.offset && x < view.offset + view.width;
    });
    expect(geometry.notes).toHaveLength(expected.length);
    expect(geometry.notes.length).toBeGreaterThan(0);
    expect(geometry.notes.every(note => note.x >= 0 && note.x + note.width <= view.width)).toBe(true);
  });
});
