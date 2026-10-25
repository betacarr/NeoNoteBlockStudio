import { produce } from 'immer';
import { parseMidi } from 'midi-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { exportMidi, originalMidi } from '../src/core/midi';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import { allocateTrackMidiChannel, deleteTrack, inspectTrackDelete, inspectTrackMove, moveTrackInView } from '../src/core/track-management';
import type { Project } from '../src/core/types';
import { midiEnd, smf } from './fixtures/midi';

function fixture() {
  const project = createProject('Track management'); project.ppq = 480;
  const instruments = ['harp', 'bass', 'flute', 'bell', 'chime'];
  project.tracks = instruments.map((instrument, index) => ({ ...newTrack(String.fromCharCode(65 + index), index, instrument), id: `track-${index}` }));
  project.tracks[1].locked = true; project.tracks[2].midiChannel = 7;
  project.patterns = project.tracks.map((track, index) => ({ id: `pattern-${index}`, name: track.name, length: 960,
    notes: [{ ...newNote(index * 60, 60 + index, 120), id: `note-${index}`, velocity: .75,
      midiSource: { onOrder: 7, offOrder: 9, releaseVelocity: 41, offSourceTrack: 4 } }],
    midiEvents: [{ id: `message-${index}`, tick: 30, order: 2, sourceTrack: 2,
      event: { deltaTime: 0, type: 'sysEx' as const, data: [index, 2, 3] } }] }));
  project.regions = project.tracks.map((track, index) => ({ id: `region-${index}`, trackId: track.id, patternId: `pattern-${index}`, start: 0, offset: 0, length: 960, loop: false }));
  project.patterns.push({ id: 'old-orphan', name: 'Unrelated historical source', length: 1, notes: [newNote(0, 52, 0)] });
  return project;
}
const visible = new Set(['track-0', 'track-2', 'track-3']);
function midiSummary(project: Project) {
  return parseMidi(exportMidi(project).bytes).tracks.slice(1).map(events => {
    const name = events.find(event => event.type === 'trackName'); let tick = 0;
    const notes: number[][] = [], programs: number[][] = [];
    for (const event of events) {
      tick += event.deltaTime;
      if (event.type === 'noteOn' || event.type === 'noteOff') notes.push([tick, event.channel, event.noteNumber, event.velocity]);
      if (event.type === 'programChange') programs.push([tick, event.channel, event.programNumber]);
    }
    return { name: name?.type === 'trackName' ? name.text : '', notes, programs };
  });
}
const literalMidi = [
  { name: 'A', notes: [[0, 0, 60, 95], [120, 0, 60, 41]], programs: [[0, 0, 0]] },
  { name: 'B', notes: [[60, 1, 61, 95], [180, 1, 61, 41]], programs: [[0, 1, 32]] },
  { name: 'C', notes: [[120, 7, 62, 95], [240, 7, 62, 41]], programs: [[0, 7, 73]] },
  { name: 'D', notes: [[180, 3, 63, 95], [300, 3, 63, 41]], programs: [[0, 3, 14]] },
  { name: 'E', notes: [[240, 4, 64, 95], [360, 4, 64, 41]], programs: [[0, 4, 10]] },
];
function wireBytes(project: Project) {
  const assets = project.assets.map(asset => { const copy = { ...asset }; if (copy.data) delete copy.data; return copy; });
  return new TextEncoder().encode(JSON.stringify({ ...project, modifiedAt: '2000-01-01T00:00:00.000Z', assets })).length;
}
function expectedVisibleMove(project: Project): Project {
  const next = structuredClone(project), first = next.tracks[0];
  next.tracks[0] = next.tracks[2]; next.tracks[2] = first; first.midiChannel = 0;
  return next;
}
afterEach(() => vi.restoreAllMocks());

describe('visible track ordering and preserved MIDI defaults', () => {
  it('swaps just two visible canonical slots, retaining hidden positions and untouched source references', () => {
    const project = fixture(), before = structuredClone(project), originalTracks = project.tracks.slice();
    expect(inspectTrackMove(project, 'track-2', -1, visible)).toEqual({ ok: true, targetId: 'track-0' }); expect(project).toEqual(before);
    expect(moveTrackInView(project, 'track-2', -1, visible)).toBe(true);
    expect(project).toEqual(expectedVisibleMove(before)); expect(project.tracks.map(track => track.id)).toEqual(['track-2', 'track-1', 'track-0', 'track-3', 'track-4']);
    project.tracks.forEach(track => expect(track).toBe(originalTracks.find(original => original.id === track.id)));
    expect(project.tracks[1]).toBe(originalTracks[1]); expect(project.tracks[1]).not.toHaveProperty('midiChannel'); expect(project.tracks[4]).not.toHaveProperty('midiChannel');
    expect(project.patterns).toEqual(before.patterns); expect(project.regions).toEqual(before.regions);
  });

  it('preserves literal SMF note channels, timings and GM programs after a filtered move', () => {
    const project = fixture(); expect(midiSummary(project)).toEqual(literalMidi);
    expect(moveTrackInView(project, 'track-2', -1, visible)).toBe(true);
    expect(midiSummary(project)).toEqual([literalMidi[2], literalMidi[1], literalMidi[0], literalMidi[3], literalMidi[4]]);
  });

  it('moves a locked selected track and swaps with a locked neighbor without changing its lock or mix', () => {
    const project = fixture(), original = structuredClone(project.tracks[1]);
    expect(inspectTrackMove(project, 'track-1', -1)).toEqual({ ok: true, targetId: 'track-0' });
    expect(moveTrackInView(project, 'track-1', -1)).toBe(true);
    expect(project.tracks[0]).toEqual({ ...original, midiChannel: 1 }); expect(project.tracks[1].midiChannel).toBe(0);
    expect(moveTrackInView(project, 'track-0', -1)).toBe(true); expect(project.tracks[1].locked).toBe(true);
  });

  it('does not pin channels when visible neighbors swap document positions sixteen apart', () => {
    const project = fixture(); project.tracks = Array.from({ length: 17 }, (_, index) => ({ ...newTrack(`T${index}`), id: `t${index}` }));
    project.regions = [];
    expect(moveTrackInView(project, 't0', 1, new Set(['t0', 't16']))).toBe(true);
    expect(project.tracks[0].id).toBe('t16'); expect(project.tracks[16].id).toBe('t0');
    expect(project.tracks.every(track => track.midiChannel === undefined)).toBe(true);
  });

  it.each(['first', 'last', 'one-visible', 'hidden', 'stale', 'empty-id', 'direction'] as const)('rejects a %s move without changing an Immer snapshot or allocating IDs', kind => {
    const project = fixture(), ids = vi.spyOn(crypto, 'randomUUID'); let id = 'track-0', direction: -1 | 1 = -1, view: ReadonlySet<string> | undefined;
    if (kind === 'last') { id = 'track-4'; direction = 1; }
    if (kind === 'one-visible') { id = 'track-2'; view = new Set([id]); }
    if (kind === 'hidden') view = new Set(['track-2']);
    if (kind === 'stale') id = 'missing'; if (kind === 'empty-id') id = '';
    if (kind === 'direction') direction = 0 as -1;
    expect(inspectTrackMove(project, id, direction, view).ok).toBe(false);
    const next = produce(project, draft => { expect(moveTrackInView(draft, id, direction, view)).toBe(false); });
    expect(next).toBe(project); expect(ids).not.toHaveBeenCalled();
  });

  it('works through Immer with unchanged patterns/resources and supports exact snapshot undo', () => {
    const project = fixture(), before = structuredClone(project);
    const moved = produce(project, draft => { expect(moveTrackInView(draft, 'track-2', -1, visible)).toBe(true); });
    expect(project).toEqual(before); expect(moved).toEqual(expectedVisibleMove(before));
    expect(moved.patterns).toBe(project.patterns); expect(moved.regions).toBe(project.regions); expect(moved.instruments).toBe(project.instruments); expect(moved.assets).toBe(project.assets);
    expect(moved.tracks[1]).toBe(project.tracks[1]); expect(moved.tracks[4]).toBe(project.tracks[4]);
    const history = [project, moved]; expect(history[0]).toEqual(before); expect(history[1]).toEqual(expectedVisibleMove(before));
    expect({ ...openNbsx(saveNbsx(moved)), modifiedAt: moved.modifiedAt }).toEqual(moved);
  });
});

describe('single-track deletion and source ownership', () => {
  it('deletes all and only selected-track regions, clearing newly unused sources while retaining shared and historical sources', () => {
    const project = fixture(); project.regions[2].patternId = 'pattern-0';
    project.regions.push({ ...project.regions[2], id: 'exclusive-c', patternId: 'pattern-2', start: 1200 });
    const before = structuredClone(project), shared = project.patterns[0], orphan = project.patterns.at(-1), remaining = project.regions.filter(region => region.trackId !== 'track-2');
    expect(inspectTrackDelete(project, 'track-2', visible)).toEqual({ ok: true }); expect(project).toEqual(before);
    expect(deleteTrack(project, 'track-2', visible)).toEqual({ removedRegionIds: ['region-2', 'exclusive-c'], removedPatternIds: ['pattern-2'] });
    expect(project.tracks.map(track => track.id)).toEqual(['track-0', 'track-1', 'track-3', 'track-4']);
    expect(project.tracks.map(track => track.midiChannel)).toEqual([undefined, undefined, 3, 4]);
    expect(project.regions).toEqual(remaining); remaining.forEach((region, index) => expect(project.regions[index]).toBe(region));
    expect(project.patterns[0]).toBe(shared); expect(project.patterns.at(-1)).toBe(orphan);
    expect(project.patterns.map(pattern => pattern.id)).toEqual(['pattern-0', 'pattern-1', 'pattern-3', 'pattern-4', 'old-orphan']);
    expect(project.instruments).toEqual(before.instruments); expect(project.assets).toEqual(before.assets);
    expect(validateProject(project)).toBe(project);
  });

  it('keeps literal MIDI channels and GM programs of survivors after deleting the first track', () => {
    const project = fixture(); expect(deleteTrack(project, 'track-0')).toEqual({ removedRegionIds: ['region-0'], removedPatternIds: ['pattern-0'] });
    expect(midiSummary(project)).toEqual(literalMidi.slice(1));
    expect(project.tracks.map(track => track.midiChannel)).toEqual([1, 7, 3, 4]);
    expect(allocateTrackMidiChannel(project)).toBe(0);
  });

  it('keeps original MIDI archive buckets and NoteOff routes even when a document track is removed', () => {
    const project = fixture(), bytes = smf([[0, 144, 60, 100, 120, 128, 60, 41, ...midiEnd]], 0);
    project.tracks[0].sourceMidiTrack = 2; project.tracks[4].sourceMidiTrack = 4;
    project.assets = [{ id: 'archive', name: 'source.mid', mime: 'audio/midi', data: bytesToBase64(bytes) }];
    project.midi = { schema: 1, format: 1, sourceAssetId: 'archive', sourceTrackNames: ['Conductor', 'One', 'Source two', 'Three', 'Source four'], conductor: [
      { id: 'conductor', tick: 0, order: 1, sourceTrack: 4, event: { deltaTime: 0, type: 'text', text: 'Archived bucket survives' } },
    ] };
    project.provenance = { kind: 'midi', filename: 'source.mid', metadata: { exact: [1, 2, 3] } };
    const patterns = project.patterns, assets = project.assets, midi = project.midi, provenance = project.provenance;
    expect(deleteTrack(project, 'track-4')?.removedPatternIds).toEqual(['pattern-4']);
    expect(project.patterns[0]).toBe(patterns[0]); expect(project.patterns[0].notes[0].midiSource?.offSourceTrack).toBe(4);
    expect(project.tracks[0].sourceMidiTrack).toBe(2); expect(project.assets).toBe(assets); expect(project.midi).toBe(midi); expect(project.provenance).toBe(provenance);
    expect(originalMidi(project)!.bytes).toEqual(bytes);
    const exported = parseMidi(exportMidi(project).bytes).tracks;
    const noteOnTrack = exported.find(events => events.some(event => event.type === 'noteOn' && event.noteNumber === 60))!;
    const noteOffTrack = exported.find(events => events.some(event => event.type === 'noteOff' && event.noteNumber === 60))!;
    expect(noteOnTrack).not.toBe(noteOffTrack);
    expect(noteOffTrack.find(event => event.type === 'text')).toMatchObject({ text: 'Archived bucket survives' });
    expect(noteOffTrack.find(event => event.type === 'noteOff')).toMatchObject({ channel: 0, noteNumber: 60, velocity: 41 });
    expect({ ...openNbsx(saveNbsx(project)), modifiedAt: project.modifiedAt }).toEqual(project);
  });

  it('retains sources that were already orphaned and preserves original array references for an empty track deletion', () => {
    const project = fixture(); project.regions = project.regions.filter(region => region.trackId !== 'track-3');
    const regions = project.regions, patterns = project.patterns;
    expect(deleteTrack(project, 'track-3')).toEqual({ removedRegionIds: [], removedPatternIds: [] });
    expect(project.regions).toBe(regions); expect(project.patterns).toBe(patterns); expect(project.patterns.some(pattern => pattern.id === 'pattern-3')).toBe(true);
  });

  it('can remove the last track and save/reopen the resulting empty arrangement', () => {
    const project = createProject(); project.patterns[0].notes = [newNote(0, 66)]; const originalAssets = project.assets, originalInstruments = project.instruments;
    const regionId = project.regions[0].id, patternId = project.patterns[0].id;
    expect(deleteTrack(project, project.tracks[0].id)).toEqual({ removedRegionIds: [regionId], removedPatternIds: [patternId] });
    expect(project.tracks).toEqual([]); expect(project.patterns).toEqual([]); expect(project.regions).toEqual([]);
    expect(project.assets).toBe(originalAssets); expect(project.instruments).toBe(originalInstruments);
    expect({ ...openNbsx(saveNbsx(project)), modifiedAt: project.modifiedAt }).toEqual(project);
    expect(inspectTrackMove(project, 'missing', 1).ok).toBe(false); expect(inspectTrackDelete(project, 'missing').ok).toBe(false);
  });

  it.each(['locked', 'hidden', 'stale', 'empty-id'] as const)('does not partially delete a %s track or clear redo with a changed reference', kind => {
    const project = fixture(), allocate = vi.spyOn(crypto, 'randomUUID'); let id = 'track-1', view: ReadonlySet<string> | undefined;
    if (kind === 'hidden') { id = 'track-0'; view = new Set(['track-2']); }
    if (kind === 'stale') id = 'gone'; if (kind === 'empty-id') id = '';
    expect(inspectTrackDelete(project, id, view).ok).toBe(false);
    expect(produce(project, draft => { expect(deleteTrack(draft, id, view)).toBeUndefined(); })).toBe(project); expect(allocate).not.toHaveBeenCalled();
  });
});

describe('full-source guards and explicit MIDI channel allocation', () => {
  it.each(['duplicate-track', 'duplicate-pattern', 'duplicate-region', 'duplicate-note', 'missing-track', 'missing-pattern', 'missing-instrument'] as const)('rejects %s data before any track or source mutation', invalid => {
    const project = fixture();
    if (invalid === 'duplicate-track') project.tracks[4].id = project.tracks[0].id;
    if (invalid === 'duplicate-pattern') project.patterns[1].id = project.patterns[0].id;
    if (invalid === 'duplicate-region') project.regions[1].id = project.regions[0].id;
    if (invalid === 'duplicate-note') project.patterns[1].notes[0].id = project.patterns[0].notes[0].id;
    if (invalid === 'missing-track') project.regions[4].trackId = 'gone';
    if (invalid === 'missing-pattern') project.regions[4].patternId = 'gone';
    if (invalid === 'missing-instrument') project.tracks[4].instrumentId = 'gone';
    const before = structuredClone(project), allocate = vi.spyOn(crypto, 'randomUUID');
    expect(inspectTrackMove(project, 'track-0', 1).ok).toBe(false); expect(inspectTrackDelete(project, 'track-0').ok).toBe(false);
    expect(moveTrackInView(project, 'track-0', 1)).toBe(false); expect(deleteTrack(project, 'track-0')).toBeUndefined();
    expect(project).toEqual(before); expect(allocate).not.toHaveBeenCalled();
  });

  it('accepts the exact schema track-count boundary and rejects only the next track', () => {
    const project = fixture(); project.tracks = Array.from({ length: 10000 }, (_, index) => ({ ...newTrack(`T${index}`), id: `t${index}` })); project.regions = [];
    expect(moveTrackInView(project, 't0', 1, new Set(['t0', 't9999']))).toBe(true);
    expect(project.tracks[0]).toMatchObject({ id: 't9999', midiChannel: 15 }); expect(project.tracks[9999]).toMatchObject({ id: 't0', midiChannel: 0 });
    project.tracks.push({ ...newTrack('Too many'), id: 'too-many' }); const tracks = project.tracks;
    expect(inspectTrackMove(project, 't0', -1).ok).toBe(false); expect(deleteTrack(project, 't0')).toBeUndefined(); expect(project.tracks).toBe(tracks);
  });

  it('prefers a free index channel, otherwise the first free channel, without skipping percussion channel9', () => {
    const project = fixture(); const before = structuredClone(project);
    expect(allocateTrackMidiChannel(project)).toBe(5); expect(allocateTrackMidiChannel(project, 23)).toBe(2);
    project.tracks = Array.from({ length: 9 }, (_, index) => ({ ...newTrack(`T${index}`), id: `t${index}` }));
    expect(allocateTrackMidiChannel(project, 1)).toBe(9); expect(allocateTrackMidiChannel({ ...project, tracks: [] })).toBe(0);
    expect(before.tracks.map(track => track.midiChannel)).toEqual([undefined, undefined, 7, undefined, undefined]);
  });

  it('uses effective explicit/implicit channels and reuses preferred only when all sixteen are occupied', () => {
    const project = fixture(); project.tracks = Array.from({ length: 16 }, (_, index) => ({ ...newTrack(`T${index}`), id: `t${index}`, midiChannel: 15 - index }));
    expect(allocateTrackMidiChannel(project, 34)).toBe(2); expect(allocateTrackMidiChannel(project)).toBe(0);
    project.tracks.pop(); expect(allocateTrackMidiChannel(project, 2)).toBe(0);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid preferred index %s', index => {
    const project = fixture(), before = structuredClone(project); expect(() => allocateTrackMidiChannel(project, index)).toThrow('索引'); expect(project).toEqual(before);
  });
});

describe('atomic saved-project byte budgets', () => {
  it('uses the24-byte writer timestamp and rejects channel-pin growth above64MiB before any write', () => {
    const project = fixture(); project.modifiedAt = '';
    const projected = expectedVisibleMove(project), limit = 64 * 1024 * 1024;
    project.description = 'x'.repeat(limit - wireBytes(projected) + 1);
    expect(wireBytes(project)).toBeLessThanOrEqual(limit);
    const tracks = project.tracks, a = project.tracks[0], allocate = vi.spyOn(crypto, 'randomUUID');
    const inspection = inspectTrackMove(project, 'track-2', -1, visible);
    expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason).toMatch(/^轨道整理后工程.*64 MB/);
    expect(moveTrackInView(project, 'track-2', -1, visible)).toBe(false); expect(project.tracks).toBe(tracks); expect(a).not.toHaveProperty('midiChannel'); expect(allocate).not.toHaveBeenCalled();
    project.description = project.description.slice(1);
    expect(moveTrackInView(project, 'track-2', -1, visible)).toBe(true); expect(wireBytes(project)).toBe(limit);
    expect(saveNbsx(project).byteLength).toBeGreaterThan(0); expect(project.modifiedAt).toBe('');
  }, 20000);

  it('checks deletion channel-pin growth too, even when the removed track itself is empty', () => {
    const project = fixture(); project.tracks[1].locked = false;
    while (project.tracks.length < 30) project.tracks.push({ ...newTrack(`T${project.tracks.length}`), id: `extra-${project.tracks.length}` });
    project.regions = project.regions.filter(region => region.trackId !== 'track-0');
    const expected = structuredClone(project); expected.tracks = expected.tracks.slice(1).map((track, index) => track.midiChannel === undefined ? { ...track, midiChannel: (index + 1) % 16 } : track);
    project.description = 'x'.repeat(64 * 1024 * 1024 - wireBytes(expected) + 1);
    expect(wireBytes(project)).toBeLessThanOrEqual(64 * 1024 * 1024);
    const tracks = project.tracks, regions = project.regions, patterns = project.patterns;
    expect(inspectTrackDelete(project, 'track-0').ok).toBe(false); expect(deleteTrack(project, 'track-0')).toBeUndefined();
    expect(project.tracks).toBe(tracks); expect(project.regions).toBe(regions); expect(project.patterns).toBe(patterns);
    expect(project.tracks.every((track, index) => index === 2 || track.midiChannel === undefined)).toBe(true);
  }, 15000);

  it('counts unchanged binary resources against the512MiB expanded budget', () => {
    const project = fixture(), data = 'A'.repeat(4 * 1024 * 1024);
    for (let index = 0; index < 170; index++) project.assets.push({ id: `sample-${index}`, name: 'data.wav', mime: 'audio/wav', data });
    const projected = expectedVisibleMove({ ...project, assets: [] }); projected.assets = project.assets;
    const mimeBytes = new TextEncoder().encode('application/vnd.exnoteblock.project+zip').length;
    project.description = 'x'.repeat(512 * 1024 * 1024 - 510 * 1024 * 1024 - mimeBytes - wireBytes(projected) + 1);
    const tracks = project.tracks, inspection = inspectTrackMove(project, 'track-2', -1, visible);
    expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason).toMatch(/^轨道整理后工程.*512 MB/);
    expect(moveTrackInView(project, 'track-2', -1, visible)).toBe(false); expect(project.tracks).toBe(tracks); expect(project.tracks[0]).not.toHaveProperty('midiChannel');
  }, 15000);
});
