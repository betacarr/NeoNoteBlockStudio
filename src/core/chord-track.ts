import type { AudioClip, Project, Region } from './types';
import { createTempoMap } from './time';
import { MAX_PROJECT_TICK } from './expansion';

export interface ChordRange { name: string; start: number; end: number }
interface ChordGroupSource { start: number; end: number; chords: ChordRange[] }
export interface ChordTrackGroup extends ChordRange {
  chords: ChordRange[];
  trimSource?: ChordGroupSource;
}
export interface ChordTrackPosition { groupStart: number; chordStart: number }
export type ChordGroupEdit = 'move' | 'copy' | 'trim-start' | 'trim-end';
export type RegionChordAction = 'chords' | 'edit-chords' | 'apply-chords' | 'read-chords' | 'drop-chords';
const MAX_CHORD_RANGES = 100000;
const KEY_TONICS = [
  ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'],
  ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'],
];

export function regionChords(clip: AudioClip) {
  const markers = clip.chords ?? (clip.analysis?.analysisPerformed !== false ? clip.analysis?.chords : undefined);
  if (!markers || clip.chordOriginSeconds === undefined) return markers;
  const offset = clip.offsetSeconds - clip.chordOriginSeconds;
  return markers.flatMap(chord => intersect(chord, offset, offset + clip.durationSeconds))
    .map(chord => ({ ...chord, start: Math.max(0, chord.start - offset), end: Math.min(clip.durationSeconds, chord.end - offset) }))
    .filter(chord => chord.end > chord.start);
}

function intersect<T extends ChordRange>(range: T, start: number, end: number): T[] {
  const left = Math.max(range.start, start), right = Math.min(range.end, end);
  return right > left ? [{ ...range, start: left, end: right }] : [];
}

function outsideRange<T extends ChordRange>(range: T, start: number, end: number): T[] {
  if (range.end <= start || range.start >= end) return [range];
  return [...intersect(range, range.start, start), ...intersect(range, end, range.end)];
}

export function midiRegionChords(region: Region) {
  return region.chords?.flatMap(chord => intersect(chord, region.offset, region.offset + region.length))
    .map(chord => ({ ...chord, start: chord.start - region.offset, end: chord.end - region.offset }));
}

export function applyRegionChords(project: Project, clip: AudioClip, cycle?: { start: number; end: number }) {
  const markers = regionChords(clip);
  if (!markers) throw new Error('请先分析片段和弦。');
  const tempo = createTempoMap(project), origin = tempo.seconds(clip.start);
  const chords: ChordRange[] = [];
  for (const chord of markers) {
    const left = Math.max(chords.at(-1)?.end ?? clip.start, tempo.tick(origin + chord.start));
    const right = tempo.tick(origin + chord.end);
    if (right > left) chords.push({ name: chord.name, start: left, end: right });
  }
  writeChordGroup(project, { name: clip.name, start: clip.start, end: tempo.tick(origin + clip.durationSeconds), chords }, cycle);
}

export function applyMidiRegionChords(project: Project, region: Region, name: string, cycle?: { start: number; end: number }) {
  const chords = midiRegionChords(region);
  if (!chords) throw new Error('请先分析片段和弦。');
  writeChordGroup(project, { name, start: region.start, end: region.start + region.length, chords: chords.map(chord => ({
    ...chord, start: region.start + chord.start, end: region.start + chord.end,
  })) }, cycle);
}

function writeChordGroup(project: Project, range: ChordTrackGroup, cycle?: { start: number; end: number }) {
  const start = Math.max(range.start, cycle?.start ?? range.start);
  const end = Math.min(MAX_PROJECT_TICK, range.end, cycle?.end ?? range.end);
  if (end <= start) return;
  const chords = range.chords.flatMap(chord => intersect(chord, start, end));
  if (!chords.length) chords.push({ name: 'N.C.', start, end });
  const group = { name: range.name.slice(0, 512) || '和弦', start, end, chords };
  const next = placeChordGroup(project.chordTrack ?? [], group);
  if (next.length <= MAX_CHORD_RANGES) project.chordTrack = next;
}

function placeChordGroup(groups: readonly ChordTrackGroup[], group: ChordTrackGroup) {
  const remaining = groups.flatMap(old => outsideRange(old, group.start, group.end).map(part => part === old ? old : {
    ...part, chords: old.chords.flatMap(chord => intersect(chord, part.start, part.end)),
    trimSource: old.trimSource ?? { start: old.start, end: old.end, chords: old.chords },
  }));
  return [...remaining, group].sort((a, b) => a.start - b.start);
}

export function chordGroupEditRange(group: ChordTrackGroup, edit: ChordGroupEdit, tick: number) {
  if (!Number.isFinite(tick)) return;
  const length = group.end - group.start, minimum = Math.min(1, length);
  const source = group.trimSource ?? group;
  if (edit === 'trim-start') return {
    start: Math.max(0, source.start, Math.min(group.end - minimum, tick)), end: group.end,
  };
  if (edit === 'trim-end') return {
    start: group.start, end: Math.min(MAX_PROJECT_TICK, source.end, Math.max(group.start + minimum, tick)),
  };
  const start = Math.max(0, Math.min(MAX_PROJECT_TICK - length, tick)), end = start + length;
  if (edit === 'copy' && start < group.end && end > group.start) return;
  return { start, end };
}

export function editChordGroup(project: Project, groupStart: number, edit: ChordGroupEdit, tick: number) {
  const groups = project.chordTrack ?? [];
  const group = groups.find(item => item.start === groupStart);
  if (!group) return;
  const range = chordGroupEditRange(group, edit, tick);
  if (!range || range.start === group.start && range.end === group.end) return;
  const { start, end } = range;
  const next: ChordTrackGroup = { name: group.name, start, end, chords: [] };
  if (edit === 'move' || edit === 'copy') {
    const delta = start - group.start;
    const shift = (chords: ChordRange[]) => chords.map(chord => ({ ...chord, start: chord.start + delta, end: chord.end + delta }));
    const source = group.trimSource;
    if (source) next.trimSource = { start: source.start + delta, end: source.end + delta, chords: shift(source.chords) };
    next.chords = (next.trimSource?.chords ?? shift(group.chords)).flatMap(chord => intersect(chord, start, end));
  } else {
    const source = group.trimSource ?? { start: group.start, end: group.end, chords: group.chords };
    next.chords = source.chords.flatMap(chord => intersect(chord, start, end));
    if (source.start !== start || source.end !== end) next.trimSource = source;
  }
  const placed = placeChordGroup(edit === 'copy' ? groups : groups.filter(item => item !== group), next);
  if (placed.length > MAX_CHORD_RANGES) return;
  project.chordTrack = placed;
  return range;
}

function updateVisibleChords(group: ChordTrackGroup, chords: ChordRange[]) {
  const source = group.trimSource;
  if (source) {
    const pending = new Map(chords.map(chord => [chord.start, chord]));
    const remaining = source.chords.flatMap(chord => {
      const visibleStart = Math.max(chord.start, group.start), visibleEnd = Math.min(chord.end, group.end);
      const visible = pending.get(visibleStart);
      if (visible?.end === visibleEnd && visible.name === chord.name) {
        pending.delete(visibleStart);
        return [chord];
      }
      return outsideRange(chord, group.start, group.end);
    });
    const next = [...remaining, ...pending.values()].sort((a, b) => a.start - b.start);
    if (next.length > MAX_CHORD_RANGES) return;
    group.trimSource = { ...source, chords: next };
  }
  group.chords = chords;
}

export function insertGlobalChord(project: Project, start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= MAX_PROJECT_TICK) return;
  const groups = project.chordTrack ?? [];
  const group = groups.find(item => item.start <= start && start < item.end);
  if (group?.chords.some(chord => chord.start === start)) return;
  const nextChord = group?.chords.find(chord => chord.start > start);
  const boundary = group?.end ?? groups.find(item => item.start > start)?.start ?? MAX_PROJECT_TICK;
  end = Math.min(end, boundary, nextChord?.start ?? MAX_PROJECT_TICK);
  if (end <= start) return;
  let name = 'C', lastChange = -1;
  for (const change of project.midi?.conductor ?? []) {
    const { tick, event } = change;
    if (event.type !== 'keySignature' || tick > start || tick < lastChange) continue;
    name = KEY_TONICS[event.scale]?.[event.key + 7] ?? 'C';
    lastChange = tick;
  }
  const chord = { name, start, end };
  if (!group) {
    if (groups.length < MAX_CHORD_RANGES) writeChordGroup(project, { ...chord, name: '和弦', chords: [chord] });
    return;
  }
  const chords = [...group.chords.flatMap(previous => outsideRange(previous, start, end)), chord].sort((a, b) => a.start - b.start);
  if (chords.length <= MAX_CHORD_RANGES) updateVisibleChords(group, chords);
}

export function deleteGlobalChord(project: Project, groupStart: number, chordStart: number) {
  const group = project.chordTrack?.find(item => item.start === groupStart);
  if (!group) return;
  const index = group.chords.findIndex(chord => chord.start === chordStart);
  if (index < 0) return;
  if (group.chords.length === 1 && !group.trimSource) project.chordTrack = project.chordTrack!.filter(item => item !== group);
  else updateVisibleChords(group, group.chords.filter((_, at) => at !== index));
}

export function renameGlobalChord(project: Project, { groupStart, chordStart }: ChordTrackPosition, name: string) {
  const group = project.chordTrack?.find(item => item.start === groupStart);
  const chord = group?.chords.find(item => item.start === chordStart);
  if (!group || !chord || chord.name === name) return;
  const original = group.trimSource?.chords.find(item => Math.max(item.start, group.start) === chord.start
    && Math.min(item.end, group.end) === chord.end);
  if (original) original.name = name;
  chord.name = name;
}

function chordsWithin(project: Project, start: number, end: number) {
  return (project.chordTrack ?? []).flatMap(group => group.chords.flatMap(chord => intersect(chord, start, end)));
}

export function applyGlobalChords(project: Project, clip: AudioClip) {
  const tempo = createTempoMap(project), origin = tempo.seconds(clip.start);
  const end = tempo.tick(origin + clip.durationSeconds);
  clip.chords = chordsWithin(project, clip.start, end).map(part => ({
    id: crypto.randomUUID(), name: part.name, confidence: 1,
    start: Math.max(0, tempo.seconds(part.start) - origin),
    end: Math.min(clip.durationSeconds, tempo.seconds(part.end) - origin),
  })).filter(chord => chord.end > chord.start);
  delete clip.chordOriginSeconds;
}

export function applyGlobalChordsToMidi(project: Project, region: Region) {
  region.chords = chordsWithin(project, region.start, region.start + region.length).map(chord => ({
    ...chord, start: region.offset + (chord.start - region.start), end: region.offset + (chord.end - region.start),
  })).filter(chord => chord.end > chord.start);
}

function validRanges(ranges: ChordRange[], start: number, end: number) {
  return Array.isArray(ranges) && ranges.length <= MAX_CHORD_RANGES && ranges.every((range, index) => range
    && typeof range.name === 'string' && range.name.length > 0 && range.name.length <= 512
    && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= start && range.end <= end
    && range.end > range.start && (index === 0 || range.start >= ranges[index - 1].end));
}

export function validateMidiRegionChords(region: Region) {
  if (region.chords !== undefined && !validRanges(region.chords, 0, MAX_PROJECT_TICK * 2)) throw new Error('MIDI 片段和弦范围或顺序无效。');
}

export function validateChordTrack(value: ChordTrackGroup[] | undefined) {
  if (value === undefined) return;
  if (!validRanges(value, 0, MAX_PROJECT_TICK) || value.some(group => !validRanges(group.chords, group.start, group.end)))
    throw new Error('和弦轨范围或顺序无效。');
  for (const group of value) {
    const source = group.trimSource;
    if (source === undefined) continue;
    if (!source || !Number.isFinite(source.start) || !Number.isFinite(source.end)
      || source.start > group.start || source.end < group.end || source.end - source.start > MAX_PROJECT_TICK
      || !validRanges(source.chords, source.start, source.end)) throw new Error('和弦组的裁剪来源无效。');
    const visible = source.chords.flatMap(chord => intersect(chord, group.start, group.end));
    if (visible.length !== group.chords.length || visible.some((chord, index) => {
      const saved = group.chords[index];
      return saved.start !== chord.start || saved.end !== chord.end || saved.name !== chord.name;
    })) throw new Error('和弦组的可见范围与裁剪来源不一致。');
  }
}
