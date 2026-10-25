import { produce } from 'immer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { dragNotes } from '../src/core/editor-interaction';
import { expansionError } from '../src/core/expansion';
import { createMeterMap } from '../src/core/meter';
import { applyNoteEdit, type NoteEditTarget } from '../src/core/note-edit';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import type { Note, Project } from '../src/core/types';

const MAX = 1e12;
function fixture(period = 4, length = period, loop = false) {
  const project = createProject('Atomic note edit'); project.ppq = 1;
  project.patterns[0].length = period; project.patterns[0].notes = [{ ...newNote(.25, 66, .125), id: 'source-note', velocity: .8,
    pan: -.25, detune: 17.25, height: 3.5, instrumentId: 'bell', midiSource: { onOrder: 4, offOrder: 7, releaseVelocity: 43, offSourceTrack: 9 } }];
  Object.assign(project.regions[0], { length, loop });
  const target: NoteEditTarget = { patternId: project.patterns[0].id, regionId: project.regions[0].id, trackId: project.tracks[0].id };
  return { project, target, pattern: project.patterns[0], region: project.regions[0] };
}
function expectRejected(project: Project, target: NoteEditTarget, notes: Note[], reason: RegExp) {
  const before = structuredClone(project), patternArray = project.patterns, regionArray = project.regions, pattern = project.patterns[0], originalNotes = pattern.notes;
  const allocate = vi.spyOn(crypto, 'randomUUID');
  expect(() => applyNoteEdit(project, target, notes)).toThrow(reason);
  expect(project).toEqual(before); expect(project.patterns).toBe(patternArray); expect(project.regions).toBe(regionArray); expect(pattern.notes).toBe(originalNotes);
  expect(allocate).not.toHaveBeenCalled(); allocate.mockRestore();
}
function wireBytes(project: Project) {
  const assets = project.assets.map(asset => { const copy = { ...asset }; if (copy.data) delete copy.data; return copy; });
  return new TextEncoder().encode(JSON.stringify({ ...project, modifiedAt: '2000-01-01T00:00:00.000Z', assets })).length;
}
afterEach(() => vi.restoreAllMocks());

describe('atomic final note transaction validation', () => {
  it.each(['missing-region', 'missing-pattern', 'missing-track', 'wrong-association', 'locked', 'duplicate-target'] as const)('rejects %s targets before modifying even an otherwise valid candidate', kind => {
    const { project, target, pattern } = fixture(), notes = pattern.notes.map(note => ({ ...note, velocity: .5 }));
    if (kind === 'missing-region') target.regionId = 'missing'; if (kind === 'missing-pattern') target.patternId = 'missing'; if (kind === 'missing-track') target.trackId = 'missing';
    if (kind === 'wrong-association') { const track = newTrack('Other'); project.tracks.push(track); target.trackId = track.id; }
    if (kind === 'locked') project.tracks[0].locked = true;
    if (kind === 'duplicate-target') project.patterns.push({ ...pattern });
    expectRejected(project, target, notes, /失效|锁定|重复/);
  });

  it('preserves the original project and all references for identical or semantically equal arrays', () => {
    const { project, target, pattern } = fixture(), allocate = vi.spyOn(crypto, 'randomUUID'), original = pattern.notes;
    expect(applyNoteEdit(project, target, original)).toBe(false);
    expect(applyNoteEdit(project, target, structuredClone(original))).toBe(false); expect(pattern.notes).toBe(original);
    expect(produce(project, draft => { expect(applyNoteEdit(draft, target, structuredClone(original))).toBe(false); })).toBe(project);
    expect(allocate).not.toHaveBeenCalled();
  });

  it.each(['empty-id', 'duplicate-id', 'foreign-id', 'instrument', 'midi-field', 'orphan'] as const)('rejects invalid %s source data before any writes', kind => {
    const { project, target, pattern } = fixture(), notes = pattern.notes.map(note => ({ ...note, velocity: .5 }));
    if (kind === 'empty-id') notes[0].id = '';
    if (kind === 'duplicate-id') notes.push({ ...notes[0] });
    if (kind === 'foreign-id') notes[0].id = project.instruments[0].id;
    if (kind === 'instrument') notes[0].instrumentId = 'not-a-project-instrument';
    if (kind === 'midi-field') notes[0].midiSource = { ...notes[0].midiSource!, offSourceTrack: 65536 };
    if (kind === 'orphan') project.regions.push({ ...project.regions[0], id: 'orphan', trackId: 'missing' });
    expectRejected(project, target, notes, /无效|重复/);
  });

  it('rejects a legal legacy MAX tick nudged out of range instead of growing an invalid source', () => {
    const { project, target, pattern, region } = fixture(); project.ppq = 960;
    pattern.notes[0].tick = MAX; region.offset = MAX; region.length = 1; expect(validateProject(project)).toBe(project);
    const notes = dragNotes(pattern.notes, new Set(['source-note']), 'move', 240);
    expect(notes[0].tick).toBe(1000000000240); expectRejected(project, target, notes, /0 至 1e12/);
  });

  it('rejects the actual MAX-1 quantize result at the final boundary', () => {
    const { project, target, pattern, region } = fixture(MAX); project.ppq = 960;
    region.length = MAX; pattern.notes[0].tick = MAX - 1;
    const tick = createMeterMap(project).snap(pattern.notes[0].tick, 240); expect(tick).toBe(1000000000080);
    expectRejected(project, target, [{ ...pattern.notes[0], tick }], /0 至 1e12/);
  });

  it('rejects a display-duration MAX+1 resize without changing any valid source geometry', () => {
    const { project, target, pattern } = fixture(); pattern.notes[0].duration = MAX;
    const notes = dragNotes(pattern.notes, new Set(['source-note']), 'resize', 1); expect(notes[0].duration).toBe(MAX + 1);
    expectRejected(project, target, notes, /0 至 1e12/);
  });

  it.each([-1, NaN, Infinity, MAX + 1])('rejects a new note with invalid onset %s before adding any notes', tick => {
    const { project, target, pattern } = fixture(); expectRejected(project, target, [...pattern.notes, { ...newNote(tick, 60), id: 'new-note' }], /0 至 1e12/);
  });
});

describe('source growth and shared occurrence limits', () => {
  it('grows only for new or moved onsets outside the old source, preserving shared notes and cropped copies', () => {
    const { project, target, pattern, region } = fixture();
    project.regions.push({ ...region, id: 'loop-copy', length: 12, loop: true }, { ...region, id: 'cropped', offset: 1, length: 2 });
    const loop = project.regions[1], cropped = project.regions[2], midi = pattern.notes[0].midiSource;
    const notes = [...pattern.notes, { ...newNote(4.5, 70, 1000), id: 'new-note' }];
    expect(applyNoteEdit(project, target, notes)).toBe(true);
    expect(pattern.length).toBe(8); expect(region.length).toBe(8); expect(pattern.notes).toBe(notes); expect(pattern.notes[0].midiSource).toBe(midi);
    expect(project.regions[1]).toBe(loop); expect(loop.length).toBe(12); expect(project.regions[2]).toBe(cropped); expect(cropped).toMatchObject({ offset: 1, length: 2 });
    expect(project.regions.every(item => item.patternId === target.patternId)).toBe(true); expect(expansionError(project, true)).toBeUndefined();
  });

  it('does not grow for an in-period fractional onset, duration tail, metadata edit, or an unchanged legacy far note', () => {
    const { project, target, pattern, region } = fixture(1, 4, true);
    expect(applyNoteEdit(project, target, [{ ...pattern.notes[0], tick: .9375, duration: MAX }])).toBe(true);
    expect(pattern.length).toBe(1); expect(region.length).toBe(4); expect(pattern.notes[0].duration).toBe(MAX);
    const legacy = { ...newNote(MAX, 60, 0), id: 'legacy-far' }; pattern.notes.push(legacy);
    expect(applyNoteEdit(project, target, pattern.notes.map(note => note.id === 'source-note' ? { ...note, detune: 32.5 } : note))).toBe(true);
    expect(pattern.length).toBe(1); expect(region.length).toBe(4); expect(pattern.notes[1]).toBe(legacy);
  });

  it('keeps unrelated far notes out of growth when a different new onset stays inside the source', () => {
    const { project, target, pattern } = fixture(); pattern.notes.push({ ...newNote(MAX, 55, 0), id: 'legacy-far' });
    expect(applyNoteEdit(project, target, [...pattern.notes, { ...newNote(.75, 72, 0), id: 'new-in-period' }])).toBe(true);
    expect(pattern.length).toBe(4); expect(project.regions[0].length).toBe(4);
  });

  it('rejects legal note coordinates whose required bar rounding would push source length beyond MAX', () => {
    const { project, target, pattern } = fixture(); project.ppq = 960;
    expectRejected(project, target, [{ ...pattern.notes[0], tick: MAX - 1 }], /小节进位.*1e12/);
    expectRejected(project, target, [...pattern.notes, { ...newNote(MAX, 60), id: 'new-at-max' }], /小节进位.*1e12/);
  });

  it('accepts MAX-1 inside an already MAX-sized source and keeps a zero-duration note exact', () => {
    const { project, target, pattern, region } = fixture(MAX);
    expect(applyNoteEdit(project, target, [{ ...pattern.notes[0], tick: MAX - 1, duration: 0 }])).toBe(true);
    expect(pattern.length).toBe(MAX); expect(region.length).toBe(MAX); expect(pattern.notes[0]).toMatchObject({ tick: MAX - 1, duration: 0 });
    expect({ ...openNbsx(saveNbsx(project)), modifiedAt: project.modifiedAt }).toEqual(project);
  });

  it('accepts exactly two million onsets and rejects a third note atomically without expanding event arrays', () => {
    const { project, target, pattern } = fixture(1, 1000000, true);
    expect(applyNoteEdit(project, target, [...pattern.notes, { ...newNote(.75, 60, 0), id: 'second-note' }])).toBe(true);
    expect(expansionError(project, true)).toBeUndefined();
    expectRejected(project, target, [...pattern.notes, { ...newNote(.5, 62, 0), id: 'third-note' }], /200 万/);
  });

  it.each(['muted', 'not-solo'] as const)('counts all shared loop copies even when the edited track is %s', hidden => {
    const { project, target, pattern, region } = fixture(1, 1000000, true); project.regions.push({ ...region, id: 'shared-copy' });
    if (hidden === 'muted') project.tracks[0].muted = true; else project.tracks.push({ ...newTrack('Solo'), solo: true });
    expect(expansionError(project, false)).toBeUndefined(); expect(expansionError(project, true)).toBeUndefined();
    expectRejected(project, target, [...pattern.notes, { ...newNote(.75, 62, 0), id: 'too-many' }], /200 万/);
  });

  it('permits non-count edits on a legacy over-expanded source so it can still be repaired', () => {
    const { project, target, pattern } = fixture(1, 2000001, true); expect(expansionError(project, true)).toMatch(/200 万/);
    expect(applyNoteEdit(project, target, [{ ...pattern.notes[0], velocity: .5, detune: 100, duration: 0 }])).toBe(true);
    expect(pattern.notes[0]).toMatchObject({ velocity: .5, detune: 100, duration: 0 });
    expectRejected(project, target, [{ ...pattern.notes[0], tick: .5 }], /200 万/);
    expect(applyNoteEdit(project, target, [])).toBe(true); expect(pattern.notes).toEqual([]); expect(expansionError(project, true)).toBeUndefined();
  });
});

describe('metadata, structural sharing and actual save safety', () => {
  it('changes only requested notes and required geometry through an Immer draft, preserving full embedded source data', () => {
    const { project, target, pattern } = fixture(), before = structuredClone(project);
    pattern.notes.push({ ...newNote(.5, 70, .25), id: 'other' });
    pattern.midiEvents = [{ id: 'sysex', tick: 3.5, order: 2, sourceTrack: 9, event: { deltaTime: 0, type: 'sysEx', data: [1, 2, 3] } }];
    project.assets = [{ id: 'original-midi', name: 'original.mid', mime: 'audio/midi', data: 'AQIDBA==' }, { id: 'sound', name: 'sound.wav', mime: 'audio/wav', data: 'AQID' }];
    project.midi = { schema: 1, format: 1, sourceAssetId: 'original-midi', conductor: [{ id: 'conductor', tick: 2, order: 1, event: { deltaTime: 0, type: 'text', text: 'Keep all' } }] };
    const pristine = structuredClone(project), allocate = vi.spyOn(crypto, 'randomUUID');
    const next = produce(project, draft => { expect(applyNoteEdit(draft, target, draft.patterns[0].notes.map(note => note.id === 'source-note' ? { ...note, velocity: .5 } : note))).toBe(true); });
    expect(project).toEqual(pristine); expect(next.patterns[0].notes[0]).toEqual({ ...before.patterns[0].notes[0], velocity: .5 });
    expect(next.patterns[0].notes[1]).toBe(project.patterns[0].notes[1]); expect(next.patterns[0].notes[0].midiSource).toBe(project.patterns[0].notes[0].midiSource);
    expect(next.regions).toBe(project.regions); expect(next.tracks).toBe(project.tracks); expect(next.assets).toBe(project.assets); expect(next.midi).toBe(project.midi); expect(next.patterns[0].midiEvents).toBe(pattern.midiEvents);
    expect(allocate).not.toHaveBeenCalled(); expect({ ...openNbsx(saveNbsx(next)), modifiedAt: next.modifiedAt }).toEqual(next);
  });

  it('leaves an Immer draft and its original history snapshot unchanged on a rejected edit', () => {
    const { project, target } = fixture(), original = structuredClone(project);
    const next = produce(project, draft => { expect(() => applyNoteEdit(draft, target, [{ ...draft.patterns[0].notes[0], duration: MAX + 1 }])).toThrow('时值'); });
    expect(next).toBe(project); expect(project).toEqual(original);
  });

  it('checks the current transaction snapshot rather than discarding earlier geometry or metadata edits', () => {
    const { project, target } = fixture(), before = structuredClone(project);
    const next = produce(project, draft => {
      draft.author = 'Earlier in the same transaction'; draft.patterns[0].length = 8; draft.regions[0].length = 8;
      const notes = [{ ...draft.patterns[0].notes[0], tick: 7.5, velocity: .5 }];
      expect(applyNoteEdit(draft, target, notes)).toBe(true);
    });
    expect(project).toEqual(before); expect(next.author).toBe('Earlier in the same transaction');
    expect(next.patterns[0].length).toBe(8); expect(next.regions[0].length).toBe(8); expect(next.patterns[0].notes[0].tick).toBe(7.5);
    expect({ ...openNbsx(saveNbsx(next)), modifiedAt: next.modifiedAt }).toEqual(next);
  });

  it('validates invalid fields already changed in the same transaction before writing any candidate notes', () => {
    const { project, target } = fixture();
    const next = produce(project, draft => {
      draft.tracks[0].volume = 5; const previous = draft.patterns[0].notes;
      expect(() => applyNoteEdit(draft, target, [{ ...previous[0], velocity: .5 }])).toThrow('轨道参数');
      expect(draft.patterns[0].notes).toBe(previous);
      draft.tracks[0].volume = 2; expect(applyNoteEdit(draft, target, [{ ...previous[0], velocity: .5 }])).toBe(true);
    });
    expect(next.tracks[0].volume).toBe(2); expect(next.patterns[0].notes[0].velocity).toBe(.5); expect(project.tracks[0].volume).toBe(1);
  });

  it('includes the save timestamp and rejects exactly one excess manifest byte before assigning the candidate array', () => {
    const { project, target, pattern } = fixture(); project.modifiedAt = '';
    const notes = pattern.notes.map(note => ({ ...note, velocity: .75 }));
    const expected = structuredClone(project); expected.patterns[0].notes = notes;
    project.description = 'x'.repeat(64 * 1024 * 1024 - wireBytes(expected) + 1);
    expect(wireBytes(project)).toBeLessThanOrEqual(64 * 1024 * 1024);
    const originalNotes = pattern.notes; expect(() => applyNoteEdit(project, target, notes)).toThrow(/音符修改后工程.*64 MB/); expect(pattern.notes).toBe(originalNotes);
    project.description = project.description.slice(1); expect(applyNoteEdit(project, target, notes)).toBe(true); expect(wireBytes(project)).toBe(64 * 1024 * 1024);
    expect(saveNbsx(project).byteLength).toBeGreaterThan(0); expect(project.modifiedAt).toBe('');
  }, 20000);

  it('counts unchanged embedded resources against the512MiB expanded limit without decoding them', () => {
    const { project, target, pattern } = fixture(), data = 'A'.repeat(4 * 1024 * 1024);
    for (let index = 0; index < 170; index++) project.assets.push({ id: `sample-${index}`, name: 'sound.wav', mime: 'audio/wav', data });
    const notes = pattern.notes.map(note => ({ ...note, velocity: .75 })), expected = { ...project, patterns: [{ ...pattern, notes }] };
    const mime = new TextEncoder().encode('application/vnd.exnoteblock.project+zip').length;
    project.description = 'x'.repeat(512 * 1024 * 1024 - 510 * 1024 * 1024 - mime - wireBytes(expected) + 1);
    const previous = pattern.notes; expect(() => applyNoteEdit(project, target, notes)).toThrow(/音符修改后工程.*512 MB/); expect(pattern.notes).toBe(previous);
  }, 15000);
});
