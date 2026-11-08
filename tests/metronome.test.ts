import { describe, expect, it } from 'vitest';
import { nextMetronomeClick } from '../src/audio/metronome';
import { createMeterMap } from '../src/core/meter';
import { commandForShortcut, inspectShortcuts } from '../src/core/shortcuts';
import { createTempoMap } from '../src/core/time';

const project = {
  ppq: 480,
  tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 1080, numerator: 3, denominator: 8 }],
};
const meter = createMeterMap(project);
const clock = { timing: createTempoMap(project), startedAt: 0, from: 0, endTick: 2520, loop: false };

describe('playback metronome', () => {
  it('plays the correct beat after a seek and accents new measures across tempo and meter changes', () => {
    const click = (from: number) => nextMetronomeClick(meter, clock, from);
    expect(click(0)).toEqual({ at: 0, accent: true });
    expect(click(.1)).toEqual({ at: .5, accent: false });
    expect(click(.9)).toEqual({ at: 1, accent: false });
    expect(click(1.01)).toEqual({ at: 1.25, accent: true });
    expect(click(1.26)).toEqual({ at: 1.75, accent: false });
    expect(click(2.26)).toEqual({ at: 2.75, accent: true });
    expect(click(4.25)).toBeUndefined();
  });

  it('wraps a cycle without inventing a beat at a mid-beat locator or repeating its exclusive end', () => {
    const cycle = { ...clock, loop: true, startTick: 120, endTick: 960 };
    expect(nextMetronomeClick(meter, cycle, .125)).toEqual({ at: .5, accent: false });
    expect(nextMetronomeClick(meter, cycle, .99)).toEqual({ at: 1.375, accent: false });
    expect(nextMetronomeClick(meter, cycle, 1.38)).toEqual({ at: 2.25, accent: false });
    expect(nextMetronomeClick(meter, { ...cycle, endTick: 240 }, .125)).toBeUndefined();
    const downbeatCycle = { ...cycle, startTick: 1080, endTick: 1800 };
    expect(nextMetronomeClick(meter, downbeatCycle, 2.5)).toEqual({ at: 2.75, accent: true });
  });

  it('uses K in the Logic preset and honors an existing custom assignment', () => {
    const defaults = inspectShortcuts('logic', {}, 'darwin');
    expect(commandForShortcut('K', defaults.effective, 'darwin')).toBe('metronome');
    const customized = inspectShortcuts('logic', { draw: 'K' }, 'darwin');
    expect(customized.issues).toEqual([]);
    expect(commandForShortcut('K', customized.effective, 'darwin')).toBe('draw');
  });
});
