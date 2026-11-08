import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import { assertPlaybackLoopPeriod, cycleSeekTick, transportPosition, validateCycleRange } from '../src/core/transport';

describe('cycle locators on the project clock', () => {
  it('rejects accidental sub-millisecond loops before they can pile up sample tails',()=>{
    expect(()=>assertPlaybackLoopPeriod(.00052)).toThrow('50');
    expect(()=>assertPlaybackLoopPeriod(.05)).not.toThrow();
    expect(()=>assertPlaybackLoopPeriod(2)).not.toThrow();
  });
  it('wraps a nonzero left locator through a changing tempo map and retains monotonic recording ticks', () => {
    const project = createProject(); project.ppq = 100;
    project.tempos = [{ tick: 0, bpm: 60 }, { tick: 200, bpm: 120 }];
    const timing = createTempoMap(project), clock = { timing, startedAt: 10, from: 1, startTick: 100, endTick: 400, loop: true };
    expect(transportPosition(clock, 9)).toEqual({ tick: 100, linearTick: 100, seconds: 1 });
    expect(transportPosition(clock, 12)).toEqual({ tick: 100, linearTick: 400, seconds: 3 });
    expect(transportPosition(clock, 12.5)).toEqual({ tick: 150, linearTick: 450, seconds: 3.5 });
  });
  it('uses an exclusive right locator and moves out-of-range seeks to the left locator', () => {
    const cycle = { start: 100, end: 400 };
    expect(cycleSeekTick(250, cycle)).toBe(250);
    expect(cycleSeekTick(400, cycle)).toBe(100);
    expect(cycleSeekTick(0, cycle)).toBe(100);
    expect(cycleSeekTick(1000, cycle)).toBe(100);
  });
  it.each([{ start: -1, end: 2 }, { start: 10, end: 10 }, { start: 20, end: 10 }, { start: 0, end: Infinity }])('rejects invalid locators %j', range => {
    expect(() => validateCycleRange(range)).toThrow('循环范围无效');
  });
});
