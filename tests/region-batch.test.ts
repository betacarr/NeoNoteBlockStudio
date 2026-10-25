import { produce } from 'immer';
import { parseMidi } from 'midi-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi, originalMidi } from '../src/core/midi';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import { applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup, planRegionGroupMove, type RegionMove } from '../src/core/region-batch';
import type { Pattern } from '../src/core/types';

function fixture({ shared = false, copy = false } = {}) {
  const project = createProject('Group fixture'); project.ppq = 480;
  project.tracks = Array.from({ length: 5 }, (_, index) => ({ ...newTrack(`Track ${index}`, index, index % 2 ? 'bass' : 'harp'), id: `track-${index}`, sourceMidiTrack: index, midiChannel: index + 1 }));
  const first: Pattern = { id: 'pattern-a', name: 'A', length: 1920, notes: [
    { ...newNote(60, 63, 91.5), id: 'note-a', velocity: .73, pan: -.25, detune: 9.125, height: .5, instrumentId: 'harp', midiSource: { onOrder: 7, offOrder: 13, releaseVelocity: 42, offSourceTrack: 4 } },
  ], midiEvents: [
    { id: 'sysex-a', tick: 30.25, order: 1, sourceTrack: 0, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } },
    { id: 'cc-a', tick: 240, order: 2, sourceTrack: 0, event: { deltaTime: 0, type: 'controller', channel: 1, controllerType: 64, value: 127, running: true } },
  ] };
  const second: Pattern = { id: 'pattern-b', name: 'B', length: 960, notes: [{ ...newNote(0, 70, 0), id: 'note-b', velocity: .42, midiSource: { onOrder: 8, offOrder: 14, releaseVelocity: 57, offSourceTrack: 0 } }] };
  const orphan: Pattern = { id: 'old-orphan', name: 'Historical orphan', length: 1, notes: [{ ...newNote(0, 50, 0), id: 'orphan-note' }] };
  project.patterns = [first, second, orphan];
  project.regions = [
    { id: 'region-a', trackId: 'track-0', patternId: first.id, start: 120.25, length: 480.5, offset: 30.25, loop: true },
    { id: 'region-b', trackId: 'track-1', patternId: shared ? first.id : second.id, start: 960.75, length: 240.25, offset: 0, loop: false },
  ];
  if (copy) project.regions.push({ ...project.regions[0], id: 'unselected-copy', start: 3000 });
  project.assets = [{ id: 'original-midi', name: 'source.mid', mime: 'audio/midi', data: 'AQIDBA==' }];
  project.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', sourceTrackNames: project.tracks.map(track => track.name),
    conductor: [{ id: 'conductor-text', tick: 0, order: 1, event: { deltaTime: 0, type: 'text', text: 'Retain original conductor' } }] };
  return { project, first, second, orphan, ids: new Set(['region-a', 'region-b']), order: project.tracks.map(track => track.id) };
}
const moveChanges = (): RegionMove[] => [{ id: 'region-a', start: 600, trackId: 'track-2' }, { id: 'region-b', start: 1440.5, trackId: 'track-3' }];
afterEach(() => vi.restoreAllMocks());

describe('group movement planning', () => {
  it('uses visible row positions and one fractional time delta, returning original project region order', () => {
    const test = fixture(); test.project.regions[1].trackId = 'track-2'; const before = structuredClone(test.project);
    expect(planRegionGroupMove(test.project, new Set(['region-b', 'region-a']), 'region-a', 'track-2', 137.375, ['track-0', 'track-2', 'track-4'])).toEqual({
      ok: true, deltaTick: 17.125, trackDelta: 1, changes: [{ id: 'region-a', start: 137.375, trackId: 'track-2' }, { id: 'region-b', start: 977.875, trackId: 'track-4' }],
    }); expect(test.project).toEqual(before);
  });

  it.each([
    [-1000, -120.25, [0, 840.5]],
    [1e12, 999999999039.25, [999999999159.5, 1e12]],
  ] as const)('clamps the whole time delta for requested anchor %s, without squeezing spacing', (requested, deltaTick, starts) => {
    const { project, ids, order } = fixture(), plan = planRegionGroupMove(project, ids, 'region-a', 'track-0', requested, order);
    expect(plan).toEqual({ ok: true, deltaTick, trackDelta: 0, changes: [{ id: 'region-a', start: starts[0], trackId: 'track-0' }, { id: 'region-b', start: starts[1], trackId: 'track-1' }] });
  });

  it.each(['hidden', 'source-locked', 'target-locked', 'beyond-row', 'stale', 'missing-source', 'missing-pattern', 'anchor', 'bad-time', 'order'] as const)('rejects the whole %s selection or destination', kind => {
    const test = fixture(); let order = test.order, target = 'track-1', anchor = 'region-a', requested = 240;
    if (kind === 'hidden') order = ['track-0', 'track-2', 'track-3', 'track-4'];
    if (kind === 'source-locked') test.project.tracks[1].locked = true;
    if (kind === 'target-locked') test.project.tracks[2].locked = true;
    if (kind === 'beyond-row') target = 'track-4';
    if (kind === 'stale') test.ids.add('deleted');
    if (kind === 'missing-source') test.project.tracks = test.project.tracks.filter(track => track.id !== 'track-1');
    if (kind === 'missing-pattern') test.project.patterns = test.project.patterns.filter(pattern => pattern.id !== 'pattern-b');
    if (kind === 'anchor') anchor = 'unselected';
    if (kind === 'bad-time') requested = NaN;
    if (kind === 'order') order = [...order, order[0]];
    const before = structuredClone(test.project), plan = planRegionGroupMove(test.project, test.ids, anchor, target, requested, order);
    expect(plan.ok).toBe(false); if (!plan.ok) expect(plan.reason.length).toBeGreaterThan(0); expect(test.project).toEqual(before);
  });
});

describe('atomic group mutations', () => {
  it.each(['missing-target', 'locked-target', 'locked-source', 'invalid-time', 'duplicate-id', 'missing-pattern'] as const)('does not touch the first valid member when the next %s fails', invalid => {
    const test = fixture({ shared: true, copy: true }), changes = moveChanges();
    if (invalid === 'missing-target') changes[1].trackId = 'deleted';
    if (invalid === 'locked-target') test.project.tracks[3].locked = true;
    if (invalid === 'locked-source') test.project.tracks[1].locked = true;
    if (invalid === 'invalid-time') changes[1].start = Infinity;
    if (invalid === 'duplicate-id') changes[1].id = changes[0].id;
    if (invalid === 'missing-pattern') test.project.regions[1].patternId = 'deleted';
    const before = structuredClone(test.project), ids = vi.spyOn(crypto, 'randomUUID');
    expect(applyRegionGroupMove(test.project, changes)).toBe(false); expect(test.project).toEqual(before); expect(ids).not.toHaveBeenCalled();
  });

  it('does not allocate, clone or change an Immer snapshot for all-noop moves', () => {
    const { project } = fixture(), ids = vi.spyOn(crypto, 'randomUUID');
    const next = produce(project, draft => { expect(applyRegionGroupMove(draft, draft.regions.map(region => ({ id: region.id, start: region.start, trackId: region.trackId })))).toBe(false); });
    expect(next).toBe(project); expect(ids).not.toHaveBeenCalled();
  });

  it('retains original NoteOff routes and shared sources for same-track movement', () => {
    const { project, first, second } = fixture({ copy: true }), expected = structuredClone(project);
    expected.regions[0].start = 240.75; expected.regions[1].start = 1081.25;
    expect(applyRegionGroupMove(project, [{ id: 'region-a', start: 240.75, trackId: 'track-0' }, { id: 'region-b', start: 1081.25, trackId: 'track-1' }])).toBe(true);
    expect(project).toEqual(expected); expect(project.patterns[0]).toBe(first); expect(project.patterns[1]).toBe(second);
  });

  it('keeps shared source identity on a cross-track move when no old NoteOff route needs detaching', () => {
    const { project, first } = fixture({ shared: true, copy: true }); delete first.notes[0].midiSource!.offSourceTrack;
    const sources = project.patterns.slice(); expect(applyRegionGroupMove(project, moveChanges())).toBe(true);
    expect(project.patterns).toEqual(sources); expect(project.patterns[0]).toBe(first);
    expect(project.regions.map(region => region.patternId)).toEqual(['pattern-a', 'pattern-a', 'pattern-a']);
  });

  it('detaches two shared members for different target tracks, keeping an unselected original and deep MIDI payloads intact', () => {
    const { project, first } = fixture({ shared: true, copy: true }), original = structuredClone(first), untouched = project.regions[2], assets = project.assets, midi = project.midi;
    expect(applyRegionGroupMove(project, moveChanges())).toBe(true);
    const sources = project.regions.slice(0, 2).map(region => project.patterns.find(pattern => pattern.id === region.patternId)!);
    expect(project.patterns).toHaveLength(5); expect(new Set(sources.map(pattern => pattern.id)).size).toBe(2);
    for (const source of sources) {
      expect(source.id).not.toBe(first.id); expect(source.notes[0].midiSource).toEqual({ onOrder: 7, offOrder: 13, releaseVelocity: 42 });
      expect(source.midiEvents!.map(({ id, ...event }) => event)).toEqual(original.midiEvents!.map(({ id, ...event }) => event));
    }
    const data = sources[0].midiEvents![0].event; if (data.type !== 'sysEx' || !Array.isArray(data.data)) throw new Error('Expected independently mutable SysEx');
    data.data[0] = 99; expect(sources[1].midiEvents![0].event).toEqual(original.midiEvents![0].event);
    expect(first).toEqual(original); expect(project.regions[2]).toBe(untouched); expect(project.regions[2].patternId).toBe(first.id);
    expect(project.assets).toBe(assets); expect(project.midi).toBe(midi); expect(validateProject(project)).toBe(project);
  });

  it('preflights aggregate copy-on-write capacity and permits the exact final schema boundary', () => {
    const test = fixture({ shared: true, copy: true });
    while (test.project.patterns.length < 99999) { const index = test.project.patterns.length; test.project.patterns.push({ id: `empty-${index}`, name: 'Empty', length: 1, notes: [] }); }
    const before = structuredClone(test.project.regions), original = structuredClone(test.first), ids = vi.spyOn(crypto, 'randomUUID');
    expect(applyRegionGroupMove(test.project, moveChanges())).toBe(false); // needs two clones, not one
    expect(test.project.regions).toEqual(before); expect(test.first).toEqual(original); expect(test.project.patterns).toHaveLength(99999); expect(ids).not.toHaveBeenCalled();
    test.project.regions.pop(); // all remaining references now move: only one clone is needed
    expect(applyRegionGroupMove(test.project, moveChanges())).toBe(true); expect(test.project.patterns).toHaveLength(100000);
    for (const region of test.project.regions) expect(test.project.patterns.find(pattern => pattern.id === region.patternId)!.notes[0].midiSource).not.toHaveProperty('offSourceTrack');
    ids.mockClear(); expect(duplicateRegionGroup(test.project, test.ids)).toBeUndefined(); expect(ids).not.toHaveBeenCalled();
  });

  it('copies the whole span with one delta, independent IDs, deep MIDI and complete per-region properties', () => {
    const { project, ids, first } = fixture({ shared: true }), before = structuredClone(project), copied = duplicateRegionGroup(project, new Set([...ids].reverse()))!;
    expect(copied.map(region => [region.trackId, region.start, region.offset, region.length, region.loop])).toEqual([
      ['track-0', 1201, 30.25, 480.5, true], ['track-1', 2041.5, 0, 240.25, false],
    ]);
    expect(project.regions.slice(0, 2)).toEqual(before.regions); expect(project.patterns.slice(0, 3)).toEqual(before.patterns);
    const clones = copied.map(region => project.patterns.find(pattern => pattern.id === region.patternId)!);
    expect(clones.map(pattern => pattern.name)).toEqual(['A 副本', 'A 副本']); expect(clones[0]).not.toBe(clones[1]);
    for (const clone of clones) {
      expect(clone.notes.map(({ id, ...note }) => note)).toEqual(first.notes.map(({ id, ...note }) => note));
      expect(clone.midiEvents?.map(({ id, ...event }) => event)).toEqual(first.midiEvents?.map(({ id, ...event }) => event));
      expect(clone.notes[0].midiSource).not.toBe(first.notes[0].midiSource);
    }
    const event = clones[0].midiEvents![0].event; if (event.type !== 'sysEx' || !Array.isArray(event.data)) throw new Error('Expected independent SysEx');
    event.data[1] = 77; clones[0].notes[0].midiSource!.releaseVelocity = 99;
    expect(first).toEqual(before.patterns[0]); expect(clones[1].midiEvents![0].event).toEqual(first.midiEvents![0].event); expect(clones[1].notes[0].midiSource!.releaseVelocity).toBe(42);
    expect(project.assets).toEqual(before.assets); expect(project.midi).toEqual(before.midi); expect(validateProject(project)).toBe(project);
  });

  it.each(['locked', 'stale', 'overflow'] as const)('rejects a whole duplicate on %s before allocating IDs', invalid => {
    const test = fixture(); if (invalid === 'locked') test.project.tracks[1].locked = true;
    if (invalid === 'stale') test.ids.add('deleted'); if (invalid === 'overflow') test.project.regions[1].start = 1e12;
    const before = structuredClone(test.project), ids = vi.spyOn(crypto, 'randomUUID');
    expect(duplicateRegionGroup(test.project, test.ids)).toBeUndefined(); expect(test.project).toEqual(before); expect(ids).not.toHaveBeenCalled();
  });

  it('accepts an independently legal maximum copied start even when its end exceeds the start scalar limit', () => {
    const { project } = fixture(); project.regions[0].start = 0; project.regions[0].length = 1e12;
    const [copy] = duplicateRegionGroup(project, new Set(['region-a']))!;
    expect(copy.start).toBe(1e12); expect(copy.length).toBe(1e12); expect(copy.start + copy.length).toBe(2e12);
    expect(validateProject(project)).toBe(project);
  });

  it('deletes only selected occurrences and their newly unreferenced patterns, preserving historical orphan sources and archives', () => {
    const { project, ids, first, second, orphan } = fixture({ copy: true }), survivor = project.regions[2], assets = project.assets, midi = project.midi;
    expect(deleteRegionGroup(project, ids)).toBe(true); expect(project.regions).toEqual([survivor]); expect(project.regions[0]).toBe(survivor);
    expect(project.patterns).toEqual([first, orphan]); expect(project.patterns).not.toContain(second); expect(project.assets).toBe(assets); expect(project.midi).toBe(midi);
  });

  it.each(['locked', 'stale', 'empty'] as const)('rejects a whole %s delete and preserves the Immer snapshot', invalid => {
    const test = fixture({ copy: true }); if (invalid === 'locked') test.project.tracks[1].locked = true;
    if (invalid === 'stale') test.ids.add('deleted'); if (invalid === 'empty') test.ids.clear();
    expect(produce(test.project, draft => { expect(deleteRegionGroup(draft, test.ids)).toBe(false); })).toBe(test.project);
  });

  it('retains immutable whole-operation snapshots, full NBSX data and destination MIDI note edges', () => {
    const { project } = fixture(); project.regions[0].loop = false; project.regions[0].offset = 0;
    const original = structuredClone(project), originalBytes = originalMidi(project)!.bytes;
    const next = produce(project, draft => { expect(applyRegionGroupMove(draft, moveChanges())).toBe(true); });
    expect(project).toEqual(original); expect(next).not.toBe(project); expect(next.assets).toBe(project.assets); expect(next.midi).toBe(project.midi);
    const reopened = openNbsx(saveNbsx(next));
    expect({ ...reopened, modifiedAt: next.modifiedAt }).toEqual(next); expect(originalMidi(next)!.bytes).toEqual(originalBytes);
    const midi = parseMidi(exportMidi(next).bytes);
    for (const [name, channel, key, release] of [['Track 2', 3, 63, 42], ['Track 3', 4, 70, 57]] as const) {
      const track = midi.tracks.find(events => events.some(event => event.type === 'trackName' && event.text === name))!;
      expect(track.filter(event => event.type === 'noteOn' || event.type === 'noteOff').map(event => [event.type, 'channel' in event ? event.channel : -1, 'noteNumber' in event ? event.noteNumber : -1, 'velocity' in event ? event.velocity : -1])).toEqual([
        ['noteOn', channel, key, key === 63 ? 93 : 53], ['noteOff', channel, key, release],
      ]);
    }
    expect(midi.tracks.flat().filter(event => event.type === 'noteOff')).toHaveLength(2);
  });
});
