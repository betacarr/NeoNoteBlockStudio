import { describe, expect, it } from 'vitest';
import { applyGlobalChordsToMidi, applyMidiRegionChords, deleteGlobalChord, editChordGroup, insertGlobalChord, midiRegionChords, renameGlobalChord } from '../src/core/chord-track';
import { openNbsx, saveNbsx } from '../src/core/container';
import { trimRegion } from '../src/core/editor-interaction';
import { analyzeMidiRegionChords } from '../src/core/midi-region-chords';
import { createProject, newNote } from '../src/core/project';
import { createRegionClipboard, planRegionPaste } from '../src/core/region-clipboard';
import { splitRegionGroup } from '../src/core/region-split';

function fixture() {
  const project = createProject();
  project.ppq = 480;
  const [pattern] = project.patterns, [region] = project.regions;
  pattern.length = region.length = 1920;
  pattern.notes = [
    ...[60, 64, 67].map(pitch => newNote(0, pitch, 480)),
    ...[60, 64, 69].map(pitch => newNote(480, pitch, 480)),
    ...[55, 59, 62, 65].map(pitch => newNote(960, pitch, 480)),
    ...[60, 64, 67].map((pitch, i) => newNote(1440 + i * 120, pitch, 100)),
  ];
  return { project, pattern, region };
}

describe('MIDI region chords', () => {
  it('reads exact MIDI intervals, inversions, and a broken chord without running audio analysis', () => {
    const { project, pattern, region } = fixture();
    expect(analyzeMidiRegionChords(pattern, region, project.ppq)).toEqual([
      { name: 'C', start: 0, end: 480 },
      { name: 'Am/C', start: 480, end: 960 },
      { name: 'G7', start: 960, end: 1440 },
      { name: 'C', start: 1440, end: 1920 },
    ]);
  });

  it('honours the visible offset and loop; promotes only the cycle intersection at the original location', () => {
    const { project, pattern, region } = fixture();
    Object.assign(region, { start: 1920, offset: 960, length: 2400, loop: true });
    region.chords = analyzeMidiRegionChords(pattern, region, project.ppq);
    expect(region.chords.map(chord => [chord.name, chord.start])).toEqual([
      ['G7', 960], ['C', 1440], ['Am/C', 2400], ['G7', 2880],
    ]);
    applyMidiRegionChords(project, region, '测试', { start: 2100, end: 2500 });
    expect(project.chordTrack?.[0]).toEqual({
      name: '测试', start: 2100, end: 2500,
      chords: [{ name: 'G7', start: 2100, end: 2400 }, { name: 'C', start: 2400, end: 2500 }],
    });
    applyGlobalChordsToMidi(project, region);
    expect(midiRegionChords(region)).toEqual([{ name: 'G7', start: 180, end: 480 }, { name: 'C', start: 480, end: 580 }]);
    expect(openNbsx(saveNbsx(project)).chordTrack).toEqual(project.chordTrack);
    expect(openNbsx(saveNbsx(project)).regions[0].chords).toEqual(region.chords);
  });

  it('keeps chord positions when trimming, splitting, and pasting across PPQs', () => {
    const { project, pattern, region } = fixture();
    region.chords = analyzeMidiRegionChords(pattern, region, project.ppq);
    trimRegion(project, region.id, 'start', 480);
    expect(midiRegionChords(region)?.[0]).toEqual({ name: 'Am/C', start: 0, end: 480 });
    const split = splitRegionGroup(project, new Set([region.id]), 960)!;
    const right = project.regions.find(item => item.id === split.pairs[0].rightId)!;
    expect(midiRegionChords(right)?.[0]).toEqual({ name: 'G7', start: 0, end: 480 });
    expect(right.chords?.[2]).not.toBe(region.chords?.[2]);
    const clipboard = createRegionClipboard(project, new Set([right.id]), 1, right.id);
    const destination = createProject();
    destination.ppq = 960;
    const pasted = planRegionPaste(destination, clipboard, 1920, destination.tracks[0].id, 2);
    expect(midiRegionChords(pasted.regions[0])?.[0]).toEqual({ name: 'G7', start: 0, end: 960 });
  });
});

describe('manual global chords', () => {
  it('uses the current MIDI key and ends a new chord at the next existing group', () => {
    const { project } = fixture();
    project.assets.push({ id: 'midi', name: 'Keys.mid', mime: 'audio/midi', data: 'AA==' });
    project.midi = { schema: 1, format: 0, sourceAssetId: 'midi', conductor: [
      { id: 'key-1', tick: 0, order: 0, event: { type: 'keySignature', deltaTime: 0, key: -2, scale: 0 } },
      { id: 'key-2', tick: 960, order: 1, event: { type: 'keySignature', deltaTime: 0, key: 2, scale: 1 } },
    ] };
    insertGlobalChord(project, 1440, 3360);
    insertGlobalChord(project, 0, 1920);
    expect(project.chordTrack?.flatMap(group => group.chords)).toEqual([
      { name: 'Bb', start: 0, end: 1440 },
      { name: 'Bm', start: 1440, end: 3360 },
    ]);
    expect(openNbsx(saveNbsx(project)).chordTrack).toEqual(project.chordTrack);
  });

  it('preserves adjacent analyzed chords and removes a group only after its last chord is deleted', () => {
    const { project, region } = fixture();
    region.chords = [{ name: 'Dm', start: 0, end: 960 }, { name: 'G7', start: 960, end: 1920 }];
    applyMidiRegionChords(project, region, '分析结果');
    insertGlobalChord(project, 480, 2400);
    insertGlobalChord(project, 960, 2400);
    expect(project.chordTrack?.[0].chords).toEqual([
      { name: 'Dm', start: 0, end: 480 },
      { name: 'C', start: 480, end: 960 },
      { name: 'G7', start: 960, end: 1920 },
    ]);
    deleteGlobalChord(project, 0, 480);
    expect(project.chordTrack?.[0].chords.map(chord => chord.name)).toEqual(['Dm', 'G7']);
    deleteGlobalChord(project, 0, 0);
    deleteGlobalChord(project, 0, 960);
    expect(project.chordTrack).toEqual([]);
    expect(region.chords[0]).toEqual({ name: 'Dm', start: 0, end: 960 });
  });
});

describe('global chord group edits', () => {
  it('restores trimmed chords after save and move, including the edited name of a boundary chord', () => {
    const { project, region } = fixture();
    region.chords = [{ name: 'C', start: 0, end: 480 }, { name: 'Am/C', start: 480, end: 960 }, { name: 'F', start: 960, end: 1920 }];
    applyMidiRegionChords(project, region, '分析和弦');
    editChordGroup(project, 0, 'trim-start', 240);
    editChordGroup(project, 240, 'trim-end', 840);
    renameGlobalChord(project, { groupStart: 240, chordStart: 240 }, 'Cmaj7');
    expect(project.chordTrack?.[0].chords.map(chord => [chord.name, chord.start, chord.end])).toEqual([
      ['Cmaj7', 240, 480], ['Am/C', 480, 840],
    ]);
    editChordGroup(project, 240, 'move', 2160);
    const reopened = openNbsx(saveNbsx(project));
    editChordGroup(reopened, 2160, 'trim-start', 1920);
    editChordGroup(reopened, 1920, 'trim-end', 3840);
    expect(reopened.chordTrack?.[0]).toEqual({ name: '分析和弦', start: 1920, end: 3840, chords: [
      { name: 'Cmaj7', start: 1920, end: 2400 }, { name: 'Am/C', start: 2400, end: 2880 }, { name: 'F', start: 2880, end: 3840 },
    ] });
    expect(reopened.regions[0].chords).toEqual(region.chords);
  });

  it('keeps the copied group independent and trims only the intersected portion of other groups', () => {
    const { project, region } = fixture();
    region.chords = [{ name: 'G7', start: 0, end: 480 }];
    applyMidiRegionChords(project, { ...region, length: 480 }, '源组');
    insertGlobalChord(project, 1920, 3840);
    expect(editChordGroup(project, 0, 'copy', 240)).toBeUndefined();
    expect(editChordGroup(project, 0, 'copy', 2400)).toEqual({ start: 2400, end: 2880 });
    expect(project.chordTrack?.map(group => [group.start, group.end, group.chords[0]?.name])).toEqual([
      [0, 480, 'G7'], [1920, 2400, 'C'], [2400, 2880, 'G7'], [2880, 3840, 'C'],
    ]);
    renameGlobalChord(project, { groupStart: 2400, chordStart: 2400 }, 'G9');
    expect(project.chordTrack?.[0].chords[0].name).toBe('G7');
    const reopened = openNbsx(saveNbsx(project));
    expect(reopened.chordTrack).toEqual(project.chordTrack);
    editChordGroup(reopened, 1920, 'trim-end', 3840);
    expect(reopened.chordTrack?.map(group => [group.start, group.end, group.chords[0]?.name])).toEqual([
      [0, 480, 'G7'], [1920, 3840, 'C'],
    ]);
  });
});
