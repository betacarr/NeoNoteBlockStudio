import { INSTRUMENTS, TRACK_COLORS } from './instruments';
import type { Diagnostic, FlatNote, Note, Pattern, Project, Region, Track } from './types';
import { broadcastForProject, withinBroadcastRange } from '../audio/delivery';
import { audioProfile } from '../audio/profiles';
import { cloneMidiEvent, validStoredMidiMessage } from './midi-events';
import { createMeterMap } from './meter';
import { expandDelayEvents, validateDelayEffect } from './delay';
import { expansionError, loopNoteCycles } from './expansion';

export const uid = (): string => crypto.randomUUID();
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
export const newNote = (tick: number, midi: number, duration = 240): Note => ({ id: uid(), tick, midi, duration, velocity: 0.8, pan: 0, detune: 0, height: 0 });
export const newTrack = (name: string, index = 0, instrumentId = 'harp'): Track => ({
  id: uid(), name, color: TRACK_COLORS[index % TRACK_COLORS.length], instrumentId,
  volume: 1, pan: 0, muted: false, solo: false, locked: false,
});
export function createProject(name = '未命名工程'): Project {
  const now = new Date().toISOString();
  const track = newTrack('钢琴');
  const pattern: Pattern = { id: uid(), name: '片段 01', length: 3840, notes: [] };
  return {
    format: 'nbsx', version: 2, id: uid(), name, author: '', description: '', createdAt: now, modifiedAt: now,
    ppq: 960, tempos: [{ tick: 0, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    tracks: [track], patterns: [pattern], regions: [{ id: uid(), trackId: track.id, patternId: pattern.id, start: 0, length: pattern.length, offset: 0, loop: false }],
    instruments: structuredClone(INSTRUMENTS), assets: [],
    audio: { profileId: 'java-1.16.5', sampleRate: 48000, masterGain: 0.7, directional: false, mode: 'vanilla' },
  };
}
export function createDemo(): Project {
  const p = createProject('玻璃庭院');
  p.description = '内置编辑示例 · 可直接修改、保存或导出';
  p.tempos[0].bpm = 108;
  p.tracks = []; p.patterns = []; p.regions = [];
  const voices = [
    { name: '玻璃旋律', instrument: 'harp', notes: [66, 69, 73, 78, 76, 73, 69, 73, 66, 69, 74, 78, 76, 74, 69, 66], step: 480, duration: 360, velocity: 0.78 },
    { name: '风铃层', instrument: 'chime', notes: [66, 69, 73, 69, 66, 69, 74, 69], step: 960, duration: 720, velocity: 0.42 },
    { name: '低音脉冲', instrument: 'bass', notes: [54, 54, 57, 57, 59, 59, 57, 57], step: 960, duration: 720, velocity: 0.68 },
    { name: '木质节奏', instrument: 'hat', notes: Array(16).fill(66) as number[], step: 480, duration: 120, velocity: 0.3 },
  ];
  voices.forEach((voice, i) => {
    const track = newTrack(voice.name, i, voice.instrument); track.pan = i === 1 ? 0.18 : i === 3 ? -0.25 : 0;
    const pattern = { id: uid(), name: voice.name, length: 7680, notes: voice.notes.map((midi, n) => ({ ...newNote(n * voice.step, midi, voice.duration), velocity: voice.velocity + (n % 4 === 0 ? 0.05 : 0) })) };
    p.tracks.push(track); p.patterns.push(pattern);
    p.regions.push({ id: uid(), trackId: track.id, patternId: pattern.id, start: 0, length: 15360, offset: 0, loop: true });
  });
  return p;
}
export function flattenNotes(project: Project, includeMuted = false): FlatNote[] {
  const error = expansionError(project, includeMuted); if (error) throw new Error(error);
  const output: FlatNote[] = [];
  const solo = project.tracks.some(t => t.solo);
  const patterns = new Map(project.patterns.map(p => [p.id, p]));
  const tracks = new Map(project.tracks.map(t => [t.id, t]));
  const order = new Map(project.regions.map((region, index) => [region.id, { region, index, period: Math.max(1, patterns.get(region.patternId)?.length ?? 1) }]));
  for (const region of project.regions) {
    const track = tracks.get(region.trackId), pattern = patterns.get(region.patternId);
    if (!track || !pattern || (!includeMuted && (track.muted || (solo && !track.solo)))) continue;
    const period = Math.max(1, pattern.length);
    for (const note of pattern.notes) {
      const { first, last } = region.loop ? loopNoteCycles(note.tick, period, region.offset, region.length) : { first: 0, last: 0 };
      for (let cycle = first; cycle <= last; cycle++) {
        const local = note.tick + cycle * period - region.offset;
        if (local < 0 || local >= region.length) continue;
        output.push({ ...note, trackId: track.id, regionId: region.id, patternId: pattern.id,
          absoluteTick: region.start + local, gain: note.velocity * track.volume,
          effectivePan: clamp(note.pan + track.pan, -1, 1), effectiveInstrument: note.instrumentId ?? track.instrumentId });
        if (output.length > 2000000) throw new Error('展开后的音符超过 200 万个，请缩短循环范围。');
      }
    }
  }
  // Keep the former region -> cycle -> source order for coincident unisons.
  const cycleOf = (note: FlatNote, value: { region: Region; period: number }) => value.region.loop ? Math.round((note.absoluteTick - value.region.start + value.region.offset - note.tick) / value.period) : 0;
  return output.sort((a, b) => {
    const timePitch = a.absoluteTick - b.absoluteTick || a.midi - b.midi; if (timePitch) return timePitch;
    const left = order.get(a.regionId)!, right = order.get(b.regionId)!;
    return left.index - right.index || cycleOf(a, left) - cycleOf(b, right);
  });
}
export function projectEnd(project: Project): number {
  return project.regions.reduce((end, region) => Math.max(end, region.start + region.length), 0) || createMeterMap(project).at(0).barEnd;
}
export function renderNoteEvents(project: Project, includeMuted = false) {
  return expandDelayEvents(project, flattenNotes(project, includeMuted));
}
export function duplicateRegion(project: Project, regionId: string): Region | undefined {
  const region = project.regions.find(r => r.id === regionId);
  const pattern = project.patterns.find(p => p.id === region?.patternId);
  if (!region || !pattern) return;
  const clone = { ...pattern, id: uid(), name: `${pattern.name} 副本`, notes: pattern.notes.map(n => ({ ...n, id: uid(), ...(n.midiSource ? { midiSource: { ...n.midiSource } } : {}) })),
    ...(pattern.midiEvents ? { midiEvents: pattern.midiEvents.map(event => ({ ...event, id: uid(), event: cloneMidiEvent(event.event) })) } : {}) };
  project.patterns.push(clone);
  const copy = { ...region, id: uid(), patternId: clone.id, start: region.start + region.length };
  project.regions.push(copy); return copy;
}
export function validateProject(value: unknown): Project {
  if (!value || typeof value !== 'object') throw new Error('工程内容不是有效对象。');
  const p = value as Project;
  if (p.format !== 'nbsx' || p.version !== 2) throw new Error('不支持的 NBSX 工程版本。');
  const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!finite(p.ppq, 1, 32767) || !Number.isInteger(p.ppq)) throw new Error('工程时间分辨率无效。');
  for (const field of ['tracks', 'patterns', 'regions', 'tempos', 'timeSignatures', 'instruments', 'assets'] as const) if (!Array.isArray(p[field])) throw new Error(`工程缺少 ${field}。`);
  if (p.tracks.length > 10000 || p.patterns.length > 100000 || p.regions.length > 100000) throw new Error('工程对象数量超过安全上限。');
  const ids = new Set<string>();
  const addId = (id: unknown) => { if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('工程含有缺失或重复的对象 ID。'); ids.add(id); };
  if (!p.tempos.length || !p.tempos.some(t => t.tick === 0)) throw new Error('工程缺少起始速度。');
  for (const tempo of p.tempos) if (!finite(tempo.tick, 0, 1e12) || !finite(tempo.bpm, 0.01, 10000)) throw new Error('工程速度事件无效。');
  for (const ts of p.timeSignatures) if (!finite(ts.tick, 0, 1e12) || !Number.isInteger(ts.numerator) || !finite(ts.numerator, 1, 255) || !finite(ts.denominator, 1, 32768) || Math.log2(ts.denominator) % 1 !== 0 || (ts.metronome !== undefined && (!Number.isInteger(ts.metronome) || !finite(ts.metronome, 0, 255))) || (ts.thirtyseconds !== undefined && (!Number.isInteger(ts.thirtyseconds) || !finite(ts.thirtyseconds, 0, 255)))) throw new Error('工程拍号无效。');
  const instrumentIds = new Set<string>(), trackIds = new Set<string>(), patternIds = new Set<string>();
  for (const ins of p.instruments) { addId(ins.id); instrumentIds.add(ins.id); if (!finite(ins.rootMidi, 0, 127)) throw new Error('乐器基准音高无效。'); }
  for (const track of p.tracks) { addId(track.id); trackIds.add(track.id); if (!instrumentIds.has(track.instrumentId) || !finite(track.volume, 0, 4) || !finite(track.pan, -1, 1) || (track.midiChannel !== undefined && (!Number.isInteger(track.midiChannel) || !finite(track.midiChannel, 0, 15))) || (track.sourceMidiTrack !== undefined && (!Number.isInteger(track.sourceMidiTrack) || !finite(track.sourceMidiTrack, 0, 65535)))) throw new Error('轨道参数无效。'); if (track.delay !== undefined && !validateDelayEffect(track.delay)) throw new Error('轨道 Delay 参数无效。'); }
  let totalMidiEvents = 0;
  const validateMidiEvents = (events: import('./types').StoredMidiEvent[]) => {
    if (!Array.isArray(events) || (totalMidiEvents += events.length) > 2000000) throw new Error('MIDI 消息数量过多。');
    for (const event of events) { addId(event.id); if (!finite(event.tick, 0, 1e12) || !Number.isInteger(event.order) || !finite(event.order, 0, 1e12) || (event.sourceTrack !== undefined && (!Number.isInteger(event.sourceTrack) || !finite(event.sourceTrack, 0, 65535))) || !validStoredMidiMessage(event.event)) throw new Error('工程包含无效 MIDI 消息。'); }
  };
  let totalNotes = 0;
  for (const pattern of p.patterns) {
    addId(pattern.id);
    patternIds.add(pattern.id);
    if (!Array.isArray(pattern.notes) || !finite(pattern.length, 1, 1e12) || (totalNotes += pattern.notes.length) > 2000000) throw new Error('片段内容无效或音符过多。');
    if (pattern.midiEvents !== undefined) validateMidiEvents(pattern.midiEvents);
    for (const note of pattern.notes) {
      addId(note.id);
      if (!finite(note.tick, 0, 1e12) || !finite(note.duration, 0, 1e12) || !finite(note.midi, 0, 127) || !Number.isInteger(note.midi) || !finite(note.velocity, 0, 1) || !finite(note.pan, -1, 1) || !finite(note.detune, -32768, 32767) || !finite(note.height, -64, 64) || (note.instrumentId && !instrumentIds.has(note.instrumentId))) throw new Error('工程包含无效音符参数。');
      if (note.midiSource && (![note.midiSource.onOrder, note.midiSource.offOrder, note.midiSource.releaseVelocity].every(Number.isInteger) || !finite(note.midiSource.onOrder, 0, 1e12) || !finite(note.midiSource.offOrder, 0, 1e12) || !finite(note.midiSource.releaseVelocity, 0, 127) || (note.midiSource.offSourceTrack !== undefined && (!Number.isInteger(note.midiSource.offSourceTrack) || !finite(note.midiSource.offSourceTrack, 0, 65535))))) throw new Error('音符 MIDI 来源信息无效。');
    }
  }
  for (const asset of p.assets) { addId(asset.id); if (!/^[\w-]+$/.test(asset.id) || typeof asset.name !== 'string' || typeof asset.mime !== 'string') throw new Error('资源信息无效。'); }
  if (p.midi) { if (p.midi.schema !== 1 || ![0, 1].includes(p.midi.format) || !p.assets.some(asset => asset.id === p.midi?.sourceAssetId && asset.mime === 'audio/midi') || (p.midi.sourceTrackNames !== undefined && (!Array.isArray(p.midi.sourceTrackNames) || p.midi.sourceTrackNames.length > 10000 || !p.midi.sourceTrackNames.every(name => typeof name === 'string')))) throw new Error('MIDI 原始文件引用无效。'); validateMidiEvents(p.midi.conductor); }
  if (p.provenance?.kind === 'flp' && (typeof p.provenance.metadata?.sourceAssetId !== 'string' || !p.assets.some(asset => asset.id === p.provenance!.metadata.sourceAssetId && asset.mime === 'application/x-fl-studio-project'))) throw new Error('FLP 原始文件引用无效。');
  for (const region of p.regions) {
    addId(region.id);
    if (!trackIds.has(region.trackId) || !patternIds.has(region.patternId) || !finite(region.start, 0, 1e12) || !finite(region.length, 1, 1e12) || !finite(region.offset, 0, 1e12) || region.midiEndExclusive !== undefined && typeof region.midiEndExclusive !== 'boolean') throw new Error('片段引用或范围无效。');
  }
  if (!p.audio || !finite(p.audio.masterGain, 0, 2) || ![22050, 44100, 48000, 96000].includes(p.audio.sampleRate) || !['vanilla', 'studio'].includes(p.audio.mode)) throw new Error('声音设置无效。');
  if (typeof p.name !== 'string' || typeof p.id !== 'string') throw new Error('工程名称或标识无效。');
  return p;
}
export function projectDiagnostics(project: Project): Diagnostic[] {
  let dryNotes: FlatNote[];
  try { dryNotes = flattenNotes(project); }
  catch (error) { return [{ severity: 'error', code: 'note-expansion-limit', message: error instanceof Error ? error.message : '音符展开超限，请缩短片段范围后重试。' }]; }
  let notes = dryNotes;
  const warnings: Diagnostic[] = [];
  try {
    const plan = expandDelayEvents(project, dryNotes);
    notes = plan.notes; warnings.push(...plan.diagnostics);
  } catch (error) {
    warnings.push({ severity: 'error', code: 'delay-event-limit', message: error instanceof Error ? error.message : 'Delay 事件无法完整展开，请调整效果参数。' });
  }
  const broadcast = broadcastForProject(project);
  const unheard = notes.filter(note => !withinBroadcastRange(note.effectivePan * 2, note.height, -2, broadcast)).length;
  if (unheard) warnings.push({ severity: 'warning', code: 'world-delivery-range', message: `${unheard} 个音符超出该版本对站立听音位置的声音发送范围，游戏预览会静音；完整试听模式可保留声音。` });
  const outOfRange = notes.filter(n => n.midi + n.detune / 100 < 54 || n.midi + n.detune / 100 > 78);
  if (outOfRange.length) warnings.push({ severity: 'warning', code: 'pitch-range', message: `${outOfRange.length} 个音符超出原版音符盒音域，需要资源包或模组支持；编辑器实时试听仍按实际音高播放。` });
  const grouped = new Map<number, number>();
  for (const n of notes) grouped.set(n.absoluteTick, (grouped.get(n.absoluteTick) ?? 0) + 1);
  let largestChord = 0; for (const count of grouped.values()) largestChord = Math.max(largestChord, count);
  if (largestChord > audioProfile(project.audio.profileId).voiceWarning) warnings.push({ severity: 'warning', code: 'voice-pressure', message: `单时刻最多 ${largestChord} 个音符，目标版本可能出现声音压力；编辑器继续完整试听。` });
  const missing = new Set(notes.filter(n => !project.instruments.find(i => i.id === n.effectiveInstrument)).map(n => n.effectiveInstrument));
  if (missing.size) warnings.push({ severity: 'error', code: 'missing-instrument', message: '工程存在缺失乐器。' });
  return warnings;
}
