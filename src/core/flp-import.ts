// Calibration catalogue, aliases and parameter conversion adapted from FLP2NBS
// under the MIT License. Copyright (c) 2026 FLP2NBS contributors.
// See third_party/flp2nbs/LICENSE. This importer does not execute FL plugins.
import { bytesToBase64 } from './container';
import { INSTRUMENTS } from './instruments';
import { readFlp, type FlpChannel, type FlpNote, type FlpProject } from './flp-parser';
import { createProject, newNote, newTrack, uid, validateProject } from './project';
import type { Diagnostic, Project } from './types';

export interface FlpChannelChoice { id: number; instrumentId: string; baselineMidi: number; confirmed: boolean; selected: boolean }
export interface FlpImportChannel extends FlpChannelChoice {
  name: string; sample: string; kind: number; enabled: boolean;
  noteCount: number; activeNoteCount: number; verified: boolean; issues: string[];
  sampleSha256?: string; checkedSamplePath?: string;
}
export interface FlpImportPlan {
  source: FlpProject; filename: string; bytes: Uint8Array; sourceSha256: string;
  channels: FlpImportChannel[]; warnings: string[]; blockers: string[];
}
export type FlpSampleChecks = Record<number, { sha256: string; path?: string }>;

const MAX_TICK = 1e12, MAX_NOTES = 2000000, MAX_COPIES = 100000, MAX_TRACKS = 10000;
const SAMPLE_HASHES = [
  ['d775e11718dba8dd601e76bee5958aa02ed0d56c26481881d4c28226f7bd4477', 'harp'],
  ['7261568b63fea6a5763335479d16980329ae0c8db35f1b743eb86005d1a12150', 'bass'],
  ['829e1ff33546ef3de4e1e1a38ca3e0dc8a582227c284052868963333ed790686', 'basedrum'],
  ['a2a5168e70548dcddd5015204cec586365e611854e83bf634b42f2a6ddd8c3b7', 'snare'],
  ['8139400f63c0bc7114e960826a11bb1cd561e8f0c01dce077dbc6424ae51ab6c', 'hat'],
  ['8c15ed51b6fd1724e1fcc532d916961ca7925ccb0538cb7464eb84f747633469', 'guitar'],
  ['9372c07a7b9939d54ba877e25ba162806143b143bd05983f2bdc0a35c913fcbe', 'flute'],
  ['550f0027fbaf52e1046898c05b65b9690d9db5374603fb701e5bd995f0d1059e', 'bell'],
  ['82066b17ea8398765b1945fc9dd2ff47a389e497d53d4ca72609c1783ab72a63', 'chime'],
  ['bd9c7af0c25f7033bff3026f6133e33d7b4d26d5ab689b66376cae090df95dd0', 'xylophone'],
  ['0a7ef8406f4ad4c5037aa1ecb7a9bf02cf34e86bb0bea46596eef147458b156a', 'iron_xylophone'],
  ['7a18c945ff55914a4f51ddf6ecb012140cc737e63931947377c940e0d66474b7', 'cow_bell'],
  ['7eaecdb39733fa5d1db91ec93fdc745a2cff9d0d77afdcbcfa9bc12568d542aa', 'didgeridoo'],
  ['6f5948e882931aaaab6a2396e0fb77228929481150fc0b822e4ac0d4c6c3bcfb', 'bit'],
  ['06b4e1927947bf2152d2d552099f753b2842f2419632f8effa1bad48d03af5f7', 'banjo'],
  ['d7e3638d4c0fba4614f24ba94d6380935ae2341536d76989e44f00ffd94a1459', 'pling'],
] as const;
const catalogue = new Map<string, string>(SAMPLE_HASHES);
const aliases = new Map(INSTRUMENTS.flatMap(instrument => [[instrument.id, instrument.id], [instrument.englishName.toLowerCase(), instrument.id]]));
for (const [alias, id] of Object.entries({ piano: 'harp', 'double bass': 'bass', dbass: 'bass', bdrum: 'basedrum', sdrum: 'snare', click: 'hat' })) aliases.set(alias, id);
const suggestInstrument = (name: string): string => {
  const normalized = name.trim().toLowerCase();
  return aliases.get(normalized) ?? aliases.get(normalized.replace(/(?:[\s_#-]+[0-9]*|\s*\([0-9]+\))+$/, '')) ?? '';
};
const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
const unique = (messages: string[]) => [...new Set(messages)];

interface NoteGroup { notes: FlpNote[]; positions: number[]; prefixEnd: number[]; end: number }
function noteGroups(source: FlpProject): Map<number, Map<number, NoteGroup>> {
  const patterns = new Map<number, Map<number, NoteGroup>>();
  for (const [id, notes] of Object.entries(source.patterns)) {
    const groups = new Map<number, NoteGroup>();
    for (const note of notes) {
      let group = groups.get(note.channel);
      if (!group) { group = { notes: [], positions: [], prefixEnd: [], end: 1 }; groups.set(note.channel, group); }
      group.notes.push(note); group.end = Math.max(group.end, note.position + note.length);
    }
    for (const group of groups.values()) {
      const ordered = group.notes.slice().sort((left, right) => left.position - right.position);
      let end = 0;
      for (const note of ordered) { group.positions.push(note.position); end = Math.max(end, note.position + note.length); group.prefixEnd.push(end); }
    }
    patterns.set(Number(id), groups);
  }
  return patterns;
}
function lowerBound(values: number[], target: number): number {
  let low = 0, high = values.length;
  while (low < high) { const mid = low + Math.floor((high - low) / 2); if (values[mid] < target) low = mid + 1; else high = mid; }
  return low;
}
const onsetCount = (group: NoteGroup, start: number, end: number) => lowerBound(group.positions, end) - lowerBound(group.positions, start);

function channelIssues(channel: FlpChannel, notes: FlpNote[]): string[] {
  const issues = channel.issues.slice();
  if (channel.kind !== 0) issues.push('第一版仅支持采样器音符；插件、Layer、音频与自动化通道不能模拟为音符盒。');
  if (!finite(channel.pan, 0, 12800) || ![channel.root, channel.pitch, channel.fine, channel.sampler.stretchPitchCents ?? 0].every(Number.isFinite)) issues.push('通道音高或声像参数无效。');
  const sampler = channel.sampler;
  if (sampler.arpDirection || sampler.addToKey || sampler.stretchTime || sampler.stretchMultiplier || sampler.sampleStart || sampler.sampleStartOffset || sampler.sampleLength !== undefined && sampler.sampleLength !== 1 || sampler.formantUnhandled) issues.push('采样器改变起音、采样范围或音色的参数尚不支持。');
  for (const note of notes) {
    if (!finite(note.position, 0, MAX_TICK) || !finite(note.length, 0, MAX_TICK) || !Number.isFinite(note.key) || !Number.isFinite(note.fine)
      || !finite(note.velocity, 0, 128) || !finite(note.pan, 0, 128)) issues.push('源音符含超出支持范围的时间、力度、声像或音高参数。');
    if (note.flags & 8) issues.push('存在滑音音符；不能按普通采样器音符导入。');
    if (note.flags & ~0x4008) issues.push(`存在未知音符 flags=${note.flags}。`);
  }
  return unique(issues);
}

/** A channel name is a suggestion, never proof of sample identity or tuning. */
export async function prepareFlpImport(bytes: Uint8Array, filename: string, sampleChecks: FlpSampleChecks = {}): Promise<FlpImportPlan> {
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('工程大于 128 MiB，超出当前安全解析限制');
  const owned = Uint8Array.from(bytes), source = readFlp(owned);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer));
  const sourceSha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  const automation = new Set(Array.isArray(source.metadata.automation_issues) ? source.metadata.automation_issues.filter((value): value is string => typeof value === 'string') : []);
  const blockers = source.issues.filter(issue => !automation.has(issue));
  const warnings = [...source.warnings,
    '仅导入采样器音符与片段时间；忽略自动化、控制器、音频片段、音效链和包络，不认证 FL 完整播放等价。',
    `采用工程初始 ${source.bpm} BPM；自动化中的速度与音高变化不会应用。`,
    'FL 通道音量为非线性参数，未模拟；导入轨道音量固定为 1，音符力度按 velocity/128 换算，声像为参数换算。',
    ...[...automation].map(issue => `忽略自动化：${issue}`)];
  if (!Number.isInteger(source.ppq) || !finite(source.ppq, 1, 32767) || !finite(source.bpm, .01, 10000) || !Number.isInteger(source.beatsBar) || !finite(source.beatsBar, 1, 255)) blockers.push('工程 PPQ、初始速度或拍号超出 NBSX 支持范围。');
  const groups = noteGroups(source), notesByChannel = new Map<number, FlpNote[]>();
  // Summary happens before a user can choose channels. Bound its Cartesian work
  // independently of the later, selected-channel project-copy budget.
  let reviewVisits = 0;
  for (const clip of source.clips) if (clip.pattern !== undefined) {
    reviewVisits += groups.get(clip.pattern)?.size ?? 0;
    if (reviewVisits > 2000000) throw new Error('FLP 播放片段与声道组合超过 200 万项，超出导入检查上限；请拆分工程后导入。');
  }
  for (const pattern of groups.values()) for (const [channel, group] of pattern) {
    const notes = notesByChannel.get(channel) ?? [];
    for (const note of group.notes) notes.push(note); notesByChannel.set(channel, notes);
    if (!source.channels[channel]) blockers.push(`音符引用不存在的通道 ${channel}。`);
  }
  const channels = Object.values(source.channels).sort((left, right) => left.id - right.id).map((channel): FlpImportChannel => ({
    id: channel.id, name: channel.name || `通道 ${channel.id}`, sample: channel.sample, kind: channel.kind, enabled: channel.enabled,
    noteCount: notesByChannel.get(channel.id)?.length ?? 0, activeNoteCount: 0,
    instrumentId: suggestInstrument(channel.name), baselineMidi: 66, verified: false, confirmed: false, selected: false,
    issues: channelIssues(channel, notesByChannel.get(channel.id) ?? []),
  }));
  const rows = new Map(channels.map(channel => [channel.id, channel]));
  const ignoredClips = new Map<string, number>();
  for (const clip of source.clips) {
    if (typeof source.tracks[clip.track] !== 'boolean') blockers.push(`轨道 ${clip.track} 缺少明确静音状态。`);
    if (![clip.position, clip.offset, clip.end].every(value => finite(value, 0, MAX_TICK)) || !finite(clip.length, 1, MAX_TICK) || clip.end - clip.offset !== clip.length) blockers.push('播放列表片段范围无效，不能保留原始裁剪窗口。');
    if (clip.pattern === undefined) {
      const channel = source.channels[clip.channel ?? -1];
      if (channel?.kind === 4 || channel?.kind === 5) { const label = channel.kind === 4 ? '音频' : '自动化'; ignoredClips.set(label, (ignoredClips.get(label) ?? 0) + 1); }
      else blockers.push(`播放列表含未知非音符片段（通道 ${clip.channel ?? '未知'}），不能猜测播放行为。`);
      continue;
    }
    const pattern = groups.get(clip.pattern);
    if (!pattern) { blockers.push(`播放列表引用不存在的 Pattern ${clip.pattern}。`); continue; }
    for (const [id, group] of pattern) {
      const row = rows.get(id); if (!row) continue;
      if (row.enabled && source.tracks[clip.track] && !clip.muted) row.activeNoteCount += onsetCount(group, clip.offset, clip.end);
      const before = lowerBound(group.positions, clip.offset);
      if (source.metadata.play_truncated_notes && before > 0 && group.prefixEnd[before - 1] > clip.offset) row.issues = unique([...row.issues, 'Play truncated notes 已启用且裁剪穿过音符；重触发语义尚不支持。']);
    }
  }
  for (const [kind, count] of ignoredClips) warnings.push(`只导入音符：忽略 ${count} 个${kind}片段，原始内容保留在嵌入的 FLP 中。`);
  for (const row of channels) row.selected = row.enabled && row.kind === 0 && row.activeNoteCount > 0;
  return withFlpSampleChecks({ source, filename, bytes: owned, sourceSha256, channels, warnings: unique(warnings), blockers: unique(blockers) }, sampleChecks);
}

/** Host checks only read authorized files; this function never resolves a sample path. */
export function withFlpSampleChecks(plan: FlpImportPlan, checks: FlpSampleChecks): FlpImportPlan {
  const channels = plan.channels.map(row => {
    const check = checks[row.id], hash = check?.sha256.toLowerCase(), known = hash && catalogue.get(hash);
    const { sampleSha256: _hash, checkedSamplePath: _path, ...base } = row;
    return { ...base, instrumentId: known ?? suggestInstrument(plan.source.channels[row.id].name), baselineMidi: 66,
      verified: !!known, confirmed: false,
      ...(hash ? { sampleSha256: hash } : {}), ...(check?.path ? { checkedSamplePath: check.path } : {}),
    };
  });
  return { ...plan, channels };
}

export function flpChannelChoiceError(plan: FlpImportPlan, choice: FlpChannelChoice): string | undefined {
  if (!choice.selected) return;
  const row = plan.channels.find(channel => channel.id === choice.id);
  if (!row) return `选择了不存在的 FL 通道 ${choice.id}。`;
  if (row.kind !== 0 || row.issues.length) return `${row.name}：${row.issues.join('；') || '不支持此通道类型。'}`;
  if (!INSTRUMENTS.some(instrument => instrument.id === choice.instrumentId)) return `${row.name}：请选择有效的音符盒乐器，不能使用默认回退。`;
  if (!finite(choice.baselineMidi, 0, 127)) return `${row.name}：采样基准 MIDI 必须为 0～127 的有限数。`;
  if (!(row.verified && row.instrumentId === choice.instrumentId && row.baselineMidi === choice.baselineMidi) && choice.confirmed !== true) return `${row.name}：请确认采样相对所选乐器的音高基准；名称不能作为校准证据。`;
}

export function importFlp(plan: FlpImportPlan, choices: FlpChannelChoice[], options: { acknowledgeWarnings: boolean }): { project: Project; diagnostics: Diagnostic[] } {
  if (plan.blockers.length) throw new Error(`FLP 无法导入：${plan.blockers.join('；')}`);
  if (plan.warnings.length && options.acknowledgeWarnings !== true) throw new Error('请先确认只导入音符的范围与忽略事项。');
  const selected = new Map<number, FlpChannelChoice>(), seen = new Set<number>();
  for (const choice of choices) {
    if (seen.has(choice.id)) throw new Error('FL 通道选择包含重复编号。'); seen.add(choice.id);
    const error = flpChannelChoiceError(plan, choice); if (error) throw new Error(error);
    if (choice.selected) selected.set(choice.id, choice);
  }
  if (!selected.size) throw new Error('请至少选择一个可导入的采样器通道。');
  const source = plan.source, groups = noteGroups(source);
  const copies: { clip: FlpProject['clips'][number]; channel: FlpChannel; group: NoteGroup; choice: FlpChannelChoice; key: string; muted: boolean }[] = [];
  const trackPlans = new Map<string, { row: number; channel: FlpChannel; muted: boolean; choice: FlpChannelChoice }>();
  let noteCount = 0, occurrences = 0;
  for (const clip of source.clips) {
    if (clip.pattern === undefined) continue;
    for (const [id, group] of groups.get(clip.pattern) ?? []) {
      const choice = selected.get(id); if (!choice) continue;
      const channel = source.channels[id], muted = !channel.enabled || !source.tracks[clip.track] || clip.muted;
      const key = `${clip.track}:${id}:${muted ? 1 : 0}`;
      if (copies.length + 1 > MAX_COPIES || noteCount + group.notes.length > MAX_NOTES) throw new Error('FLP 片段克隆超过 10 万个或源音符副本超过 200 万个，请减少所选通道或片段。');
      // Reserve the bounded copy entry only after checking its complete note budget.
      noteCount += group.notes.length; copies.push({ clip, channel, group, choice, key, muted });
      occurrences += onsetCount(group, clip.offset, clip.end);
      trackPlans.set(key, { row: clip.track, channel, muted, choice });
      if (trackPlans.size > MAX_TRACKS) throw new Error('FLP 分轨超过 1 万条，请减少所选通道。');
    }
  }
  if (!occurrences) throw new Error('所选通道在播放列表范围内没有有效起音。');
  // Validate every source note before allocating converted notes or project copies.
  for (const { channel, group, choice } of copies) for (const note of group.notes) {
    const pitch = choice.baselineMidi + note.key - channel.root + (channel.pitch + channel.fine + (channel.sampler.stretchPitchCents ?? 0) + (note.fine - 120) * 10) / 100;
    if (!finite(pitch, 0, 127)) throw new Error(`${channel.name}：源 tick ${note.position} 的音高 ${pitch} 超出 MIDI 0～127，未裁剪。`);
  }
  const project = createProject(plan.filename.replace(/^.*[\\/]/, '').replace(/\.flp$/i, ''));
  project.ppq = source.ppq; project.tempos = [{ tick: 0, bpm: source.bpm }]; project.timeSignatures = [{ tick: 0, numerator: source.beatsBar, denominator: 4 }];
  project.tracks = []; project.patterns = []; project.regions = [];
  const tracks = new Map<string, string>();
  for (const [key, entry] of [...trackPlans].sort((left, right) => left[1].row - right[1].row || left[1].channel.id - right[1].channel.id || Number(left[1].muted) - Number(right[1].muted))) {
    const track = newTrack(`轨道 ${entry.row} · ${entry.channel.name || `通道 ${entry.channel.id}`}${entry.muted ? '（静音）' : ''}`, project.tracks.length, entry.choice.instrumentId);
    track.muted = entry.muted; project.tracks.push(track); tracks.set(key, track.id);
  }
  for (const { clip, channel, group, choice, key } of copies) {
    const notes = group.notes.map(sourceNote => {
      const pitch = choice.baselineMidi + sourceNote.key - channel.root + (channel.pitch + channel.fine + (channel.sampler.stretchPitchCents ?? 0) + (sourceNote.fine - 120) * 10) / 100;
      const midi = Math.round(pitch);
      return { ...newNote(sourceNote.position, midi, sourceNote.length), velocity: sourceNote.velocity / 128,
        pan: channel.pan === 6400 ? sourceNote.pan / 64 - 1 : (sourceNote.pan / 64 + channel.pan / 6400) / 2 - 1,
        detune: (pitch - midi) * 100 };
    });
    const pattern = { id: uid(), name: `${source.patternNames?.[clip.pattern!] || `Pattern ${clip.pattern}`} · ${channel.name}`, length: Math.max(1, clip.end, group.end), notes };
    project.patterns.push(pattern); project.regions.push({ id: uid(), trackId: tracks.get(key)!, patternId: pattern.id, start: clip.position, length: clip.length, offset: clip.offset, loop: false });
  }
  const sourceAssetId = uid(); project.assets.push({ id: sourceAssetId, name: plan.filename.replace(/^.*[\\/]/, ''), mime: 'application/x-fl-studio-project', data: bytesToBase64(plan.bytes) });
  const ignored = { channels: plan.channels.filter(row => !selected.has(row.id)).map(row => ({ id: row.id, name: row.name, kind: row.kind, enabled: row.enabled, noteCount: row.noteCount, activeNoteCount: row.activeNoteCount })),
    clips: source.clips.filter(clip => clip.pattern === undefined).map(clip => ({ ...clip })), automationIssues: structuredClone(source.metadata.automation_issues ?? []) };
  project.provenance = { kind: 'flp', filename: plan.filename, metadata: { sourceAssetId, sha256: plan.sourceSha256, version: source.version, ppq: source.ppq, bpm: source.bpm,
    channelChoices: choices.map(choice => {
      const row = plan.channels.find(row => row.id === choice.id);
      return { ...choice, verified: !!row?.verified && row.instrumentId === choice.instrumentId && row.baselineMidi === choice.baselineMidi,
        ...(row?.sampleSha256 ? { sampleSha256: row.sampleSha256 } : {}) };
    }),
    channelParameters: Object.values(source.channels).map(channel => ({ id: channel.id, volume: channel.volume, pan: channel.pan, root: channel.root, pitch: channel.pitch, fine: channel.fine, sampler: { ...channel.sampler } })),
    ignored, sourceMetadata: structuredClone(source.metadata), importedSourceNotes: noteCount, playlistNoteOccurrences: occurrences } };
  validateProject(project);
  const diagnostics: Diagnostic[] = plan.warnings.map(message => ({ severity: 'warning', code: 'flp-notes-only', message }));
  if (ignored.channels.length) diagnostics.push({ severity: 'info', code: 'flp-skipped-channels', message: `已跳过 ${ignored.channels.length} 个通道，共 ${ignored.channels.reduce((sum, row) => sum + row.noteCount, 0)} 个源音符、${ignored.channels.reduce((sum, row) => sum + row.activeNoteCount, 0)} 个启用起音；详情与原始 FLP 保留在 NBSX 中。` });
  diagnostics.push({ severity: 'info', code: 'flp-imported', message: `已导入 ${project.regions.length} 个独立片段、${noteCount} 个源音符副本和 ${occurrences} 个播放列表起音（包含所选静音内容）。` });
  return { project, diagnostics };
}
