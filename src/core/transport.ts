import type { TempoMap } from './time';

export interface CycleRange { start: number; end: number }
/** This transport repeats complete sample tails, rather than granular synthesis. */
export const MIN_PLAYBACK_LOOP_SECONDS = .05;
export function assertPlaybackLoopPeriod(seconds:number):void {
  if(!Number.isFinite(seconds)||seconds<MIN_PLAYBACK_LOOP_SECONDS-1e-9)throw new Error('循环范围不足 50 毫秒，已停止以避免高频重复和尾音堆叠；请重新拖出循环范围。');
}
/** Locators use project ticks; the right locator is exclusive. */
export function validateCycleRange(range: CycleRange): CycleRange {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > 1e12 || range.end <= range.start) throw new Error('循环范围无效：终点必须晚于起点。');
  return { start: range.start, end: range.end };
}
export const cycleSeekTick = (tick: number, range: CycleRange): number => tick >= range.start && tick < range.end ? tick : range.start;
export interface TransportClock { timing: TempoMap; startedAt: number; from: number; endTick: number; loop: boolean; startTick?: number }
export interface TransportPosition { tick: number; linearTick: number; seconds: number }
export function transportPosition(clock: TransportClock, contextTime: number): TransportPosition {
  const seconds = Math.max(clock.from, contextTime - clock.startedAt + clock.from), startTick = clock.startTick ?? 0;
  const start = clock.timing.seconds(startTick), period = clock.timing.seconds(clock.endTick) - start;
  const elapsed = Math.max(0, seconds - start), cycles = clock.loop && period > 0 ? Math.floor(elapsed / period) : 0;
  const tick = clock.timing.tick(clock.loop && period > 0 ? start + elapsed % period : seconds);
  return { tick, linearTick: cycles * (clock.endTick - startTick) + tick, seconds };
}
