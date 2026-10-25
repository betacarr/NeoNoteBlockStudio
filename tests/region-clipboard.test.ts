import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegionClipboard, planRegionPaste, type RegionPastePlan } from '../src/core/region-clipboard';
import { createNoteClipboard, planNotePaste } from '../src/core/note-clipboard';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import type { Asset, Instrument, Project } from '../src/core/types';

function addInstrument(project: Project, id: string, data: string) {
  const asset: Asset = { id: `${id}-sample`, name: `${id}.wav`, mime: 'audio/wav', data, path: `samples/${id}.wav`, sha1: 'a'.repeat(40) };
  const instrument: Instrument = { ...project.instruments[0], id, name: id, englishName: id, assetId: asset.id, rootMidi: 60, sound: `custom:${id}` };
  project.instruments.push(instrument); project.assets.push(asset); return { instrument, asset };
}
function fixture() {
  const source = createProject('Source'), target = createProject('Target'); source.ppq = 480; target.ppq = 960;
  addInstrument(source, 'source-default', 'AAEC'); addInstrument(source, 'gap-default', 'AQID'); addInstrument(source, 'bottom-default', 'AgME');
  const custom = addInstrument(source, 'custom', 'BAUG');
  source.tracks = [
    { ...newTrack('Source A', 0, 'source-default'), id: 'source-a', locked: true, sourceMidiTrack: 1, midiChannel: 4 },
    { ...newTrack('Source gap', 1, 'gap-default'), id: 'source-gap', locked: true, sourceMidiTrack: 2, midiChannel: 6, volume: .37, pan: -.4, muted: true,
      delay: { ...createDefaultDelay(), enabled: true, mode: 'tail', interval: .75, feedback: .25, panAmount: .4 } },
    { ...newTrack('Source B', 2, 'bottom-default'), id: 'source-b', sourceMidiTrack: 3, midiChannel: 7, volume: 1.3, pan: .2 },
  ];
  source.patterns = [
    { id: 'pattern-a', name: 'Full source A', length: 960, notes: [
      { ...newNote(60, 60, 120.5), id: 'note-a', velocity: .73, pan: -.2, detune: 12.5, height: .75, midiSource: { onOrder: 7, offOrder: 12, releaseVelocity: 41, offSourceTrack: 3 } },
      { ...newNote(1200, 64, 0), id: 'cropped-out', instrumentId: 'custom' },
    ], midiEvents: [
      { id: 'sysex', tick: 30, order: 5, sourceTrack: 11, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } },
      { id: 'outside-tempo', tick: 1200, order: 6, sourceTrack: 12, event: { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 625000 } },
    ] },
    { id: 'pattern-b', name: 'Loop source B', length: 480, notes: [{ ...newNote(90, 67, 240), id: 'note-b', midiSource: { onOrder: 17, offOrder: 22, releaseVelocity: 59, offSourceTrack: 5 } }] },
    { id: 'unrelated-pattern', name: 'Do not copy', length: 1, notes: [] },
  ];
  // Lower row comes first and starts earlier: paste primary must still be the top row.
  source.regions = [
    { id: 'region-b', trackId: 'source-b', patternId: 'pattern-b', start: 120, length: 360, offset: 30, loop: true },
    { id: 'region-a', trackId: 'source-a', patternId: 'pattern-a', start: 240, length: 480, offset: 60, loop: false },
  ];
  source.assets.push({ id: 'source-archive', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }, { id: 'source-reference', name: 'reference.wav', mime: 'audio/wav', data: 'AA==' });
  source.midi = { schema: 1, format: 1, sourceAssetId: 'source-archive', conductor: [{ id: 'source-conductor', tick: 0, order: 1, event: { deltaTime: 0, type: 'text', text: 'Do not transfer' } }] };
  source.reference = { assetId: 'source-reference', startTick: 100, gain: .5 };
  target.tracks = [{ ...newTrack('Target first', 0, 'bell'), id: 'target-0', volume: 2, pan: .3 }, { ...newTrack('Locked unused gap', 1), id: 'target-1', locked: true }, { ...newTrack('Target last', 2, 'flute'), id: 'target-2' }];
  target.regions[0].trackId = 'target-0'; target.patterns[0].notes = [{ ...newNote(17.25, 55, 61.5), id: 'untouched-target-note' }];
  target.tempos = [{ tick: 0, bpm: 96 }, { tick: 960, bpm: 180 }];
  target.assets.push({ id: 'target-archive', name: 'target.mid', mime: 'audio/midi', data: 'AgMEBQ==' });
  target.midi = { schema: 1, format: 1, sourceAssetId: 'target-archive', conductor: [{ id: 'target-conductor', tick: 21, order: 9, sourceTrack: 1, event: { deltaTime: 0, type: 'sysEx', data: [9, 8] } }] };
  const ids = new Set(['region-a', 'region-b']);
  return { source, target, ids, custom, copied: () => createRegionClipboard(source, ids, 7, 'region-b') };
}
function merge(target: Project, plan: RegionPastePlan): Project {
  const result = structuredClone(target);
  for (const field of ['tracks', 'patterns', 'regions', 'instruments', 'assets'] as const) result[field].push(...structuredClone(plan[field]) as never[]);
  return result;
}
function freezeTree(value: object) { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freezeTree(item); }
// Independent container-wire oracle: data is stored as binary asset entries and
// saveNbsx writes a normal 24-byte ISO stamp, whatever the model previously held.
function wireManifestBytes(project: Project) {
  const assets = project.assets.map(asset => { const copy = { ...asset }; if (copy.data) delete copy.data; return copy; });
  return new TextEncoder().encode(JSON.stringify({ ...project, modifiedAt: '2026-01-01T00:00:00.000Z', assets })).length;
}
afterEach(() => vi.restoreAllMocks());

describe('independent complete-source region snapshots', () => {
  it('copies locked sources, complete cropped-out notes/messages and the document row gap, with only the required resource closure', () => {
    const { source, copied } = fixture(), before = structuredClone(source), clipboard = copied();
    expect(clipboard).toMatchObject({ schema: 1, ppq: 480, sourceProjectId: source.id, documentKey: 7, primaryRegionId: 'region-b' });
    expect(clipboard.tracks.map(track => track.id)).toEqual(['source-a', 'source-gap', 'source-b']); expect(clipboard.tracks[0].locked).toBe(true);
    expect(clipboard.regions.map(region => region.id)).toEqual(['region-b', 'region-a']); expect(clipboard.patterns.map(pattern => pattern.id)).toEqual(['pattern-a', 'pattern-b']);
    expect(clipboard.patterns[0].notes[1]).toEqual(source.patterns[0].notes[1]); expect(clipboard.patterns[0].midiEvents).toEqual(source.patterns[0].midiEvents);
    expect(clipboard.instruments.map(instrument => instrument.id)).toEqual(['source-default', 'gap-default', 'bottom-default', 'custom']);
    expect(clipboard.assets.map(asset => asset.id)).toEqual(['source-default-sample', 'gap-default-sample', 'bottom-default-sample', 'custom-sample']);
    for (const field of ['tempos', 'midi', 'reference', 'conductor']) expect(clipboard).not.toHaveProperty(field);
    expect(source).toEqual(before);
    source.tracks[1].delay!.feedback = .9; source.patterns[0].notes[0].midiSource!.releaseVelocity = 99;
    const event = source.patterns[0].midiEvents![0].event; if (event.type !== 'sysEx' || !Array.isArray(event.data)) throw new Error('Expected SysEx'); event.data[0] = 99;
    source.assets[0].data = 'CQ=='; expect(clipboard.tracks[1].delay!.feedback).toBe(.25); expect(clipboard.patterns[0].notes[0].midiSource!.releaseVelocity).toBe(41);
    expect(clipboard.patterns[0].midiEvents![0].event).toMatchObject({ data: [1, 2, 3] }); expect(clipboard.assets[0].data).toBe('AAEC');
  });

  it.each(['empty', 'stale', 'primary', 'asset', 'document'] as const)('rejects an invalid %s copy atomically', invalid => {
    const { source, ids } = fixture(); let primary: string | undefined = 'region-b', key = 7;
    if (invalid === 'empty') ids.clear(); if (invalid === 'stale') ids.add('deleted'); if (invalid === 'primary') primary = 'deleted';
    if (invalid === 'asset') source.assets = source.assets.filter(asset => asset.id !== 'gap-default-sample'); if (invalid === 'document') key = .5;
    const before = structuredClone(source); expect(() => createRegionClipboard(source, ids, key, primary)).toThrow(); expect(source).toEqual(before);
  });
});

describe('pure PPQ-aware region paste placement and resources', () => {
  it('converts all source time fields from 480 to 960, preserves payload time data, and keeps existing destination settings', () => {
    const { source, target, copied } = fixture(), clipboard = copied(), before = structuredClone({ source, target, clipboard });
    const plan = planRegionPaste(target, clipboard, 60, 'target-0', 8, new Set(['target-0', 'target-2']));
    expect(plan.tracks).toEqual([]); expect(plan.regions.map(region => [region.trackId, region.start, region.length, region.offset, region.loop])).toEqual([
      ['target-2', 60, 720, 60, true], ['target-0', 300, 960, 120, false],
    ]);
    expect(plan.primaryRegionId).toBe(plan.regions[1].id); // top source row, even though the lower row is earlier
    const top = plan.patterns[1]; expect(top.name).toBe('Full source A'); expect(top.length).toBe(1920);
    expect(top.notes.map(note => [note.tick, note.duration])).toEqual([[120, 241], [2400, 0]]);
    expect(top.notes[0]).toMatchObject({ midi: 60, velocity: .73, pan: -.2, detune: 12.5, height: .75, midiSource: { onOrder: 7, offOrder: 12, releaseVelocity: 41 } });
    expect(top.midiEvents!.map(({ id, ...event }) => event)).toEqual([
      { tick: 60, order: 5, sourceTrack: 11, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } },
      { tick: 2400, order: 6, sourceTrack: 12, event: { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 625000 } },
    ]);
    expect(plan.instruments.map(instrument => instrument.id)).toEqual(['custom']); expect(plan.assets.map(asset => asset.id)).toEqual(['custom-sample']);
    expect(plan.patterns[0]).toMatchObject({ name: 'Loop source B', length: 960, notes: [{ tick: 180, duration: 480 }] });
    expect(plan.diagnostics.some(diagnostic => diagnostic.code === 'clipboard-ppq-scaled')).toBe(true);
    expect({ source, target, clipboard }).toEqual(before);
    const result = merge(target, plan); expect(result.tracks).toEqual(target.tracks); expect(result.tempos).toEqual(target.tempos); expect(result.midi).toEqual(target.midi);
    expect(validateProject(result)).toBe(result); const reopened = openNbsx(saveNbsx(result)); expect({ ...reopened, modifiedAt: result.modifiedAt }).toEqual(result);
  });

  it('supports fractional downscaling and zero display durations without rounding to a grid', () => {
    const { source, target, copied } = fixture(); source.ppq = 960; target.ppq = 480;
    source.patterns[0].notes[0].tick = 60.25; source.patterns[0].notes[0].duration = .25;
    const plan = planRegionPaste(target, copied(), 60, 'target-0', 8);
    expect(plan.regions.map(region => [region.start, region.length, region.offset])).toEqual([[60, 180, 15], [120, 240, 30]]);
    expect(plan.patterns[1].notes.map(note => [note.tick, note.duration])).toEqual([[30.125, .125], [600, 0]]);
  });

  it('adds tail rows including their gap with original names/mix/Delay, new ownership, and only those row defaults', () => {
    const { source, target, copied } = fixture(), clipboard = copied(), before = structuredClone(target), plan = planRegionPaste(target, clipboard, 3840, 'target-2', 8, new Set(['target-2']));
    expect(plan.tracks.map(track => track.name)).toEqual(['Source gap', 'Source B']);
    expect(plan.tracks.map(track => [track.locked, track.midiChannel, track.sourceMidiTrack])).toEqual([[false, 6, undefined], [false, 7, undefined]]);
    expect(plan.tracks[0]).toMatchObject({ volume: .37, pan: -.4, muted: true, solo: false, delay: source.tracks[1].delay });
    expect(plan.instruments.map(instrument => instrument.id)).toEqual(['gap-default', 'bottom-default', 'custom']);
    expect(plan.assets.map(asset => asset.id)).toEqual(['gap-default-sample', 'bottom-default-sample', 'custom-sample']);
    expect(plan.regions[1].trackId).toBe('target-2'); expect(plan.regions[0].trackId).toBe(plan.tracks[1].id); expect(plan.primaryRegionId).toBe(plan.regions[1].id);
    expect(target).toEqual(before); expect(validateProject(merge(target, plan))).toBeTruthy();
  });

  it('can create the full source row span in a document with no tracks', () => {
    const { target, copied } = fixture(); target.tracks = []; target.regions = [];
    const plan = planRegionPaste(target, copied(), 0, undefined, 8);
    expect(plan.tracks.map(track => [track.name, track.locked, track.sourceMidiTrack])).toEqual([['Source A', false, undefined], ['Source gap', false, undefined], ['Source B', false, undefined]]);
    expect(plan.instruments).toHaveLength(4); expect(plan.primaryRegionId).toBe(plan.regions[1].id); expect(validateProject(merge(target, plan))).toBeTruthy();
  });

  it('remaps conflicting IDs without changing target samples, and reuses a complete identical definition under other IDs', () => {
    const { target, copied, custom } = fixture(), clipboard = copied();
    target.instruments.push({ ...custom.instrument, rootMidi: 70 }); target.assets.push({ ...custom.asset, data: 'BwgJ' });
    const before = structuredClone(target), collision = planRegionPaste(target, clipboard, 0, 'target-0', 8);
    expect(collision.instruments).toHaveLength(1); expect(collision.assets).toHaveLength(1);
    expect(collision.instruments[0].id).not.toBe('custom'); expect(collision.assets[0].id).not.toBe('custom-sample');
    expect(collision.instruments[0].assetId).toBe(collision.assets[0].id); expect(collision.patterns[1].notes[1].instrumentId).toBe(collision.instruments[0].id);
    expect({ ...collision.assets[0], id: custom.asset.id }).toEqual(custom.asset); expect(target).toEqual(before);
    target.assets.push({ ...custom.asset, id: 'equal-sample' }); target.instruments.push({ ...custom.instrument, id: 'equal-instrument', assetId: 'equal-sample' });
    const reused = planRegionPaste(target, clipboard, 0, 'target-0', 8);
    expect(reused.instruments).toEqual([]); expect(reused.assets).toEqual([]); expect(reused.patterns[1].notes[1].instrumentId).toBe('equal-instrument');
  });

  it('preserves NoteOff routes only for the same document instance and exact existing destination track', () => {
    const { source, copied } = fixture(), clipboard = copied(); source.tracks[0].locked = false;
    const same = planRegionPaste(source, clipboard, 0, 'source-a', 7);
    expect(same.patterns.map(pattern => pattern.notes[0].midiSource?.offSourceTrack)).toEqual([5, 3]);
    const newDocumentSameId = planRegionPaste(source, clipboard, 0, 'source-a', 8);
    expect(newDocumentSameId.patterns.map(pattern => pattern.notes[0].midiSource)).toEqual([{ onOrder: 17, offOrder: 22, releaseVelocity: 59 }, { onOrder: 7, offOrder: 12, releaseVelocity: 41 }]);
    source.tracks[1].locked = false;
    const movedTracks = planRegionPaste(source, clipboard, 0, 'source-gap', 7);
    expect(movedTracks.patterns.every(pattern => pattern.notes[0].midiSource?.offSourceTrack === undefined)).toBe(true); expect(movedTracks.tracks[0]).not.toHaveProperty('sourceMidiTrack');
    expect(movedTracks.patterns[1].midiEvents![0].sourceTrack).toBe(11);
  });

  it('independently clones every occurrence even when the source was shared, without mutating frozen inputs', () => {
    const { source, target, ids } = fixture(); source.regions.push({ ...source.regions[1], id: 'top-copy', start: 360 }); ids.add('top-copy');
    const clipboard = createRegionClipboard(source, ids, 7); freezeTree(source); freezeTree(target); freezeTree(clipboard);
    const plan = planRegionPaste(target, clipboard, 0, 'target-0', 8); expect(plan.patterns).toHaveLength(3);
    expect(plan.patterns[1].id).not.toBe(plan.patterns[2].id); expect(plan.patterns[1].notes[0].id).not.toBe(plan.patterns[2].notes[0].id);
    const event = plan.patterns[1].midiEvents![0].event; if (event.type !== 'sysEx' || !Array.isArray(event.data)) throw new Error('Expected SysEx'); event.data[0] = 99;
    expect(plan.patterns[2].midiEvents![0].event).toMatchObject({ data: [1, 2, 3] }); expect(clipboard.patterns[0].midiEvents![0].event).toMatchObject({ data: [1, 2, 3] });
    expect(validateProject(merge(target, plan))).toBeTruthy();
  });
});

describe('region clipboard rejection and capacity boundaries', () => {
  it.each(['', 'short', 'a legacy timestamp far longer than a saved ISO stamp '.repeat(4)].flatMap(modifiedAt => [
    { kind: 'regions' as const, modifiedAt }, { kind: 'notes' as const, modifiedAt },
  ]))('budgets the actual save timestamp for $kind with legacy modifiedAt="$modifiedAt" at exactly 64 MB and one byte over', ({ kind, modifiedAt }) => {
    const { source, target, copied } = fixture(), clipboard = copied(); target.modifiedAt = modifiedAt;
    const noteClipboard = createNoteClipboard(source, source.patterns[0].notes, 'source-a', 7);
    const planned = () => {
      if (kind === 'regions') return merge(target, planRegionPaste(target, clipboard, 0, 'target-0', 8));
      const plan = planNotePaste(target, noteClipboard, 0, 'target-0', 8), result = structuredClone(target);
      result.patterns[0].notes.push(...plan.notes); result.instruments.push(...plan.instruments); result.assets.push(...plan.assets); return result;
    };
    const limit = 64 * 1024 * 1024, empty = planned(); target.description = 'x'.repeat(limit - wireManifestBytes(empty));
    const exact = planned(); expect(wireManifestBytes(exact)).toBe(limit);
    expect(saveNbsx(exact).byteLength).toBeGreaterThan(0);
    expect(target.modifiedAt).toBe(modifiedAt); const regionRefs = target.regions, patternRefs = target.patterns;
    target.description += 'x'; expect(() => planned()).toThrow('64 MB');
    expect(() => saveNbsx({ ...exact, description: exact.description + 'x' })).toThrow('64 MB');
    expect(target.regions).toBe(regionRefs); expect(target.patterns).toBe(patternRefs); expect(target.modifiedAt).toBe(modifiedAt);
  }, 20000);

  it.each(['missing-target', 'locked-top', 'locked-bottom', 'hidden-top', 'hidden-bottom'] as const)('rejects actual %s targets, while an unused locked/hidden gap is allowed', invalid => {
    const { target, copied } = fixture(), clipboard = copied(), visible = new Set(['target-0', 'target-2']); let trackId: string | undefined = 'target-0';
    if (invalid === 'missing-target') trackId = undefined; if (invalid === 'locked-top') target.tracks[0].locked = true; if (invalid === 'locked-bottom') target.tracks[2].locked = true;
    if (invalid === 'hidden-top') visible.delete('target-0'); if (invalid === 'hidden-bottom') visible.delete('target-2');
    const before = structuredClone({ target, clipboard }), allocated = vi.spyOn(crypto, 'randomUUID');
    expect(() => planRegionPaste(target, clipboard, 0, trackId, 8, visible)).toThrow(); expect({ target, clipboard }).toEqual(before); expect(allocated).not.toHaveBeenCalled();
  });

  it.each(['pattern', 'track', 'primary', 'duplicate-note', 'outside-note', 'outside-event', 'orphan-resource', 'asset', 'track-flags', 'ppq'] as const)('fully rejects a malformed %s snapshot before importing any subset', invalid => {
    const { target, copied } = fixture(), clipboard = copied();
    if (invalid === 'pattern') clipboard.patterns.pop(); if (invalid === 'track') clipboard.regions[0].trackId = 'deleted'; if (invalid === 'primary') clipboard.primaryRegionId = 'deleted';
    if (invalid === 'duplicate-note') clipboard.patterns[0].notes[1].id = clipboard.patterns[0].notes[0].id;
    if (invalid === 'outside-note') clipboard.patterns[0].notes[1].midi = 128;
    if (invalid === 'outside-event') clipboard.patterns[0].midiEvents![1].tick = NaN;
    if (invalid === 'orphan-resource') clipboard.instruments.push({ ...clipboard.instruments[0], id: 'unused-broken', assetId: 'missing-asset' });
    if (invalid === 'asset') clipboard.assets[0].data = 'invalid!'; if (invalid === 'track-flags') (clipboard.tracks[1] as unknown as { locked: unknown }).locked = 1;
    if (invalid === 'ppq') clipboard.ppq = 0;
    const before = structuredClone({ target, clipboard }), allocated = vi.spyOn(crypto, 'randomUUID');
    expect(() => planRegionPaste(target, clipboard, 0, 'target-0', 8)).toThrow(); expect({ target, clipboard }).toEqual(before); expect(allocated).not.toHaveBeenCalled();
  });

  it.each(['pattern-short', 'region-short', 'offset-overflow', 'note-overflow'] as const)('rejects converted %s instead of clamping the musical timing', invalid => {
    const { source, target, copied } = fixture();
    if (invalid.endsWith('short')) { source.ppq = 960; target.ppq = 480; }
    if (invalid === 'pattern-short') source.patterns[0].length = 1; if (invalid === 'region-short') source.regions[1].length = 1;
    if (invalid === 'offset-overflow') source.regions[1].offset = 1e12; if (invalid === 'note-overflow') source.patterns[0].notes[1].duration = 1e12;
    const clipboard = copied(), allocated = vi.spyOn(crypto, 'randomUUID'); expect(() => planRegionPaste(target, clipboard, 0, 'target-0', 8)).toThrow('工程范围'); expect(allocated).not.toHaveBeenCalled();
  });

  it('allows the legal maximum region start without imposing a start-plus-length limit', () => {
    const { source, target } = fixture(), clipboard = createRegionClipboard(source, new Set(['region-a']), 7);
    const plan = planRegionPaste(target, clipboard, 1e12, 'target-0', 8); expect(plan.regions[0].start).toBe(1e12); expect(plan.regions[0].length).toBe(960);
    expect(validateProject(merge(target, plan))).toBeTruthy();
    expect(() => planRegionPaste(target, clipboard, 1e12 + 1, 'target-0', 8)).toThrow();
  });

  it('preflights the actual track limit before allocating any new row or resource', () => {
    const { target, copied } = fixture(), clipboard = copied();
    while (target.tracks.length < 10000) { const index = target.tracks.length; target.tracks.push({ ...newTrack('Filler'), id: `target-fill-${index}` }); }
    const count = target.tracks.length, allocated = vi.spyOn(crypto, 'randomUUID'); expect(() => planRegionPaste(target, clipboard, 0, target.tracks.at(-1)!.id, 8)).toThrow('安全上限');
    expect(target.tracks).toHaveLength(count); expect(allocated).not.toHaveBeenCalled();
  });

  it('rejects declared oversized note/message arrays before traversing or cloning them', () => {
    const { target, copied } = fixture(), clipboard = copied();
    clipboard.patterns[0].notes = Array(2000001).fill(clipboard.patterns[0].notes[0]);
    expect(() => planRegionPaste(target, clipboard, 0, 'target-0', 8)).toThrow('200 万');
    const messages = copied(); messages.patterns[0].midiEvents = Array(2000001).fill(messages.patterns[0].midiEvents![0]);
    expect(() => planRegionPaste(target, messages, 0, 'target-0', 8)).toThrow('MIDI 消息数量');
  });

  it('checks the 64 MB compact manifest before cloning a large resource snapshot', () => {
    const { source, ids } = fixture(), name = 'x'.repeat(300000);
    for (let index = 0; index < 230; index++) {
      const id = `large-${index}`, { asset } = addInstrument(source, id, 'AA=='); asset.name = name;
      source.patterns[0].notes.push({ ...newNote(index, 60), id: `large-note-${index}`, instrumentId: id });
    }
    expect(() => createRegionClipboard(source, ids, 7)).toThrow('64 MB');
  });

  it('counts expanded sample bytes even when many assets share the same compact in-memory Base64 string', () => {
    const { source, ids } = fixture(), data = 'A'.repeat(4 * 1024 * 1024); // 3 MiB decoded per separately stored asset
    for (let index = 0; index < 171; index++) {
      const id = `binary-${index}`; addInstrument(source, id, data);
      source.patterns[0].notes.push({ ...newNote(index, 60), id: `binary-note-${index}`, instrumentId: id });
    }
    expect(() => createRegionClipboard(source, ids, 7)).toThrow('512 MB');
  }, 15000);
});
