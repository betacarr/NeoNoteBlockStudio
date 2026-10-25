import { describe, expect, it } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createProject, flattenNotes, projectDiagnostics, validateProject } from '../src/core/project';
import type { FlatNote, Note, Project } from '../src/core/types';

const note = (id: string, tick: number, midi = 66): Note => ({
  id, tick, midi, duration: 1.25, velocity: .75, pan: -.125, height: .5, detune: -7.25,
});

function fixture(period = 4, length = 12, offset = 0): Project {
  const project = createProject('Note expansion fixture');
  project.patterns[0].length = period;
  project.patterns[0].notes = [note('source-note', 0)];
  Object.assign(project.regions[0], { start: 23, length, offset, loop: true });
  return project;
}

// Deliberately small and cycle-major, independent of the production range and
// budget helpers. Full objects and stable equal-time ordering are the oracle.
function naiveCycleMajor(project: Project, includeMuted: boolean): FlatNote[] {
  const output: FlatNote[] = [];
  const hasSolo = project.tracks.some(track => track.solo);
  for (const region of project.regions) {
    const track = project.tracks.find(item => item.id === region.trackId);
    const pattern = project.patterns.find(item => item.id === region.patternId);
    if (!track || !pattern || !includeMuted && (track.muted || hasSolo && !track.solo)) continue;
    const period = Math.max(1, pattern.length);
    const cycles = region.loop ? Math.ceil((region.offset + region.length) / period) : 1;
    if (cycles > 1000) throw new Error('The independent oracle only accepts small fixtures.');
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const source of pattern.notes) {
        const local = source.tick + cycle * period - region.offset;
        if (local < 0 || local >= region.length) continue;
        const pan = source.pan + track.pan;
        output.push({
          ...source, trackId: track.id, regionId: region.id, patternId: pattern.id,
          absoluteTick: region.start + local, gain: source.velocity * track.volume,
          effectivePan: pan < -1 ? -1 : pan > 1 ? 1 : pan,
          effectiveInstrument: source.instrumentId ?? track.instrumentId,
        });
      }
    }
  }
  return output.sort((left, right) => left.absoluteTick - right.absoluteTick || left.midi - right.midi);
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (bound: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

function randomFixture(index: number, random: (bound: number) => number): Project {
  const project = createProject(`Seeded expansion ${index}`);
  const prototype = project.tracks[0];
  project.tracks = Array.from({ length: 1 + random(3) }, (_, track) => ({
    ...prototype, id: `track-${track}`, instrumentId: ['harp', 'bass', 'chime'][track],
    volume: random(17) / 4, pan: random(17) / 8 - 1,
    muted: random(4) === 0, solo: random(5) === 0,
  }));
  project.patterns = Array.from({ length: 1 + random(3) }, (_, pattern) => ({
    id: `pattern-${pattern}`, name: `Source ${pattern}`, length: 1 + random(40) / 4,
    notes: Array.from({ length: random(9) }, (_, entry) => ({
      ...note(`note-${pattern}-${entry}`, random(120) / 4, 60 + random(5)),
      duration: random(25) / 4, velocity: random(17) / 16,
      pan: random(17) / 8 - 1, height: random(17) / 4 - 2,
      detune: random(65) / 4 - 8,
      ...(random(3) === 0 ? { instrumentId: 'guitar' } : {}),
      midiSource: { onOrder: entry * 2, offOrder: entry * 2 + 1, releaseVelocity: random(128), offSourceTrack: pattern },
    })),
  }));
  project.regions = Array.from({ length: 1 + random(5) }, (_, region) => ({
    id: `region-${region}`, trackId: project.tracks[random(project.tracks.length)].id,
    patternId: project.patterns[random(project.patterns.length)].id,
    start: random(60) / 4, length: 1 + random(80) / 4, offset: random(80) / 4,
    loop: random(4) !== 0,
  }));
  return project;
}

describe('actual note expansion and recoverable limits', () => {
  it('matches an independent cycle-major oracle for complete sequences in 160 seeded small projects', () => {
    const random = seededRandom(0x7a31b9e2);
    for (let index = 0; index < 160; index++) {
      const project = randomFixture(index, random), before = structuredClone(project);
      validateProject(project);
      for (const includeMuted of [false, true]) {
        expect(flattenNotes(project, includeMuted), `seeded case ${index}, includeMuted=${includeMuted}`)
          .toEqual(naiveCycleMajor(project, includeMuted));
      }
      expect(project).toEqual(before);
    }
  });

  it('keeps region, then cycle, then source-note order at equal onset and pitch', () => {
    const project = fixture(10, 30);
    project.regions[0].start = 0;
    project.patterns[0].notes = [note('A', 10), note('B', 0), note('C', 10)];
    project.regions.push({ ...project.regions[0], id: 'second-region' });
    const first = project.regions[0].id;
    expect(flattenNotes(project).map(event => [event.absoluteTick, event.regionId, event.id])).toEqual([
      [0, first, 'B'], [0, 'second-region', 'B'],
      [10, first, 'A'], [10, first, 'C'], [10, first, 'B'],
      [10, 'second-region', 'A'], [10, 'second-region', 'C'], [10, 'second-region', 'B'],
      [20, first, 'A'], [20, first, 'C'], [20, first, 'B'],
      [20, 'second-region', 'A'], [20, 'second-region', 'C'], [20, 'second-region', 'B'],
    ]);
  });

  it('matches literal floating-point source expressions at decimal window edges and large absolute origins', () => {
    const cases = [
      { period: 1.1, length: 4.4, offset: .3, start: 1e12, ticks: [0, .1, 1.2, 2.3, .3] },
      { period: 1.1, length: 3.3, offset: 2.2, start: .1, ticks: [0, .1, .3, 1.1, 2.2, 3.3] },
      { period: 1.0000000000000002, length: 3.0000000000000004, offset: 2.0000000000000004, start: 1e12, ticks: [0, Number.EPSILON, 1.0000000000000002, 2, 3.0000000000000004] },
    ];
    for (const example of cases) {
      const project = fixture(example.period, example.length, example.offset);
      project.regions[0].start = example.start;
      project.patterns[0].notes = example.ticks.map((tick, index) => note(`decimal-${index}`, tick));
      validateProject(project);
      expect(flattenNotes(project)).toEqual(naiveCycleMajor(project, false));
    }
  });

  it('preserves a literal 1e12 source offset without visiting its silent preceding cycles', () => {
    const project = fixture(4, 3, 1e12);
    project.patterns[0].notes.push(note('second-onset', 2));
    const source = structuredClone(project);
    expect(flattenNotes(project).map(event => [event.id, event.absoluteTick])).toEqual([
      ['source-note', 23], ['second-onset', 25],
    ]);
    expect(project).toEqual(source);
    expect(project.regions[0].offset).toBe(1e12);
  });

  it('retains an original cycle-zero occurrence of a legacy source note at tick 1e12', () => {
    const project = fixture(4, 1, 1e12);
    project.patterns[0].notes = [note('legacy-at-MAX', 1e12)];
    validateProject(project);
    expect(flattenNotes(project)).toEqual([{
      ...project.patterns[0].notes[0], trackId: project.tracks[0].id, regionId: project.regions[0].id,
      patternId: project.patterns[0].id, absoluteTick: 23, gain: .75,
      effectivePan: -.125, effectiveInstrument: 'harp',
    }]);
  });

  it.each(['empty source', 'no in-range onsets'] as const)('handles a 1e12-tick loop with %s', kind => {
    const project = fixture(1, 1e12);
    project.patterns[0].notes = kind === 'empty source' ? [] : [note('outside-window', 1e12)];
    const before = structuredClone(project);
    validateProject(project);
    expect(flattenNotes(project)).toEqual([]);
    expect(projectDiagnostics(project)).toEqual([]);
    expect(project).toEqual(before);
  });

  it('reports a real event-budget error without throwing from diagnostics and allows shortening to repair it', () => {
    const project = fixture(1, 1e12), before = structuredClone(project);
    // One source note requests 1e12 occurrences: rejection must happen before
    // allocating a two-million-entry FlatNote array.
    expect(() => flattenNotes(project)).toThrow(/200 万/);
    const diagnostics = projectDiagnostics(project);
    expect(diagnostics.some(item => item.severity === 'error' && /200 万/.test(item.message))).toBe(true);
    expect(project).toEqual(before);
    project.regions[0].length = 3;
    expect(flattenNotes(project).map(event => event.absoluteTick)).toEqual([23, 24, 25]);
    expect(projectDiagnostics(project).some(item => item.severity === 'error')).toBe(false);
    expect(project.patterns).toEqual(before.patterns);
  });

  it('applies both solo and muted selection to events and their budget, while includeMuted includes all', () => {
    const project = fixture(1, 1e12);
    project.tracks[0].muted = true;
    project.tracks.push({ ...project.tracks[0], id: 'audible-track', muted: false, solo: true });
    project.regions.push({ ...project.regions[0], id: 'audible-region', trackId: 'audible-track', length: 1 });
    expect(flattenNotes(project).map(event => event.trackId)).toEqual(['audible-track']);
    expect(projectDiagnostics(project).some(item => item.severity === 'error')).toBe(false);
    expect(() => flattenNotes(project, true)).toThrow(/200 万/);
    project.tracks[0].muted = false;
    expect(flattenNotes(project).map(event => event.trackId)).toEqual(['audible-track']);
    project.tracks[1].solo = false;
    expect(() => flattenNotes(project)).toThrow(/200 万/);
  });

  it('round-trips a legal over-budget NBSX without altering source content or embedded resources', () => {
    const project = fixture(1, 1e12);
    project.ppq = 480;
    project.assets.push({ id: 'sample-fixture', name: 'Original sample.bin', mime: 'application/octet-stream', data: 'AAECA//+', path: 'relative/sample.bin', sha1: 'fixture-original-identity' });
    project.instruments.push({ ...project.instruments[0], id: 'custom-fixture', name: 'Custom', assetId: 'sample-fixture' });
    project.patterns[0].notes[0].instrumentId = 'custom-fixture';
    project.patterns[0].notes[0].midiSource = { onOrder: 4, offOrder: 8, releaseVelocity: 53, offSourceTrack: 2 };
    project.patterns[0].midiEvents = [{ id: 'preserved-controller', tick: 2.5, order: 3, sourceTrack: 2, event: { deltaTime: 0, type: 'controller', channel: 4, controllerType: 64, value: 127 } }];
    project.tempos.push({ tick: 3.25, bpm: 137.5 });
    project.provenance = { kind: 'midi', filename: 'source.mid', metadata: { retained: [1, 'value'] } };
    const before = structuredClone(project);
    const opened = openNbsx(saveNbsx(project));
    expect(opened).toEqual({ ...before, modifiedAt: opened.modifiedAt });
    expect(project).toEqual(before);
    expect(projectDiagnostics(opened).some(item => item.severity === 'error' && /200 万/.test(item.message))).toBe(true);
    opened.regions[0].length = 2;
    expect(flattenNotes(opened)).toHaveLength(2);
    const repaired = openNbsx(saveNbsx(opened));
    expect(repaired).toEqual({ ...opened, modifiedAt: repaired.modifiedAt });
    expect(repaired.patterns).toEqual(before.patterns);
    expect(repaired.assets).toEqual(before.assets);
    expect(repaired.instruments).toEqual(before.instruments);
  });
});
