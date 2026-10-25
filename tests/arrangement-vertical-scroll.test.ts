import { describe, expect, it, vi } from 'vitest';
import { startVerticalEdgeScroll } from '../src/ui/edge-scroll';

function fixture(pointer = 300) {
  const frames = new Map<number, FrameRequestCallback>(), callbacks = new Map<number, FrameRequestCallback>();
  let id = 0, active = true, position = 104;
  const bounds = { top: 100, height: 200, scrollHeight: 800 };
  const view = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); callbacks.set(id, callback); return id; },
    cancelAnimationFrame: (value: number) => frames.delete(value),
  };
  const writes: number[] = [], onScroll = vi.fn();
  const element = {
    ownerDocument: { defaultView: view }, clientTop: 0,
    get clientHeight() { return bounds.height; }, get scrollHeight() { return bounds.scrollHeight; },
    get scrollTop() { return position; }, set scrollTop(value: number) { writes.push(value); position = Math.max(0, Math.min(bounds.scrollHeight - bounds.height, value)); },
    getBoundingClientRect: () => ({ top: bounds.top }),
  };
  const controller = startVerticalEdgeScroll(element as unknown as HTMLElement, pointer, { isActive: () => active, onScroll });
  const frame = (time: number) => { for (const [key, callback] of [...frames]) if (frames.delete(key)) callback(time); };
  return { controller, element, bounds, frames, callbacks, writes, onScroll, frame, active: (value: boolean) => { active = value; } };
}

describe('arrangement vertical edge scrolling', () => {
  it('moves down by elapsed time, caps long frames and reads back real scroll before notifying', () => {
    const state = fixture(); state.frame(0); expect(state.element.scrollTop).toBe(104);
    state.frame(100); expect(state.element.scrollTop).toBe(143); expect(state.onScroll).toHaveBeenCalledOnce();
    state.frame(116); expect(state.element.scrollTop).toBeCloseTo(155.48, 8);
    state.controller.stop(); expect(state.frames.size).toBe(0);
  });

  it('excludes the sticky ruler from the top edge and stops when the pointer returns to the center', () => {
    const state = fixture(126); state.frame(0); state.frame(50);
    expect(state.element.scrollTop).toBe(65);
    state.controller.move(213); state.frame(100); expect(state.element.scrollTop).toBe(65);
    state.controller.move(138); state.frame(150); expect(state.element.scrollTop).toBe(45.5);
    state.controller.stop();
  });

  it('clamps both ends without producing repeated updates at the boundary', () => {
    const state = fixture(); state.frame(0);
    for (let time = 50; time <= 1000; time += 50) state.frame(time);
    expect(state.element.scrollTop).toBe(600);
    const calls = state.onScroll.mock.calls.length; state.frame(1050); expect(state.onScroll).toHaveBeenCalledTimes(calls);
    state.controller.move(100); for (let time = 1100; time <= 2100; time += 50) state.frame(time);
    expect(state.element.scrollTop).toBe(0); expect(state.writes.every(value => value >= 0 && value <= 600)).toBe(true);
    state.controller.stop();
  });

  it('uses current viewport geometry after resize or relocation', () => {
    const state = fixture(290); state.frame(0);
    state.bounds.top = 200; state.frame(50); expect(state.element.scrollTop).toBe(104);
    state.bounds.height = 90; state.frame(100); expect(state.element.scrollTop).toBe(143);
    state.controller.stop();
  });

  it('tears down on invalid ownership and ignores saved late callbacks', () => {
    const state = fixture(), late = [...state.callbacks.values()][0]; state.frame(0);
    state.active(false); state.frame(50); expect(state.frames.size).toBe(0); expect(state.writes).toEqual([]);
    late(100); expect(state.frames.size).toBe(0); expect(state.writes).toEqual([]);
    state.controller.stop(); state.controller.move(0); expect(state.frames.size).toBe(0);
  });

  it('does not scroll nonfinite coordinates or a viewport covered by its ruler', () => {
    for (const pointer of [NaN, Infinity, -Infinity]) {
      const state = fixture(pointer); state.frame(0); state.frame(50); expect(state.writes).toEqual([]); state.controller.stop();
    }
    const state = fixture(); state.bounds.height = 26; state.frame(0); state.frame(50); expect(state.writes).toEqual([]); state.controller.stop();
  });
});
