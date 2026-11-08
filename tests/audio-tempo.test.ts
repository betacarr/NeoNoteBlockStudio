import { describe, expect, it } from 'vitest';
import { planAudioTempo, visibleFirstBeat } from '../src/core/audio-tempo';
import { createProject, newNote } from '../src/core/project';
import { createTempoMap } from '../src/core/time';

const clip = { id: 'audio', offsetSeconds: 0, durationSeconds: 5.25,
  tempoAnalysis: { bpm: 96, firstBeatSeconds: .25, confidence: .85 } };

describe('smart audio tempo', () => {
  it('adopts source tempo in a new project with an empty MIDI region and retains the pickup', () => {
    const project = createProject();
    const plan = planAudioTempo(project, 0, clip, 'auto');
    expect(plan.tempos).toEqual([{ tick: 0, bpm: 96 }]);
    expect(plan.anchor).toBe(project.ppq * 4);
    const time = createTempoMap({ ...project, tempos: plan.tempos! });
    expect(time.seconds(plan.start) + .25).toBeCloseTo(time.seconds(plan.anchor!), 8);
    expect(clip.offsetSeconds).toBe(0);
  });

  it('keeps a tempo reference in Automatic mode while aligning the first beat', () => {
    const project = createProject();
    project.patterns[0].notes.push(newNote(0, 60, 480));
    const plan = planAudioTempo(project, 0, clip, 'auto');
    expect(plan.tempos).toBeUndefined();
    expect(plan.anchor).toBe(3840);
    expect(plan.start).toBeCloseTo(3360, 8);
    expect(planAudioTempo(createProject(), 0, clip, 'auto', true)).toEqual(plan);
  });

  it('adapts the local range and restores the original tempo after it', () => {
    const project = createProject(), at = 3840;
    project.tempos = [{ tick: 0, bpm: 120 }, { tick: 4800, bpm: 126 }, { tick: 14400, bpm: 150 }];
    const plan = planAudioTempo(project, at, clip, 'adapt');
    expect(plan.tempos).toEqual([{ tick: 0, bpm: 120 }, { tick: at, bpm: 96 }, { tick: 11520, bpm: 126 }, { tick: 14400, bpm: 150 }]);
    const timing = createTempoMap({ ...project, tempos: plan.tempos! });
    expect(timing.seconds(plan.start) + .25).toBeCloseTo(timing.seconds(at), 8);
    expect(timing.seconds(at + project.ppq * 4) - timing.seconds(at)).toBeCloseTo(2.5, 8);
    expect(planAudioTempo(project, at, clip, 'auto').tempos).toBeUndefined();
  });

  it('uses the next visible beat on a trimmed clip and leaves unmeasurable audio in place', () => {
    expect(visibleFirstBeat({ ...clip, offsetSeconds: .8 })).toBeCloseTo(.075, 8);
    expect(visibleFirstBeat({ ...clip, offsetSeconds: .8, durationSeconds: .05 })).toBeUndefined();
    expect(planAudioTempo(createProject(), 293, { ...clip, tempoAnalysis: undefined }, 'adapt')).toEqual({ start: 293 });
  });

  it('keeps an unstable estimate visible without automatically rewriting the tempo map', () => {
    const project = createProject();
    const changing = { ...clip, tempoAnalysis: { ...clip.tempoAnalysis, method: 'beat-this' as const, stable: false, downbeat: true } };
    const plan = planAudioTempo(project, 0, changing, 'adapt');
    expect(plan.anchor).toBe(3840);
    expect(plan.tempos).toBeUndefined();
    expect(planAudioTempo(project, 0, changing, 'adapt', false, true).tempos).toEqual([{ tick: 0, bpm: 96 }]);
    expect(visibleFirstBeat({ ...changing, offsetSeconds: .6 })).toBeUndefined();
  });
});
