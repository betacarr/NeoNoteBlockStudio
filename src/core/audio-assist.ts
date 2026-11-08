import { validateAudioTempo, type AudioTempoAnalysis } from './audio-tempo';
import type { Asset, AudioFileAsset, Project } from './types';

export interface AudioStem { id: string; role: string; name: string; assetId: string; gain: number; muted: boolean; solo: boolean }
export interface AudioChord { id: string; name: string; start: number; end: number; confidence: number }
/** All times are seconds in the original audio timeline. The initial implementation is fixed-tempo. */
export interface AudioWorkspace {
  id: string; name: string; sourceAssetId: string; duration: number; sampleRate: number; frames: number;
  analysisPerformed?: boolean;
  tempoAnalysis?: AudioTempoAnalysis;
  tempoDetection?: 'beat-this' | 'spectral';
  stems: AudioStem[]; bpm: number; firstBeat: number; beats: number[]; chords: AudioChord[];
  model: { id: string; version: string; device?: 'cpu' | 'cuda' | 'mps'; memoryProfile?: 'balanced' | 'low'; fallbackNote?: string }; loop: { enabled: boolean; start: number; end: number };
}
export const STEM_ROLES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
export type StemRole = typeof STEM_ROLES[number];
export const DRUM_ROLES = ['kick', 'snare', 'hi-hat', 'toms', 'other-drums'] as const;
export type DrumRole = typeof DRUM_ROLES[number];
export type StemSourceRole = StemRole | DrumRole;
export interface StemSelection { stems: StemRole[]; drumPieces: boolean; drumRoles?: DrumRole[]; submix: StemSourceRole[] }
export interface AudioAssistRequest { id: string; name: string; bytes?: Uint8Array; sourceHandle?: string; sourceAsset?: AudioFileAsset; decodeOnly?: boolean; detectTempo?: boolean; mode?: 'split' | 'chords'; sourceRange?: { offsetSeconds:number; durationSeconds:number }; separation?: boolean; acceleration?: 'cpu' | 'cuda' | 'mps'; cpuThreads?: number; memoryProfile?: 'balanced' | 'low'; stemSelection?: StemSelection }
export interface AudioAssistResult { workspace: AudioWorkspace; assets: Asset[] }
export interface AudioAssistProgress { id: string; phase: string; progress: number; message: string }
export interface AudioAssistFileSelection { name: string; handle: string; size: number }
export interface AudioAssistStatus { available: boolean; message: string; modelReady: boolean; canSeparate?: boolean; canSplitDrums?: boolean; optionalCudaAvailable?: boolean; optionalMpsAvailable?: boolean }

export function validateStemSelection(value: StemSelection): void {
  const roles = (items: unknown, allowed: readonly string[]) => Array.isArray(items) && items.length <= allowed.length
    && items.every(role => allowed.includes(role)) && new Set(items).size === items.length;
  if (!value || typeof value.drumPieces !== 'boolean' || !roles(value.stems, STEM_ROLES)
    || value.drumRoles !== undefined && (!value.drumPieces || !roles(value.drumRoles, DRUM_ROLES))
    || !roles(value.submix, stemSourceRoles(value.drumPieces))) throw new Error('分轨声部选择无效。');
  const selected = selectedStemSources(value);
  if (value.submix.length === 1 || value.submix.some(role => selected.includes(role))
    || !selected.length && !value.submix.length) throw new Error('请选择要提取的声部，或至少两个未单独提取的声部来创建子混音。');
}

export function stemSourceRoles(drumPieces: boolean): StemSourceRole[] {
  return STEM_ROLES.flatMap<StemSourceRole>(role => role === 'drums' && drumPieces ? [...DRUM_ROLES] : [role]);
}

export function selectedStemSources(selection: Pick<StemSelection, 'stems' | 'drumPieces' | 'drumRoles'>): StemSourceRole[] {
  return stemSourceRoles(selection.drumPieces).filter(role => DRUM_ROLES.includes(role as DrumRole)
    ? selection.drumRoles?.includes(role as DrumRole) ?? selection.stems.includes('drums')
    : selection.stems.includes(role as StemRole));
}

export function stemOutputRoles(selection: StemSelection): string[] {
  return [...selectedStemSources(selection), ...(selection.submix.length ? ['submix'] : [])];
}
export interface AudioModelStatus {
  id: string; name: string; sizeBytes: number; license: string; licenseUrl: string; sourceUrl: string;
  state: 'missing' | 'downloading' | 'ready' | 'error' | 'blocked';
  progress: number; downloadedBytes: number; totalBytes: number; message: string;
}

/** Empty results still permit the original audio to be auditioned/exported. */
export function playableAudioStems(workspace: AudioWorkspace): AudioStem[] {
  return workspace.stems.length ? workspace.stems : [{ id: '__audio_source__', role: 'original', name: '原始音频', assetId: workspace.sourceAssetId, gain: 1, muted: false, solo: false }];
}
export function applyAudioWorkspace(project: Project, workspace: AudioWorkspace, assets: Asset[], applyTempo = false): Project {
  const next = structuredClone(project);
  const previous = next.audioWorkspace;
  const replaced = new Set(previous ? [previous.sourceAssetId, ...previous.stems.map(s => s.assetId)] : []);
  const kept = new Set([workspace.sourceAssetId, ...workspace.stems.map(s => s.assetId), ...next.instruments.map(i => i.assetId), ...(next.audioClips ?? []).flatMap(c => [c.assetId,...(c.analysis?[c.analysis.sourceAssetId,...c.analysis.stems.map(s=>s.assetId)]:[])]), next.reference?.assetId, next.midi?.sourceAssetId,
    typeof next.provenance?.metadata.sourceAssetId === 'string' ? next.provenance.metadata.sourceAssetId : undefined]);
  next.assets = next.assets.filter(a => !replaced.has(a.id) || kept.has(a.id));
  for (const asset of assets) {
    const found = next.assets.find(a => a.id === asset.id);
    if (found && JSON.stringify(found) !== JSON.stringify(asset)) throw new Error('音频资源标识与现有工程冲突，请重新分析。');
    if (!found) next.assets.push(structuredClone(asset));
  }
  next.audioWorkspace = structuredClone(workspace);
  validateAudioWorkspace(next.audioWorkspace, next.assets); requireEmbeddedAudioWorkspace(next);
  if (applyTempo && workspace.analysisPerformed === false) throw new Error('此结果仅分轨，尚未分析曲速。');
  if (applyTempo) next.tempos = [{ tick: 0, bpm: workspace.bpm }];
  return next;
}

const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validateAudioChords(chords: AudioChord[], duration: number) {
  const ids = new Set<string>();
  if (!Array.isArray(chords) || chords.length > 100000) throw new Error('和弦标记数量无效。');
  for (const [i, chord] of chords.entries()) {
    if (!chord || typeof chord.id !== 'string' || !chord.id || chord.id.length > 512 || ids.has(chord.id)
      || typeof chord.name !== 'string' || !chord.name || chord.name.length > 512 || !finite(chord.start, 0, duration)
      || !finite(chord.end, chord.start, duration) || chord.end <= chord.start || !finite(chord.confidence, 0, 1)
      || i > 0 && chord.start < chords[i - 1].end - 1e-6) throw new Error('和弦标记范围或顺序无效。');
    ids.add(chord.id);
  }
}
export function validateAudioFileAsset(value: unknown): asserts value is AudioFileAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('音频侧车资源描述无效。');
  const file = value as AudioFileAsset;
  if (Object.keys(file).some(key => !['sha256', 'bytes', 'sampleRate', 'frames', 'channels', 'file'].includes(key))
    || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
    || file.file !== `audio/${file.sha256}.wav`
    || !Number.isSafeInteger(file.bytes) || !finite(file.bytes, 44, 128 * 1024 ** 3)
    || !Number.isInteger(file.sampleRate) || !finite(file.sampleRate, 8000, 192000)
    || !Number.isInteger(file.channels) || !finite(file.channels, 1, 8)
    || !Number.isSafeInteger(file.frames) || !finite(file.frames, 1, file.sampleRate * 86400)) throw new Error('音频侧车资源必须使用有效的内容哈希与托管相对路径。');
}
export function validateAudioAssets(assets: Asset[]): void {
  for (const asset of assets) if (asset.audioFile !== undefined) {
    validateAudioFileAsset(asset.audioFile);
    if (!asset.mime.startsWith('audio/') || asset.data !== undefined) throw new Error('托管音频侧车不能同时包含嵌入数据或非音频资源。');
  }
}
export function projectUsesExternalAudio(project: Project): boolean { return project.assets.some(asset => asset.audioFile !== undefined); }
export function validateAudioWorkspace(value: unknown, assets: Asset[]): asserts value is AudioWorkspace {
  if (!value || typeof value !== 'object') throw new Error('音频分析工程无效。');
  const w = value as AudioWorkspace;
  validateAudioAssets(assets);
  if (w.analysisPerformed !== undefined && typeof w.analysisPerformed !== 'boolean') throw new Error('音频分析状态无效。');
  if (w.analysisPerformed === false && (w.beats?.length || w.chords?.length)) throw new Error('未执行分析的结果不能包含节拍或和弦。');
  const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 512;
  if (!text(w.id) || !text(w.name) || !finite(w.duration, .001, 86400) || !Number.isInteger(w.sampleRate) || !finite(w.sampleRate, 8000, 192000) || !Number.isInteger(w.frames) || !finite(w.frames, 1, 16588800000) || Math.abs(w.frames / w.sampleRate - w.duration) > 1 / w.sampleRate + 1e-6) throw new Error('音频分析时长或采样信息无效。');
  if (!finite(w.bpm, 10, 1000) || !finite(w.firstBeat, 0, w.duration) || !Array.isArray(w.beats) || w.beats.length > 2000000 || w.beats.some((b, i) => !finite(b, 0, w.duration) || (i > 0 && b <= w.beats[i - 1]))) throw new Error('音频节拍信息无效。');
  if (!Array.isArray(w.stems) || w.stems.length > 64 || !Array.isArray(w.chords) || w.chords.length > 100000 || !w.model || !text(w.model.id) || !text(w.model.version)) throw new Error('音频分析结果无效。');
  if (w.model.device !== undefined && !['cpu','cuda','mps'].includes(w.model.device) || w.model.memoryProfile !== undefined && !['balanced','low'].includes(w.model.memoryProfile) || w.model.fallbackNote !== undefined && !text(w.model.fallbackNote)) throw new Error('音频计算状态无效。');
  const ids = new Set<string>();
  const add = (id: string) => { if (!text(id) || ids.has(id)) throw new Error('音频分析对象标识重复或无效。'); ids.add(id); };
  const asset = (id: string) => {
    const a = assets.find(a => a.id === id && a.mime.startsWith('audio/'));
    if (!a) throw new Error('音频分析缺少引用的音频资源。');
    if (a.audioFile && (a.audioFile.sampleRate !== w.sampleRate || a.audioFile.frames !== w.frames)) throw new Error('音频侧车分轨长度或采样率未对齐。');
  };
  asset(w.sourceAssetId);
  if (w.tempoAnalysis !== undefined) validateAudioTempo(w.tempoAnalysis, w.duration);
  if (w.tempoDetection !== undefined && w.tempoDetection !== 'beat-this' && w.tempoDetection !== 'spectral') throw new Error('音频曲速检测来源无效。');
  for (const s of w.stems) { add(s.id); asset(s.assetId); if (!text(s.role) || !text(s.name) || !finite(s.gain, 0, 4) || typeof s.muted !== 'boolean' || typeof s.solo !== 'boolean') throw new Error('音频分轨设置无效。'); }
  validateAudioChords(w.chords, w.duration);
  for (const c of w.chords) add(c.id);
  if (!w.loop || typeof w.loop.enabled !== 'boolean' || !finite(w.loop.start, 0, w.duration) || !finite(w.loop.end, w.loop.start, w.duration) || w.loop.end <= w.loop.start) throw new Error('音频循环范围无效。');
}

export function requireEmbeddedAudioWorkspace(project: Project): void {
  const workspace = project.audioWorkspace;
  for (const id of [...(workspace ? [workspace.sourceAssetId, ...workspace.stems.map(s => s.assetId)] : []), ...(project.audioClips ?? []).flatMap(c => [c.assetId,...(c.analysis?[c.analysis.sourceAssetId,...c.analysis.stems.map(s=>s.assetId)]:[])])]) {
    const asset = project.assets.find(a => a.id === id);
    if (asset?.audioFile) validateAudioFileAsset(asset.audioFile);
    else if (!asset?.data) throw new Error('音频分析资源未嵌入工程，且缺少有效托管侧车，无法完整保存或恢复。');
  }
}

export function fixedBeatGrid(bpm: number, firstBeat: number, duration: number): number[] {
  if (!finite(bpm, 10, 1000) || !finite(firstBeat, 0, duration) || !finite(duration, .001, 86400)) throw new Error('BPM 或首拍时间无效。');
  const interval = 60 / bpm, count = Math.floor((duration - firstBeat) / interval + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => Math.min(duration, firstBeat + i * interval));
}
export function setWorkspaceTempo(workspace: AudioWorkspace, bpm: number, firstBeat = workspace.firstBeat): AudioWorkspace {
  return { ...workspace, bpm, firstBeat, beats: fixedBeatGrid(bpm, firstBeat, workspace.duration) };
}
/** Move a shared boundary without gaps or overlaps. */
export function moveChordBoundary(chords: AudioChord[], rightIndex: number, at: number): AudioChord[] {
  if (rightIndex < 1 || rightIndex >= chords.length || !finite(at, chords[rightIndex - 1].start + .001, chords[rightIndex].end - .001)) throw new Error('和弦分界必须位于相邻两段内部。');
  return chords.map((c, i) => i === rightIndex - 1 ? { ...c, end: at } : i === rightIndex ? { ...c, start: at } : { ...c });
}
export function mergeChordMarkers(chords: AudioChord[], leftIndex: number): AudioChord[] {
  if (leftIndex < 0 || leftIndex + 1 >= chords.length) throw new Error('请选择两个相邻和弦。');
  return chords.flatMap((c, i) => i === leftIndex ? [{ ...c, end: chords[i + 1].end, confidence: Math.min(c.confidence, chords[i + 1].confidence) }] : i === leftIndex + 1 ? [] : [{ ...c }]);
}
export function activeStemGain(stem: AudioStem, stems: AudioStem[]): number {
  return stem.muted || stems.some(s => s.solo) && !stem.solo ? 0 : stem.gain;
}
