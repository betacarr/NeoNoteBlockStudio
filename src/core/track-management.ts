import { NBSX_SAVE_TIMESTAMP, sizeBudget } from './clipboard-resources';
import { validateProject } from './project';
import type { Pattern, Project, Region, Track } from './types';

export type TrackInspection = { ok: true } | { ok: false; reason: string };
export type TrackMoveInspection = { ok: true; targetId: string } | { ok: false; reason: string };
export interface TrackDeleteResult { removedRegionIds: string[]; removedPatternIds: string[] }
interface TrackProjection {
  tracks: Track[];
  channels: Map<string, number>;
  regions: Region[];
  patterns: Pattern[];
}
type MovePlan = { ok: true; targetId: string; projection: TrackProjection } | { ok: false; reason: string };
type DeletePlan = { ok: true; result: TrackDeleteResult; projection: TrackProjection } | { ok: false; reason: string };

const rejected = (error: unknown): { ok: false; reason: string } => ({ ok: false,
  reason: (error instanceof Error ? error.message : '无法完整整理轨道。').replace(/^粘贴后工程/, '轨道整理后工程') });

/** Stream the prospective saved manifest, including the writer's timestamp. */
function assertBudget(project: Project, projection: TrackProjection): void {
  const budget = sizeBudget();
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, tracks: [], patterns: [], regions: [], instruments: [], assets: [],
    ...(project.midi ? { midi: { ...project.midi, conductor: [] } } : {}) });
  budget.addItems(projection.tracks); budget.addItems(projection.regions); budget.addItems(project.instruments);
  if (project.midi) budget.addItems(project.midi.conductor);
  projection.patterns.forEach((pattern, index) => {
    if (index) budget.comma();
    budget.addJson({ ...pattern, notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    budget.addItems(pattern.notes); if (pattern.midiEvents !== undefined) budget.addItems(pattern.midiEvents);
  });
  project.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); });
  budget.finish();
}

/** Pin only implicit channels whose new document index would change their MIDI. */
function projectTracks(project: Project, tracks: Track[], regions = project.regions, patterns = project.patterns): TrackProjection {
  const previous = new Map(project.tracks.map((track, index) => [track.id, index % 16]));
  const channels = new Map<string, number>();
  const projected = tracks.map((track, index) => {
    const channel = previous.get(track.id)!;
    if (track.midiChannel !== undefined || channel === index % 16) return track;
    channels.set(track.id, channel); return { ...track, midiChannel: channel };
  });
  return { tracks: projected, channels, regions, patterns };
}

function selectedTrack(project: Project, id: string, visibleIds?: ReadonlySet<string>): number {
  validateProject(project);
  const index = project.tracks.findIndex(track => track.id === id);
  if (index < 0) throw new Error('所选轨道已失效，请重新选择。');
  if (visibleIds !== undefined && !visibleIds.has(id)) throw new Error('所选轨道已被筛选隐藏，无法整理。');
  return index;
}

function planMove(project: Project, id: string, direction: -1 | 1, visibleIds?: ReadonlySet<string>): MovePlan {
  try {
    if (direction !== -1 && direction !== 1) throw new Error('轨道移动方向无效。');
    const index = selectedTrack(project, id, visibleIds);
    let target = index + direction;
    while (target >= 0 && target < project.tracks.length && visibleIds !== undefined && !visibleIds.has(project.tracks[target].id)) target += direction;
    if (target < 0 || target >= project.tracks.length) throw new Error('已到可见轨道边界，无法继续移动。');
    const tracks = project.tracks.slice(); [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    const projection = projectTracks(project, tracks); assertBudget(project, projection);
    return { ok: true, targetId: project.tracks[target].id, projection };
  } catch (error) { return rejected(error); }
}

function planDelete(project: Project, id: string, visibleIds?: ReadonlySet<string>): DeletePlan {
  try {
    const index = selectedTrack(project, id, visibleIds);
    if (project.tracks[index].locked) throw new Error('所选轨道已锁定，无法删除。');
    const removedRegions = project.regions.filter(region => region.trackId === id);
    const regions = project.regions.filter(region => region.trackId !== id);
    const unreferenced = new Set(removedRegions.map(region => region.patternId));
    for (const region of regions) unreferenced.delete(region.patternId);
    const removedPatterns = project.patterns.filter(pattern => unreferenced.has(pattern.id));
    const patterns = removedPatterns.length ? project.patterns.filter(pattern => !unreferenced.has(pattern.id)) : project.patterns;
    const projection = projectTracks(project, project.tracks.filter(track => track.id !== id), removedRegions.length ? regions : project.regions, patterns);
    assertBudget(project, projection);
    return { ok: true, projection, result: { removedRegionIds: removedRegions.map(region => region.id), removedPatternIds: removedPatterns.map(pattern => pattern.id) } };
  } catch (error) { return rejected(error); }
}

/** Pure preflight. Locked tracks can move because neither their content nor mix changes. */
export function inspectTrackMove(project: Project, id: string, direction: -1 | 1, visibleIds?: ReadonlySet<string>): TrackMoveInspection {
  const plan = planMove(project, id, direction, visibleIds); return plan.ok ? { ok: true, targetId: plan.targetId } : plan;
}

function applyProjection(project: Project, projection: TrackProjection): void {
  // Reuse every surviving object. Only the required implicit channel pins change.
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  for (const [id, channel] of projection.channels) tracks.get(id)!.midiChannel = channel;
  project.tracks = projection.tracks.map(track => tracks.get(track.id)!);
  if (project.regions !== projection.regions) project.regions = projection.regions;
  if (project.patterns !== projection.patterns) project.patterns = projection.patterns;
}

/** Atomic mutator for an Immer draft; hidden canonical slots stay in place. */
export function moveTrackInView(project: Project, id: string, direction: -1 | 1, visibleIds?: ReadonlySet<string>): boolean {
  const plan = planMove(project, id, direction, visibleIds); if (!plan.ok) return false;
  applyProjection(project, plan.projection); return true;
}

export function inspectTrackDelete(project: Project, id: string, visibleIds?: ReadonlySet<string>): TrackInspection {
  const plan = planDelete(project, id, visibleIds); return plan.ok ? { ok: true } : plan;
}

/** Remove one track and only the sources made unreferenced by its own regions. */
export function deleteTrack(project: Project, id: string, visibleIds?: ReadonlySet<string>): TrackDeleteResult | undefined {
  const plan = planDelete(project, id, visibleIds); if (!plan.ok) return;
  applyProjection(project, plan.projection); return plan.result;
}

/** Prefer the old index-based channel, then the first unused channel, then reuse. */
export function allocateTrackMidiChannel(project: Project, preferredIndex = project.tracks.length): number {
  if (!Number.isSafeInteger(preferredIndex) || preferredIndex < 0) throw new Error('新轨道的首选 MIDI 频道索引无效。');
  const preferred = preferredIndex % 16, occupied = new Set<number>();
  project.tracks.forEach((track, index) => {
    const channel = track.midiChannel ?? index % 16;
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error('工程包含无效 MIDI 频道。');
    occupied.add(channel);
  });
  if (!occupied.has(preferred)) return preferred;
  for (let channel = 0; channel < 16; channel++) if (!occupied.has(channel)) return channel;
  return preferred;
}
