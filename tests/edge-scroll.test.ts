import { describe, expect, it, vi } from 'vitest';
import { startHorizontalEdgeScroll } from '../src/ui/edge-scroll';

class InertRafWindow {
  private next = 0;
  pending = new Map<number, FrameRequestCallback>();
  archive = new Map<number, FrameRequestCallback>();
  requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = this.next++; this.pending.set(id, callback); this.archive.set(id, callback); return id;
  });
  cancelAnimationFrame = vi.fn((id: number) => { this.pending.delete(id); });
  frame(time: number): number {
    const entry = this.pending.entries().next().value;
    if (!entry) throw new Error('No queued frame');
    const [id, callback] = entry; this.pending.delete(id); callback(time); return id;
  }
  late(id: number, time: number) { this.archive.get(id)!(time); }
}
function fixture(options: { pointer?: number; left?: number; width?: number; scrollWidth?: number; scroll?: number; border?: number; rectWidth?: number; noView?: boolean; readback?: (value: number, previous: number) => number } = {}) {
  const view = new InertRafWindow(), dimensions = { left: options.left ?? 100, width: options.width ?? 200, scrollWidth: options.scrollWidth ?? 1000, border: options.border, rectWidth: options.rectWidth ?? options.width ?? 200 };
  let position = options.scroll ?? 400, active = true;
  const writes: number[] = [], onScroll = vi.fn(), isActive = vi.fn(() => active);
  const element = {
    ownerDocument: { defaultView: options.noView ? null : view },
    get clientWidth() { return dimensions.width; }, get clientLeft() { return dimensions.border; }, get scrollWidth() { return dimensions.scrollWidth; },
    get scrollLeft() { return position; },
    set scrollLeft(value: number) { writes.push(value); position = options.readback ? options.readback(value, position) : Math.max(0, Math.min(Math.max(0, dimensions.scrollWidth - dimensions.width), value)); },
    getBoundingClientRect: vi.fn(() => ({ left: dimensions.left, right: dimensions.left + dimensions.rectWidth, width: dimensions.rectWidth })),
  };
  const controller = startHorizontalEdgeScroll(element as unknown as HTMLElement, options.pointer ?? 300, { isActive, onScroll });
  return { view, dimensions, element, writes, onScroll, isActive, controller, position: () => position, setPosition: (value: number) => { position = value; }, setActive: (value: boolean) => { active = value; } };
}

describe('temporary horizontal edge scrolling', () => {
  it('waits for the first timestamp and then uses elapsed milliseconds at the maximum edge speed', () => {
    const state = fixture();
    expect(state.view.pending.size).toBe(1); expect(state.writes).toEqual([]);
    state.view.frame(100); expect(state.position()).toBe(400); expect(state.onScroll).not.toHaveBeenCalled();
    state.view.frame(116); expect(state.position()).toBeCloseTo(417.28, 10);
    state.view.frame(132); expect(state.position()).toBeCloseTo(434.56, 10);
    expect(state.onScroll).toHaveBeenCalledTimes(2); state.controller.stop();
  });

  it('produces the same displacement over equal elapsed time with different frame counts', () => {
    const frequent = fixture(), sparse = fixture();
    for (const time of [0, 10, 20, 30, 40]) frequent.view.frame(time);
    for (const time of [0, 40]) sparse.view.frame(time);
    expect(frequent.position()).toBeCloseTo(443.2, 10); expect(sparse.position()).toBeCloseTo(443.2, 10);
    frequent.controller.stop(); sparse.controller.stop();
  });

  it('limits a long pause to fifty milliseconds and resumes normal elapsed integration', () => {
    const state = fixture(); state.view.frame(0); state.view.frame(1000);
    expect(state.position()).toBe(454);
    state.view.frame(1010); expect(state.position()).toBeCloseTo(464.8, 10); state.controller.stop();
  });

  it('keeps time fresh while inside and does not charge interior time when entering or reentering an edge', () => {
    const state = fixture({ pointer: 200 }); state.view.frame(0); state.view.frame(500);
    expect(state.writes).toEqual([]);
    state.controller.move(300); state.view.frame(520); expect(state.position()).toBeCloseTo(421.6, 10);
    state.controller.move(200); state.view.frame(1000); expect(state.position()).toBeCloseTo(421.6, 10);
    state.controller.move(100); state.view.frame(1020); expect(state.position()).toBeCloseTo(400, 10);
    expect(state.onScroll).toHaveBeenCalledTimes(2); state.controller.stop();
  });

  it('uses the twenty-four-pixel band continuously and caps speed outside the viewport', () => {
    const state = fixture({ pointer: 276 }); state.view.frame(0); state.view.frame(20); expect(state.writes).toEqual([]);
    state.controller.move(288); state.view.frame(40); expect(state.position()).toBeCloseTo(410.8, 10);
    state.controller.move(1000); state.view.frame(60); expect(state.position()).toBeCloseTo(432.4, 10);
    state.controller.move(112); state.view.frame(80); expect(state.position()).toBeCloseTo(421.6, 10);
    state.controller.move(124); state.view.frame(100); expect(state.position()).toBeCloseTo(421.6, 10);
    expect(state.onScroll).toHaveBeenCalledTimes(3); state.controller.stop();
  });

  it('clamps both ends and stops writing or notifying when the browser is already at the edge', () => {
    const state = fixture({ scroll: 795 }); state.view.frame(0); state.view.frame(20);
    expect(state.position()).toBe(800); expect(state.onScroll).toHaveBeenCalledTimes(1);
    state.view.frame(40); expect(state.writes).toEqual([800]);
    state.controller.move(100); state.setPosition(3); state.view.frame(60);
    expect(state.position()).toBe(0); expect(state.onScroll).toHaveBeenCalledTimes(2);
    state.view.frame(80); expect(state.writes).toEqual([800, 0]); state.controller.stop();
  });

  it('does not scroll a non-overflowing element or clamp anything while the pointer is in the interior', () => {
    const narrow = fixture({ scroll: 0, scrollWidth: 100 }); narrow.view.frame(0); narrow.view.frame(20);
    expect(narrow.writes).toEqual([]); expect(narrow.onScroll).not.toHaveBeenCalled(); narrow.controller.stop();
    const interior = fixture({ pointer: 200, scrollWidth: 100, scroll: 55 }); interior.view.frame(0); interior.view.frame(20);
    expect(interior.position()).toBe(55); expect(interior.writes).toEqual([]); interior.controller.stop();
  });

  it('uses actual scroll readback, so ignored assignments never call onScroll', () => {
    const state = fixture({ readback: (_value, previous) => previous }); state.view.frame(0); state.view.frame(20); state.view.frame(40);
    expect(state.writes).toHaveLength(2); expect(state.position()).toBe(400); expect(state.onScroll).not.toHaveBeenCalled(); state.controller.stop();
  });

  it('notifies only after the actual rounded browser position has changed', () => {
    const state = fixture({ readback: value => Math.round(value) }), observed: number[] = [];
    state.onScroll.mockImplementation(() => { observed.push(state.position()); });
    state.view.frame(0); state.view.frame(16);
    expect(state.writes[0]).toBeCloseTo(417.28, 10); expect(observed).toEqual([417]); state.controller.stop();
  });

  it('checks activity before geometry or scrolling, including synchronous cancellation from isActive', () => {
    const inactive = fixture(); inactive.setActive(false); inactive.view.frame(0);
    expect(inactive.element.getBoundingClientRect).not.toHaveBeenCalled(); expect(inactive.writes).toEqual([]); expect(inactive.view.pending.size).toBe(0);
    const cancelled = fixture(); cancelled.view.frame(0);
    cancelled.isActive.mockImplementation(() => { cancelled.controller.stop(); return true; }); cancelled.view.frame(20);
    expect(cancelled.element.getBoundingClientRect).not.toHaveBeenCalled(); expect(cancelled.writes).toEqual([]); expect(cancelled.view.pending.size).toBe(0);
  });

  it('stops when an active gesture becomes invalid between frames', () => {
    const state = fixture(); state.view.frame(0); state.setActive(false); state.view.frame(20);
    expect(state.writes).toEqual([]); expect(state.onScroll).not.toHaveBeenCalled(); expect(state.view.pending.size).toBe(0);
  });

  it('makes stop idempotent even for RAF id zero and ignores a cancelled late frame', () => {
    const state = fixture(); state.controller.stop(); state.controller.stop();
    expect(state.view.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(0);
    state.controller.move(100); state.view.late(0, 1000);
    expect(state.isActive).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); expect(state.view.pending.size).toBe(0);
  });

  it('never schedules another frame if onScroll synchronously stops its controller', () => {
    const state = fixture(); state.onScroll.mockImplementation(() => state.controller.stop());
    state.view.frame(0); const last = state.view.frame(20);
    expect(state.onScroll).toHaveBeenCalledTimes(1); expect(state.view.pending.size).toBe(0);
    const position = state.position(); state.view.late(last, 40);
    expect(state.position()).toBe(position); expect(state.onScroll).toHaveBeenCalledTimes(1);
    expect(state.view.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('reads new bounds and scroll dimensions on each frame, including a zero-width resize', () => {
    const state = fixture(); state.view.frame(0); state.dimensions.left = 200; state.view.frame(20);
    expect(state.writes).toEqual([]); // The old right edge is now the center.
    state.dimensions.width = 100; state.view.frame(40); expect(state.position()).toBeCloseTo(421.6, 10);
    state.dimensions.scrollWidth = 110; state.view.frame(60); expect(state.position()).toBe(10);
    state.dimensions.width = 0; state.view.frame(80); expect(state.position()).toBe(10);
    state.dimensions.width = 100; state.controller.move(200); state.view.frame(100); expect(state.position()).toBe(0);
    expect(state.onScroll).toHaveBeenCalledTimes(3); state.controller.stop();
  });

  it('uses clientLeft and clientWidth rather than the outer border and vertical-scrollbar rectangle', () => {
    const state = fixture({ left: 100, border: 1, width: 212, rectWidth: 230, scrollWidth: 1212, pointer: 301 });
    state.view.frame(0); state.view.frame(20); expect(state.position()).toBeCloseTo(410.8, 10); // client right=313; 12px inside.
    state.controller.move(113); state.view.frame(40); expect(state.position()).toBeCloseTo(400, 10); // client left=101.
    state.controller.stop();
  });

  it('assigns overlapping tiny edge bands symmetrically with a stationary midpoint', () => {
    const state = fixture({ width: 40, pointer: 120 }); state.view.frame(0); state.view.frame(20); expect(state.writes).toEqual([]);
    state.controller.move(110); state.view.frame(40); expect(state.position()).toBeCloseTo(389.2, 10);
    state.controller.move(130); state.view.frame(60); expect(state.position()).toBeCloseTo(400, 10);
    state.controller.move(120); state.view.frame(80); expect(state.position()).toBeCloseTo(400, 10);
    expect(state.onScroll).toHaveBeenCalledTimes(2); state.controller.stop();
  });

  it.each([NaN, Infinity, -Infinity])('ignores invalid pointer coordinate %s without accumulating elapsed time', pointer => {
    const state = fixture({ pointer }); state.view.frame(0); state.view.frame(500); expect(state.writes).toEqual([]);
    state.controller.move(300); state.view.frame(520); expect(state.position()).toBeCloseTo(421.6, 10); state.controller.stop();
  });

  it('does not integrate a backwards or nonfinite clock sample', () => {
    const state = fixture(); state.view.frame(0); state.view.frame(-20); expect(state.writes).toEqual([]);
    state.view.frame(NaN); state.view.frame(20); expect(state.writes).toEqual([]);
    state.view.frame(40); expect(state.position()).toBeCloseTo(421.6, 10); state.controller.stop();
  });

  it('is an inert no-op without an owning window and never uses a global RAF', () => {
    const state = fixture({ noView: true }); state.controller.move(100); state.controller.stop(); state.controller.stop();
    expect(state.view.requestAnimationFrame).not.toHaveBeenCalled(); expect(state.isActive).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]); expect(state.onScroll).not.toHaveBeenCalled();
  });
});
