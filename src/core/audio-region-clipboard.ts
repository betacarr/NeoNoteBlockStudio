import { audioClipEnd, validateAudioClips } from './audio-clips';
import { requireEmbeddedAudioWorkspace, validateAudioAssets, validateAudioWorkspace } from './audio-assist';
import { assetBytes, NBSX_SAVE_TIMESTAMP, resourceIndex, sameAsset, sizeBudget } from './clipboard-resources';
import { MAX_PROJECT_TICK } from './expansion';
import { uid, validateProject } from './project';
import type { Asset, AudioClip, Diagnostic, Project, Track } from './types';

export interface AudioClipClipboard {
  schema: 1;
  sourceProjectId: string;
  documentKey: number;
  ppq: number;
  primaryClipId: string;
  /** Only the selected audio rows, in document order. Summing headers are not clips. */
  tracks: Track[];
  clips: AudioClip[];
  assets: Asset[];
}
export interface AudioClipPastePlan {
  tracks: Track[];
  clips: AudioClip[];
  assets: Asset[];
  primaryClipId: string;
  diagnostics: Diagnostic[];
}
export type AudioClipSelectionInspection = { ok: true; clips: AudioClip[] } | { ok: false; reason: string };
const validTick = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PROJECT_TICK;
const documentKeyValid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** One invalid, hidden or protected member refuses the complete edit. Copy can read locked rows. */
export function inspectAudioClipSelection(project: Project, ids: ReadonlySet<string>, visibleTrackIds?: ReadonlySet<string>, readOnly = false): AudioClipSelectionInspection {
  if (!ids.size) return { ok: false, reason: '请选择音频片段。' };
  const clips = (project.audioClips ?? []).filter(clip => ids.has(clip.id));
  if (clips.length !== ids.size) return { ok: false, reason: '所选音频片段已失效，请重新选择。' };
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  for (const clip of clips) {
    const track = tracks.get(clip.trackId);
    if (!track || track.kind !== 'audio' || track.audioGroup) return { ok: false, reason: '音频片段的来源轨道无效。' };
    if (visibleTrackIds && !visibleTrackIds.has(track.id)) return { ok: false, reason: '选区包含被筛选隐藏的音频轨道，请先显示全部所选。' };
    if (!readOnly && track.locked) return { ok: false, reason: '选区包含已锁定的音频轨道，请先解锁。' };
  }
  return { ok: true, clips };
}

/** Keep all analysis audio as well as the audible source, so reopening a copy remains editable. */
function referencedAssets(clips: readonly AudioClip[]): Set<string> {
  return new Set(clips.flatMap(clip => [clip.assetId, ...(clip.analysis ? [clip.analysis.sourceAssetId, ...clip.analysis.stems.map(stem => stem.assetId)] : [])]));
}

function assertClipboard(clipboard: AudioClipClipboard): void {
  if (!clipboard || clipboard.schema !== 1 || !identifier(clipboard.sourceProjectId) || !documentKeyValid(clipboard.documentKey)
    || !Number.isInteger(clipboard.ppq) || clipboard.ppq < 1 || clipboard.ppq > 32767 || !identifier(clipboard.primaryClipId)
    || !Array.isArray(clipboard.tracks) || !clipboard.tracks.length || !Array.isArray(clipboard.clips) || !clipboard.clips.length
    || !Array.isArray(clipboard.assets)) throw new Error('音频片段剪贴板结构无效。');
  const tracks = resourceIndex(clipboard.tracks), assets = resourceIndex(clipboard.assets);
  for (const track of tracks.values()) {
    if (track.kind !== 'audio' || track.audioGroup || typeof track.name !== 'string' || typeof track.color !== 'string'
      || typeof track.locked !== 'boolean' || typeof track.muted !== 'boolean' || typeof track.solo !== 'boolean'
      || !Number.isFinite(track.volume) || track.volume < 0 || track.volume > 4 || !Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1)
      throw new Error('音频片段剪贴板轨道设置无效。');
  }
  for (const asset of assets.values()) assetBytes(asset);
  validateAudioAssets(clipboard.assets);
  // Parent stacks are a mix property of the source project; a copied clip does
  // not require copying its whole stack, nor acquire a second stack implicitly.
  const validationTracks = clipboard.tracks.map(({ parentTrackId, ...track }) => track);
  validateAudioClips({ tracks: validationTracks, patterns: [], regions: [], assets: clipboard.assets, audioClips: clipboard.clips } as unknown as Project);
  if (!clipboard.clips.some(clip => clip.id === clipboard.primaryClipId)) throw new Error('音频片段剪贴板主片段已失效。');
  const usedTracks = new Set(clipboard.clips.map(clip => clip.trackId)), usedAssets = referencedAssets(clipboard.clips);
  if (usedTracks.size !== tracks.size || usedAssets.size !== assets.size || [...usedAssets].some(id => !assets.has(id))) throw new Error('音频片段剪贴板包含缺失或无关的资源。');
  for (const clip of clipboard.clips) if (clip.analysis) validateAudioWorkspace(clip.analysis, clipboard.assets);
  const budget = sizeBudget();
  budget.addJson({ ...clipboard, clips: [], tracks: [], assets: [] }); budget.addItems(clipboard.clips); budget.addItems(clipboard.tracks);
  clipboard.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); }); budget.finish();
}

export function createAudioClipClipboard(project: Project, ids: ReadonlySet<string>, documentKey = 0, primaryClipId?: string): AudioClipClipboard {
  validateProject(project);
  if (!documentKeyValid(documentKey)) throw new Error('音频片段复制文档无效。');
  const selection = inspectAudioClipSelection(project, ids, undefined, true);
  if (!selection.ok) throw new Error(selection.reason);
  if (primaryClipId !== undefined && !ids.has(primaryClipId)) throw new Error('音频片段复制主片段不在选区中。');
  const usedTracks = new Set(selection.clips.map(clip => clip.trackId)), usedAssets = referencedAssets(selection.clips);
  const clipboard: AudioClipClipboard = { schema: 1, sourceProjectId: project.id, documentKey, ppq: project.ppq,
    primaryClipId: primaryClipId ?? selection.clips[0].id, clips: selection.clips,
    tracks: project.tracks.filter(track => usedTracks.has(track.id)), assets: project.assets.filter(asset => usedAssets.has(asset.id)) };
  assertClipboard(clipboard); return structuredClone(clipboard);
}

export function assertAudioProjectSize(project: Project): void {
  const budget = sizeBudget();
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, tracks: [], patterns: [], regions: [], audioClips: [], instruments: [], assets: [],
    ...(project.midi ? { midi: { ...project.midi, conductor: [] } } : {}) });
  budget.addItems(project.tracks); budget.addItems(project.regions); budget.addItems(project.audioClips ?? []); budget.addItems(project.instruments);
  if (project.midi) budget.addItems(project.midi.conductor);
  project.patterns.forEach((pattern, index) => {
    if (index) budget.comma();
    budget.addJson({ ...pattern, notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    budget.addItems(pattern.notes); if (pattern.midiEvents !== undefined) budget.addItems(pattern.midiEvents);
  });
  project.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); }); budget.finish();
}

/** Pure staging. App appends the arrays together in one undoable transaction.
 * Managed sidecars are capabilities of the open document, so this initial
 * clipboard intentionally refuses cross-document paste instead of broken audio.
 */
export function planAudioClipPaste(project: Project, clipboard: AudioClipClipboard, tick: number, targetTrackId?: string,
  documentKey = 0, visibleTrackIds?: ReadonlySet<string>): AudioClipPastePlan {
  validateProject(project); assertClipboard(clipboard);
  if (!documentKeyValid(documentKey) || !validTick(tick)) throw new Error('音频片段粘贴文档或时间位置无效。');
  if (project.id !== clipboard.sourceProjectId || documentKey !== clipboard.documentKey) throw new Error('音频片段目前仅支持在同一打开工程内粘贴；跨工程请重新导入音频。');
  if ((project.audioClips?.length ?? 0) + clipboard.clips.length > 100000) throw new Error('粘贴后音频片段数量超过安全上限。');
  const available = project.tracks.filter(track => track.kind === 'audio' && !track.audioGroup);
  const base = targetTrackId === undefined ? -1 : available.findIndex(track => track.id === targetTrackId);
  if (targetTrackId !== undefined && base < 0) throw new Error('请选择普通音频轨道作为粘贴目标，不能粘贴到音符轨道或分轨汇总轨。');
  const usedIds = new Set<string>([project.id]);
  for (const list of [project.tracks, project.patterns, project.regions, project.instruments, project.assets, project.audioClips ?? [], project.midi?.conductor ?? []]) for (const item of list) usedIds.add(item.id);
  for (const pattern of project.patterns) { for (const note of pattern.notes) usedIds.add(note.id); for (const event of pattern.midiEvents ?? []) usedIds.add(event.id); }
  for (const clip of clipboard.clips) usedIds.add(clip.id);
  for (const track of clipboard.tracks) usedIds.add(track.id);
  const freshId = () => { let id: string, attempts = 0; do { if (++attempts > 128) throw new Error('无法分配音频片段标识，请重试。'); id = uid(); } while (usedIds.has(id)); usedIds.add(id); return id; };
  const tracks: Track[] = [], destinations = new Map<string, Track>();
  clipboard.tracks.forEach((source, index) => {
    let target = base < 0 ? available.find(track => track.id === source.id) : available[base + index];
    if (target && (target.locked || visibleTrackIds && !visibleTrackIds.has(target.id))) throw new Error('音频片段粘贴目标包含已锁定或被筛选隐藏的轨道。');
    if (!target) {
      const { parentTrackId, audioGroup, sourceMidiTrack, midiChannel, drumPresetId, delay, ...plain } = structuredClone(source);
      const instrumentId = project.instruments.some(instrument => instrument.id === source.instrumentId) ? source.instrumentId : project.instruments[0]?.id;
      if (!instrumentId) throw new Error('目标工程没有可用的音色定义，无法创建音频轨道。');
      target = { ...plain, id: freshId(), kind: 'audio', locked: false,
        instrumentId };
      tracks.push(target);
    }
    destinations.set(source.id, target);
  });
  if (project.tracks.length + tracks.length > 10000) throw new Error('粘贴后轨道数量超过安全上限。');
  const assets: Asset[] = [];
  for (const source of clipboard.assets) {
    const existing = project.assets.find(asset => asset.id === source.id);
    if (existing && !sameAsset(source, existing)) throw new Error('音频片段来源资源已改变，请重新复制；目标资源未被覆盖。');
    if (!existing) {
      if (usedIds.has(source.id)) throw new Error('音频片段来源资源标识已被占用，请重新复制。');
      usedIds.add(source.id); assets.push(structuredClone(source));
    }
  }
  const first = clipboard.clips.reduce((minimum, clip) => Math.min(minimum, clip.start), Infinity), ratio = project.ppq / clipboard.ppq;
  const ids = new Map(clipboard.clips.map(clip => [clip.id, freshId()]));
  const clips = clipboard.clips.map(source => {
    const start = tick + (source.start - first) * ratio;
    if (!validTick(start)) throw new Error('音频片段粘贴起点超过工程范围。');
    const clip = { ...structuredClone(source), id: ids.get(source.id)!, trackId: destinations.get(source.trackId)!.id, start };
    if (clip.separation && ids.has(clip.separation.sourceClipId)) clip.separation.sourceClipId = ids.get(clip.separation.sourceClipId)!;
    return clip;
  });
  const candidate = { ...project, tracks: project.tracks.concat(tracks), assets: project.assets.concat(assets), audioClips: (project.audioClips ?? []).concat(clips) };
  if (clips.some(clip => !validTick(audioClipEnd(candidate, clip)))) throw new Error('音频片段粘贴终点超过工程范围。');
  validateProject(candidate); validateAudioAssets(candidate.assets); requireEmbeddedAudioWorkspace(candidate); assertAudioProjectSize(candidate);
  const diagnostics: Diagnostic[] = tracks.length ? [{ severity: 'info', code: 'audio-clipboard-tracks-created', message: `已补建 ${tracks.length} 条普通音频轨道。` }] : [];
  return { tracks, clips, assets, diagnostics, primaryClipId: ids.get(clipboard.primaryClipId)! };
}

/** Delete content only. Source audio/analysis stays available for undo and paste. */
export function deleteAudioClipGroup(project: Project, ids: ReadonlySet<string>, visibleTrackIds?: ReadonlySet<string>): AudioClip[] {
  const selection = inspectAudioClipSelection(project, ids, visibleTrackIds);
  if (!selection.ok) throw new Error(selection.reason);
  const remaining = (project.audioClips ?? []).filter(clip => !ids.has(clip.id));
  validateProject({ ...project, audioClips: remaining });
  project.audioClips = remaining;
  return selection.clips;
}
