// Adapted from FLP2NBS flp.py, formats.py and model.py under the MIT License.
// Copyright (c) 2026 FLP2NBS contributors. See the bundled third-party notices.
// Additional event-name facts: PyFLP 2.2.1 PatternID.Name=193;
// DisplayGroupID.Name=231 is not a pattern name. No PyFLP runtime is used.

export interface FlpNote {
  position: number; channel: number; key: number; length: number;
  velocity: number; pan: number; fine: number; flags: number;
}
export interface FlpSampler {
  layoutBytes?: number; arpDirection?: number; addToKey?: boolean;
  stretchTime?: number; stretchPitchCents?: number; stretchMultiplier?: number;
  sampleStart?: number; sampleLength?: number; sampleStartOffset?: number;
  formantUnhandled?: boolean;
}
export interface FlpChannel {
  id: number; name: string; enabled: boolean; kind: number; root: number; sample: string;
  pitch: number; fine: number; pan: number; volume: number; issues: string[]; sampler: FlpSampler;
}
export interface FlpClip {
  pattern?: number; channel?: number; position: number; length: number;
  offset: number; end: number; track: number; muted: boolean;
}
export interface FlpProject {
  version: string; ppq: number; bpm: number; beatsBar: number;
  channels: Record<number, FlpChannel>; patterns: Record<number, FlpNote[]>;
  clips: FlpClip[]; tracks: Record<number, boolean>;
  issues: string[]; warnings: string[]; metadata: Record<string, unknown>;
  patternNames?: Record<number, string>;
}

const MAX_BYTES = 128 * 1024 * 1024, MAX_EVENTS = 2000000, MAX_NOTES = 2000000, MAX_CLIPS = 100000, MAX_SUMMARIES = 100000;
interface Profile { version: number[]; label: string; event172Size: number }
interface Event { id: number; data: Uint8Array }
interface ControlSummary { pattern: number; target: string; count: number; tick_min: number; tick_max: number; value_min: number; value_max: number }
export class FlpError extends Error { constructor(message: string) { super(message); this.name = 'FlpError'; } }
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const fail = (message: string): never => { throw new FlpError(message); };
function versionText(bytes: Uint8Array): string {
  if (bytes.length > 128) return fail('工程版本字段过长，超出安全解析限制');
  if (bytes.some(value => value > 127)) return fail('工程版本无效');
  return new TextDecoder().decode(bytes).replace(/\0+$/, '');
}
function profileFor(text: string): Profile {
  if (!/^\d+(?:\.\d+)+$/.test(text)) return fail('工程版本无效');
  const version = text.split('.').map(Number);
  if (!version.every(Number.isSafeInteger)) return fail('工程版本无效');
  if (![20, 21, 24, 25, 26].includes(version[0])) return fail(`不支持 FL ${text}；当前格式范围为 FL 20、21、2024、2025、2026`);
  return { version, label: `FL ${version[0]}`, event172Size: version[0] === 26 ? 1 : 4 };
}
function text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\0+$/, ''); }
  catch { return fail('FLP 文本包含损坏的 UTF-16 数据'); }
}
function unsigned(bytes: Uint8Array): number {
  let value = 0; for (let at = bytes.length - 1; at >= 0; at--) value = value * 256 + bytes[at]; return value;
}
function* events(bytes: Uint8Array): Generator<Event> {
  let at = 22, count = 0, profile: Profile | undefined;
  while (at < bytes.length) {
    if (++count > MAX_EVENTS) return fail('FLP 事件超过 200 万个，超出安全解析限制');
    const id = bytes[at++]; let size = 0;
    if (id < 192) {
      size = id < 64 ? 1 : id < 128 ? 2 : 4;
      if (id === 172) {
        if (!profile) return fail('event 172 位于工程版本之前，无法确定布局');
        if (profile.version[0] === 25 && profile.version[1] >= 2) return fail('FL 25.2+ 的 event 172 存在尚未验证的变长布局，停止读取；未尝试猜测恢复');
        size = profile.event172Size;
      }
    } else {
      let ended = false;
      for (let group = 0; group < 5; group++) {
        if (at >= bytes.length) return fail('事件长度被截断');
        const value = bytes[at++]; size += (value & 127) * 2 ** (group * 7);
        if (!(value & 128)) { ended = true; break; }
      }
      if (!ended) return fail('事件长度编码无效');
    }
    if (size > bytes.length - at) return fail(`事件 ${id} 数据被截断`);
    const data = bytes.subarray(at, at + size); at += size;
    if (id === 199) {
      if (profile) return fail('缺少或重复的工程版本');
      profile = profileFor(versionText(data));
    }
    yield { id, data };
  }
}
function playlistStride(bytes: Uint8Array): number {
  const data = view(bytes), candidates: number[] = [];
  for (const stride of [32, 60, 80, 88]) {
    if (bytes.length % stride) continue;
    let valid = true;
    for (let at = 0; at < bytes.length; at += stride) {
      if (data.getUint16(at + 4, true) !== 20480 || data.getUint16(at + 12, true) > 499) { valid = false; break; }
    }
    if (valid) candidates.push(stride);
  }
  if (candidates.length !== 1) return fail(`播放列表记录布局无法唯一确认：候选 [${candidates.join(', ')}]，数据 ${bytes.length} 字节；未按长度或版本猜测`);
  return candidates[0];
}
function samplerParameters(bytes: Uint8Array): FlpSampler {
  if (![158, 168].includes(bytes.length)) return fail(`未知采样器参数布局：${bytes.length} 字节（支持 158/168）`);
  const data = view(bytes), result: FlpSampler = {
    layoutBytes: bytes.length, arpDirection: data.getUint32(40, true), addToKey: !!bytes[63],
    stretchTime: data.getUint32(96, true), stretchPitchCents: data.getInt32(100, true), stretchMultiplier: data.getInt32(104, true),
    sampleStart: data.getFloat64(128, true), sampleLength: data.getFloat64(136, true), sampleStartOffset: data.getFloat64(144, true),
  };
  if (![result.sampleStart, result.sampleLength, result.sampleStartOffset].every(Number.isFinite)) return fail('采样器起止位置包含非有限数值');
  if (bytes.length === 168 && data.getFloat64(160, true) !== .5) result.formantUnhandled = true;
  return result;
}

/** Read known FL20/21/24/25/26 layouts without interpreting plug-in audio or accessing files. */
export function readFlp(bytes: Uint8Array): FlpProject {
  if (!(bytes instanceof Uint8Array)) return fail('FLP 内容必须是二进制字节');
  if (bytes.length > MAX_BYTES) return fail('工程大于 128 MiB，超出当前安全解析限制');
  const header = view(bytes);
  if (bytes.length < 22 || header.getUint32(0, false) !== 0x464c6864 || header.getUint32(4, true) !== 6) return fail('不是受支持的 FLP 文件头');
  if (header.getUint32(14, false) !== 0x464c6474 || header.getUint32(18, true) !== bytes.length - 22) return fail('FLP 数据长度不符，文件可能损坏');
  if (header.getUint16(8, true) !== 0) return fail('只支持完整 FLP 工程');

  // Two bounded passes retain only subarray views during iteration, avoiding a
  // second full file/event list. The first pass establishes the global tempo.
  let version = '', firstTempo: number | undefined, firstCoarse: number | undefined, firstFine: number | undefined;
  let tempoChanged = false, coarseChanged = false, fineChanged = false;
  const counts: Record<number, number> = {};
  for (const { id, data } of events(bytes)) {
    counts[id] = (counts[id] ?? 0) + 1;
    if (id === 199) version = versionText(data);
    else if (id === 156) { const bpm = unsigned(data) / 1000; if (firstTempo === undefined) firstTempo = bpm; else if (firstTempo !== bpm) tempoChanged = true; }
    else if (id === 66) { const value = unsigned(data); if (firstCoarse === undefined) firstCoarse = value; else if (firstCoarse !== value) coarseChanged = true; }
    else if (id === 93) { const value = unsigned(data); if (firstFine === undefined) firstFine = value; else if (firstFine !== value) fineChanged = true; }
  }
  if (!version) return fail('缺少或重复的工程版本');
  const profile = profileFor(version), tempoSource = firstTempo === undefined ? 'legacy66+93' : 'event156';
  if (firstTempo === undefined && (firstCoarse === undefined || coarseChanged || fineChanged)) return fail('未读到唯一速度，拒绝使用猜测默认值');
  const bpm = firstTempo ?? firstCoarse! + (firstFine ?? 0) / 1000, ppq = header.getUint16(12, true);
  if (ppq < 1 || ppq > 9600 || !(bpm > 0 && bpm <= 522)) return fail('PPQ 或速度超出支持范围');
  const playlistLayouts = new Set<number>(), samplerLayouts = new Set<number>(), trackLayouts = new Set<number>();
  const metadata: Record<string, unknown> = { event_counts: counts, format_profile: profile.label, tempo_source: tempoSource,
    playlist_layouts: [], sampler_layouts: [], track_layouts: [],
    compatibility_validation: ['20.8.3.2304', '24.2.2.4597', '25.1.3.4922', '26.1.1.5547'].includes(version) ? 'real_corpus_structural' : 'synthetic_layout_tests_only' };
  const project: FlpProject = { version, ppq, bpm, beatsBar: 4, channels: {}, patterns: {}, clips: [], tracks: {}, issues: [], warnings: [], metadata };
  const issueSet = new Set<string>(), warningSet = new Set<string>(), automation = new Set<string>();
  const issue = (message: string) => { issueSet.add(message); if (issueSet.size > MAX_SUMMARIES) fail('FLP 问题摘要超过安全上限'); };
  const warning = (message: string) => { warningSet.add(message); if (warningSet.size > MAX_SUMMARIES) fail('FLP 警告摘要超过安全上限'); };
  const automationIssue = (message: string) => { issue(message); automation.add(message); };
  if (tempoChanged) automationIssue('多个不同速度事件：可能存在变速');
  if (firstCoarse !== undefined && (coarseChanged || fineChanged)) automationIssue('旧版速度事件不唯一：可能存在变速');
  if (tempoSource === 'event156' && firstCoarse !== undefined && firstCoarse + (firstFine ?? 0) / 1000 !== bpm) automationIssue('新旧速度事件不一致，不能确定播放速度');
  if (metadata.compatibility_validation === 'synthetic_layout_tests_only') warning(`FL ${version} 尚无本机真实工程回归；仅已知布局测试通过，不认证完整播放兼容性`);
  let channel: FlpChannel | undefined, pattern = 1, patternDeclared = false, envIndex = 0, noteCount = 0;
  const arrangements = new Set<number>(), controlSummary = new Map<string, ControlSummary>();
  for (const { id, data } of events(bytes)) {
    const u = data.length <= 4 ? unsigned(data) : 0, d = view(data);
    if (id === 64) {
      if (project.channels[u]) return fail(`重复通道编号 ${u}，拒绝覆盖通道状态`);
      channel = { id: u, name: '', enabled: true, kind: 0, root: 60, sample: '', pitch: 0, fine: 0, pan: 6400, volume: 10000, issues: [], sampler: {} };
      project.channels[u] = channel; envIndex = 0;
    } else if (id === 65) { pattern = u; patternDeclared = true; project.patterns[pattern] ??= []; }
    else if (id === 193) {
      if (!patternDeclared) { issue('Pattern 名称缺少明确的 Pattern 编号，未猜测名称归属'); continue; }
      const name = text(data), names = project.patternNames ??= {};
      if (names[pattern] !== undefined && names[pattern] !== name) return fail(`Pattern ${pattern} 含冲突名称，拒绝覆盖`);
      names[pattern] = name;
    } else if (id === 98) channel = undefined;
    else if (id === 224) {
      if (data.length % 24) return fail('音符记录不是 24 字节整倍数');
      if ((noteCount += data.length / 24) > MAX_NOTES) return fail('FLP 音符超过 200 万个，超出安全解析限制');
      const notes = project.patterns[pattern] ??= [];
      for (let at = 0; at < data.length; at += 24) {
        notes.push({ position: d.getUint32(at, true), flags: d.getUint16(at + 4, true), channel: d.getUint16(at + 6, true), length: d.getUint32(at + 8, true),
          key: d.getUint16(at + 12, true), fine: data[at + 16], pan: data[at + 20], velocity: data[at + 21] });
        if (data[at + 22] !== 128 || data[at + 23] !== 128 || data[at + 18] !== 64) warning('存在音符调制/释放参数：不能等价保留');
      }
    } else if (id === 223 && data.length) {
      if (data.length % 12) return fail('Pattern 控制事件长度无效');
      for (let at = 0; at < data.length; at += 12) {
        const tick = d.getUint32(at, true), target = d.getUint32(at + 4, true), value = d.getInt32(at + 8, true), key = `${pattern}:${target}`;
        const targetText = `0x${target.toString(16).padStart(8, '0')}`;
        let summary = controlSummary.get(key);
        if (!summary) { summary = { pattern, target: targetText, count: 0, tick_min: tick, tick_max: tick, value_min: value, value_max: value }; controlSummary.set(key, summary); }
        if (controlSummary.size > MAX_SUMMARIES) return fail('FLP 控制器摘要超过安全上限');
        summary.count++; summary.tick_min = Math.min(summary.tick_min, tick); summary.tick_max = Math.max(summary.tick_max, tick);
        summary.value_min = Math.min(summary.value_min, value); summary.value_max = Math.max(summary.value_max, value);
        if (target === 0x40000005) {
          if (value === Math.round(bpm * 1000)) warning(`已核对 Pattern ${pattern} 的同速事件：${bpm} BPM，与工程一致，不改变速度`);
          else automationIssue(`Pattern ${pattern} 含实际变速事件，与工程 ${bpm} BPM 不同，尚不支持；位置和值见 pattern_controller_summary`);
        } else automationIssue(`Pattern ${pattern} 含未支持的控制器/事件自动化，目标 ${targetText}；位置和值见 pattern_controller_summary`);
      }
    } else if ((id === 216 || id === 225) && data.length) {
      if (data.length % 12) issue('初始化控制参数长度无效，无法确认初始速度/音高');
      else for (let at = 0; at < data.length; at += 12) if (d.getUint32(at + 4, true) === 0x40000005 && d.getInt32(at + 8, true) !== Math.round(bpm * 1000)) automationIssue('初始化控制参数覆盖工程 BPM，尚不支持');
    } else if (id === 26 && u) issue('Pattern 实时循环模式尚不支持');
    else if ((id === 227 || id === 234) && data.length) automationIssue(`检测到自动化或控制器链接事件 ${id}，不能保证恒速与静态音高`);
    else if (id === 226 && data.length) warning('存在外部 MIDI 控制映射；离线转换不接收实时 MIDI 输入');
    else if ((id === 242 || id === 243) && data.length) warning(`FL ${profile.version[0]} 扩展事件 ${id} 未解码，已在原始事件摘要中记录，无法认证完整播放行为`);
    else if (id === 11 && u) issue('工程 Swing 不为零，起音行为尚不支持');
    else if (id === 80 && u) issue('Master pitch 不为零，尚不支持');
    else if (id === 17) project.beatsBar = u;
    else if (id === 18 && u !== 4) issue('当前仅支持四分音符为一拍的拍号');
    else if ((id === 33 || id === 34) && u !== 0 && u !== 4) issue('时间标记中存在拍号变化，当前尚不支持');
    else if (id === 30) metadata.play_truncated_notes = !!u;
    else if (id === 99) { arrangements.add(u); channel = undefined; }
    else if (id === 233 && data.length) {
      const stride = playlistStride(data); playlistLayouts.add(stride);
      if (project.clips.length + data.length / stride > MAX_CLIPS) return fail('FLP 播放片段超过 10 万个，超出安全解析限制');
      for (let at = 0; at < data.length; at += stride) {
        const position = d.getUint32(at, true), base = d.getUint16(at + 4, true), index = d.getUint16(at + 6, true), length = d.getUint32(at + 8, true), track = 500 - d.getUint16(at + 12, true);
        let start = d.getUint32(at + 24, true), end = d.getUint32(at + 28, true);
        if (index > base) {
          const sentinels = [0xffffffff, 0xbf800000];
          start = sentinels.includes(start) ? 0 : start; end = sentinels.includes(end) ? start + length : end;
          if (end < start || end - start !== length) { issue(`播放列表裁切窗口与长度不一致：${start}..${end} / ${length}；拒绝猜测`); start = end = 0; }
          const flags = d.getUint16(at + 18, true);
          if ((flags & ~0x8000) !== 64) issue(`未知播放片段 flags=0x${flags.toString(16).padStart(4, '0')}（Pattern ${index - base} / 轨道 ${track} / 源 tick ${position}），静音/播放语义未确认，阻止导出`);
          if (stride === 80 || stride === 88) { const scale = d.getFloat64(at + 64, true); if (scale !== 1) issue(`播放片段缩放 ${scale} 尚不支持`); }
          else if (stride === 60) { const gain = d.getFloat32(at + 52, true); if (gain !== 1) issue(`播放片段增益 ${gain} 尚不支持`); }
          project.clips.push({ pattern: index - base, position, length, offset: start, end, track, muted: false });
        } else project.clips.push({ channel: index, position, length, offset: 0, end: length, track, muted: false });
      }
    } else if (id === 238) {
      if (![44, 66, 70].includes(data.length)) return fail(`未知轨道描述布局：${data.length} 字节（支持 44/66/70）`);
      const track = d.getUint32(0, true), enabled = data[12];
      if (track < 1 || track > 500 || enabled > 1) return fail('轨道编号或静音状态无效');
      if (project.tracks[track] !== undefined && project.tracks[track] !== !!enabled) return fail(`轨道 ${track} 含冲突静音状态，拒绝覆盖`);
      project.tracks[track] = !!enabled; trackLayouts.add(data.length);
      if (d.getUint32(data.length === 44 ? 18 : 22, true)) issue(`轨道 ${track} 使用 Performance motion`);
      if (data[data.length === 44 ? 42 : 46]) { const grouped = metadata.grouped_tracks as number[] | undefined; if (grouped) grouped.push(track); else metadata.grouped_tracks = [track]; }
    } else if (channel) {
      if (id === 0) channel.enabled = !!u;
      else if (id === 21) channel.kind = u;
      else if (id === 203) channel.name = text(data);
      else if (id === 192 && !channel.name) channel.name = text(data);
      else if (id === 196) channel.sample = text(data);
      else if (id === 135) channel.root = u;
      else if (id === 142) channel.fine = d.getInt32(0, true);
      else if (id === 219) {
        if (data.length < 12) return fail('通道 Levels 数据过短');
        channel.pan = d.getInt32(0, true); channel.volume = d.getUint32(4, true); channel.pitch = d.getInt32(8, true);
      } else if (id === 89 && u) channel.issues.push('通道 Time shift 非零');
      else if (id === 97 && u !== 128) channel.issues.push('通道 Swing 系数不是默认 128');
      else if (id === 215) {
        try { channel.sampler = samplerParameters(data); }
        catch (error) { if (!(error instanceof FlpError)) throw error; channel.issues.push(error.message); continue; }
        samplerLayouts.add(data.length); const sampler = channel.sampler;
        if (sampler.arpDirection) channel.issues.push('琶音器改变起音行为');
        if (sampler.addToKey) channel.issues.push('Add to key 模式尚不支持');
        if (sampler.stretchTime || sampler.stretchMultiplier) channel.issues.push('采样时间拉伸尚不支持');
        if (sampler.sampleStart || sampler.sampleStartOffset || sampler.sampleLength !== 1) channel.issues.push('采样起止位置改变；须重新测定原始采样基准');
        if (sampler.formantUnhandled) channel.issues.push('采样器 Formant 不是默认值，尚不支持');
      } else if (id === 209 && data.length >= 20 && d.getUint32(0, true)) channel.issues.push('采样器回声重复');
      else if (id === 221 && data.length >= 9 && data[8] & 1) channel.issues.push('单音/滑音模式');
      else if (id === 218) {
        if (data.length < 48) channel.issues.push('包络数据长度不足');
        else if (envIndex === 4 && (d.getUint32(4, true) || d.getInt32(44, true))) channel.issues.push('Pitch 包络 / LFO 无法保留');
        envIndex++;
      }
    }
  }
  if (Object.keys(project.channels).length !== header.getUint16(10, true)) return fail('通道数与文件头不一致');
  if (!project.clips.length) issue('播放列表为空，没有可转换片段');
  if (arrangements.size > 1) issue('多个 Arrangement：当前不能确定应导出哪个');
  if (project.beatsBar < 1 || project.beatsBar > 16) return fail('源拍号分子无效');
  if (controlSummary.size) metadata.pattern_controller_summary = [...controlSummary.values()];
  if (automation.size) metadata.automation_issues = [...automation];
  metadata.playlist_layouts = [...playlistLayouts].sort((a, b) => a - b);
  metadata.sampler_layouts = [...samplerLayouts].sort((a, b) => a - b);
  metadata.track_layouts = [...trackLayouts].sort((a, b) => a - b);
  project.issues = [...issueSet]; project.warnings = [...warningSet];
  return project;
}
