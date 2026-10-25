import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { dragNotes, dragPlacedNote, growEditedPattern, noteResizeHandleWidth, planRegionTrim, regionSourceRanges, trimRegion } from '../src/core/editor-interaction';
import { createProject, flattenNotes, newNote, validateProject } from '../src/core/project';

describe('piano roll note drags', () => {
  it('moves a newly placed FL note in time and pitch while retaining its duration and MIDI details', () => {
    const source = { ...newNote(480, 60, 240), detune: 17, midiSource: { onOrder: 2, offOrder: 4, releaseVelocity: 45 } };
    const moved = dragPlacedNote(source, 'fl', 720, 3, 3000);
    expect(moved).toEqual({ ...source, tick: 1200, midi: 63 });
    expect(source).toMatchObject({ tick: 480, midi: 60, duration: 240 });
    expect(dragPlacedNote(source, 'logic', 720, 3, 1920)).toEqual({ ...source, duration: 1440 });
  });
  it('keeps chord spacing intact at the time and keyboard boundaries', () => {
    const notes = [newNote(240, 2, 300), newNote(720, 126, 600), newNote(960, 64, 120)];
    const selected = new Set(notes.slice(0, 2).map(note => note.id));
    const moved = dragNotes(notes, selected, 'move', -500, 9);
    expect(moved.map(note => [note.tick, note.midi, note.duration])).toEqual([[0, 3, 300], [480, 127, 600], [960, 64, 120]]);
    expect(moved[2]).toBe(notes[2]);
    expect(notes[0].tick).toBe(240);
  });
  it('resizes only duration and leaves a draggable body even on very short notes', () => {
    const source = newNote(480, 60, 240);
    expect(dragNotes([source], new Set([source.id]), 'resize', -500, 12)[0]).toEqual({ ...source, duration: 1 });
    expect(noteResizeHandleWidth(6)).toBeLessThan(3);
    expect(noteResizeHandleWidth(100)).toBe(7);
  });
});

describe('region playback borders', () => {
  const fixture = () => {
    const p = createProject(), region = p.regions[0], pattern = p.patterns[0];
    region.start = 1920; region.length = 1920; pattern.length = 1920;
    pattern.notes = [newNote(0, 60, 900), newNote(480, 64, 100), newNote(1200, 67, 1200)];
    pattern.midiEvents = [{ id: 'source-controller', tick: 480, order: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127 } }];
    return { p, region, pattern };
  };
  it('projects trimmed and wrapped source ranges without confusing playback length with loop period', () => {
    expect(regionSourceRanges(960, { offset: 240, length: 1200, loop: false })).toEqual([{ start: 240, end: 1440 }]);
    expect(regionSourceRanges(960, { offset: 2640, length: 480, loop: true })).toEqual([{ start: 0, end: 240 }, { start: 720, end: 960 }]);
    expect(regionSourceRanges(960, { offset: 720, length: 5000, loop: true })).toEqual([{ start: 0, end: 960 }]);
  });
  it('hides source onsets when shortened and reveals them again without deleting or shortening notes', () => {
    const { p, region, pattern } = fixture(), original = structuredClone(pattern);
    trimRegion(p, region.id, 'start', 2400);
    expect(region).toMatchObject({ start: 2400, offset: 480, length: 1440 });
    expect(flattenNotes(p).map(note => note.absoluteTick)).toEqual([2400, 3120]);
    expect(pattern).toEqual(original);
    trimRegion(p, region.id, 'start', 1920);
    trimRegion(p, region.id, 'end', 2500);
    expect(flattenNotes(p).map(note => [note.absoluteTick, note.duration])).toEqual([[1920, 900], [2400, 100]]);
    trimRegion(p, region.id, 'end', 6000);
    expect(pattern).toEqual(original);
    expect(flattenNotes(p).map(note => note.absoluteTick)).toEqual([1920, 2400, 3120]);
  });
  it('prepends silence beyond source zero and retains every existing absolute onset and note duration', () => {
    const { p, region, pattern } = fixture(), before = flattenNotes(p).map(note => [note.absoluteTick, note.duration]);
    trimRegion(p, region.id, 'start', 960);
    expect(region).toMatchObject({ start: 960, offset: 0, length: 2880 });
    expect(pattern.length).toBe(2880);
    expect(pattern.notes.map(note => note.tick)).toEqual([960, 1440, 2160]);
    expect(pattern.midiEvents![0].tick).toBe(1440);
    expect(flattenNotes(p).map(note => [note.absoluteTick, note.duration])).toEqual(before);
    expect(validateProject(p)).toBe(p);
  });
  it('makes a shared source independent before adding silence, including MIDI metadata', () => {
    const { p, region, pattern } = fixture();
    pattern.notes[0].midiSource = { onOrder: 1, offOrder: 8, releaseVelocity: 30 };
    const other = { ...region, id: 'other-copy', start: 8000 }; p.regions.push(other);
    const original = structuredClone(pattern), before = flattenNotes(p).map(note => [note.regionId, note.absoluteTick, note.duration]);
    const next = produce(p, draft => { trimRegion(draft, region.id, 'start', 0); });
    const edited = next.regions[0], source = next.patterns.find(item => item.id === edited.patternId)!;
    expect(edited.patternId).not.toBe(pattern.id);
    expect(next.regions[1].patternId).toBe(pattern.id);
    expect(next.patterns[0]).toEqual(original);
    expect(source.notes[0].id).not.toBe(pattern.notes[0].id);
    expect(source.midiEvents![0].id).not.toBe(pattern.midiEvents![0].id);
    expect(flattenNotes(next).map(note => [note.regionId, note.absoluteTick, note.duration])).toEqual(before);
    expect(p.patterns).toHaveLength(1);
    expect(validateProject(next)).toBe(next);
  });
  it('extends loop phase to the left without changing its source period or overlapping note onsets', () => {
    const { p, region, pattern } = fixture();
    region.loop = true; region.offset = 240; region.length = 3840;
    const original = structuredClone(pattern), oldEnd = region.start + region.length;
    const overlapping = flattenNotes(p).map(note => note.absoluteTick);
    trimRegion(p, region.id, 'start', 1200);
    expect(region).toMatchObject({ start: 1200, offset: 1440, length: oldEnd - 1200 });
    expect(pattern).toEqual(original);
    expect(flattenNotes(p).filter(note => note.absoluteTick >= 1920).map(note => note.absoluteTick)).toEqual(overlapping);
    expect(planRegionTrim(region, pattern.length, 'start', -500).region.start).toBe(0);
    expect(planRegionTrim(region, pattern.length, 'start', oldEnd + 500).region.length).toBe(1);
    expect(planRegionTrim(region, pattern.length, 'end', region.start - 500).region.length).toBe(1);
  });
});

describe('source growth after note editing or recording', () => {
  const fixture = (offset = 0, length = 3840) => {
    const p = createProject(), region = p.regions[0], pattern = p.patterns[0];
    region.start = offset; region.offset = offset; region.length = length;
    pattern.notes = [newNote(1200, 60, 1000)];
    return { p, region, pattern };
  };
  it('extends a source-following copy to the new musical bar without altering existing note timing', () => {
    const { p, region, pattern } = fixture(), before = flattenNotes(p).map(note => [note.absoluteTick, note.duration]);
    growEditedPattern(p, region, pattern, 4001);
    expect(pattern.length).toBe(7680);
    expect(region.length).toBe(7680);
    expect(flattenNotes(p).map(note => [note.absoluteTick, note.duration])).toEqual(before);
  });
  it('subtracts the source offset when the right border follows the growing source end', () => {
    const { p, region, pattern } = fixture(960, 2880), before = flattenNotes(p).map(note => note.absoluteTick);
    growEditedPattern(p, region, pattern, 4001);
    expect(pattern.length).toBe(7680);
    expect(region).toMatchObject({ start: 960, offset: 960, length: 6720 });
    expect(region.offset + region.length).toBe(pattern.length);
    expect(flattenNotes(p).map(note => note.absoluteTick)).toEqual(before);
  });
  it('preserves a cropped playback end both for an internal recording and for notes beyond the source end', () => {
    const { p, region, pattern } = fixture(960, 960), range = { ...region };
    pattern.notes.push(newNote(1440, 64));
    growEditedPattern(p, region, pattern, 1441);
    expect(pattern.length).toBe(3840);
    expect(region).toEqual(range);
    pattern.notes.push(newNote(4000, 67));
    growEditedPattern(p, region, pattern, 4001);
    expect(pattern.length).toBe(7680);
    expect(region).toEqual(range);
    expect(flattenNotes(p).map(note => note.absoluteTick)).toEqual([1200, 1440]);
    expect(pattern.notes).toHaveLength(3);
  });
  it('retains an explicitly extended silent tail even when the source grows past it', () => {
    const { p, region, pattern } = fixture(960, 5000), range = { ...region };
    growEditedPattern(p, region, pattern, 8001);
    expect(pattern.length).toBe(11520);
    expect(region).toEqual(range);
  });
  it('keeps loop playback length and phase independent from source growth', () => {
    const { p, region, pattern } = fixture(960, 5000); region.loop = true;
    const range = { ...region };
    growEditedPattern(p, region, pattern, 4001);
    expect(pattern.length).toBe(7680);
    expect(region).toEqual(range);
  });
  it('follows actual meter bar boundaries for an offset copy', () => {
    const { p, region, pattern } = fixture(240, 1200);
    p.ppq = 480; p.timeSignatures = [{ tick: 0, numerator: 3, denominator: 4 }]; pattern.length = 1440;
    growEditedPattern(p, region, pattern, 1500);
    expect(pattern.length).toBe(2880);
    expect(region.length).toBe(2640);
  });
});
