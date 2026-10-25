import type { TempoMap } from './time';

export interface TransportClock { timing: TempoMap; startedAt: number; from: number; endTick: number; loop: boolean }
export interface TransportPosition { tick: number; linearTick: number; seconds: number }
export function transportPosition(clock: TransportClock, contextTime: number): TransportPosition {
  const seconds = Math.max(clock.from, contextTime - clock.startedAt + clock.from), period = clock.timing.seconds(clock.endTick);
  const cycles = clock.loop && period > 0 ? Math.floor(seconds / period) : 0;
  const tick = clock.timing.tick(clock.loop && period > 0 ? seconds % period : seconds);
  return { tick, linearTick: cycles * clock.endTick + tick, seconds };
}
