import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { beginRecordedPress, finishRecordedPress, previewRecordingProject, recordingProjectsEqual } from '../src/core/recording';
import { createProject, newNote, newTrack, uid, validateProject } from '../src/core/project';
import { growEditedPattern } from '../src/core/editor-interaction';
import { openNbsx, saveNbsx } from '../src/core/container';
import type { Project } from '../src/core/types';

function fixture() {
  const project = createProject('Held recording fixture'); project.ppq = 480;
  project.patterns[0].length = project.regions[0].length = 960;
  project.patterns[0].notes = [newNote(0, 60, 30)];
  const track = newTrack('Untouched'), pattern = { id: uid(), name: 'Untouched pattern', length: 960, notes: [newNote(40, 70, 60)] };
  project.tracks.push(track); project.patterns.push(pattern);
  project.regions.push({ id: uid(), trackId: track.id, patternId: pattern.id, start: 0, length: 960, offset: 0, loop: false });
  return project;
}
const pressAt = (project: Project, tick = 127, pitch = 64, documentKey = 4) => beginRecordedPress(project, project.regions[0], pitch, .7, tick, undefined, true, 16, 8, documentKey)!;
function freezeTree(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeTree(child);
}

describe('stable recording identity and snapshot', () => {
  it('uses one note ID and a fixed step duration for snapshots and key release', () => {
    const project = fixture(), press = pressAt(project), before = structuredClone({ project, press });
    const first = finishRecordedPress(project, press, undefined, 4)!, later = finishRecordedPress(project, press, { tick: 500, linearTick: 500, seconds: 1 }, 4)!;
    expect(first.note).toMatchObject({ id: press.noteId, tick: 120, duration: 240, midi: 64, velocity: .7 });
    expect(first.caret).toBe(360); expect(later).toEqual(first);
    const preview = previewRecordingProject(project, [press], undefined, 4), repeated = previewRecordingProject(project, [press], undefined, 4);
    expect(preview.noteCount).toBe(1); expect(preview.project.patterns[0].notes.at(-1)).toEqual(first.note);
    expect(recordingProjectsEqual(preview.project, repeated.project)).toBe(true);
    expect({ project, press }).toEqual(before);
  });

  it('preserves legacy calls and checks a supplied document generation even when all UUIDs match', () => {
    const project = fixture(), press = beginRecordedPress(project, project.regions[0], 60, .8, 0, undefined, true, 16, 16)!;
    expect(press.documentKey).toBe(0); expect(finishRecordedPress(project, press)?.note.id).toBe(press.noteId);
    const sameIdsNewDocument = structuredClone(project);
    expect(finishRecordedPress(sameIdsNewDocument, press, undefined, 1)).toBeUndefined();
    expect(previewRecordingProject(sameIdsNewDocument, [press], undefined, 1)).toEqual({ project: sameIdsNewDocument, noteCount: 0 });
  });

  it('keeps held duration over multiple live cycles and keeps the ID as later snapshots lengthen', () => {
    const project = fixture(); project.regions[0].loop = true; project.regions[0].length = 1920;
    const press = beginRecordedPress(project, project.regions[0], 67, .9, 0, { tick: 850, linearTick: 850, seconds: 1 }, true, 0, 16, 4)!;
    const first = previewRecordingProject(project, [press], { tick: 100, linearTick: 2020, seconds: 3 }, 4);
    const second = previewRecordingProject(project, [press], { tick: 200, linearTick: 2120, seconds: 4 }, 4);
    expect(first.project.patterns[0].notes.at(-1)).toMatchObject({ id: press.noteId, tick: 850, duration: 1170 });
    expect(second.project.patterns[0].notes.at(-1)).toMatchObject({ id: press.noteId, tick: 850, duration: 1270 });
    expect(project.patterns[0].length).toBe(960); expect(project.regions[0].length).toBe(1920);
    expect(recordingProjectsEqual(first.project, second.project)).toBe(false);
  });

  it('retains a one-tick loop period for two valid fractional onsets near its end', () => {
    const project = fixture(); project.ppq = 1;
    project.patterns[0].length = 1; project.regions[0].loop = true; project.regions[0].length = 4;
    const position = { tick: .9375, linearTick: .9375, seconds: .46875 };
    const first = beginRecordedPress(project, project.regions[0], 64, .7, 0, position, true, 64, 16, 4)!;
    const second = beginRecordedPress(project, project.regions[0], 67, .8, 0, position, true, 64, 16, 4)!;
    const firstFinish = finishRecordedPress(project, first, position, 4)!;
    expect(firstFinish.note).toMatchObject({ id: first.noteId, tick: .9375, duration: 1 });
    const one = previewRecordingProject(project, [first], position, 4);
    expect(one.project.patterns[0].length).toBe(1); expect(one.project.regions[0].length).toBe(4);
    expect(finishRecordedPress(one.project, second, position, 4)?.note).toMatchObject({ id: second.noteId, tick: .9375, duration: 1 });
    const both = previewRecordingProject(project, [first, second], position, 4);
    const sequential = previewRecordingProject(one.project, [second], position, 4);
    expect(both.noteCount).toBe(2); expect(sequential.noteCount).toBe(1);
    expect(both.project.patterns[0].notes.slice(-2).map(note => [note.id, note.tick])).toEqual([[first.noteId, .9375], [second.noteId, .9375]]);
    expect(both.project.patterns[0].length).toBe(1); expect(both.project.regions[0].length).toBe(4);
    expect(recordingProjectsEqual(both.project, sequential.project)).toBe(true);
    expect(() => validateProject(both.project)).not.toThrow();
    expect(project.patterns[0].length).toBe(1); expect(project.patterns[0].notes).toHaveLength(1);
  });

  it('merges a whole chord before growth and retains all untouched object references', () => {
    const project = fixture(), first = pressAt(project, 1000, 64), second = pressAt(project, 1100, 67), before = structuredClone(project);
    freezeTree(project); freezeTree(first); freezeTree(second);
    const result = previewRecordingProject(project, [first, second], undefined, 4);
    expect(result.noteCount).toBe(2); expect(result.project).not.toBe(project);
    expect(result.project.patterns[0].notes.map(note => note.id)).toEqual([project.patterns[0].notes[0].id, first.noteId, second.noteId]);
    expect(result.project.patterns[0].length).toBe(1920); expect(result.project.regions[0].length).toBe(1920);
    expect(result.project.patterns[0].notes[0]).toBe(project.patterns[0].notes[0]);
    expect(result.project.patterns[1]).toBe(project.patterns[1]); expect(result.project.regions[1]).toBe(project.regions[1]);
    expect(result.project.tracks).toBe(project.tracks); expect(result.project.instruments).toBe(project.instruments);
    expect(result.project.assets).toBe(project.assets); expect(result.project.tempos).toBe(project.tempos); expect(result.project.audio).toBe(project.audio);
    expect(result.project.modifiedAt).toBe(project.modifiedAt); expect(project).toEqual(before);
  });

  it('deduplicates the same held identity and never reinserts an already materialized note', () => {
    const project = fixture(), press = pressAt(project), result = previewRecordingProject(project, [press, press], undefined, 4);
    expect(result.noteCount).toBe(1);
    const repeated = previewRecordingProject(result.project, [press], undefined, 4);
    expect(repeated.project).toBe(result.project); expect(repeated.noteCount).toBe(0);
    expect(finishRecordedPress(result.project, press, undefined, 4)).toBeUndefined();
  });

  it('retains full source data through NBSX and matches the later real keyup model', () => {
    const project = fixture(), press = pressAt(project), source = structuredClone(project);
    project.assets.push({ id: 'embedded-source', name: 'source.bin', mime: 'application/octet-stream', data: 'AQID' });
    project.patterns[1].notes[0].midiSource = { onOrder: 2, offOrder: 7, releaseVelocity: 61 };
    const snapshot = previewRecordingProject(project, [press], undefined, 4), reopened = openNbsx(saveNbsx(snapshot.project));
    expect(reopened.patterns[0].notes.at(-1)?.id).toBe(press.noteId);
    expect(recordingProjectsEqual(reopened, snapshot.project)).toBe(true);
    const finished = finishRecordedPress(project, press, undefined, 4)!;
    const actualModel = produce(project, draft => {
      draft.patterns[0].notes.push(finished.note); growEditedPattern(draft, draft.regions[0], draft.patterns[0], finished.note.tick + 1);
      draft.modifiedAt = 'changed-by-the-real-commit';
    });
    expect(recordingProjectsEqual(actualModel, snapshot.project)).toBe(true);
    expect(project.patterns[0].notes).toEqual(source.patterns[0].notes);
    expect(project.patterns[0].notes.some(note => note.id === press.noteId)).toBe(false);
  });
});

describe('recording target identity', () => {
  it.each(['move', 'trim', 'offset', 'loop', 'track', 'pattern', 'region-deleted', 'pattern-deleted', 'track-deleted', 'locked', 'ppq', 'project'] as const)('cancels a press after target change: %s', change => {
    const project = fixture(), press = pressAt(project), altered = structuredClone(project), region = altered.regions[0];
    if (change === 'move') region.start++;
    else if (change === 'trim') region.length--;
    else if (change === 'offset') region.offset++;
    else if (change === 'loop') region.loop = true;
    else if (change === 'track') region.trackId = altered.tracks[1].id;
    else if (change === 'pattern') region.patternId = altered.patterns[1].id;
    else if (change === 'region-deleted') altered.regions.shift();
    else if (change === 'pattern-deleted') altered.patterns.shift();
    else if (change === 'track-deleted') altered.tracks.shift();
    else if (change === 'locked') altered.tracks[0].locked = true;
    else if (change === 'ppq') altered.ppq = 960;
    else altered.id = 'different-project';
    expect(finishRecordedPress(altered, press, undefined, 4)).toBeUndefined();
    const snapshot = previewRecordingProject(altered, [press], undefined, 4);
    expect(snapshot.project).toBe(altered); expect(snapshot.noteCount).toBe(0);
  });

  it('binds a looping source period but accepts non-looping source growth with unchanged region geometry', () => {
    const project = fixture(); project.regions[0].loop = true;
    const loopPress = pressAt(project), loopChanged = structuredClone(project); loopChanged.patterns[0].length++;
    expect(finishRecordedPress(loopChanged, loopPress, undefined, 4)).toBeUndefined();
    project.regions[0].loop = false;
    const nonLoopPress = pressAt(project), grown = structuredClone(project); grown.patterns[0].length = 1920;
    expect(finishRecordedPress(grown, nonLoopPress, undefined, 4)?.note.id).toBe(nonLoopPress.noteId);
  });

  it('allows unrelated edits and inserted notes without requiring the original Project object', () => {
    const project = fixture(), press = pressAt(project);
    const edited = produce(project, draft => { draft.patterns[0].notes.push(newNote(50, 72, 80)); draft.description = 'Unrelated edit'; });
    expect(finishRecordedPress(edited, press, undefined, 4)?.note.id).toBe(press.noteId);
    expect(previewRecordingProject(edited, [press], undefined, 4).project.patterns[0].notes).toHaveLength(3);
  });

  it('requires an explicit immutable rebase after an owned recording grows the remaining chord target', () => {
    const project = fixture(), first = pressAt(project, 1000, 64), remaining = pressAt(project, 1100, 67);
    const originalPress = structuredClone(remaining), firstResult = finishRecordedPress(project, first, undefined, 4)!;
    const committed = produce(project, draft => {
      draft.patterns[0].notes.push(firstResult.note);
      growEditedPattern(draft, draft.regions[0], draft.patterns[0], firstResult.note.tick + 1);
    });
    expect(committed.regions[0].length).toBe(1920);
    // Core cannot infer whether this was a recording or a user border edit.
    expect(finishRecordedPress(committed, remaining, undefined, 4)).toBeUndefined();
    const rebased = { ...remaining, regionState: { ...remaining.regionState, length: committed.regions[0].length } };
    expect(finishRecordedPress(committed, rebased, undefined, 4)?.note).toMatchObject({ id: remaining.noteId, tick: 1080, duration: 240 });
    expect(remaining).toEqual(originalPress); expect(rebased.noteId).toBe(remaining.noteId);
    const trimmed = produce(committed, draft => { draft.regions[0].length--; });
    expect(finishRecordedPress(trimmed, rebased, undefined, 4)).toBeUndefined();
  });

  it('lets locked, bypassed and out-of-range live presses audition without entering a save snapshot', () => {
    const project = fixture(); project.tracks[0].locked = true;
    const locked = pressAt(project); expect(locked).toBeDefined(); expect(locked.capture).toBe(false);
    project.tracks[0].locked = false;
    const bypassed = beginRecordedPress(project, project.regions[0], 60, .8, 0, undefined, false, 16, 16, 4)!;
    const outside = beginRecordedPress(project, project.regions[0], 60, .8, 0, { tick: 2000, linearTick: 2000, seconds: 2 }, true, 16, 16, 4)!;
    expect(bypassed.capture).toBe(false); expect(outside.capture).toBe(false);
    expect(previewRecordingProject(project, [locked, bypassed, outside], undefined, 4)).toEqual({ project, noteCount: 0 });
    expect(previewRecordingProject(project, [], undefined, 4).project).toBe(project);
  });
});

describe('recording scalar and schema bounds', () => {
  it.each([{ pitch: 128 }, { pitch: .5 }, { velocity: -1 }, { caret: NaN }, { snap: Infinity }, { length: 0 }, { document: .5 }])('rejects malformed begin input: %j', values => {
    const project = fixture();
    expect(beginRecordedPress(project, project.regions[0], values.pitch ?? 60, values.velocity ?? .8, values.caret ?? 0, undefined, true, values.snap ?? 16, values.length ?? 16, values.document ?? 4)).toBeUndefined();
  });

  it('rejects a nonfinite or rewound live endpoint and an out-of-range held duration', () => {
    const project = fixture(), press = beginRecordedPress(project, project.regions[0], 60, .8, 0, { tick: 100, linearTick: 100, seconds: 0 }, true, 0, 16, 4)!;
    for (const linearTick of [NaN, Infinity, 99, 1e12 + 101]) expect(finishRecordedPress(project, press, { tick: 120, linearTick, seconds: 0 }, 4)).toBeUndefined();
  });

  it('accepts the exact legal growth bound and rejects a bar-rounded range beyond it', () => {
    const project = fixture(); project.ppq = 1; project.patterns[0].length = project.regions[0].length = 1e12 - 2;
    const press = beginRecordedPress(project, project.regions[0], 60, .8, 1e12 - 1, undefined, true, 0, 4, 4)!;
    const legal = previewRecordingProject(project, [press], undefined, 4);
    expect(legal.noteCount).toBe(1); expect(legal.project.patterns[0].length).toBe(1e12);
    expect(() => validateProject(legal.project)).not.toThrow();
    project.ppq = 480;
    const roundedPastLimit = beginRecordedPress(project, project.regions[0], 60, .8, 1e12 - 1, undefined, true, 0, 1920, 4)!;
    expect(finishRecordedPress(project, roundedPastLimit, undefined, 4)).toBeUndefined();
    expect(previewRecordingProject(project, [roundedPastLimit], undefined, 4).project).toBe(project);
  });

  it('rejects a combined pending-note overflow before producing a partial model', () => {
    const project = fixture(), press = pressAt(project);
    // Capacity-only sink: no serialization or native work, and no giant clone.
    project.patterns[0].notes = Array(2000000).fill(project.patterns[0].notes[0]); project.patterns[1].notes = [];
    expect(() => previewRecordingProject(project, [press], undefined, 4)).toThrow('200 万');
    expect(project.patterns[0].notes).toHaveLength(2000000);
  });
});

describe('save snapshot JSON equivalence', () => {
  it('ignores only root modifiedAt and accepts JSON object property order differences', () => {
    const project = fixture(), reordered = Object.fromEntries(Object.entries(structuredClone(project)).reverse()) as unknown as Project;
    reordered.modifiedAt = 'a-new-save-time';
    expect(recordingProjectsEqual(project, project)).toBe(true); expect(recordingProjectsEqual(project, reordered)).toBe(true);
    reordered.createdAt = 'a-different-creation'; expect(recordingProjectsEqual(project, reordered)).toBe(false);
  });

  it.each(['note', 'tempo', 'asset', 'metadata', 'order'] as const)('detects a real full-data difference in %s', field => {
    const project = fixture(), changed = structuredClone(project);
    if (field === 'note') changed.patterns[0].notes[0].velocity = .42;
    else if (field === 'tempo') changed.tempos[0].bpm = 90;
    else if (field === 'asset') changed.assets.push({ id: 'sample', name: 'sample.ogg', mime: 'audio/ogg', data: 'AQID' });
    else if (field === 'metadata') changed.provenance = { kind: 'midi', filename: 'source.mid', metadata: { modifiedAt: 'nested-is-not-ignored' } };
    else changed.tracks.reverse();
    expect(recordingProjectsEqual(project, changed)).toBe(false);
  });
});
