import { growEditedPattern } from './editor-interaction';
import { expansionError, MAX_PROJECT_TICK } from './expansion';
import type { Project } from './types';

export { expansionError, MAX_PROJECT_TICK } from './expansion';
export interface InspectorNoteTimingPatch { tick?: number; duration?: number }

const finite = (value: number, minimum = 0) => Number.isFinite(value) && value >= minimum && value <= MAX_PROJECT_TICK;

/** Preserve the inspector's exact displayed upper bound without rounding other input. */
export function inspectorBeatTicks(beats: number, ppq: number): number {
  return beats === MAX_PROJECT_TICK / ppq ? MAX_PROJECT_TICK : beats * ppq;
}

/** Only changed starts outside the original source period can grow its range. */
export function noteTimingError(project: Project, regionId: string, selectedIDs: ReadonlySet<string>, patch: InspectorNoteTimingPatch): string | undefined {
  if (!selectedIDs.size || patch.tick === undefined && patch.duration === undefined) return undefined;
  const region = project.regions.find(item => item.id === regionId), pattern = project.patterns.find(item => item.id === region?.patternId);
  const track = project.tracks.find(item => item.id === region?.trackId);
  if (!region || !pattern || !track) return '找不到要修改的片段或轨道。';
  if (track.locked) return '轨道已锁定，无法修改音符时间。';
  let selected = false, changed = false, required = pattern.length;
  for (const note of pattern.notes) {
    if (!selectedIDs.has(note.id)) continue;
    selected = true;
    if (patch.tick !== undefined && !finite(patch.tick) || patch.duration !== undefined && !finite(patch.duration)) return '音符开始时间和时值必须是 0 至 1e12 之间的有限数字。';
    if (patch.tick !== undefined && patch.tick !== note.tick) {
      changed = true;
      if (patch.tick >= pattern.length) required = Math.max(required, patch.tick + 1);
    }
    if (patch.duration !== undefined && patch.duration !== note.duration) changed = true;
  }
  if (!selected || !changed) return undefined;
  if (!finite(project.ppq, 1) || project.ppq > 32767 || !Number.isInteger(project.ppq)) return '工程时间分辨率无效。';
  const candidateRegion = { ...region }, candidatePattern = { ...pattern };
  if (required > pattern.length) growEditedPattern(project, candidateRegion, candidatePattern, required);
  if (!finite(candidatePattern.length, 1) || !finite(candidateRegion.length, 1)) return '音符修改后的小节进位或片段长度超过 1e12，请缩短开始位置。';
  return expansionError(project, true, { patternId: pattern.id, patternLength: candidatePattern.length, noteIds: selectedIDs, noteTick: patch.tick,
    regionId: region.id, regionLength: candidateRegion.length });
}

/** `length` is the actual tick length after the UI's beat-to-tick conversion. */
export function regionLengthError(project: Project, regionId: string, length: number): string | undefined {
  if (!finite(length, 1)) return '片段长度必须是 1 至 1e12 之间的有限数字。';
  const region = project.regions.find(item => item.id === regionId), track = project.tracks.find(item => item.id === region?.trackId);
  if (!region || !track || !project.patterns.some(item => item.id === region.patternId)) return '找不到要修改的片段或轨道。';
  if (track.locked) return '轨道已锁定，无法修改片段长度。';
  return expansionError(project, true, { regionId, regionLength: length });
}
