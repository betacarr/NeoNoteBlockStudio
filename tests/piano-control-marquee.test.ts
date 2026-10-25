import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { clamp, createProject, newNote } from '../src/core/project';
import { noteName } from '../src/core/instruments';
import { createMeterMap } from '../src/core/meter';
import { constrainNoteMovement, dragNotes, dragPlacedNote, noteResizeHandleWidth, planRegionTrim, regionSourceRanges } from '../src/core/editor-interaction';
import { noteAt, notesAlongStroke } from '../src/ui/piano-hit-test';
import { clampPianoZoom, planPianoView, planPianoRowZoom } from '../src/ui/piano-view';
import { PianoNoteIndex } from '../src/ui/piano-note-index';
import { previewPianoNotes } from '../src/ui/piano-preview';
import { velocityBounds, constrainVelocityDelta, changeNoteVelocities } from '../src/core/note-velocity';

// Reuse the existing inert hooks/refs harness, without importing its test cases.
// It compiles the current real component and runs its callbacks/ResizeObserver;
// these checks are not browser or physical pointer/keyboard input.
const component = readFileSync(new URL('../src/ui/PianoRoll.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const constants = component.indexOf('const KEYBOARD =');
if (constants < 0) throw new Error('PianoRoll component constants were not found');
const componentCode = transformSync(component.slice(constants).replace('export function PianoRoll(', 'function PianoRoll('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
const existingHarness = readFileSync(new URL('./piano-gestures.test.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = existingHarness.indexOf('function pianoFixture('), end = existingHarness.indexOf('\ndescribe(', start);
if (start < 0 || end < 0) throw new Error('PianoRoll callback harness boundaries were not found');
const harnessCode = transformSync(existingHarness.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
const dependencies = { componentCode, clamp, createProject, newNote, noteName, createMeterMap, constrainNoteMovement, dragNotes, dragPlacedNote, noteResizeHandleWidth, planRegionTrim, regionSourceRanges, noteAt, notesAlongStroke, clampPianoZoom, planPianoView, planPianoRowZoom, PianoNoteIndex, previewPianoNotes, velocityBounds, constrainVelocityDelta, changeNoteVelocities, expect, vi };
const pianoFixture = Function(...Object.keys(dependencies), `${harnessCode}\nreturn pianoFixture;`)(...Object.values(dependencies));

type Point = { x: number; y: number };
function marqueePoints(state: any, origin: 'body' | 'edge' | 'blank'): { from: Point; to: Point } {
  const r = state.rect('a');
  return origin === 'blank'
    ? { from: { x: r.x - 10, y: r.y - 4 }, to: { x: r.x + r.width + 8, y: r.y + r.height + 1 } }
    : { from: origin === 'edge' ? { x: r.x + r.width - 1, y: r.y + r.height / 2 } : state.point('a'), to: { x: r.x + r.width + 8, y: r.y + r.height / 2 + 2 } };
}
function noProjectEdit(state: any) {
  expect(state.onEdit).not.toHaveBeenCalled();
  expect(state.props().onTrimRegion).not.toHaveBeenCalled();
  expect(state.props().pattern.notes).toEqual(state.originalNotes);
}

describe('PianoRoll Ctrl/Cmd marquee callbacks (no physical input)', () => {
  for (const preset of ['fl', 'logic', 'nbs'] as const) {
    it.each(['body', 'edge', 'blank'] as const)(`${preset}: Ctrl drag from %s replaces selection without drawing, moving or resizing`, origin => {
      const state = pianoFixture(); state.update({ preset });
      const { from, to } = marqueePoints(state, origin);
      state.dispatch('onPointerDown', state.at(from, { ctrlKey: true }));
      expect(state.props().selected.size).toBe(0);
      state.dispatch('onPointerMove', state.at(to, { ctrlKey: true }));
      noProjectEdit(state);
      state.dispatch('onPointerUp', state.at(to, { ctrlKey: true }));
      expect([...state.props().selected]).toEqual(['a']);
      expect(state.props().onAudition).not.toHaveBeenCalled();
      noProjectEdit(state);
    });
  }

  it.each([{ ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }, { shiftKey: true }])('Shift makes modifier marquee additive: %j', modifiers => {
    const state = pianoFixture(), { from, to } = marqueePoints(state, 'edge');
    state.dispatch('onPointerDown', state.at(from, modifiers));
    state.dispatch('onPointerMove', state.at(to, modifiers));
    state.dispatch('onPointerUp', state.at(to, modifiers));
    expect(new Set(state.props().selected)).toEqual(new Set(['a', 'b']));
    noProjectEdit(state);
  });

  it('Cmd also replaces selection and modifier marquee takes priority over the eraser tool', () => {
    const state = pianoFixture(); state.update({ tool: 'erase' });
    const { from, to } = marqueePoints(state, 'body');
    state.dispatch('onPointerDown', state.at(from, { metaKey: true }));
    state.dispatch('onPointerMove', state.at(to, { metaKey: true }));
    state.dispatch('onPointerUp', state.at(to, { metaKey: true }));
    expect([...state.props().selected]).toEqual(['a']); noProjectEdit(state);
  });

  it.each(['Escape', 'onPointerCancel', 'onLostPointerCapture', 'onBlur'])('%s cancels Ctrl marquee and restores the old selection', cancel => {
    const state = pianoFixture(), { from, to } = marqueePoints(state, 'blank');
    state.dispatch('onPointerDown', state.at(from, { ctrlKey: true }));
    state.dispatch('onPointerMove', state.at(to, { ctrlKey: true }));
    expect(state.props().selected.size).toBe(0);
    state.dispatch(cancel === 'Escape' ? 'onKeyDown' : cancel, state.at(to, { key: 'Escape', code: 'Escape' }));
    expect([...state.props().selected]).toEqual(['b']);
    expect(state.captures.size).toBe(0); expect(state.frames.size).toBe(0);
    state.dispatch('onPointerUp', state.at(to, { ctrlKey: true }));
    noProjectEdit(state);
  });

  it('Ctrl wheel still zooms, cancelling the pending marquee without committing it', () => {
    const state = pianoFixture(), { from, to } = marqueePoints(state, 'body'), zoom = state.props().zoom;
    state.dispatch('onPointerDown', state.at(from, { ctrlKey: true }));
    state.dispatch('onPointerMove', state.at(to, { ctrlKey: true }));
    state.wheelZoom(from.x, -120);
    expect(state.props().zoom).toBeGreaterThan(zoom);
    expect([...state.props().selected]).toEqual(['b']); expect(state.captures.size).toBe(0);
    state.dispatch('onPointerUp', state.at(to, { ctrlKey: true })); noProjectEdit(state);
  });

  it('Ctrl on the ruler still seeks and on the keyboard still auditions', () => {
    const state = pianoFixture(), p = state.point();
    state.dispatch('onPointerDown', state.event(p.x, 12, { ctrlKey: true }));
    state.dispatch('onPointerMove', state.event(p.x + 24, 12, { ctrlKey: true }));
    state.dispatch('onPointerUp', state.event(p.x + 24, 12, { ctrlKey: true }));
    expect(state.props().onSeek).toHaveBeenCalled();
    state.dispatch('onPointerDown', state.event(30, p.y, { ctrlKey: true }));
    state.dispatch('onPointerUp', state.event(30, p.y, { ctrlKey: true }));
    expect(state.props().onAudition).toHaveBeenCalledOnce();
    expect(state.onSelect).not.toHaveBeenCalled(); noProjectEdit(state);
  });

  it('Ctrl in the velocity lane still changes velocity once on release', () => {
    const state = pianoFixture();
    state.dispatch('onPointerDown', state.at(state.velocityPoint(.5), { ctrlKey: true }));
    state.dispatch('onPointerMove', state.at(state.velocityPoint(.75), { ctrlKey: true }));
    expect(state.onEdit).not.toHaveBeenCalled();
    state.dispatch('onPointerUp', state.at(state.velocityPoint(.75), { ctrlKey: true }));
    expect(state.onEdit).toHaveBeenCalledOnce();
    expect(state.props().pattern.notes).toEqual([{ ...state.originalNotes[0], velocity: .75 }, state.originalNotes[1]]);
  });

  it('Ctrl marquee uses the painted one-pixel height when fit rows are subpixel', () => {
    const notes = Array.from({ length: 128 }, (_, midi) => ({ ...newNote(0, midi, 1000), id: `pitch-${midi}` }));
    const state = pianoFixture({ notes, selected: [], paint: true, size: { width: 800, height: 180 } });
    state.update({ viewRequest: { id: 1, mode: 'all' } });
    expect(state.view().row).toBeLessThan(1); expect(state.rect('pitch-119').height).toBe(1);
    const contact = { x: 100, y: state.rect('pitch-119').y + .93 };
    const painted = state.lastPaint().filter((command: any) => command.kind === 'body'); expect(painted).toHaveLength(128);
    state.dispatch('onPointerDown', state.at(contact, { ctrlKey: true })); state.dispatch('onPointerUp', state.at(contact, { ctrlKey: true }));
    expect([...state.props().selected]).toEqual(['pitch-117', 'pitch-118', 'pitch-119']); noProjectEdit(state);
  });

  it('Ctrl does not override region trim, middle-button pan or right-button erase', () => {
    const state = pianoFixture(), r = state.props().region, end = state.gridPoint(r.offset + r.length, 84), step = 240 * state.view().scale;
    state.dispatch('onPointerDown', state.event(end.x - 3, 34, { ctrlKey: true }));
    state.dispatch('onPointerMove', state.event(end.x - 3 + step, 34, { ctrlKey: true }));
    state.dispatch('onPointerUp', state.event(end.x - 3 + step, 34, { ctrlKey: true }));
    expect(state.props().onTrimRegion).toHaveBeenCalledWith(r.id, 'end', r.start + r.length + 240);
    const p = state.point();
    state.dispatch('onPointerDown', state.at(p, { ctrlKey: true, button: 1 }));
    state.dispatch('onPointerMove', state.at({ x: p.x - 24, y: p.y }, { ctrlKey: true, button: 1 }));
    state.dispatch('onPointerUp', state.at({ x: p.x - 24, y: p.y }, { ctrlKey: true, button: 1 }));
    expect(state.onSelect).not.toHaveBeenCalled(); expect(state.onEdit).not.toHaveBeenCalled();
    state.dispatch('onPointerDown', state.at(state.point(), { ctrlKey: true, button: 2 }));
    state.dispatch('onPointerUp', state.at(state.point(), { ctrlKey: true, button: 2 }));
    expect(state.onEdit).toHaveBeenCalledOnce(); expect(state.onEdit.mock.calls[0][0]).toBe('擦除音符');
  });
});
