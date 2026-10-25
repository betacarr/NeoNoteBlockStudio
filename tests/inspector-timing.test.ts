import { describe, expect, it } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { expansionError, loopNoteCycles } from '../src/core/expansion';
import { inspectorBeatTicks, MAX_PROJECT_TICK, noteTimingError, regionLengthError } from '../src/core/inspector-timing';
import { createProject, newNote, validateProject } from '../src/core/project';
import type { Project } from '../src/core/types';

function fixture(period = 4, length = period, loop = false): Project {
  const project = createProject('Inspector timing fixture');
  project.ppq = 1;
  project.patterns[0].length = period;
  project.patterns[0].notes = [newNote(.25, 60, .125)];
  Object.assign(project.regions[0], { length, loop });
  return project;
}
const selected = (project: Project) => new Set([project.patterns[0].notes[0].id]);
const noteError = (project: Project, patch: { tick?: number; duration?: number }) => noteTimingError(project, project.regions[0].id, selected(project), patch);
const lengthError = (project: Project, length: number) => regionLengthError(project, project.regions[0].id, length);
function freezeTree(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeTree(child);
}

describe('bounded loop occurrence ranges', () => {
  it('retains literal huge offsets, cycle-zero legacy notes and half-open endpoints', () => {
    expect(loopNoteCycles(0, 1, 1e12, 1)).toEqual({ first: 1e12, last: 1e12 });
    expect(loopNoteCycles(1e12, 1, 1e12, 1)).toEqual({ first: 0, last: 0 });
    expect(loopNoteCycles(1e12, 1, 0, 1e12)).toEqual({ first: 0, last: -1 });
    expect(loopNoteCycles(.5, 10, 1, 1)).toEqual({ first: 0, last: -1 });
    expect(loopNoteCycles(0, 4, 4, 8)).toEqual({ first: 1, last: 2 });
  });

  it('corrects quotient rounding using actual decimal onset arithmetic', () => {
    // The apparent period boundary is rounded below the half-open end after
    // the original tick + cycle * period - offset operations.
    expect(loopNoteCycles(999999999999.9, 1.1, 999999999999.9, 1.1)).toEqual({ first: 0, last: 1 });
    expect(loopNoteCycles(999999999999.9, 1.1, 999999999999.9, 3.3)).toEqual({ first: 0, last: 2 });
    expect(loopNoteCycles(.3, 1.2, 1e12, 1.1)).toEqual({ first: 833333333334, last: 833333333334 });
    expect(loopNoteCycles(1.1, 3.3, 3.3, 1.1)).toEqual({ first: 0, last: -1 });
  });

  it('matches independent exhaustive small-window cycle enumeration', () => {
    // This oracle never calls flattenNotes or derives a range by division.
    // All possible onsets for these inputs occur before the literal cycle 80.
    for (const period of [1, 1.1, 1.25, 2.2, 7]) {
      for (const offset of [0, .1, .3, 3.3, 7.7]) {
        for (const tick of [0, .1, .3, 1.1, 2.2, 9.9, 32]) {
          for (const length of [1, 1.1, 2.2, 7.7]) {
            const expected: number[] = [];
            for (let cycle = 0; cycle < 80; cycle++) {
              const local = tick + cycle * period - offset;
              if (local >= 0 && local < length) expected.push(cycle);
            }
            const { first, last } = loopNoteCycles(tick, period, offset, length);
            const actual = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
            expect(actual, JSON.stringify({ tick, period, offset, length })).toEqual(expected);
          }
        }
      }
    }
  });

  it('counts only real onsets at the inclusive two-million-event budget', () => {
    const project = fixture(1, 2e6, true);
    expect(expansionError(project)).toBeUndefined();
    expect(lengthError(project, 2e6 + 1)).toMatch(/200 万/);
    project.regions[0].offset = 1e12;
    expect(expansionError(project)).toBeUndefined();
    project.patterns[0].notes = [];
    expect(lengthError(project, 1e12)).toBeUndefined();
    project.patterns[0].notes = [newNote(1e12, 60)];
    project.regions[0].offset = 0;
    expect(lengthError(project, 1e12)).toBeUndefined();
  });

  it('sums shared-pattern regions and optionally applies muted and solo filtering', () => {
    const project = fixture(1, 1e6, true);
    project.regions.push({ ...project.regions[0], id: 'second-copy' });
    expect(expansionError(project)).toBeUndefined();
    project.regions.push({ ...project.regions[0], id: 'one-extra', length: 1 });
    expect(expansionError(project)).toMatch(/200 万/);
    project.tracks[0].muted = true;
    expect(expansionError(project, false)).toBeUndefined();
    expect(expansionError(project)).toMatch(/200 万/);
    project.tracks[0].muted = false;
    project.tracks.push({ ...project.tracks[0], id: 'solo-track', solo: true });
    expect(expansionError(project, false)).toBeUndefined();
    expect(expansionError(project, true)).toMatch(/200 万/);
  });
});

describe('inspector time preflight', () => {
  it.each([21, 27, 32767])('accepts the exact displayed maximum at PPQ %s while rejecting the next representable beat value', ppq => {
    const project = fixture(); project.ppq = ppq;
    const beats = MAX_PROJECT_TICK / ppq, epsilon = 2 ** (Math.floor(Math.log2(beats)) - 52);
    const ticks = inspectorBeatTicks(beats, ppq);
    expect(ticks).toBe(MAX_PROJECT_TICK);
    expect(lengthError(project, ticks)).toBeUndefined();
    expect(noteError(project, { duration: ticks })).toBeUndefined();
    const above = inspectorBeatTicks(beats + epsilon, ppq);
    expect(above).toBeGreaterThan(MAX_PROJECT_TICK);
    expect(lengthError(project, above)).toMatch(/有限数字/);
    expect(noteError(project, { tick: above })).toMatch(/有限数字/);
    expect(noteError(project, { duration: above })).toMatch(/有限数字/);
    expect(inspectorBeatTicks(beats - epsilon, ppq)).toBe((beats - epsilon) * ppq);
  });

  it('keeps ordinary fractional beat multiplication exact without tick rounding', () => {
    expect(inspectorBeatTicks(.1, 3)).toBe(.30000000000000004);
    expect(inspectorBeatTicks(.125, 27)).toBe(3.375);
    expect(inspectorBeatTicks(.000000001, 32767)).toBe(.000032767);
    expect(inspectorBeatTicks(0, 21)).toBe(0);
    expect(inspectorBeatTicks(-0, 21)).toBe(-0);
  });

  it('allows fractional MIDI timing, zero duration and the full legal duration limit without growth', () => {
    const project = fixture(1, 4, true); project.ppq = 137;
    expect(noteError(project, { tick: .9375, duration: 0 })).toBeUndefined();
    expect(noteError(project, { duration: MAX_PROJECT_TICK })).toBeUndefined();
    expect(project.patterns[0].length).toBe(1);
    expect(project.regions[0].length).toBe(4);
  });

  it.each([-1, NaN, Infinity, -Infinity, MAX_PROJECT_TICK + 1])('rejects a changed invalid note scalar %s', value => {
    const project = fixture();
    expect(noteError(project, { tick: value })).toMatch(/有限数字/);
    expect(noteError(project, { duration: value })).toMatch(/有限数字/);
  });

  it('accepts exact region length bounds without narrowing the project schema', () => {
    const project = fixture();
    expect(lengthError(project, 1)).toBeUndefined();
    expect(lengthError(project, MAX_PROJECT_TICK)).toBeUndefined();
    for (const value of [0, .999, -1, NaN, Infinity, MAX_PROJECT_TICK + .01]) expect(lengthError(project, value)).toMatch(/有限数字/);
  });

  it('leaves empty, stale and semantically unchanged selections alone', () => {
    const project = fixture();
    expect(noteTimingError(project, project.regions[0].id, new Set(), { tick: NaN })).toBeUndefined();
    expect(noteTimingError(project, project.regions[0].id, new Set(['stale-note']), { duration: Infinity })).toBeUndefined();
    expect(noteError(project, {})).toBeUndefined();
    expect(noteError(project, { tick: .25, duration: .125 })).toBeUndefined();
    expect(noteTimingError(project, 'missing-region', selected(project), { tick: 2 })).toMatch(/找不到/);
    project.tracks[0].locked = true;
    expect(noteError(project, { tick: 2 })).toMatch(/锁定/);
    expect(lengthError(project, 2)).toMatch(/锁定/);
  });

  it('checks real bar rounding rather than only the entered maximum', () => {
    const project = fixture();
    expect(noteError(project, { tick: MAX_PROJECT_TICK - 1 })).toBeUndefined(); // 1e12 is a PPQ=1 bar line.
    expect(noteError(project, { tick: MAX_PROJECT_TICK })).toMatch(/小节进位/);
    project.ppq = 480;
    expect(noteError(project, { tick: MAX_PROJECT_TICK - 1 })).toMatch(/小节进位/); // Its next 1920-tick bar exceeds 1e12.
  });

  it('uses the region source origin when checking cropped-source bar growth', () => {
    const project = fixture(4, 1);
    expect(noteError(project, { tick: MAX_PROJECT_TICK - 1 })).toBeUndefined();
    project.regions[0].start = 1;
    expect(noteError(project, { tick: MAX_PROJECT_TICK - 1 })).toMatch(/小节进位/);
  });

  it('does not grow for duration-only edits or unrelated legacy notes outside the source', () => {
    const project = fixture();
    project.patterns[0].notes.push(newNote(MAX_PROJECT_TICK, 70));
    expect(noteError(project, { duration: 5.25 })).toBeUndefined();
    expect(noteError(project, { tick: .75 })).toBeUndefined();
    const farID = new Set([project.patterns[0].notes[1].id]);
    expect(noteTimingError(project, project.regions[0].id, farID, { tick: MAX_PROJECT_TICK, duration: 0 })).toBeUndefined();
    expect(project.patterns[0].length).toBe(4);
  });

  it('keeps an in-period fractional start in its existing loop, and permits explicit outside-source growth', () => {
    const project = fixture(1, 2e6 + 1, true);
    expect(noteError(project, { tick: .9375 })).toMatch(/200 万/); // Still period 1, not rounded to 4.
    expect(noteError(project, { duration: 12 })).toMatch(/200 万/);
    expect(noteError(project, { tick: 1 })).toBeUndefined(); // Deliberate move grows the source to 4, reducing occurrences.
    expect(project.patterns[0].length).toBe(1);
    expect(project.regions[0].length).toBe(2e6 + 1);
  });

  it('checks the candidate onset and each other reference to the edited source', () => {
    const project = fixture(2, 4e6, true);
    project.patterns[0].notes[0].tick = 1.75;
    project.regions.push({ ...project.regions[0], id: 'other-copy', length: 1 });
    expect(expansionError(project)).toBeUndefined(); // The short copy excludes 1.75.
    expect(noteError(project, { tick: .25 })).toMatch(/200 万/); // It now includes the same changed note.
    expect(noteError(project, { tick: 2 })).toBeUndefined(); // Both references use the newly grown source period.
  });

  it('counts cropped non-loop notes by the half-open playback border', () => {
    const project = fixture(4, 1); project.regions[0].offset = 1;
    project.patterns[0].notes = [newNote(.999, 60), newNote(1, 61), newNote(2, 62)];
    // Replication exposes an off-by-one count without allocating expanded notes.
    project.regions = Array.from({ length: 100000 }, (_, index) => ({ ...project.regions[0], id: `copy-${index}` }));
    project.patterns[0].notes.push(...Array.from({ length: 19 }, (_, index) => newNote(1.5, 63 + index)));
    expect(expansionError(project)).toBeUndefined(); // 20 in-window starts * 100000 regions.
    expect(noteTimingError(project, project.regions[0].id, new Set([project.patterns[0].notes[0].id]), { tick: 1 })).toMatch(/200 万/);
  });

  it('keeps all source data immutable and preserves complete schema-valid projects through NBSX', () => {
    const project = fixture(); project.ppq = 137;
    project.assets.push({ id: 'source-midi', name: 'Source.mid', mime: 'audio/midi', data: 'AAECA/8=', path: 'original.mid', sha1: 'source-identity' });
    project.midi = { schema: 1, format: 1, sourceAssetId: 'source-midi', sourceTrackNames: ['Tempo', 'Piano'], conductor: [] };
    project.provenance = { kind: 'midi', filename: 'Source.mid', metadata: { arbitrary: ['kept', 1.25] } };
    project.patterns[0].notes[0].midiSource = { onOrder: 7, offOrder: 8, releaseVelocity: 87, offSourceTrack: 2 };
    project.patterns[0].notes[0].instrumentId = 'bass';
    project.patterns[0].midiEvents = [{ id: 'retained-controller', tick: 1.25, order: 9, sourceTrack: 2, event: { deltaTime: 0, type: 'controller', channel: 2, controllerType: 64, value: 127 } }];
    const before = structuredClone(project);
    freezeTree(project);
    expect(noteError(project, { tick: .9375, duration: 0 })).toBeUndefined();
    expect(noteError(project, { tick: MAX_PROJECT_TICK })).toMatch(/小节进位/);
    expect(lengthError(project, 1.125)).toBeUndefined();
    expect(project).toEqual(before);
    const edited = structuredClone(project);
    Object.assign(edited.patterns[0].notes[0], { tick: .9375, duration: 0 });
    edited.regions[0].length = 1.125;
    expect(() => validateProject(edited)).not.toThrow();
    const reopened = openNbsx(saveNbsx(edited));
    expect(reopened).toEqual({ ...edited, modifiedAt: reopened.modifiedAt });
    expect(project).toEqual(before);
  });
});
