import { NBSX_SAVE_TIMESTAMP, sizeBudget } from './clipboard-resources';
import { MAX_PROJECT_TICK } from './expansion';
import { uid, validateProject } from './project';
import type { Pattern, Project, Region } from './types';

export type RegionSplitInspection = { ok: true; count: number } | { ok: false; reason: string };
export interface RegionSplitResult { pairs: { leftId: string; rightId: string }[] }
interface Cut { region: Region; pattern: Pattern; delta: number; rightLength: number; rightOffset: number; detachLeft: boolean; tick: number }
type Plan = { ok: true; cuts: Cut[]; clones: Pattern[] } | { ok: false; reason: string };
const BUDGET_ID = '00000000-0000-4000-8000-000000000000';

function leftOf(cut: Cut, patternId = cut.detachLeft ? BUDGET_ID : cut.pattern.id): Region {
  return { ...cut.region, patternId, length: cut.delta, midiEndExclusive: true };
}
function rightOf(cut: Cut, id = BUDGET_ID, patternId = BUDGET_ID): Region {
  return { ...cut.region, id, patternId, start: cut.tick, length: cut.rightLength, offset: cut.rightOffset };
}

/** Stream projected wire JSON without allocating copies of a large source. */
function assertBudget(project: Project, cuts: readonly Cut[] = [], clones: readonly Pattern[] = []) {
  const budget = sizeBudget(), byRegion = new Map(cuts.map(cut => [cut.region.id, cut]));
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, tracks: [], patterns: [], regions: [], instruments: [], assets: [] });
  budget.addItems(project.tracks); budget.addItems(project.instruments);
  let patternCount = 0;
  function addPattern(pattern: Pattern, cloned: boolean) {
    if (patternCount++) budget.comma();
    budget.addJson({ ...pattern, ...(cloned ? { id: BUDGET_ID } : {}), notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    pattern.notes.forEach((note, index) => { if (index) budget.comma(); budget.addJson(cloned ? { ...note, id: BUDGET_ID } : note); });
    pattern.midiEvents?.forEach((event, index) => { if (index) budget.comma(); budget.addJson(cloned ? { ...event, id: BUDGET_ID } : event); });
  }
  for (const pattern of project.patterns) addPattern(pattern, false);
  for (const pattern of clones) addPattern(pattern, true);
  let regionCount = 0;
  const addRegion = (region: Region) => { if (regionCount++) budget.comma(); budget.addJson(region); };
  for (const region of project.regions) {
    const cut = byRegion.get(region.id);
    if (cut) { addRegion(leftOf(cut)); addRegion(rightOf(cut)); } else addRegion(region);
  }
  project.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); }); budget.finish();
}

function plan(project: Project, ids: ReadonlySet<string>, tick: number, visibleTrackIds?: ReadonlySet<string>): Plan {
  try {
    if (!Number.isFinite(tick) || tick < 0 || tick > MAX_PROJECT_TICK) return { ok: false, reason: '播放头位置超过工程时间范围。' };
    if (!ids.size) return { ok: false, reason: '请选择需要拆分的片段。' };
    validateProject(project);
    const regions = project.regions.filter(region => ids.has(region.id));
    if (regions.length !== ids.size) return { ok: false, reason: '所选片段已失效，请重新选择。' };
    const tracks = new Map(project.tracks.map(track => [track.id, track])), patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern])), usage = new Map<string, number>();
    for (const region of project.regions) usage.set(region.patternId, (usage.get(region.patternId) ?? 0) + 1);
    const cuts: Cut[] = [], clones: Pattern[] = [];
    for (const region of regions) {
      if (tracks.get(region.trackId)!.locked || visibleTrackIds !== undefined && !visibleTrackIds.has(region.trackId)) return { ok: false, reason: '所选片段包含锁定或被筛选隐藏的轨道。' };
      const delta = tick - region.start, rightLength = region.length - delta;
      if (delta <= 0 || rightLength <= 0) continue;
      if (delta < 1 || rightLength < 1) return { ok: false, reason: '拆分后的左右片段都需至少保留 1 tick。' };
      const rightOffset = region.offset + delta;
      // Keep whole cycles: modulo would lose legacy far-note occurrences and
      // alter same-tick MIDI expression ordering. Unrepresentable offsets reject.
      if (!Number.isFinite(rightOffset) || rightOffset > MAX_PROJECT_TICK) return { ok: false, reason: '拆分后右片段的源偏移超过工程范围。' };
      const pattern = patterns.get(region.patternId)!, detachLeft = usage.get(pattern.id)! > 1;
      if (detachLeft) usage.set(pattern.id, usage.get(pattern.id)! - 1);
      cuts.push({ region, pattern, delta, rightLength, rightOffset, detachLeft, tick });
      if (detachLeft) clones.push(pattern); clones.push(pattern);
    }
    if (!cuts.length) return { ok: false, reason: '播放头不在所选片段可拆分的内部。' };
    if (project.patterns.length + clones.length > 100000 || project.regions.length + cuts.length > 100000) return { ok: false, reason: '拆分后片段或源数量超过安全上限。' };
    let notes = 0, messages = project.midi?.conductor.length ?? 0;
    for (const list of [project.patterns, clones]) for (const pattern of list) {
      notes += pattern.notes.length; messages += pattern.midiEvents?.length ?? 0;
      if (notes > 2000000 || messages > 2000000) return { ok: false, reason: '拆分后音符或 MIDI 消息超过 200 万个。' };
    }
    assertBudget(project, cuts, clones); return { ok: true, cuts, clones };
  } catch (error) { return { ok: false, reason: (error instanceof Error ? error.message : '无法完整拆分片段。').replace(/^粘贴后工程/, '拆分后工程') }; }
}

export function inspectRegionSplit(project: Project, ids: ReadonlySet<string>, tick: number, visibleTrackIds?: ReadonlySet<string>): RegionSplitInspection {
  const result = plan(project, ids, tick, visibleTrackIds); return result.ok ? { ok: true, count: result.cuts.length } : result;
}

/** Atomic draft mutation: full independent sources, unchanged note durations/routes. */
export function splitRegionGroup(project: Project, ids: ReadonlySet<string>, tick: number, visibleTrackIds?: ReadonlySet<string>): RegionSplitResult | undefined {
  const result = plan(project, ids, tick, visibleTrackIds); if (!result.ok) return;
  const used = new Set<string>([project.id]);
  for (const list of [project.tracks, project.regions, project.patterns, project.instruments, project.assets, project.midi?.conductor ?? []]) for (const item of list) used.add(item.id);
  for (const pattern of project.patterns) { for (const note of pattern.notes) used.add(note.id); for (const event of pattern.midiEvents ?? []) used.add(event.id); }
  const freshId = () => { let id: string; do { id = uid(); } while (used.has(id)); used.add(id); return id; };
  const clonePattern = (pattern: Pattern): Pattern => ({ ...pattern, id: freshId(),
    notes: pattern.notes.map(note => ({ ...note, id: freshId(), ...(note.midiSource ? { midiSource: { ...note.midiSource } } : {}) })),
    ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(item => ({ ...item, id: freshId(), event: { ...item.event, ...('data' in item.event ? { data: Array.from(item.event.data) } : {}) } })) } : {}) });
  const clones: Pattern[] = [], stages = new Map<string, { left: Region; right: Region }>();
  for (const cut of result.cuts) {
    const left = cut.detachLeft ? clonePattern(cut.pattern) : cut.pattern; if (cut.detachLeft) clones.push(left);
    const right = clonePattern(cut.pattern); clones.push(right);
    stages.set(cut.region.id, { left: leftOf(cut, left.id), right: rightOf(cut, freshId(), right.id) });
  }
  const regions: Region[] = [];
  for (const region of project.regions) { const stage = stages.get(region.id); if (stage) regions.push(stage.left, stage.right); else regions.push(region); }
  // Validate actual allocated identities and exact saved bytes before any write.
  try { const prospective = { ...project, patterns: project.patterns.concat(clones), regions }; validateProject(prospective); assertBudget(prospective); }
  catch { return; }
  for (const pattern of clones) project.patterns.push(pattern);
  const pairs: RegionSplitResult['pairs'] = [];
  project.regions = project.regions.flatMap(region => {
    const stage = stages.get(region.id); if (!stage) return [region];
    Object.assign(region, stage.left); pairs.push({ leftId: region.id, rightId: stage.right.id }); return [region, stage.right];
  });
  return { pairs };
}
