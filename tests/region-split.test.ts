import { produce } from 'immer';
import { parseMidi } from 'midi-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createRegionClipboard, planRegionPaste } from '../src/core/region-clipboard';
import { duplicateRegionGroup } from '../src/core/region-batch';
import { inspectRegionSplit, splitRegionGroup } from '../src/core/region-split';
import { exportMidi, originalMidi } from '../src/core/midi';
import { createProject, flattenNotes, newNote, newTrack, validateProject } from '../src/core/project';
import type { Pattern, Project } from '../src/core/types';

function fixture(shared = false) {
  const project = createProject('Split fixture'); project.ppq = 480;
  project.tracks[0].id = 'track'; project.tracks[0].sourceMidiTrack = 0; project.tracks[0].midiChannel = 3;
  project.patterns = [{ id: 'pattern', name: 'Full independent source', length: 960, notes: [
    { ...newNote(60, 60, 0), id: 'start-note' },
    { ...newNote(240, 64, 960), id: 'long-note', velocity: .73, pan: -.2, detune: 12.5, height: .75, instrumentId: 'bell', midiSource: { onOrder: 7, offOrder: 12, releaseVelocity: 41, offSourceTrack: 4 } },
    { ...newNote(300, 67, 120), id: 'cut-note' }, { ...newNote(500, 72, 0), id: 'after-note' }, { ...newNote(1800, 79, 0), id: 'cropped-note' },
  ], midiEvents: [
    { id: 'cc', tick: 300, order: 3, sourceTrack: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127, running: true } },
    { id: 'sysex', tick: 300, order: 4, sourceTrack: 1, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } },
    { id: 'unknown', tick: 300, order: 5, sourceTrack: 1, event: { deltaTime: 0, type: 'unknownMeta', metatypeByte: 0x7e, data: [4, 5] } },
    { id: 'endpoint', tick: 540, order: 6, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 65, value: 99 } },
    { id: 'outside', tick: 1800, order: 20, event: { deltaTime: 0, type: 'sysEx', data: [9] } },
  ] }];
  project.regions = [{ id: 'region', trackId: 'track', patternId: 'pattern', start: 120, length: 480, offset: 60, loop: false }];
  if (shared) project.regions.push({ ...project.regions[0], id: 'guard', start: 1200 });
  project.assets = [{ id: 'midi-archive', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }];
  project.midi = { schema: 1, format: 1, sourceAssetId: 'midi-archive', conductor: [{ id: 'conductor', tick: 17, order: 1, event: { deltaTime: 0, type: 'text', text: 'Do not edit' } }] };
  return { project, region: project.regions[0], pattern: project.patterns[0], ids: new Set(['region']) };
}
function normalized(pattern: Pattern) {
  return { ...pattern, id: '', notes: pattern.notes.map(({ id, ...note }) => note), ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(({ id, ...event }) => event) } : {}) };
}
function events(project: Project) {
  return parseMidi(exportMidi(project).bytes).tracks.flatMap((track, index) => {
    let tick = 0; return track.map(event => { tick += event.deltaTime; return { track: index, tick, event }; });
  });
}
function wireBytes(project: Project) {
  const assets = project.assets.map(asset => { const copy = { ...asset }; if (copy.data) delete copy.data; return copy; });
  return new TextEncoder().encode(JSON.stringify({ ...project, modifiedAt: '2026-01-01T00:00:00.000Z', assets })).length;
}
afterEach(() => vi.restoreAllMocks());

describe('atomic region split and source ownership', () => {
  it('cuts at the exact fractional playhead, retaining complete source data and note lengths independently', () => {
    const { project, region, pattern, ids } = fixture(), before = structuredClone(project);
    expect(inspectRegionSplit(project, ids, 360.125)).toEqual({ ok: true, count: 1 }); expect(project).toEqual(before);
    const result = splitRegionGroup(project, ids, 360.125)!; expect(result.pairs).toEqual([{ leftId: 'region', rightId: project.regions[1].id }]);
    expect(project.regions[0]).toBe(region); expect(project.regions[0]).toEqual({ ...before.regions[0], length: 240.125, midiEndExclusive: true });
    expect(project.regions[1]).toEqual({ ...before.regions[0], id: result.pairs[0].rightId, patternId: project.patterns[1].id, start: 360.125, length: 239.875, offset: 300.125 });
    expect(project.patterns[0]).toBe(pattern); expect(normalized(project.patterns[1])).toEqual(normalized(pattern));
    expect(project.patterns[1].notes[1].duration).toBe(960); expect(project.patterns[1].notes[4].tick).toBe(1800);
    expect(project.patterns[1].notes[1].midiSource).toEqual({ onOrder: 7, offOrder: 12, releaseVelocity: 41, offSourceTrack: 4 });
    expect(flattenNotes(project).map(note => [note.absoluteTick, note.midi, note.duration])).toEqual([[120, 60, 0], [300, 64, 960], [360, 67, 120], [560, 72, 0]]);
    const data = project.patterns[1].midiEvents![1].event; if (data.type !== 'sysEx' || !Array.isArray(data.data)) throw new Error('Expected SysEx'); data.data[0] = 99;
    expect(pattern).toEqual(before.patterns[0]); expect(project.assets).toEqual(before.assets); expect(project.midi).toEqual(before.midi);
  });

  it('detaches a shared left and right while preserving the unselected reference and all globals', () => {
    const { project, ids, pattern } = fixture(true), original = structuredClone(project), guard = project.regions[1];
    const next = produce(project, draft => { expect(splitRegionGroup(draft, ids, 360)?.pairs).toHaveLength(1); });
    expect(project).toEqual(original); expect(next.regions.map(region => region.id)).toEqual(['region', next.regions[1].id, 'guard']);
    expect(next.regions[2]).toBe(guard); expect(next.patterns[0]).toBe(pattern); expect(next.patterns).toHaveLength(3);
    expect(next.regions[0].patternId).toBe(next.patterns[1].id); expect(next.regions[1].patternId).toBe(next.patterns[2].id);
    expect(normalized(next.patterns[1])).toEqual(normalized(pattern)); expect(normalized(next.patterns[2])).toEqual(normalized(pattern));
    expect(next.assets).toBe(project.assets); expect(next.midi).toBe(project.midi); expect(next.tracks).toBe(project.tracks); expect(next.instruments).toBe(project.instruments); expect(next.tempos).toBe(project.tempos);
    const reopened = openNbsx(saveNbsx(next)); expect({ ...reopened, modifiedAt: next.modifiedAt }).toEqual(next); expect(originalMidi(reopened)!.bytes).toEqual(originalMidi(project)!.bytes);
  });

  it('keeps the last original source when all shared references are split, without creating a new orphan', () => {
    const { project, pattern } = fixture(true); project.regions[1].start = 120;
    const result = splitRegionGroup(project, new Set(['guard', 'region']), 360)!;
    expect(result.pairs.map(pair => pair.leftId)).toEqual(['region', 'guard']); expect(project.patterns).toHaveLength(4);
    expect(project.regions[0].patternId).not.toBe(pattern.id); expect(project.regions[2].patternId).toBe(pattern.id);
    expect(new Set(project.regions.map(region => region.patternId)).size).toBe(4); expect(validateProject(project)).toBe(project);
  });

  it('leaves non-intersecting selected occurrences unchanged and splits only strict interior members', () => {
    const { project, ids } = fixture(); const untouched = { ...project.regions[0], id: 'later', start: 1000 }; project.regions.push(untouched); ids.add('later');
    expect(inspectRegionSplit(project, ids, 360)).toEqual({ ok: true, count: 1 });
    expect(splitRegionGroup(project, ids, 360)!.pairs.map(pair => pair.leftId)).toEqual(['region']); expect(project.regions[2]).toBe(untouched);
  });

  it.each([0, 120, 600, 700])('keeps the complete Immer snapshot for boundary/outside tick %s', tick => {
    const { project, ids } = fixture(), allocate = vi.spyOn(crypto, 'randomUUID');
    expect(inspectRegionSplit(project, ids, tick).ok).toBe(false);
    expect(produce(project, draft => { expect(splitRegionGroup(draft, ids, tick)).toBeUndefined(); })).toBe(project); expect(allocate).not.toHaveBeenCalled();
  });

  it.each(['empty', 'stale', 'locked', 'hidden', 'nonintersecting-locked', 'too-short', 'offset-overflow', 'bad-tick'] as const)('rejects a whole %s group before allocating or modifying it', invalid => {
    const { project, ids } = fixture(); let tick = 360, visible: ReadonlySet<string> | undefined;
    if (invalid === 'empty') ids.clear(); if (invalid === 'stale') ids.add('deleted'); if (invalid === 'locked') project.tracks[0].locked = true;
    if (invalid === 'hidden') visible = new Set();
    if (invalid === 'nonintersecting-locked') { const track = { ...newTrack('Locked'), id: 'locked', locked: true }; project.tracks.push(track); project.regions.push({ ...project.regions[0], id: 'far-locked', trackId: track.id, start: 1000 }); ids.add('far-locked'); }
    if (invalid === 'too-short') { project.regions.push({ ...project.regions[0], id: 'short-side', start: 359.5 }); ids.add('short-side'); }
    if (invalid === 'offset-overflow') { project.regions[0].offset = 1e12; project.regions[0].loop = true; } if (invalid === 'bad-tick') tick = NaN;
    const before = structuredClone(project), allocate = vi.spyOn(crypto, 'randomUUID'), inspection = inspectRegionSplit(project, ids, tick, visible);
    expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason.length).toBeGreaterThan(0);
    expect(splitRegionGroup(project, ids, tick, visible)).toBeUndefined(); expect(project).toEqual(before); expect(allocate).not.toHaveBeenCalled();
  });

  it('accepts two exact one-tick children without adding a grid snap', () => {
    const { project, ids } = fixture(); project.regions[0].start = .25; project.regions[0].length = 2;
    expect(splitRegionGroup(project, ids, 1.25)?.pairs).toHaveLength(1); expect(project.regions.map(region => [region.start, region.length, region.offset])).toEqual([[.25, 1, 60], [1.25, 1, 61]]);
  });
});

describe('split MIDI endpoint ownership and looping source phase', () => {
  it.each([undefined, false, true])('exports cut controller/SysEx/unknown metadata once and inherits right endpoint flag %s', originalFlag => {
    const { project, ids } = fixture(); if (originalFlag !== undefined) project.regions[0].midiEndExclusive = originalFlag;
    splitRegionGroup(project, ids, 360);
    expect(project.regions[0].midiEndExclusive).toBe(true); expect(project.regions[1].midiEndExclusive).toBe(originalFlag);
    const actual = events(project), cut = actual.filter(item => item.tick === 360);
    expect(cut.filter(item => item.event.type === 'controller' && item.event.controllerType === 64)).toHaveLength(1);
    expect(cut.filter(item => item.event.type === 'sysEx')).toHaveLength(1); expect(cut.filter(item => item.event.type === 'unknownMeta')).toHaveLength(1);
    expect(actual.filter(item => item.tick === 600 && item.event.type === 'controller' && item.event.controllerType === 65)).toHaveLength(originalFlag ? 0 : 1);
    const musical = actual.filter(item => item.event.type === 'noteOn' || item.event.type === 'noteOff');
    expect(musical.filter(item => item.event.type === 'noteOn').map(item => [item.tick, item.event.type === 'noteOn' ? item.event.noteNumber : -1])).toEqual([[120, 60], [300, 64], [360, 67], [560, 72]]);
    expect(musical.some(item => item.tick === 1260 && item.event.type === 'noteOff' && item.event.noteNumber === 64 && item.event.velocity === 41)).toBe(true);
    expect(project.patterns.every(pattern => pattern.midiEvents!.some(event => event.id === 'cc' || event.tick === 300))).toBe(true);
  });

  it('advances raw loop offset across whole periods, preserving far-note occurrences and expression ordering', () => {
    const { project, ids } = fixture(); project.patterns[0].length = 100;
    project.patterns[0].notes = [{ ...newNote(25, 60, 200), id: 'phase-25' }, { ...newNote(75, 64, 0), id: 'phase-75' }, { ...newNote(175, 83, 0), id: 'far-phase' }];
    project.patterns[0].midiEvents = [
      { id: 'cc25', tick: 25, order: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 25 } },
      { id: 'cc75', tick: 75, order: 2, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 65, value: 75 } },
      { id: 'cc175', tick: 175, order: 3, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 66, value: 99 } },
    ];
    Object.assign(project.regions[0], { start: 200, length: 300, offset: 75, loop: true });
    splitRegionGroup(project, ids, 350); expect(project.regions.map(region => [region.start, region.length, region.offset])).toEqual([[200, 150, 75], [350, 150, 225]]);
    expect(flattenNotes(project).map(note => [note.absoluteTick, note.midi, note.duration])).toEqual([[200, 64, 0], [250, 60, 200], [300, 64, 0], [300, 83, 0], [350, 60, 200], [400, 64, 0], [400, 83, 0], [450, 60, 200]]);
    const expression = events(project).filter(item => item.event.type === 'controller');
    for (const [controller, ticks] of [[64, [250, 350, 450]], [65, [200, 300, 400, 500]], [66, [300, 400, 500]]] as const) expect(expression.filter(item => item.event.type === 'controller' && item.event.controllerType === controller).map(item => item.tick)).toEqual(ticks);
  });

  it('preserves the marker through independent duplication, clipboard paste and full NBSX save/reopen', () => {
    const { project, ids } = fixture(); splitRegionGroup(project, ids, 360);
    const copies = duplicateRegionGroup(project, new Set(['region']))!; expect(copies[0].midiEndExclusive).toBe(true);
    const clipboard = createRegionClipboard(project, new Set(['region']), 4), target = createProject('Target'), plan = planRegionPaste(target, clipboard, 0, target.tracks[0].id, 5);
    expect(plan.regions[0].midiEndExclusive).toBe(true);
    const reopened = openNbsx(saveNbsx(project)); expect({ ...reopened, modifiedAt: project.modifiedAt }).toEqual(project);
  });

  it.each([0, 'true', null])('rejects malformed marker %s while accepting legacy regions without it', value => {
    const { project } = fixture(); expect(validateProject(project)).toBe(project);
    (project.regions[0] as unknown as { midiEndExclusive: unknown }).midiEndExclusive = value; expect(() => validateProject(project)).toThrow('片段引用或范围');
  });
});

describe('split schema and actual container budgets', () => {
  it.each(['patterns', 'regions'])('rejects the aggregate %s count before allocating IDs', field => {
    const { project, ids } = fixture(true);
    if (field === 'patterns') while (project.patterns.length < 99999) project.patterns.push({ id: `p-${project.patterns.length}`, name: '', length: 1, notes: [] });
    else while (project.regions.length < 100000) project.regions.push({ ...project.regions[1], id: `r-${project.regions.length}` });
    const patternRefs = project.patterns, regionRefs = project.regions, allocate = vi.spyOn(crypto, 'randomUUID');
    expect(inspectRegionSplit(project, ids, 360).ok).toBe(false); expect(splitRegionGroup(project, ids, 360)).toBeUndefined();
    expect(project.patterns).toBe(patternRefs); expect(project.regions).toBe(regionRefs); expect(allocate).not.toHaveBeenCalled();
  });

  it.each(['notes', 'midiEvents'] as const)('counts all duplicated %s across a group before cloning a single source', field => {
    const { project, pattern } = fixture(); const template = newNote(0, 60, 0);
    if (field === 'notes') pattern.notes = Array.from({ length: 20001 }, (_, index) => ({ ...template, id: `bulk-note-${index}` }));
    else pattern.midiEvents = Array.from({ length: 20001 }, (_, index) => ({ id: `bulk-message-${index}`, tick: index, order: index, event: { deltaTime: 0, type: 'sysEx' as const, data: [1] } }));
    const first = project.regions[0]; project.regions = Array.from({ length: 100 }, (_, index) => ({ ...first, id: `selected-${index}` })); const ids = new Set(project.regions.map(region => region.id)), allocate = vi.spyOn(crypto, 'randomUUID');
    const inspection = inspectRegionSplit(project, ids, 360); expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason).toContain('200 万');
    expect(splitRegionGroup(project, ids, 360)).toBeUndefined(); expect(allocate).not.toHaveBeenCalled();
  });

  it('uses the writer timestamp and accepts exactly 64 MiB, rejecting one extra byte before any write', () => {
    const { project, ids } = fixture(); project.modifiedAt = ''; const probe = structuredClone(project); splitRegionGroup(probe, ids, 360);
    const limit = 64 * 1024 * 1024; project.description = 'x'.repeat(limit - wireBytes(probe) + 1);
    const allocate = vi.spyOn(crypto, 'randomUUID'), inspection = inspectRegionSplit(project, ids, 360);
    expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason).toMatch(/^拆分后工程.*64 MB/);
    expect(splitRegionGroup(project, ids, 360)).toBeUndefined(); expect(allocate).not.toHaveBeenCalled();
    project.description = project.description.slice(1); expect(inspectRegionSplit(project, ids, 360)).toEqual({ ok: true, count: 1 }); expect(splitRegionGroup(project, ids, 360)?.pairs).toHaveLength(1);
    expect(wireBytes(project)).toBe(limit); expect(saveNbsx(project).byteLength).toBeGreaterThan(0); expect(project.modifiedAt).toBe('');
  }, 20000);

  it('counts unchanged embedded assets against the 512 MiB expanded budget when adding source metadata', () => {
    const { project, ids } = fixture(), data = 'A'.repeat(4 * 1024 * 1024);
    for (let index = 0; index < 170; index++) project.assets.push({ id: `sample-${index}`, name: 'data.wav', mime: 'audio/wav', data });
    // All 170 entries hold separate 3-MiB payloads, despite the shared JS string.
    const probe: Project = structuredClone({ ...project, assets: [] }); splitRegionGroup(probe, ids, 360); probe.assets = project.assets;
    const mime = new TextEncoder().encode('application/vnd.exnoteblock.project+zip').length;
    project.description = 'x'.repeat(512 * 1024 * 1024 - 510 * 1024 * 1024 - mime - wireBytes(probe) + 1);
    const allocate = vi.spyOn(crypto, 'randomUUID'), inspection = inspectRegionSplit(project, ids, 360);
    expect(inspection.ok).toBe(false); if (!inspection.ok) expect(inspection.reason).toMatch(/^拆分后工程.*512 MB/);
    expect(splitRegionGroup(project, ids, 360)).toBeUndefined(); expect(allocate).not.toHaveBeenCalled();
  }, 15000);
});
