import { assertNotes, resourceIndex, assertInstrument, assetBytes, sameInstrument, sameAsset, sizeBudget, NBSX_SAVE_TIMESTAMP } from './clipboard-resources';
import { MAX_PROJECT_TICK } from './expansion';
import { uid, validateProject } from './project';
import type { Asset, Diagnostic, Instrument, Pattern, Project, Region, Track } from './types';

export interface RegionClipboard {
  schema: 1;
  ppq: number;
  sourceProjectId: string;
  documentKey: number;
  primaryRegionId: string;
  /** Contiguous document rows from the top to bottom selected source, including gaps. */
  tracks: Track[];
  patterns: Pattern[];
  regions: Region[];
  instruments: Instrument[];
  assets: Asset[];
}
export interface RegionPastePlan {
  tracks: Track[]; patterns: Pattern[]; regions: Region[]; instruments: Instrument[]; assets: Asset[];
  diagnostics: Diagnostic[]; primaryRegionId: string;
}
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const documentKeyValid = (value: number) => Number.isSafeInteger(value) && value >= 0;
const finite = (value: number, min = 0, max = MAX_PROJECT_TICK) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Stream compact JSON pieces, retaining each enclosing empty array's brackets. */
function assertSize(value: Pick<Project, 'tracks' | 'patterns' | 'regions' | 'instruments' | 'assets'> & object, savedProject = false): void {
  const budget = sizeBudget();
  budget.addJson({ ...value, ...(savedProject ? { modifiedAt: NBSX_SAVE_TIMESTAMP } : {}), tracks: [], patterns: [], regions: [], instruments: [], assets: [] });
  budget.addItems(value.tracks); budget.addItems(value.regions); budget.addItems(value.instruments);
  value.patterns.forEach((pattern, index) => {
    budget.addJson({ ...pattern, notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    budget.addItems(pattern.notes); if (pattern.midiEvents !== undefined) budget.addItems(pattern.midiEvents);
    if (index) budget.comma();
  });
  value.assets.forEach((asset, index) => { budget.addAsset(asset); if (index) budget.comma(); }); budget.finish();
}

function clipboardProject(value: RegionClipboard): Project {
  return { format: 'nbsx', version: 2, id: value.sourceProjectId, name: 'Region clipboard', author: '', description: '', createdAt: '', modifiedAt: '',
    ppq: value.ppq, tempos: [{ tick: 0, bpm: 120 }], timeSignatures: [], tracks: value.tracks, patterns: value.patterns, regions: value.regions,
    instruments: value.instruments, assets: value.assets, audio: { mode: 'studio', profileId: '', sampleRate: 48000, masterGain: 1, directional: false } };
}

function assertClipboard(value: RegionClipboard): void {
  if (!value || value.schema !== 1 || !identifier(value.sourceProjectId) || !documentKeyValid(value.documentKey)
    || !finite(value.ppq, 1, 32767) || !Number.isInteger(value.ppq) || !identifier(value.primaryRegionId)
    || !Array.isArray(value.tracks) || !value.tracks.length || !Array.isArray(value.patterns) || !Array.isArray(value.regions) || !value.regions.length
    || !Array.isArray(value.instruments) || !Array.isArray(value.assets)) throw new Error('片段剪贴板来源或结构无效。');
  if (value.tracks.some(track => !track || ![track.name, track.color].every(item => typeof item === 'string')
    || ![track.locked, track.muted, track.solo].every(item => typeof item === 'boolean'))) throw new Error('片段剪贴板轨道设置无效。');
  const instruments = resourceIndex(value.instruments), assets = resourceIndex(value.assets), patterns = resourceIndex(value.patterns);
  for (const instrument of instruments.values()) assertInstrument(instrument);
  for (const asset of assets.values()) assetBytes(asset);
  for (const pattern of patterns.values()) { if (typeof pattern.name !== 'string') throw new Error('片段剪贴板源名称无效。'); assertNotes(pattern.notes); }
  if (value.regions.some(region => !region || typeof region.loop !== 'boolean')) throw new Error('片段剪贴板播放范围无效。');
  validateProject(clipboardProject(value));
  const regionIds = new Set(value.regions.map(region => region.id)), trackIds = new Set(value.regions.map(region => region.trackId));
  if (!regionIds.has(value.primaryRegionId) || !trackIds.has(value.tracks[0].id) || !trackIds.has(value.tracks.at(-1)!.id)) throw new Error('片段剪贴板主片段或轨道跨度已失效。');
  const usedPatterns = new Set(value.regions.map(region => region.patternId)), usedInstruments = new Set(value.tracks.map(track => track.instrumentId)), usedAssets = new Set<string>();
  for (const pattern of value.patterns) for (const note of pattern.notes) if (note.instrumentId !== undefined) usedInstruments.add(note.instrumentId);
  for (const id of usedInstruments) {
    const instrument = instruments.get(id); if (!instrument) throw new Error('片段剪贴板引用的音色不存在。');
    if (instrument.assetId !== undefined) { if (!assets.has(instrument.assetId)) throw new Error('片段剪贴板引用的采样不存在。'); usedAssets.add(instrument.assetId); }
  }
  if (usedPatterns.size !== patterns.size || usedInstruments.size !== instruments.size || usedAssets.size !== assets.size) throw new Error('片段剪贴板包含失效或无关的源资源。');
  assertSize(value);
}

/** Read-only copy is allowed on locked sources and retains full source content. */
export function createRegionClipboard(project: Project, ids: ReadonlySet<string>, documentKey: number, primaryRegionId?: string): RegionClipboard {
  validateProject(project);
  if (!ids.size || !documentKeyValid(documentKey)) throw new Error('片段复制选区或文档无效。');
  const regions = project.regions.filter(region => ids.has(region.id));
  if (regions.length !== ids.size || primaryRegionId !== undefined && !ids.has(primaryRegionId)) throw new Error('片段复制选区或主片段已失效。');
  const rows = new Map(project.tracks.map((track, index) => [track.id, index])); let first = Infinity, last = -1;
  for (const region of regions) { const row = rows.get(region.trackId); if (row === undefined) throw new Error('片段来源轨道不存在。'); first = Math.min(first, row); last = Math.max(last, row); }
  const tracks = project.tracks.slice(first, last + 1), neededPatterns = new Set(regions.map(region => region.patternId));
  const patterns = project.patterns.filter(pattern => neededPatterns.has(pattern.id)), neededInstruments = new Set(tracks.map(track => track.instrumentId));
  for (const pattern of patterns) for (const note of pattern.notes) if (note.instrumentId !== undefined) neededInstruments.add(note.instrumentId);
  const instruments = project.instruments.filter(instrument => neededInstruments.has(instrument.id)), neededAssets = new Set(instruments.flatMap(instrument => instrument.assetId === undefined ? [] : [instrument.assetId]));
  const clipboard: RegionClipboard = { schema: 1, ppq: project.ppq, sourceProjectId: project.id, documentKey, primaryRegionId: primaryRegionId ?? regions[0].id,
    tracks, patterns, regions, instruments, assets: project.assets.filter(asset => neededAssets.has(asset.id)) };
  assertClipboard(clipboard); return structuredClone(clipboard);
}

/** Pure all-or-nothing placement; the caller appends these arrays in one transaction. */
export function planRegionPaste(target: Project, clipboard: RegionClipboard, targetTick: number, targetTrackId: string | undefined,
  documentKey: number, visibleTrackIds?: ReadonlySet<string>): RegionPastePlan {
  validateProject(target); assertClipboard(clipboard);
  if (!documentKeyValid(documentKey) || !finite(targetTick)) throw new Error('片段粘贴文档或时间位置无效。');
  const base = target.tracks.length ? target.tracks.findIndex(track => track.id === targetTrackId) : 0;
  if (base < 0 || !target.tracks.length && targetTrackId !== undefined && targetTrackId !== '') throw new Error('请明确选择片段粘贴的首轨。');
  const sourceRows = new Map(clipboard.tracks.map((track, index) => [track.id, index])), sourcePatterns = resourceIndex(clipboard.patterns);
  const addedTrackCount = Math.max(0, base + clipboard.tracks.length - target.tracks.length);
  if (target.tracks.length + addedTrackCount > 10000 || target.patterns.length + clipboard.regions.length > 100000 || target.regions.length + clipboard.regions.length > 100000) throw new Error('粘贴后工程轨道、片段或源数量超过安全上限。');
  const usedRows = new Set(clipboard.regions.map(region => sourceRows.get(region.trackId)!));
  for (const row of usedRows) {
    const track = target.tracks[base + row];
    if (track && (track.locked || visibleTrackIds !== undefined && !visibleTrackIds.has(track.id))) throw new Error('粘贴目标包含已锁定或被筛选隐藏的轨道。');
  }
  let notes = 0, messages = target.midi?.conductor.length ?? 0;
  for (const pattern of target.patterns) { notes += pattern.notes.length; messages += pattern.midiEvents?.length ?? 0; }
  for (const region of clipboard.regions) {
    const pattern = sourcePatterns.get(region.patternId)!; notes += pattern.notes.length; messages += pattern.midiEvents?.length ?? 0;
    if (notes > 2000000 || messages > 2000000) throw new Error('粘贴后工程音符或 MIDI 消息超过 200 万个。');
  }
  let firstTick = Infinity; for (const region of clipboard.regions) firstTick = Math.min(firstTick, region.start);
  const ratio = target.ppq / clipboard.ppq;
  const scaled = (value: number, min = 0) => { const next = value * ratio; if (!finite(next, min)) throw new Error('片段 PPQ 换算后的时间或长度超过工程范围。'); return next; };
  const starts = clipboard.regions.map(region => { const start = targetTick + (region.start - firstTick) * ratio; if (!finite(start)) throw new Error('片段粘贴起点超过工程范围。'); scaled(region.length, 1); scaled(region.offset); return start; });
  for (const pattern of clipboard.patterns) {
    scaled(pattern.length, 1); for (const note of pattern.notes) { scaled(note.tick); scaled(note.duration); }
    for (const event of pattern.midiEvents ?? []) scaled(event.tick);
  }
  const usedIds = new Set<string>([target.id, clipboard.sourceProjectId]);
  for (const project of [target, clipboard]) {
    for (const item of [...project.tracks, ...project.regions, ...project.patterns]) usedIds.add(item.id);
    for (const pattern of project.patterns) { for (const note of pattern.notes) usedIds.add(note.id); for (const event of pattern.midiEvents ?? []) usedIds.add(event.id); }
  }
  for (const item of [...target.instruments, ...target.assets, ...(target.midi?.conductor ?? [])]) usedIds.add(item.id);
  const freshId = () => { let id: string; do { id = uid(); } while (usedIds.has(id)); usedIds.add(id); return id; };
  const resourceId = (id: string) => { if (usedIds.has(id)) return freshId(); usedIds.add(id); return id; };
  const instruments: Instrument[] = [], assets: Asset[] = [], diagnostics: Diagnostic[] = [], sourceInstruments = resourceIndex(clipboard.instruments), sourceAssets = resourceIndex(clipboard.assets);
  const instrumentMap = new Map<string, string>(), assetMap = new Map<string, string>(); let remapped = 0, resetRoutes = 0;
  function copyAsset(sourceId: string): string {
    const previous = assetMap.get(sourceId); if (previous !== undefined) return previous;
    const asset = sourceAssets.get(sourceId)!;
    const match = target.assets.find(item => item.id === sourceId && sameAsset(item, asset)) ?? target.assets.find(item => sameAsset(item, asset)) ?? assets.find(item => sameAsset(item, asset));
    const id = match?.id ?? resourceId(sourceId); if (!match) assets.push({ ...structuredClone(asset), id });
    assetMap.set(sourceId, id); if (id !== sourceId) remapped++; return id;
  }
  function copyInstrument(sourceId: string): string {
    const previous = instrumentMap.get(sourceId); if (previous !== undefined) return previous;
    const instrument = sourceInstruments.get(sourceId)!, candidate = { ...instrument, ...(instrument.assetId === undefined ? {} : { assetId: copyAsset(instrument.assetId) }) };
    const match = target.instruments.find(item => item.id === sourceId && sameInstrument(item, candidate)) ?? target.instruments.find(item => sameInstrument(item, candidate)) ?? instruments.find(item => sameInstrument(item, candidate));
    const id = match?.id ?? resourceId(sourceId); if (!match) instruments.push({ ...structuredClone(candidate), id });
    instrumentMap.set(sourceId, id); if (id !== sourceId) remapped++; return id;
  }
  const tracks: Track[] = [];
  for (let index = target.tracks.length; index < base + clipboard.tracks.length; index++) {
    const source = clipboard.tracks[index - base], track = { ...structuredClone(source), id: freshId(), instrumentId: copyInstrument(source.instrumentId), locked: false };
    delete track.sourceMidiTrack; tracks.push(track);
  }
  const allTracks = target.tracks.concat(tracks), patterns: Pattern[] = [], regions: Region[] = [];
  for (let index = 0; index < clipboard.regions.length; index++) {
    const sourceRegion = clipboard.regions[index], source = sourcePatterns.get(sourceRegion.patternId)!, row = base + sourceRows.get(sourceRegion.trackId)!, track = allTracks[row];
    const preserveRoute = row < target.tracks.length && clipboard.sourceProjectId === target.id && clipboard.documentKey === documentKey && sourceRegion.trackId === track.id;
    const pattern = structuredClone(source); pattern.id = freshId(); pattern.length = scaled(source.length, 1);
    for (const note of pattern.notes) {
      note.id = freshId(); note.tick = scaled(note.tick); note.duration = scaled(note.duration);
      if (note.instrumentId !== undefined) note.instrumentId = copyInstrument(note.instrumentId);
      if (!preserveRoute && note.midiSource?.offSourceTrack !== undefined) { delete note.midiSource.offSourceTrack; resetRoutes++; }
    }
    for (const event of pattern.midiEvents ?? []) { event.id = freshId(); event.tick = scaled(event.tick); }
    patterns.push(pattern); regions.push({ ...structuredClone(sourceRegion), id: freshId(), patternId: pattern.id, trackId: track.id, start: starts[index], length: scaled(sourceRegion.length, 1), offset: scaled(sourceRegion.offset) });
  }
  const prospective = { ...target, tracks: allTracks, patterns: target.patterns.concat(patterns), regions: target.regions.concat(regions), instruments: target.instruments.concat(instruments), assets: target.assets.concat(assets) };
  validateProject(prospective); assertSize(prospective, true);
  let primary = -1;
  for (let index = 0; index < clipboard.regions.length; index++) if (sourceRows.get(clipboard.regions[index].trackId) === 0 && (primary < 0 || starts[index] < starts[primary])) primary = index;
  if (ratio !== 1) diagnostics.push({ severity: 'info', code: 'clipboard-ppq-scaled', message: `片段已从 PPQ ${clipboard.ppq} 换算至 ${target.ppq}，保留拍数、裁剪范围和完整源时值。` });
  if (tracks.length) diagnostics.push({ severity: 'info', code: 'region-clipboard-tracks-created', message: `已补建 ${tracks.length} 条尾部轨道，保留来源轨道间隔。` });
  if (remapped) diagnostics.push({ severity: 'info', code: 'clipboard-resource-remapped', message: `${remapped} 个音色或采样引用已安全映射，目标资源未被覆盖。` });
  if (resetRoutes) diagnostics.push({ severity: 'info', code: 'clipboard-midi-route-reset', message: `${resetRoutes} 个音符已移除原 MIDI NoteOff 轨道路由，释放力度与事件顺序仍保留。` });
  if ([...assetMap.keys()].some(id => !sourceAssets.get(id)!.data)) diagnostics.push({ severity: 'warning', code: 'clipboard-external-sample', message: '部分音色未嵌入采样内容；已保留资源定义，仍需定位对应声音文件。' });
  return { tracks, patterns, regions, instruments, assets, diagnostics, primaryRegionId: regions[primary].id };
}
