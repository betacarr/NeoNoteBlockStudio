import type { Asset, AudioClip, Project, Track } from './types';
import { validateAudioTempo } from './audio-tempo';
import { DRUM_ROLES, STEM_ROLES, validateAudioChords, type AudioAssistResult } from './audio-assist';
import { createTempoMap } from './time';

export const ARRANGEMENT_AUDIO_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3', 'm4a', 'aac'];
export const ARRANGEMENT_AUDIO_FORMATS = new RegExp(`\\.(${ARRANGEMENT_AUDIO_EXTENSIONS.join('|')})$`, 'i');
export const ARRANGEMENT_AUDIO_FORMAT_LABEL = 'WAV / AIFF / FLAC / OGG / MP3 / M4A / AAC';
export const AUDIO_DROP_MAX_BYTES = 64 * 1024 ** 2;
export function audioClipEnd(project: Project, clip: AudioClip): number {
  const time = createTempoMap(project);
  return time.tick(time.seconds(clip.start) + clip.durationSeconds);
}
export function audioTrackParents(tracks: readonly Track[], track?: Track): Track[] {
  const parents: Track[] = [];
  // Stem Splitter can nest the kit-piece stack inside the main stem stack.
  while (track?.parentTrackId && parents.length < 3) {
    const parentId = track.parentTrackId;
    track = tracks.find(parent => parent.id === parentId);
    if (!track) break;
    parents.push(track);
  }
  return parents;
}
export function audioTrackChildren(tracks: readonly Track[], id: string): Track[] {
  return tracks.filter(track => audioTrackParents(tracks, track).some(parent => parent.id === id));
}
export function validateAudioClips(project: Project, knownIds?:Set<string>): void {
  for (const track of project.tracks) if (track.parentTrackId) {
    const parents = audioTrackParents(project.tracks, track);
    if (track.kind !== 'audio' || !parents.length || parents.length > 2 || parents.some(parent => !parent.audioGroup)
      || parents.at(-1)?.parentTrackId) throw new Error('音频分轨组引用无效。');
  }
  if (project.audioClips === undefined) return;
  if (!Array.isArray(project.audioClips) || project.audioClips.length > 100000) throw new Error('音频片段数量无效。');
  const ids = knownIds ?? new Set([...project.tracks, ...project.patterns, ...project.regions, ...project.assets].map(x => x.id));
  for (const c of project.audioClips) {
    const a = project.assets.find(a => a.id === c.assetId), t = project.tracks.find(t => t.id === c.trackId);
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || t?.kind !== 'audio' || !a || typeof c.name !== 'string'
      || !Number.isFinite(c.start) || c.start < 0 || c.start > 1e12 || !Number.isFinite(c.offsetSeconds) || c.offsetSeconds < 0
      || !Number.isFinite(c.durationSeconds) || c.durationSeconds <= 0 || c.durationSeconds > 7200
      || c.muted !== undefined && typeof c.muted !== 'boolean'
      || a.audioFile && c.offsetSeconds + c.durationSeconds > a.audioFile.frames / a.audioFile.sampleRate + 2 / a.audioFile.sampleRate)
      throw new Error('音频片段引用、轨道或播放范围无效。');
    ids.add(c.id);
    const sourceDuration = a.audioFile ? (a.audioFile.frames + 2) / a.audioFile.sampleRate : 86400;
    if (c.tempoAnalysis !== undefined) validateAudioTempo(c.tempoAnalysis, sourceDuration);
    if (c.chordOriginSeconds !== undefined && (!Array.isArray(c.chords) || !Number.isFinite(c.chordOriginSeconds)
      || c.chordOriginSeconds < 0 || c.chordOriginSeconds > sourceDuration)) throw new Error('音频和弦的源偏移无效。');
    if (c.chords !== undefined) validateAudioChords(c.chords,
      c.chordOriginSeconds === undefined ? c.durationSeconds : sourceDuration - c.chordOriginSeconds);
  }
  if (project.regions.some(r => project.tracks.find(t => t.id === r.trackId)?.kind === 'audio')) throw new Error('音符片段不能放在音频轨道。');
}
export function mergeAudioAssets(project: Project, assets: Asset[]): void {
  for (const asset of assets) {
    const old = project.assets.find(a => a.id === asset.id);
    if (old && JSON.stringify(old) !== JSON.stringify(asset)) throw new Error('音频资源标识冲突，请重新导入。');
    if (!old) project.assets.push(structuredClone(asset));
  }
}
export function appendAudioResult(project: Project, result: AudioAssistResult, start: number, sourceClipId?: string, targetTrackId?:string, selectedRoles?:string[]): AudioClip[] {
  if (sourceClipId) return appendStemResult(project, result, start, sourceClipId, selectedRoles).clips;
  const { workspace } = result;
  const target = targetTrackId ? project.tracks.find(t => t.id === targetTrackId) : undefined;
  if (targetTrackId && (!target || target.kind !== 'audio' || target.audioGroup || target.locked)) throw new Error('请选择未锁定的普通音频轨道。');
  const track = target ?? newAudioTrack(project, workspace.name, '#94bea7');
  const clip: AudioClip = { id: crypto.randomUUID(), trackId: track.id, assetId: workspace.sourceAssetId, name: workspace.name, start, offsetSeconds: 0, durationSeconds: workspace.duration, ...(workspace.tempoAnalysis && { tempoAnalysis: { ...workspace.tempoAnalysis } }) };
  mergeAudioAssets(project, result.assets.filter(asset => asset.id === clip.assetId));
  if (!target) project.tracks.push(track);
  (project.audioClips ??= []).push(clip);
  return [clip];
}

function newAudioTrack(project: Project, name: string, color = '#72b7bd'): Track {
  return { id: crypto.randomUUID(), kind: 'audio', name, color, instrumentId: project.instruments[0].id, volume: 1, pan: 0, muted: false, solo: false, locked: false };
}

export function appendStemResult(project: Project, result: AudioAssistResult, start: number, sourceClipId?: string, selectedRoles?: string[]) {
  const { workspace } = result;
  const stems = selectedRoles ? workspace.stems.filter(stem => selectedRoles.includes(stem.role)) : workspace.stems;
  const roles = new Set(stems.map(stem => stem.role));
  const drumRoles = DRUM_ROLES.filter(role => roles.has(role));
  if (!stems.length || roles.size !== stems.length || selectedRoles && roles.size !== selectedRoles.length
    || stems.some(stem => ![...STEM_ROLES, ...DRUM_ROLES, 'submix'].includes(stem.role))
    || drumRoles.length && roles.has('drums')) throw new Error('分轨结果缺少所选声部。');
  const source = sourceClipId ? project.audioClips?.find(clip => clip.id === sourceClipId) : undefined;
  const sourceTrack = project.tracks.find(track => track.id === source?.trackId);
  if (sourceClipId && (!source || !sourceTrack || sourceTrack.locked)) throw new Error('源音频片段已改变或锁定，请重新选择。');
  // Take the snapshot before changing the source or creating any new regions.
  const origin = source ?? appendAudioResult(project, result, start)[0];
  const group = newAudioTrack(project, origin.name + ' · 分轨组');
  group.audioGroup = { sourceClipId: origin.id, collapsed: false };
  if (sourceTrack) {
    group.volume = sourceTrack.volume;
    group.pan = sourceTrack.pan;
    group.solo = sourceTrack.solo;
  }
  const added = [group];
  const clips: AudioClip[] = [];
  let drumGroup: Track | undefined;
  for (const stem of stems) {
    if (!drumGroup && drumRoles.length && stems.length > drumRoles.length && drumRoles.some(role => role === stem.role)) {
      drumGroup = newAudioTrack(project, '鼓 · 单个鼓件');
      drumGroup.parentTrackId = group.id;
      drumGroup.audioGroup = { sourceClipId: origin.id, collapsed: false };
      added.push(drumGroup);
    }
    const track = newAudioTrack(project, stem.name);
    track.parentTrackId = drumRoles.some(role => role === stem.role) ? drumGroup?.id ?? group.id : group.id;
    added.push(track);
    clips.push({ id: crypto.randomUUID(), trackId: track.id, assetId: stem.assetId, name: stem.name, start: origin.start,
      offsetSeconds: 0, durationSeconds: workspace.duration,
      separation: { role: stem.role, sourceClipId: origin.id, model: workspace.model.id + '/' + workspace.model.version } });
  }
  mergeAudioAssets(project, result.assets.filter(asset => stems.some(stem => stem.assetId === asset.id)));
  project.audioClips!.push(...clips);
  origin.muted = true;
  const parent = audioTrackParents(project.tracks, sourceTrack).at(-1);
  const last = project.tracks.reduce((index, track, at) => track.id === (parent?.id ?? origin.trackId)
    || parent && audioTrackParents(project.tracks, track).some(item => item.id === parent.id) ? at : index, -1);
  // Audio lanes can be inserted between note tracks. Preserve their existing
  // fallback MIDI channels when their absolute indices move.
  if (added.length % 16 !== 0) for (let index = last + 1; index < project.tracks.length; index++) {
    const track = project.tracks[index];
    if (track.kind !== 'audio' && track.midiChannel === undefined) track.midiChannel = index % 16;
  }
  project.tracks.splice(last + 1, 0, ...added);
  return { clips, group };
}
