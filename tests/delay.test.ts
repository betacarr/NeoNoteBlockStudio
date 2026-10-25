import { describe, expect, it } from 'vitest';
import { createDefaultDelay, delayEnvelope, expandDelayEvents, validateDelayEffect } from '../src/core/delay';
import { createProject, flattenNotes, newNote, projectDiagnostics, projectEnd, renderNoteEvents, validateProject } from '../src/core/project';
import { openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi, importMidi, originalMidi } from '../src/core/midi';
import { expressionFixture } from './fixtures/midi';
import type { DelayEffect } from '../src/core/types';

function fixture(settings: Partial<DelayEffect> = {}) {
  const project = createProject();
  project.patterns[0].notes = [{ ...newNote(0, 66, 1920), id: 'dry-note', velocity: .8 }];
  project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, ...settings };
  return project;
}
const echoes = (project: ReturnType<typeof fixture>) => renderNoteEvents(project).notes.filter(note => note.delaySource);

describe('Delay settings and project compatibility', () => {
  it('creates independent disabled defaults and accepts all documented bounds', () => {
    const first = createDefaultDelay(), second = createDefaultDelay();
    expect(first).toEqual({ enabled: false, mode: 'gate', timeUnit: 'beats', interval: .5, feedback: .5, wet: .5, panAmount: 0,
      attack: 0, decay: .25, sustain: .7, release: .5, releaseOffset: 0, tail: 4 });
    first.enabled = true; expect(second.enabled).toBe(false);
    expect(validateDelayEffect(second)).toBe(true);
    expect(validateDelayEffect({ ...second, interval: 1 / 128, attack: 256, decay: 256, release: 256, releaseOffset: -256, tail: 256, feedback: 1, wet: 0, sustain: 0 })).toBe(true);
    expect(validateDelayEffect({ ...second, timeUnit: 'seconds', interval: .001, releaseOffset: 256 })).toBe(true);
  });

  it.each([
    null, [], {}, { enabled: 1 }, { mode: 'free' }, { timeUnit: 'ticks' }, { interval: 0 }, { interval: 257 },
    { interval: .007 }, { timeUnit: 'seconds', interval: .0009 }, { feedback: -1 }, { wet: 1.01 },
    { sustain: Infinity }, { attack: NaN }, { decay: -1 }, { release: 257 }, { releaseOffset: -257 }, { tail: -1 },
  ])('rejects incomplete, nonfinite or out-of-range settings: %j', patch => {
    const value = patch && !Array.isArray(patch) && Object.keys(patch).length ? { ...createDefaultDelay(), ...patch } : patch;
    expect(validateDelayEffect(value)).toBe(false);
    const project = fixture(); project.tracks[0].delay = value as DelayEffect;
    expect(() => validateProject(project)).toThrow('Delay');
  });

  it('round-trips old projects without adding Delay and saves settings without baking echoes', () => {
    const old = createProject(), openedOld = openNbsx(saveNbsx(old));
    expect(openedOld.tracks[0]).not.toHaveProperty('delay');
    expect(validateProject(openedOld)).toBe(openedOld);
    const project = fixture({ mode: 'tail', tail: 2 }), before = structuredClone(project);
    const opened = openNbsx(saveNbsx(project));
    expect(opened.tracks[0].delay).toEqual(project.tracks[0].delay);
    expect(opened.patterns[0].notes).toEqual(project.patterns[0].notes);
    expect(opened.patterns[0].notes).toHaveLength(1);
    expect(echoes(opened)).toHaveLength(4);
    expect(project).toEqual(before);
  });
});

describe('Delay alternating pan relative to each dry occurrence', () => {
  it('accepts legacy missing pan and both endpoints, including a disabled effect', () => {
    const effect = createDefaultDelay(); delete effect.panAmount;
    expect(validateDelayEffect(effect)).toBe(true);
    expect(validateDelayEffect({ ...effect, panAmount: 0 })).toBe(true);
    expect(validateDelayEffect({ ...effect, panAmount: 1 })).toBe(true);
  });

  it.each([null, '0.5', NaN, Infinity, -Number.MIN_VALUE, 1.000001])('rejects invalid pan %j even while disabled', panAmount => {
    const effect = { ...createDefaultDelay(), enabled: false, panAmount };
    expect(validateDelayEffect(effect)).toBe(false);
    const project = fixture(); project.tracks[0].delay = effect as DelayEffect;
    expect(() => validateProject(project)).toThrow('Delay'); expect(() => renderNoteEvents(project)).toThrow('Delay');
  });

  it.each([
    ['gate', 'beats'], ['gate', 'seconds'], ['tail', 'beats'], ['tail', 'seconds'],
  ] as const)('alternates left first for %s / %s without changing raw pan or event times', (mode, timeUnit) => {
    const project = fixture({ mode, timeUnit, panAmount: .5, interval: .5, tail: 1.5, attack: 0, decay: 0, sustain: 1, release: 0 });
    project.patterns[0].notes[0].duration = timeUnit === 'beats' ? 1920 : 3840;
    project.patterns[0].notes[0].pan = .125; project.tracks[0].pan = .125;
    const taps = echoes(project);
    expect(taps.map(note => note.effectivePan)).toEqual([-.25, .75, -.25]);
    expect(taps.map(note => note.absoluteTick)).toEqual(timeUnit === 'beats' ? [480, 960, 1440] : [960, 1920, 2880]);
    expect(taps.map(note => note.pan)).toEqual([.125, .125, .125]);
    expect(taps.map(note => note.delaySource!.tap)).toEqual([1, 2, 3]);
  });

  it.each([
    [.75, .75, [.5, 1, .5]], [-.75, -.75, [-1, -.5, -1]],
  ] as const)('adds the amount to the already clamped note %s + track %s pan', (notePan, trackPan, expected) => {
    const project = fixture({ mode: 'tail', panAmount: .5, tail: 1.5 });
    project.patterns[0].notes[0].pan = notePan; project.tracks[0].pan = trackPan;
    expect(echoes(project).map(note => note.effectivePan)).toEqual(expected);
  });

  it('restarts from the left for every source note and each loop occurrence', () => {
    const project = fixture({ mode: 'tail', panAmount: .5, interval: .5, tail: 1 });
    project.patterns[0].length = 960; project.regions[0].length = 1920; project.regions[0].loop = true;
    project.patterns[0].notes[0].pan = .25;
    project.patterns[0].notes.push({ ...newNote(240, 70), id: 'second-note', pan: -.25 });
    expect(echoes(project).map(note => [note.absoluteTick, note.delaySource!.occurrenceTick, note.delaySource!.tap, note.effectivePan])).toEqual([
      [480, 0, 1, -.25], [720, 240, 1, -.75], [960, 0, 2, .75], [1200, 240, 2, .25],
      [1440, 960, 1, -.25], [1680, 1200, 1, -.75], [1920, 960, 2, .75], [2160, 1200, 2, .25],
    ]);
  });

  it('keeps original tap parity when the attack-weighted first tap is numerically silent', () => {
    // With the smallest positive wet, attack level .5 rounds the first factor
    // to zero. Tap 2 survives; it must stay right rather than being renumbered.
    const project = fixture({ panAmount: .25, interval: .5, wet: Number.MIN_VALUE, feedback: 1, attack: 1, decay: 0, sustain: 1, release: 0 });
    expect(echoes(project).map(note => [note.delaySource!.tap, note.effectivePan])).toEqual([[2, .25], [3, -.25]]);
  });

  it('retains alternating pan across second-based taps spanning a tempo change', () => {
    const project = fixture({ panAmount: .5, timeUnit: 'seconds', interval: .5, attack: 0, decay: 0, sustain: 1, release: .5, feedback: 1, wet: 1 });
    project.tempos = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }];
    project.patterns[0].notes[0].tick = 480; project.patterns[0].notes[0].duration = 1440;
    expect(echoes(project).map(note => [note.absoluteTick, note.effectivePan])).toEqual([[1200, -.5], [1680, .5], [2160, -.5]]);
  });

  it('keeps zero and missing settings identical in every event field and retains dry references', () => {
    const project = fixture({ mode: 'tail', panAmount: 0, tail: 1 }), dry = flattenNotes(project);
    dry[0].effectivePan = -0;
    const zero = expandDelayEvents(project, dry); delete project.tracks[0].delay!.panAmount;
    const legacy = expandDelayEvents(project, dry);
    expect(legacy).toEqual(zero); expect(legacy.notes[0]).toBe(dry[0]);
    expect(legacy.notes.every(note => Object.is(note.effectivePan, -0))).toBe(true);
    project.tracks[0].delay!.enabled = false; project.tracks[0].delay!.panAmount = 1;
    expect(expandDelayEvents(project, dry).notes).toBe(dry);
  });

  it('keeps the source, raw MIDI and complete NBSX content unchanged apart from the optional setting', () => {
    const project = importMidi(expressionFixture(), 'source.mid').project;
    project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', tail: 1, panAmount: .625 };
    const before = structuredClone(project), dry = flattenNotes(project), dryBefore = structuredClone(dry), midiBefore = exportMidi(project).bytes;
    for (const note of dry) Object.freeze(note);
    const plan = expandDelayEvents(project, dry);
    expect(plan.generated).toBeGreaterThan(0); expect(plan.notes.filter(note => !note.delaySource)).toEqual(dry);
    expect(plan.notes.filter(note => !note.delaySource).every(note => dry.includes(note))).toBe(true);
    expect(dry).toEqual(dryBefore); expect(project).toEqual(before); expect(exportMidi(project).bytes).toEqual(midiBefore);
    const reopened = openNbsx(saveNbsx(project));
    expect(reopened.tracks[0].delay?.panAmount).toBe(.625); expect(reopened.patterns).toEqual(before.patterns);
    expect(reopened.assets).toEqual(before.assets); expect(reopened.midi).toEqual(before.midi);
    expect(originalMidi(reopened)?.bytes).toEqual(expressionFixture());
    delete project.tracks[0].delay!.panAmount;
    const old = openNbsx(saveNbsx(project)); expect(old.tracks[0].delay).not.toHaveProperty('panAmount');
    expect(() => renderNoteEvents(old)).not.toThrow();
  });
});

describe('Delay onset envelope', () => {
  it('samples attack, decay, sustain and release with independent tap decay', () => {
    const project = fixture({ interval: .5, feedback: .5, wet: .8, attack: 1, decay: 1, sustain: .5, release: 1 });
    project.tracks[0].volume = 2;
    const plan = renderNoteEvents(project), taps = plan.notes.filter(note => note.delaySource);
    expect(taps.map(note => note.absoluteTick)).toEqual([480, 960, 1440, 1920, 2400]);
    const expected = [.2, .2, .075, .025, .00625];
    for (let at = 0; at < taps.length; at++) {
      expect(taps[at].delaySource!.factor).toBeCloseTo(expected[at], 14);
      expect(taps[at].velocity).toBeCloseTo(.8 * expected[at], 14);
      expect(taps[at].gain).toBeCloseTo(1.6 * expected[at], 14);
    }
    expect(plan.generated).toBe(5); expect(plan.endTick).toBe(2401);
  });

  it('starts an early release from the actual attack level, never from sustain or full volume', () => {
    const project = fixture({ interval: .25, feedback: 1, wet: 1, attack: 2, decay: 1, sustain: .8, releaseOffset: -1.5, release: 1 });
    expect(echoes(project).map(note => note.delaySource!.factor)).toEqual([.125, .25, .1875, .125, .0625]);
    const effect = project.tracks[0].delay!;
    expect(delayEnvelope(effect, .5, 2)).toBe(.25);
    expect(delayEnvelope(effect, 1.5, 2)).toBe(0);
    expect(delayEnvelope({ ...effect, releaseOffset: -3 }, .25, 2)).toBe(0);
  });

  it('handles zero stages, a silent sustain and zero release without retaining silent events', () => {
    const project = fixture({ interval: .5, feedback: 1, wet: 1, attack: 0, decay: 0, sustain: 1, release: 0 });
    project.patterns[0].notes[0].duration = 960;
    expect(echoes(project).map(note => note.absoluteTick)).toEqual([480]);
    project.tracks[0].delay!.sustain = 0;
    const dry = flattenNotes(project), silent = expandDelayEvents(project, dry);
    expect(silent.notes).toBe(dry); expect(silent.generated).toBe(0);
    project.tracks[0].delay = { ...project.tracks[0].delay!, attack: 1, decay: 1, release: 1 };
    project.patterns[0].notes[0].duration = 96000;
    expect(echoes(project).map(note => note.delaySource!.factor)).toEqual([.5, 1, .5]);
  });

  it('makes tail mode independent of note duration and every ADSR setting', () => {
    const project = fixture({ mode: 'tail', tail: 1.5, interval: .5, wet: 1, feedback: .5, attack: 256, decay: 0, sustain: 0, release: 0, releaseOffset: -256 });
    project.patterns[0].notes[0].duration = 0;
    const first = echoes(project);
    expect(first.map(note => note.absoluteTick)).toEqual([480, 960, 1440]);
    expect(first.map(note => note.delaySource!.factor)).toEqual([.5, .25, .125]);
    project.patterns[0].notes[0].duration = 960000;
    expect(echoes(project).map(note => [note.absoluteTick, note.gain])).toEqual(first.map(note => [note.absoluteTick, note.gain]));
  });
});

describe('Delay musical timeline and source identity', () => {
  it('uses the real tempo map for second intervals and second-based note duration', () => {
    const project = fixture({ timeUnit: 'seconds', interval: .5, mode: 'gate', attack: 0, decay: 0, sustain: 1, release: .5, feedback: 1, wet: 1 });
    project.tempos = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }];
    project.patterns[0].notes[0].tick = 480; project.patterns[0].notes[0].duration = 1440;
    expect(echoes(project).map(note => note.absoluteTick)).toEqual([1200, 1680, 2160]);
    expect(echoes(project).map(note => note.delaySource!.factor)).toEqual([1, 1, .5]);
    project.tracks[0].delay = { ...project.tracks[0].delay!, timeUnit: 'beats', mode: 'tail', tail: 1.5 };
    expect(echoes(project).map(note => note.absoluteTick)).toEqual([960, 1440, 1920]);
  });

  it('keeps source references and metadata unchanged while giving each loop occurrence unique tap identities', () => {
    const project = fixture({ mode: 'tail', tail: 1, interval: .5, feedback: 1, wet: .5 });
    project.patterns[0].length = 960; project.regions[0].length = 1920; project.regions[0].loop = true;
    project.patterns[0].notes[0].midiSource = { onOrder: 7, offOrder: 8, releaseVelocity: 64, offSourceTrack: 1 };
    const dry = flattenNotes(project), before = structuredClone(project), drySnapshot = structuredClone(dry);
    for (const note of dry) Object.freeze(note);
    const plan = expandDelayEvents(project, dry), taps = plan.notes.filter(note => note.delaySource);
    expect(plan.notes.filter(note => !note.delaySource)).toEqual(dry);
    expect(plan.notes[0]).toBe(dry[0]); expect(plan.notes.includes(dry[1])).toBe(true);
    expect(taps.map(note => [note.absoluteTick, note.delaySource!.occurrenceTick, note.delaySource!.tap])).toEqual([[480, 0, 1], [960, 0, 2], [1440, 960, 1], [1920, 960, 2]]);
    expect(new Set(taps.map(note => note.id)).size).toBe(taps.length);
    expect(taps.every(note => !dry.some(source => source.id === note.id))).toBe(true);
    expect(taps.every(note => !('midiSource' in note) && note.duration === 1920 && note.delaySource!.noteId === 'dry-note')).toBe(true);
    expect(expandDelayEvents(project, dry).notes.map(note => note.id)).toEqual(plan.notes.map(note => note.id));
    expect(expandDelayEvents(project, taps).generated).toBe(0);
    expect(dry).toEqual(drySnapshot); expect(project).toEqual(before);
    expect(projectEnd(project)).toBe(1920); expect(plan.endTick).toBe(1921);
  });

  it('retains dry flattening and honors mute filtering only through the render wrapper', () => {
    const project = fixture({ mode: 'tail', tail: 1 });
    expect(flattenNotes(project)).toHaveLength(1);
    expect(renderNoteEvents(project).notes).toHaveLength(3);
    project.tracks[0].muted = true;
    expect(renderNoteEvents(project).notes).toEqual([]);
    expect(renderNoteEvents(project, true).notes).toHaveLength(3);
    expect(flattenNotes(project, true)).toHaveLength(1);
  });
});

describe('Delay bounded expansion', () => {
  it.each([{ enabled: false }, { wet: 0 }, { feedback: 0 }, { mode: 'tail' as const, tail: 0 }])('does not expand a disabled or inaudible plan: %j', settings => {
    const project = fixture(settings), dry = flattenNotes(project), plan = expandDelayEvents(project, dry);
    expect(plan.notes).toBe(dry); expect(plan.generated).toBe(0); expect(plan.endTick).toBe(1);
  });

  it('accepts 4096 taps and explicitly rejects larger source and total event plans', () => {
    const project = fixture({ mode: 'tail', timeUnit: 'seconds', interval: .001, tail: 4.096, feedback: 1, wet: 1 });
    expect(echoes(project)).toHaveLength(4096);
    project.tracks[0].delay!.tail = 4.097;
    expect(() => renderNoteEvents(project)).toThrow('4096');
    expect(projectDiagnostics(project)).toContainEqual(expect.objectContaining({ severity: 'error', code: 'delay-event-limit', message: expect.stringContaining('4096') }));
    project.tracks[0].delay!.tail = 4;
    project.patterns[0].notes = Array.from({ length: 500 }, (_, index) => ({ ...newNote(0, 66), id: `budget-${index}` }));
    expect(() => renderNoteEvents(project)).toThrow('200 万');
  });

  it('merges effect pressure and derived voice-pressure warnings without dropping events', () => {
    const project = fixture({ mode: 'tail', timeUnit: 'seconds', interval: .001, tail: 4, feedback: 1, wet: 1 });
    project.patterns[0].notes = Array.from({ length: 26 }, (_, index) => ({ ...newNote(0, 66), id: `pressure-${index}` }));
    const plan = renderNoteEvents(project);
    expect(plan.generated).toBe(104000); expect(plan.notes).toHaveLength(104026);
    expect(plan.diagnostics.map(item => item.code)).toEqual(['delay-event-pressure']);
    expect(projectDiagnostics(project).some(item => item.code === 'delay-event-pressure')).toBe(true);
    project.audio.profileId = 'java-1.7.10';
    project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', interval: .5, tail: .5, feedback: 1, wet: 1 };
    project.patterns[0].notes = Array.from({ length: 40 }, (_, index) => ({ ...newNote(index < 20 ? 0 : 480, 66), id: `chord-${index}` }));
    expect(projectDiagnostics(project).some(item => item.code === 'voice-pressure')).toBe(true);
    expect(flattenNotes(project)).toHaveLength(40);
  });
});
