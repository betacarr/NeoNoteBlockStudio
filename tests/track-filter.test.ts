import { describe, expect, it } from 'vitest';
import { filterTracks, trackInstrumentOptions } from '../src/core/track-filter';
import { createProject, newNote, newTrack } from '../src/core/project';
import type { Instrument } from '../src/core/types';

const instrument = (id: string, name = id): Instrument => ({ id, name, englishName: id, block: 'fixture', color: '#abc', rootMidi: 66, gmProgram: 0 });

describe('track default-instrument display filtering', () => {
  it('returns the original readonly array for all instruments, retaining generic track metadata', () => {
    const tracks = Object.freeze([{ instrumentId: 'bass', originalIndex: 9 }, { instrumentId: 'harp', originalIndex: 2 }].map(track => Object.freeze(track)));
    const all = filterTracks(tracks, '');
    expect(all).toBe(tracks); expect(all.map(track => track.originalIndex)).toEqual([9, 2]);
  });

  it('retains source order and original objects, regardless of lock, mute or solo state', () => {
    const tracks = [newTrack('First', 0, 'bass'), newTrack('Other', 1), newTrack('Last', 2, 'bass')];
    tracks[0].muted = true; tracks[2].locked = true; tracks[2].solo = true;
    const before = structuredClone(tracks); tracks.forEach(Object.freeze); Object.freeze(tracks);
    const shown = filterTracks(tracks, 'bass');
    expect(shown).toEqual([tracks[0], tracks[2]]); expect(shown[0]).toBe(tracks[0]); expect(shown[1]).toBe(tracks[2]);
    expect(tracks).toEqual(before); expect(filterTracks(tracks, 'missing')).toEqual([]);
  });

  it('orders used options by project instrument order and counts custom IDs independently of identical names', () => {
    const instruments = [instrument('custom-b', '同名'), instrument('unused'), instrument('harp', '钢琴'), instrument('custom-a', '同名')];
    const tracks = [newTrack('A', 0, 'custom-a'), newTrack('H', 1, 'harp'), newTrack('B', 2, 'custom-b'), newTrack('A2', 3, 'custom-a')];
    expect(trackInstrumentOptions(tracks, instruments)).toEqual([
      { id: 'custom-b', name: '同名', count: 1 }, { id: 'harp', name: '钢琴', count: 1 }, { id: 'custom-a', name: '同名', count: 2 },
    ]);
    expect(filterTracks(tracks, 'custom-b')).toEqual([tracks[2]]);
  });

  it('keeps a selected unused known option at its project position with a zero count', () => {
    const tracks = [newTrack('H', 0, 'harp')], instruments = [instrument('bass'), instrument('harp'), instrument('bell')];
    expect(trackInstrumentOptions(tracks, instruments, 'bass')).toEqual([{ id: 'bass', name: 'bass', count: 0 }, { id: 'harp', name: 'harp', count: 1 }]);
    expect(filterTracks(tracks, 'bass')).toEqual([]);
  });

  it('gives missing definitions distinct fallback labels after known options in first-occurrence order', () => {
    const tracks = ['unknown-b', 'harp', 'unknown-a', 'unknown-b'].map((id, index) => newTrack(String(index), index, id));
    expect(trackInstrumentOptions(tracks, [instrument('harp')], 'deleted')).toEqual([
      { id: 'harp', name: 'harp', count: 1 }, { id: 'unknown-b', name: '未知乐器 · unknown-b', count: 2 },
      { id: 'unknown-a', name: '未知乐器 · unknown-a', count: 1 }, { id: 'deleted', name: '未知乐器 · deleted', count: 0 },
    ]);
  });

  it('preserves an unavailable selection in empty projects without inventing a default filter', () => {
    expect(trackInstrumentOptions([], [instrument('harp')])).toEqual([]);
    expect(trackInstrumentOptions([], [instrument('harp')], 'harp')).toEqual([{ id: 'harp', name: 'harp', count: 0 }]);
    expect(trackInstrumentOptions([], [], 'deleted')).toEqual([{ id: 'deleted', name: '未知乐器 · deleted', count: 0 }]);
  });

  it('does not inspect per-note instrument overrides or alter any project state', () => {
    const project = createProject(); project.patterns[0].notes = [{ ...newNote(0, 66), instrumentId: 'bell' }];
    const before = structuredClone(project), tracks = project.tracks, instruments = project.instruments;
    tracks.forEach(Object.freeze); instruments.forEach(Object.freeze); Object.freeze(tracks); Object.freeze(instruments);
    expect(filterTracks(tracks, 'bell')).toEqual([]);
    expect(trackInstrumentOptions(tracks, instruments)).toEqual([{ id: 'harp', name: '钢琴', count: 1 }]);
    expect(project).toEqual(before); expect(project.tracks).toBe(tracks);
  });
});
