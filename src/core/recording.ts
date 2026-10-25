import { createMeterMap, patternTickAt } from './meter';
import { uid } from './project';
import { growEditedPattern } from './editor-interaction';
import { produce } from 'immer';
import type { Note, Project, Region } from './types';
import type { TransportPosition } from './transport';

export interface RecordedPress {
  noteId: string; documentKey: number; ppq: number; trackId: string;
  regionState: Pick<Region, 'start' | 'length' | 'offset' | 'loop'>;
  patternLength?: number;
  pitch: number; velocity: number; projectId: string; patternId: string; regionId: string;
  absoluteTick: number; sourceTick: number; linearTick: number; live: boolean; capture: boolean;
  snap: number; duration: number;
}
const MAX_TICK = 1e12, MAX_NOTES = 2000000;
const finite = (value: number, min = 0, max = MAX_TICK) => Number.isFinite(value) && value >= min && value <= max;
const validDocumentKey = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validRegion = (region: Region) => finite(region.start) && finite(region.offset) && finite(region.length, 1) && typeof region.loop === 'boolean';

function idInProject(project: Project, id: string): boolean {
  return project.id === id || project.tracks.some(item => item.id === id) || project.regions.some(item => item.id === id)
    || project.instruments.some(item => item.id === id) || project.assets.some(item => item.id === id)
    || project.midi?.conductor.some(item => item.id === id) === true
    || project.patterns.some(pattern => pattern.id === id || pattern.notes.some(note => note.id === id) || pattern.midiEvents?.some(event => event.id === id));
}

export function beginRecordedPress(project: Project, region: Region, pitch: number, velocity: number, caret: number, position: TransportPosition | undefined, capture: boolean, snap: number, noteLength: number, documentKey = 0): RecordedPress | undefined {
  const pattern = project.patterns.find(p => p.id === region.patternId);
  const track = project.tracks.find(item => item.id === region.trackId);
  if (!pattern || !track || !validRegion(region) || !finite(pattern.length, 1) || !finite(project.ppq, 1, 32767) || !Number.isInteger(project.ppq)
    || !validDocumentKey(documentKey) || !finite(pitch, 0, 127) || !Number.isInteger(pitch) || !finite(velocity, 0, 1)
    || !finite(snap) || !Number.isFinite(noteLength) || noteLength <= 0) return;
  const tick = position?.tick ?? Math.max(caret, region.start);
  const duration = project.ppq * 4 / noteLength, linearTick = position?.linearTick ?? tick;
  const sourceTick = patternTickAt(tick, region, pattern);
  if (!finite(tick) || !finite(sourceTick) || !finite(linearTick, 0, Number.MAX_SAFE_INTEGER) || !finite(duration, 0, MAX_TICK)) return;
  const inRange = tick >= region.start && tick < region.start + region.length;
  let noteId: string; do { noteId = uid(); } while (idInProject(project, noteId));
  return { noteId, documentKey, ppq: project.ppq, trackId: track.id, regionState: { start: region.start, length: region.length, offset: region.offset, loop: region.loop },
    ...(region.loop ? { patternLength: pattern.length } : {}), pitch, velocity, projectId: project.id, patternId: pattern.id, regionId: region.id,
    absoluteTick: tick, sourceTick, linearTick,
    live: !!position, capture: capture && !track.locked && (!position || inRange), snap, duration };
}
export function finishRecordedPress(project: Project, press: RecordedPress, position?: TransportPosition, documentKey?: number): { note: Note; caret: number } | undefined {
  const region = project.regions.find(r => r.id === press.regionId), pattern = project.patterns.find(p => p.id === press.patternId);
  const track = project.tracks.find(item => item.id === press.trackId);
  if (!press.capture || project.id !== press.projectId || project.ppq !== press.ppq || !region || !pattern || !track || track.locked
    || region.patternId !== pattern.id || region.trackId !== press.trackId || !validRegion(region) || !finite(pattern.length, 1)
    || !press.regionState || region.start !== press.regionState.start || region.length !== press.regionState.length
    || region.offset !== press.regionState.offset || region.loop !== press.regionState.loop || region.loop && pattern.length !== press.patternLength
    || !validDocumentKey(press.documentKey) || documentKey !== undefined && (!validDocumentKey(documentKey) || documentKey !== press.documentKey)
    || typeof press.noteId !== 'string' || !press.noteId || idInProject(project, press.noteId)
    || !finite(press.absoluteTick) || !finite(press.sourceTick) || !finite(press.snap) || !finite(press.duration)
    || !finite(press.pitch, 0, 127) || !Number.isInteger(press.pitch) || !finite(press.velocity, 0, 1)
    || !finite(press.linearTick, 0, Number.MAX_SAFE_INTEGER)) return;
  if (position && (!finite(position.tick) || !finite(position.linearTick, 0, Number.MAX_SAFE_INTEGER) || press.live && position.linearTick < press.linearTick)) return;
  const quantized = createMeterMap(project).snap(press.absoluteTick, press.snap ? project.ppq * 4 / press.snap : 1);
  let tick = Math.max(0, press.sourceTick + quantized - press.absoluteTick);
  if (region.loop) tick %= pattern.length;
  const duration = press.live ? Math.max(1, Math.round((position?.linearTick ?? press.linearTick) - press.linearTick)) : Math.max(1, Math.round(press.duration));
  const caret = quantized + duration;
  if (!finite(tick, 0, MAX_TICK - 1) || !finite(duration, 1) || !finite(caret)) return;
  const grownRegion = { ...region }, grownPattern = { ...pattern };
  if (!region.loop) growEditedPattern(project, grownRegion, grownPattern, tick + 1);
  if (!finite(grownPattern.length, 1) || !finite(grownRegion.length, 1)) return;
  return { note: { id: press.noteId, tick, duration, midi: press.pitch, velocity: press.velocity, pan: 0, detune: 0, height: 0 }, caret };
}

/** Build a saveable view of held notes without finishing keys or editing history. */
export function previewRecordingProject(project: Project, presses: Iterable<RecordedPress>, position?: TransportPosition, documentKey?: number): { project: Project; noteCount: number } {
  const pending: { press: RecordedPress; note: Note }[] = [], seen = new Set<string>();
  for (const press of presses) {
    if (seen.has(press.noteId)) continue;
    const result = finishRecordedPress(project, press, position, documentKey);
    if (result) { pending.push({ press, note: result.note }); seen.add(press.noteId); }
  }
  if (!pending.length) return { project, noteCount: 0 };
  let count = pending.length;
  for (const pattern of project.patterns) count += pattern.notes.length;
  if (count > MAX_NOTES) throw new Error('录入快照中的音符超过 200 万个，请先拆分工程。');
  const snapshot = produce(project, draft => {
    for (const { press, note } of pending) {
      const pattern = draft.patterns.find(item => item.id === press.patternId)!, region = draft.regions.find(item => item.id === press.regionId)!;
      pattern.notes.push(note); if (!region.loop) growEditedPattern(draft, region, pattern, note.tick + 1);
      if (!finite(pattern.length, 1) || !finite(region.length, 1)) throw new Error('录入快照的片段范围超过工程上限。');
    }
  });
  return { project: snapshot, noteCount: pending.length };
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equalJson(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

/** Compare the full saved JSON data, excluding only the root save timestamp. */
export function recordingProjectsEqual(a: Project, b: Project): boolean {
  if (a === b) return true;
  try {
    const left = JSON.stringify({ ...a, modifiedAt: undefined }), right = JSON.stringify({ ...b, modifiedAt: undefined });
    return left === right || equalJson(JSON.parse(left), JSON.parse(right));
  } catch { return false; }
}
