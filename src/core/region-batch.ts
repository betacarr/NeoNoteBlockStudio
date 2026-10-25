import { MAX_PROJECT_TICK } from './expansion';
import { uid } from './project';
import type { Pattern, Project, Region, Track } from './types';

export interface RegionMove { id: string; start: number; trackId: string }
export type RegionGroupMovePlan = { ok: true; changes: RegionMove[]; deltaTick: number; trackDelta: number } | { ok: false; reason: string };
const validStart = (value: number) => Number.isFinite(value) && value >= 0 && value <= MAX_PROJECT_TICK;

/** Resolve the whole selection before any mutation; stale IDs never select a subset. */
function selectedRegions(project: Project, ids: ReadonlySet<string>): { regions: Region[]; tracks: Map<string, Track>; patterns: Map<string, Pattern> } | undefined {
  if (!ids.size) return;
  const tracks = new Map(project.tracks.map(track => [track.id, track])), patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]));
  const regions = project.regions.filter(region => ids.has(region.id));
  if (regions.length !== ids.size || regions.some(region => !tracks.has(region.trackId) || tracks.get(region.trackId)!.locked
    || !patterns.has(region.patternId) || !validStart(region.start))) return;
  return { regions, tracks, patterns };
}

/** Preserve one shared time/row delta. The caller snaps the requested anchor. */
export function planRegionGroupMove(project: Project, ids: ReadonlySet<string>, anchorRegionId: string, targetTrackId: string,
  requestedStart: number, trackOrder: readonly string[]): RegionGroupMovePlan {
  const rejected = (reason: string): RegionGroupMovePlan => ({ ok: false, reason });
  if (!Number.isFinite(requestedStart)) return rejected('片段开始时间必须是有限数值。');
  const selected = selectedRegions(project, ids);
  if (!selected) return rejected('选区为空、含失效片段或已锁定轨道，无法成组移动。');
  const { regions, tracks } = selected;
  const anchor = regions.find(region => region.id === anchorRegionId);
  if (!anchor) return rejected('拖动的主片段不在当前选区中。');
  const rows = new Map(trackOrder.map((id, index) => [id, index]));
  if (rows.size !== trackOrder.length || trackOrder.some(id => !tracks.has(id))) return rejected('可见轨道顺序已失效。');
  const anchorRow = rows.get(anchor.trackId), targetRow = rows.get(targetTrackId);
  if (anchorRow === undefined || targetRow === undefined || regions.some(region => !rows.has(region.trackId))) return rejected('选区或目标包含被筛选隐藏的轨道。');
  const trackDelta = targetRow - anchorRow;
  let earliest = Infinity, latest = 0;
  for (const region of regions) { earliest = Math.min(earliest, region.start); latest = Math.max(latest, region.start); }
  const deltaTick = Math.max(-earliest, Math.min(MAX_PROJECT_TICK - latest, requestedStart - anchor.start));
  const changes: RegionMove[] = [];
  for (const region of regions) {
    const row = rows.get(region.trackId)! + trackDelta, trackId = trackOrder[row], target = tracks.get(trackId);
    if (!target || target.locked) return rejected('成组移动会超出轨道范围或进入已锁定轨道。');
    const start = region.start + deltaTick;
    if (!validStart(start)) return rejected('成组移动会超出工程时间范围。');
    changes.push({ id: region.id, start, trackId });
  }
  return { ok: true, changes, deltaTick, trackDelta };
}

/** Use the actual NBSX limits, including conductor messages, before UID allocation. */
function hasCapacity(project: Project, clones: readonly Pattern[], addedRegions = 0): boolean {
  if (project.patterns.length + clones.length > 100000 || project.regions.length + addedRegions > 100000) return false;
  let notes = 0, messages = project.midi?.conductor.length ?? 0;
  for (const patterns of [project.patterns, clones]) for (const pattern of patterns) {
    notes += pattern.notes.length; messages += pattern.midiEvents?.length ?? 0;
    if (notes > 2000000 || messages > 2000000) return false;
  }
  return true;
}

function clonePattern(pattern: Pattern, duplicate = false): Pattern {
  return { ...pattern, id: uid(), ...(duplicate ? { name: `${pattern.name} 副本` } : {}),
    notes: pattern.notes.map(note => ({ ...note, id: uid(), ...(note.midiSource ? { midiSource: { ...note.midiSource } } : {}) })),
    ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(item => ({ ...item, id: uid(),
      event: { ...item.event, ...('data' in item.event ? { data: Array.from(item.event.data) } : {}) } })) } : {}) };
}
function clearOffRoutes(pattern: Pattern) {
  for (const note of pattern.notes) if (note.midiSource?.offSourceTrack !== undefined) delete note.midiSource.offSourceTrack;
}

/** Validate and stage every detach before writing any member of the group. */
export function applyRegionGroupMove(project: Project, changes: readonly RegionMove[]): boolean {
  if (!changes.length || new Set(changes.map(change => change.id)).size !== changes.length) return false;
  const regions = new Map(project.regions.map(region => [region.id, region])), tracks = new Map(project.tracks.map(track => [track.id, track]));
  const patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]));
  const usage = new Map<string, number>();
  for (const region of project.regions) usage.set(region.patternId, (usage.get(region.patternId) ?? 0) + 1);
  const routed = new Map<string, boolean>();
  const detaches: { region: Region; pattern: Pattern }[] = [], clear = new Set<Pattern>();
  let changed = false;
  for (const change of changes) {
    const region = regions.get(change.id), source = region && tracks.get(region.trackId), target = tracks.get(change.trackId), pattern = region && patterns.get(region.patternId);
    if (!region || !source || !target || !pattern || source.locked || target.locked || !validStart(change.start)) return false;
    if (region.start !== change.start || region.trackId !== change.trackId) changed = true;
    if (region.trackId === change.trackId) continue;
    if (!routed.has(pattern.id)) routed.set(pattern.id, pattern.notes.some(note => note.midiSource?.offSourceTrack !== undefined));
    if (routed.get(pattern.id)) {
      const count = usage.get(pattern.id)!;
      if (count > 1) { detaches.push({ region, pattern }); usage.set(pattern.id, count - 1); }
      else clear.add(pattern);
    }
  }
  if (!changed || detaches.length && !hasCapacity(project, detaches.map(item => item.pattern))) return false;
  const staged = detaches.map(item => { const pattern = clonePattern(item.pattern); clearOffRoutes(pattern); return { region: item.region, pattern }; });
  for (const { region, pattern } of staged) { project.patterns.push(pattern); region.patternId = pattern.id; }
  for (const pattern of clear) clearOffRoutes(pattern);
  for (const change of changes) { const region = regions.get(change.id)!; region.start = change.start; region.trackId = change.trackId; }
  return true;
}

/** Copy each selected occurrence independently to the right of the whole span. */
export function duplicateRegionGroup(project: Project, ids: ReadonlySet<string>): Region[] | undefined {
  const selected = selectedRegions(project, ids); if (!selected) return;
  const { regions, patterns } = selected;
  let first = Infinity, last = 0;
  for (const region of regions) {
    if (!Number.isFinite(region.length) || region.length < 1 || region.length > MAX_PROJECT_TICK) return;
    first = Math.min(first, region.start); last = Math.max(last, region.start + region.length);
  }
  const delta = last - first;
  if (!Number.isFinite(delta) || regions.some(region => !validStart(region.start + delta))) return;
  const sources = regions.map(region => patterns.get(region.patternId)!);
  if (!hasCapacity(project, sources, regions.length)) return;
  const staged = regions.map((region, index) => {
    const pattern = clonePattern(sources[index], true);
    return { pattern, region: { ...region, id: uid(), patternId: pattern.id, start: region.start + delta } };
  });
  for (const item of staged) { project.patterns.push(item.pattern); project.regions.push(item.region); }
  return staged.map(item => item.region);
}

/** Remove only the selected occurrences and their newly unreferenced sources. */
export function deleteRegionGroup(project: Project, ids: ReadonlySet<string>): boolean {
  const selected = selectedRegions(project, ids); if (!selected) return false;
  const { regions } = selected;
  const removedSources = new Set(regions.map(region => region.patternId)), remaining = project.regions.filter(region => !ids.has(region.id));
  for (const region of remaining) removedSources.delete(region.patternId);
  project.regions = remaining;
  if (removedSources.size) project.patterns = project.patterns.filter(pattern => !removedSources.has(pattern.id));
  return true;
}
