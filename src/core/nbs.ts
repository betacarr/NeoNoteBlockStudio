import { createProject, clamp, renderNoteEvents, newNote, newTrack, uid } from './project';
import { INSTRUMENTS } from './instruments';
import { secondsToTick, createTempoMap, sortedTempos } from './time';
import { nbsExportTiming, type NbsTempoPreset } from './nbs-export-timing';
import type { Diagnostic, FlatNote, Project } from './types';

class Reader {
  offset = 0; view: DataView;
  constructor(public bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  require(n: number) { if (this.offset + n > this.bytes.length) throw new Error(`NBS 文件在字节 ${this.offset} 处意外结束。`); }
  u8() { this.require(1); return this.view.getUint8(this.offset++); }
  u16() { this.require(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { this.require(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  i32() { this.require(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  str() {
    const length = this.i32();
    if (length < 0 || length > 16 * 1024 * 1024) throw new Error('NBS 字符串长度无效。');
    this.require(length); const bytes = this.bytes.subarray(this.offset, this.offset + length); this.offset += length;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('windows-1252').decode(bytes); }
  }
}
class Writer {
  chunks: number[] = [];
  u8(n: number) { this.chunks.push(n & 255); }
  u16(n: number) { this.u8(n); this.u8(n >> 8); }
  i32(n: number) { this.u16(n); this.u16(n >> 16); }
  str(text: string) { const bytes = new TextEncoder().encode(text); this.i32(bytes.length); for (const byte of bytes) this.u8(byte); }
  finish() { return Uint8Array.from(this.chunks); }
}
interface RawNote { tick: number; layer: number; instrument: number; key: number; velocity: number; pan: number; detune: number }
interface RawLayer { name: string; locked: boolean; solo: boolean; volume: number; pan: number }

export function importNbs(bytes: Uint8Array, filename: string): { project: Project; diagnostics: Diagnostic[] } {
  if (bytes.length > 128 * 1024 * 1024) throw new Error('NBS 文件过大。');
  const r = new Reader(bytes);
  const first = r.u16(), version = first === 0 ? r.u8() : 0;
  if (version > 6) throw new Error(`尚不支持 NBS v${version}。`);
  const builtinCount = version ? r.u8() : 10;
  if (builtinCount > 255) throw new Error('NBS 内置乐器数量无效。');
  const declaredLength = version >= 3 ? r.u16() : first;
  const layerCount = r.u16();
  if (layerCount > 32767) throw new Error('NBS 层数过大。');
  const name = r.str(), author = r.str(), originalAuthor = r.str(), description = r.str();
  const tempo = r.u16() / 100;
  if (tempo <= 0) throw new Error('NBS 速度必须大于零。');
  const autoSave = r.u8(), autoSaveMinutes = r.u8(), signature = r.u8();
  const minutesSpent = r.i32(), leftClicks = r.i32(), rightClicks = r.i32(), added = r.i32(), removed = r.i32();
  const importedFilename = r.str();
  const loop = version >= 4 ? { enabled: r.u8(), count: r.u8(), start: r.u16() } : { enabled: 0, count: 0, start: 0 };
  const rawNotes: RawNote[] = []; let tick = -1;
  while (true) {
    const jump = r.u16(); if (!jump) break; tick += jump;
    let layer = -1;
    while (true) {
      const layerJump = r.u16(); if (!layerJump) break; layer += layerJump;
      if (layer >= layerCount || rawNotes.length >= 2000000) throw new Error('NBS 音符层引用无效或音符数量过大。');
      const instrument = r.u8(), key = r.u8();
      const velocity = version >= 4 ? r.u8() : 100, pan = version >= 4 ? r.u8() : 100, detune = version >= 4 ? r.i16() : 0;
      if (key > 87 || velocity > 100 || pan > 200) throw new Error('NBS 音符参数超出格式范围。');
      rawNotes.push({ tick, layer, instrument, key, velocity, pan, detune });
    }
  }
  const layers: RawLayer[] = [];
  if (r.offset < bytes.length) for (let i = 0; i < layerCount; i++) {
    const name = r.str(), state = version >= 4 ? r.u8() : 0;
    if (state > 2) throw new Error(`NBS 层状态 ${state} 不受支持，无法安全转换。`);
    layers.push({ name, locked: state === 1, solo: state === 2, volume: r.u8(), pan: version >= 2 ? r.u8() : 100 });
  }
  const custom: { name: string; soundFile: string; key: number; pressKey: number }[] = [];
  if (r.offset < bytes.length) {
    const count = r.u8();
    for (let i = 0; i < count; i++) {
      const ins = { name: r.str(), soundFile: r.str(), key: r.u8(), pressKey: r.u8() };
      if (ins.key > 87) throw new Error('NBS 自定义乐器调音参数无效。'); custom.push(ins);
    }
  }
  const p = createProject(name || filename.replace(/\.nbs$/i, ''));
  p.author = author; p.description = description;
  // An NBS tick is a musical subdivision, not necessarily a Minecraft game tick.
  const tickScale = p.ppq / 4;
  p.tempos = [{ tick: 0, bpm: tempo * 15 }];
  p.timeSignatures = [{ tick: 0, numerator: clamp(signature || 4, 1, 8), denominator: 4 }];
  p.tracks = []; p.patterns = []; p.regions = [];
  // NBS's sound-key is a transposition, not the MIDI root of a sampler.
  // OpenNBS plays 2^((note_key + sound_key - 90) / 12); convert conventions.
  custom.forEach((ins, i) => p.instruments.push({ id: `custom-${uid()}`, name: ins.name, englishName: ins.name, rootMidi: 111 - ins.key,
    nbsIndex: builtinCount + i, block: '自定义采样', color: '#b5a0d0', gmProgram: 0,
    assetId: `external-${i}`, sound: ins.soundFile }));
  custom.forEach((ins, i) => p.assets.push({ id: `external-${i}`, name: ins.soundFile, mime: 'audio/ogg', path: ins.soundFile }));
  const instrumentId = (index: number): string => index < builtinCount ? INSTRUMENTS[index]?.id ?? 'harp' : p.instruments[INSTRUMENTS.length + index - builtinCount]?.id ?? 'harp';
  const songLength = Math.max(declaredLength, tick + 1, 1) * tickScale;
  const tempoEvents = rawNotes.filter(n => n.instrument >= builtinCount && custom[n.instrument - builtinCount]?.name === 'Tempo Changer');
  // OpenNBS executes functional events even on muted/non-solo layers, in
  // ascending layer order. Only the final event in a column sets its tempo.
  const effectiveTempoEvents = new Map(tempoEvents.map(event => [event.tick, event]));
  for (const event of effectiveTempoEvents.values()) {
    const bpm = Math.abs(event.detune);
    if (bpm === 0) throw new Error(`NBS tick ${event.tick} 的 Tempo Changer 设置了零速度（0 BPM），当前工程不支持零速度停顿，无法安全转换。${version < 4 ? '该旧版 NBS 没有 fine pitch 字段，不能从中恢复非零速度。' : ''}`);
    if (bpm > 10000) throw new Error(`NBS tick ${event.tick} 的 Tempo Changer 速度为 ${bpm} BPM，超出当前 NBSX 可保存并重新打开的上限 10000 BPM；无法安全转换。`);
    const at = event.tick * tickScale; p.tempos = p.tempos.filter(t => t.tick !== at); p.tempos.push({ tick: at, bpm });
  }
  p.tempos.sort((a, b) => a.tick - b.tick);
  const tempoEventSet = new Set(tempoEvents);
  const notesByLayer = Array.from({ length: layerCount }, () => [] as RawNote[]);
  for (const note of rawNotes) if (!tempoEventSet.has(note)) notesByLayer[note.layer].push(note);
  for (let i = 0; i < layerCount; i++) {
    const layer = layers[i] ?? { name: '', locked: false, solo: false, volume: 100, pan: 100 };
    const sourceNotes = notesByLayer[i];
    const track = newTrack(layer.name || `NBS 层 ${i + 1}`, i, instrumentId(sourceNotes[0]?.instrument ?? 0));
    track.volume = clamp(layer.volume / 100, 0, 1); track.pan = clamp((layer.pan - 100) / 100, -1, 1);
    // OpenNBS's source state 1 also suppresses playback. Editor-only locks
    // remain independent of mute everywhere else in the project model.
    track.locked = layer.locked; track.muted = layer.locked; track.solo = layer.solo;
    const pattern = { id: uid(), name: track.name, length: songLength,
      notes: sourceNotes.map(n => ({ ...newNote(n.tick * tickScale, n.key + 21, tickScale), velocity: n.velocity / 100,
        pan: (n.pan - 100) / 100, detune: n.detune, instrumentId: instrumentId(n.instrument) })) };
    // Preserve the legacy effective pan while using additive track pan in the new editor.
    if (layer.pan !== 100) for (const note of pattern.notes) note.pan = clamp(((layer.pan + (note.pan * 100 + 100)) / 2 - 100) / 100 - track.pan, -1, 1);
    p.tracks.push(track); p.patterns.push(pattern); p.regions.push({ id: uid(), trackId: track.id, patternId: pattern.id, start: 0, length: songLength, offset: 0, loop: false });
  }
  if (!p.tracks.length) { const blank = createProject(p.name); p.tracks = blank.tracks; p.patterns = blank.patterns; p.regions = blank.regions; }
  p.provenance = { kind: 'nbs', filename, metadata: { version, builtinCount, originalAuthor, autoSave, autoSaveMinutes, minutesSpent, leftClicks, rightClicks, added, removed, importedFilename, loop, layers, custom, declaredLength, functionalEvents: tempoEvents } };
  const diagnostics: Diagnostic[] = [];
  if (layers.some(layer => layer.locked)) diagnostics.push({ severity: 'info', code: 'nbs-layer-state', message: '原 NBS 的“锁定”层在 OpenNBS 中也静音，已同时映射为编辑锁定和静音；本编辑器单独设置编辑锁时不会自动静音。' });
  const customSounds = custom.filter(i => i.name !== 'Tempo Changer');
  if (customSounds.length) diagnostics.push({ severity: 'warning', code: 'nbs-custom-samples', message: `${customSounds.length} 个自定义乐器需要定位原始声音文件；NBS 文件本身不包含采样。` });
  if (loop.enabled) diagnostics.push({ severity: 'info', code: 'nbs-song-loop', message: '已保留原 NBS 的整曲循环设置；片段循环可在新工程中单独设置。' });
  if (tempoEvents.length) diagnostics.push({ severity: 'info', code: 'nbs-tempo-events', message: `已将 ${tempoEvents.length} 个 Tempo Changer 事件转换为工程速度变化。` });
  if (custom.some(i => /sound.?stopper/i.test(i.name))) diagnostics.push({ severity: 'warning', code: 'nbs-special-events', message: '检测到可能表达止音的特殊乐器，当前保留原始事件；请核对试听与转换结果。' });
  return { project: p, diagnostics };
}

interface MusicalFraction { numerator: bigint; denominator: bigint }
const musicalGcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; while (b) { const next = a % b; a = b; b = next; } return a; };
function musicalFraction(numerator: bigint, denominator = 1n): MusicalFraction {
  const common = musicalGcd(numerator, denominator);
  return { numerator: numerator / common, denominator: denominator / common };
}
/** Match the saved decimal convention in time.ts, without accumulating tempo denominators. */
function musicalDecimal(value: number): MusicalFraction {
  if (!Number.isFinite(value)) throw new Error('NBS 音乐网格需要有限的时间参数。');
  if (Number.isSafeInteger(value)) return { numerator: BigInt(value), denominator: 1n };
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, decimals = ''] = mantissa.split('.'), exponent = Number(exponentText ?? 0) - decimals.length;
  const digits = BigInt(whole + decimals);
  return exponent >= 0 ? { numerator: digits * 10n ** BigInt(exponent), denominator: 1n } : musicalFraction(digits, 10n ** BigInt(-exponent));
}
function addMusical(a: MusicalFraction, b: MusicalFraction): MusicalFraction {
  const common = musicalGcd(a.denominator, b.denominator), left = b.denominator / common, right = a.denominator / common;
  return musicalFraction(a.numerator * left + b.numerator * right, a.denominator * left);
}
const musicalNumber = (value: MusicalFraction): number => {
  const direct = Number(value.numerator) / Number(value.denominator);
  return Number.isFinite(direct) ? direct : Number(value.numerator * 10n ** 20n / value.denominator) / 1e20;
};
function musicalGridPosition(value: MusicalFraction, grid: number, ppq: number, geometryError = 0) {
  const numerator = value.numerator * BigInt(grid), denominator = value.denominator * BigInt(ppq);
  if (numerator < 0n) throw new Error('NBS 音符或速度事件的开始时间不能为负数。');
  const tick = Number(numerator / denominator), remainder = numerator % denominator;
  // A split stores start and offset as separate doubles. Their construction can
  // leave a sub-ULP residue at an integer grid boundary. Only composed region
  // geometry gets this bound; direct note/tempo positions retain strict floor.
  const tolerance = geometryError * grid / ppq;
  if (remainder && tolerance > 0 && tolerance < .5) {
    const bound = musicalDecimal(tolerance);
    if ((denominator - remainder) * bound.denominator <= bound.numerator * denominator) return { tick: tick + 1, quantized: false, sourceTick: (tick + 1) * ppq / grid, corrected: true };
    if (remainder * bound.denominator <= bound.numerator * denominator) return { tick, quantized: false, sourceTick: tick * ppq / grid, corrected: true };
  }
  return { tick, quantized: remainder !== 0n, sourceTick: musicalNumber(value), corrected: false };
}
function musicalNotePositions(project: Project, grid: number) {
  const patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]));
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const tempos = sortedTempos(project.tempos);
  const regions = new Map(project.regions.map(region => [region.id, {
    region, period: Math.max(1, patterns.get(region.patternId)?.length ?? 1),
    base: addMusical(musicalDecimal(region.start), musicalDecimal(-region.offset)),
  }]));
  return (note: FlatNote) => {
    const entry = regions.get(note.regionId);
    if (!entry) throw new Error('NBS 音符引用的来源片段不存在。');
    const occurrence = note.delaySource?.occurrenceTick ?? note.absoluteTick;
    // flattenNotes' floating occurrence identifies the integer cycle only. All
    // placement arithmetic below uses the original independently saved values.
    const cycle = entry.region.loop ? Math.round((occurrence - entry.region.start + entry.region.offset - note.tick) / entry.period) : 0;
    let tick = addMusical(entry.base, musicalDecimal(note.tick));
    const ulpBound = (value: number) => Math.abs(value) * Number.EPSILON;
    let geometryError = (ulpBound(entry.region.start) + ulpBound(entry.region.offset)) * 2;
    if (cycle) {
      const period = musicalDecimal(entry.period);
      tick = addMusical(tick, { numerator: period.numerator * BigInt(cycle), denominator: period.denominator });
      geometryError += (ulpBound(entry.period) * cycle + ulpBound(entry.period * cycle)) * 2;
    }
    if (note.delaySource) {
      const effect = tracks.get(note.trackId)?.delay;
      if (effect?.timeUnit === 'beats') {
        const interval = musicalDecimal(effect.interval);
        tick = addMusical(tick, { numerator: interval.numerator * BigInt(note.delaySource.tap) * BigInt(project.ppq), denominator: interval.denominator });
      } else {
        // Within one tempo segment, reconstruct the seconds delay from saved
        // interval/BPM rather than flooring the round-trip seconds->tick error.
        // Cross-segment echoes retain the engine's actual piecewise location.
        let low = 0, high = tempos.length;
        while (low < high) { const middle = Math.floor((low + high) / 2); if (tempos[middle].tick <= occurrence) low = middle + 1; else high = middle; }
        const index = Math.max(0, low - 1), next = tempos[index + 1];
        if (effect && (!next || note.absoluteTick < next.tick)) {
          const interval = musicalDecimal(effect.interval), bpm = musicalDecimal(tempos[index].bpm);
          tick = addMusical(tick, musicalFraction(interval.numerator * BigInt(note.delaySource.tap) * BigInt(project.ppq) * bpm.numerator, interval.denominator * bpm.denominator * 60n));
        } else { tick = musicalDecimal(note.absoluteTick); geometryError = 0; }
      }
    }
    return musicalGridPosition(tick, grid, project.ppq, geometryError);
  };
}

/** Numbers retain the legacy absolute-time grid; presets preserve musical spacing. */
export function exportNbs(project: Project, version: 4 | 5 | 6 = 5, timingMode: number | NbsTempoPreset = 20): { bytes: Uint8Array; diagnostics: Diagnostic[] } {
  const musical = typeof timingMode === 'string', grid = timingMode === 'bpm-5' ? 12 : 8;
  if (musical && (!Number.isInteger(project.ppq) || project.ppq < 1 || project.ppq > 32767)) throw new Error('NBS 音乐网格需要 1～32767 范围内的整数 PPQ。');
  const ticksPerSecond = musical ? nbsExportTiming(project, timingMode).ticksPerSecond : timingMode;
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond < 0.01 || ticksPerSecond > 327.67) throw new Error('NBS 速度必须在 0.01～327.67 tick/s 之间。');
  if (musical && sortedTempos(project.tempos)[0].bpm * grid / 60 < .25) throw new Error('Note Block Studio 实际播放最低速度为 0.25 tick/s；当前 BPM 在所选音乐网格中过慢，无法按原速度播放。');
  const tempo = Math.round(ticksPerSecond * 100) / 100;
  const plan = renderNoteEvents(project);
  const diagnostics: Diagnostic[] = [...plan.diagnostics];
  const notes = plan.notes;
  const position = musical ? musicalNotePositions(project, grid) : undefined;
  const sourceTempos = musical ? sortedTempos(project.tempos).filter((event, index, all) => !index || event.bpm !== all[index - 1].bpm) : [];
  const usesTempoChanger = sourceTempos.length > 1;
  const tempoNotes = new Map<number, { tick: number; pitch: number }>();
  let tempoPositionQuantized = 0, tempoRateQuantized = 0;
  const effectiveTempos = new Map<number, { at: ReturnType<typeof musicalGridPosition>; bpm: number }>();
  if (usesTempoChanger) for (const event of sourceTempos) {
    const at = musicalGridPosition(musicalDecimal(event.tick), grid, project.ppq);
    if (at.quantized) tempoPositionQuantized++;
    effectiveTempos.set(at.tick, { at, bpm: event.bpm });
  }
  for (const event of effectiveTempos.values()) {
    const { at } = event, bpm = musicalDecimal(event.bpm);
    const numerator = bpm.numerator * BigInt(grid), denominator = bpm.denominator * 4n;
    const pitch = Number(numerator / denominator);
    if (pitch < 1 || pitch > 32767) throw new Error('Tempo Changer 的整数速度必须在 1～32767 之间；当前 BPM 无法在所选 NBS 音乐网格中保存。');
    // The original control_draw playback loop clamps tempo below .25 TPS.
    if (pitch < 4) throw new Error('Note Block Studio 实际播放最低速度为 0.25 tick/s，Tempo Changer 的整数速度至少需要 4；当前速度无法按原速播放。');
    if (pitch > 10000) throw new Error('Tempo Changer 换算后的速度超过 NBSX 可重新导入的 10000 BPM 上限；请调整速度或选择其他网格。');
    if (numerator % denominator) tempoRateQuantized++;
    // The original importer overwrites an earlier functional note in the same column.
    tempoNotes.set(at.tick, { tick: at.tick, pitch });
  }
  if (musical) {
    const initial = musicalDecimal(sourceTempos[0].bpm);
    if (initial.numerator * BigInt(grid) * 100n % (initial.denominator * 60n)) diagnostics.push({ severity: 'warning', code: 'nbs-header-tempo-precision', message: `NBS 文件头只能保存两位小数 tick/s，起始速度已保存为 ${tempo} tick/s；音符位置仍独立按每拍 ${grid} 格映射。` });
    if (usesTempoChanger) diagnostics.push({ severity: 'warning', code: 'nbs-tempo-changer', message: '速度变化已写为 Tempo Changer 功能音符，音符保持音乐网格位置；游戏及部分 NBS 播放器不支持此功能，可能只按文件头速度播放。' });
    if (tempoRateQuantized) diagnostics.push({ severity: 'warning', code: 'nbs-tempo-changer-precision', message: `${tempoRateQuantized} 个速度事件不能以 Tempo Changer 的整数 fine pitch 精确表示，已按 Note Block Studio 规则向下取整；音符未为此移动。` });
    if (tempoPositionQuantized) diagnostics.push({ severity: 'warning', code: 'nbs-tempo-position-quantization', message: `${tempoPositionQuantized} 个速度事件未落在每拍 ${grid} 格的整数位置，已向下取整；同一格以最后一个速度事件为准。` });
  }
  if (plan.generated) diagnostics.push({ severity: 'info', code: 'nbs-delay-baked', message: `Delay 已展开为 ${plan.generated} 个实际回声音符；原始 MIDI 音符与效果参数保留在 NBSX 工程中。` });
  const silentEchoes = notes.filter(note => note.delaySource && Math.round(clamp(note.gain, 0, 1) * 100) === 0).length;
  if (silentEchoes) diagnostics.push({ severity: 'warning', code: 'nbs-delay-volume-quantization', message: `${silentEchoes} 个较轻的回声音符在 NBS 整数力度网格上为 0；可调高回声力度或缩短尾音。` });
  const timing = createTempoMap(project);
  const hasSolo = project.tracks.some(track => track.solo);
  if (project.tracks.some(track => track.muted || (hasSolo && !track.solo))) diagnostics.push({ severity: 'warning', code: 'nbs-audible-tracks', message: 'NBS 导出按当前试听混音生成：静音或未独奏轨道中的音符未写入；完整轨道内容仍保留在 NBSX 工程中。' });
  const sourceLoop = project.provenance?.kind === 'nbs' ? project.provenance.metadata.loop : undefined;
  if (sourceLoop && typeof sourceLoop === 'object' && 'enabled' in sourceLoop && sourceLoop.enabled) diagnostics.push({ severity: 'warning', code: 'nbs-song-loop-loss', message: '当前 NBS 导出关闭原文件的整曲循环，循环次数和起点未写入；这些来源设置仍保留在 NBSX 中。' });
  const supportedMidi = ['programChange', 'endOfTrack', 'trackName', 'instrumentName', 'portPrefix', 'channelPrefix', ...(musical ? ['setTempo', 'timeSignature'] : [])];
  const unsupportedMidi = (type: string) => !supportedMidi.includes(type);
  if ((project.midi?.conductor ?? []).some(message => unsupportedMidi(message.event.type)) || project.patterns.some(pattern => pattern.midiEvents?.some(message => unsupportedMidi(message.event.type)))) diagnostics.push({ severity: 'warning', code: 'nbs-midi-messages', message: 'NBS 不支持 MIDI 控制器、弯音、触后、SysEx 和歌词等附加消息；导出使用编辑器的离散音符参数，完整来源保留在 NBSX 中。' });
  if (project.timeSignatures.length > 1 || project.timeSignatures.some(meter => meter.denominator !== 4 || meter.numerator < 2 || meter.numerator > 8)) diagnostics.push({ severity: 'warning', code: 'nbs-meter', message: 'NBS 拍号元数据无法完整表达当前拍号或其变化；音符起音时间仍按工程速度转换。' });
  const builtinCount = version >= 6 ? 20 : 16;
  const usedIds = new Set(notes.map(n => n.effectiveInstrument));
  // Imported nbsIndex belongs to the source file's built-in table. A custom
  // instrument at 10/16 must stay custom when a newer target adds built-ins.
  const builtinIndices = new Map(INSTRUMENTS.filter(i => i.nbsIndex !== undefined && i.nbsIndex < builtinCount).map(i => [i.id, i.nbsIndex!]));
  const sampledBuiltins = project.instruments.filter(i => usedIds.has(i.id) && builtinIndices.has(i.id) && i.assetId);
  if (sampledBuiltins.length) diagnostics.push({ severity: 'warning', code: 'nbs-builtin-sample', message: `${sampledBuiltins.length} 个已使用的内置乐器关联了工程采样。接收端仍使用 NBS 内置采样，这些采样关联不会写入 NBS；工程替换采样保留在 NBSX 中。如需接收端使用替换声音，请改用自定义乐器并提供相应声音文件。` });
  const custom = project.instruments.filter(i => usedIds.has(i.id) && !builtinIndices.has(i.id));
  if (musical && custom.some(instrument => instrument.name === 'Tempo Changer')) throw new Error('已使用的自定义声音乐器名为 Tempo Changer，与 NBS 功能乐器冲突；请先重命名该声音乐器。');
  const limit = version === 4 ? 18 : 256 - builtinCount;
  if (custom.length + Number(usesTempoChanger) > limit) throw new Error(`NBS v${version} 最多支持 ${limit} 个自定义乐器（含 Tempo Changer）；请选择其他版本或减少乐器。`);
  const instrumentIndices = new Map(builtinIndices);
  custom.forEach((i, n) => instrumentIndices.set(i.id, builtinCount + n));
  const notesByTrack = new Map<string, typeof notes>();
  for (const note of notes) {
    const trackNotes = notesByTrack.get(note.trackId);
    if (trackNotes) trackNotes.push(note); else notesByTrack.set(note.trackId, [note]);
  }
  const rows: { name: string; notes: { tick: number; key: number; velocity: number; pan: number; pitch: number; instrument: number }[] }[] = [];
  if (usesTempoChanger) rows.push({ name: 'Tempo Changer', notes: [...tempoNotes.values()].map(event => ({ ...event, key: 39, velocity: 100, pan: 100, instrument: builtinCount + custom.length })) });
  let maxError = 0, clipped = 0, quantizedNotes = 0, correctedNotes = 0;
  for (const track of project.tracks) {
    const lanes: typeof rows = [];
    const columns = new Map<number, number>();
    for (const note of notesByTrack.get(track.id) ?? []) {
      const source = position?.(note), seconds = timing.seconds(note.absoluteTick), tick = source ? source.tick : Math.round(seconds * tempo);
      if (source) {
        if (source.quantized) quantizedNotes++;
        if (source.corrected) correctedNotes++;
        maxError = Math.max(maxError, Math.abs(timing.seconds(tick * project.ppq / grid) - timing.seconds(source.sourceTick)));
      } else maxError = Math.max(maxError, Math.abs(tick / tempo - seconds));
      const key = clamp(note.midi - 21, 0, 87); if (key !== note.midi - 21) clipped++;
      const laneIndex = columns.get(tick) ?? 0; columns.set(tick, laneIndex + 1);
      let lane = lanes[laneIndex];
      if (!lane) { lane = { name: laneIndex ? `${track.name} [${laneIndex + 1}]` : track.name, notes: [] }; lanes.push(lane); }
      lane.notes.push({ tick, key, velocity: Math.round(clamp(note.gain, 0, 1) * 100), pan: Math.round((note.effectivePan + 1) * 100), pitch: Math.round(note.detune), instrument: instrumentIndices.get(note.effectiveInstrument) ?? 0 });
    }
    if (!lanes.length) lanes.push({ name: track.name, notes: [] });
    rows.push(...lanes);
  }
  const entries = rows.flatMap((row, layer) => row.notes.map(n => ({ ...n, layer }))).sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  const lastTick = entries.at(-1)?.tick ?? 0;
  if (lastTick > 32766 || rows.length > 32767) throw new Error('导出超过 NBS 有符号 short 时间或层数范围（长度最多 32767 格）。请降低导出分辨率或拆分工程。');
  if (clipped) diagnostics.push({ severity: 'warning', code: 'nbs-key-range', message: `${clipped} 个音符超出 NBS 的 88 键范围，导出副本中已截到最近边界。` });
  if (musical ? quantizedNotes > 0 : maxError > 0.0001) diagnostics.push({ severity: 'warning', code: 'nbs-quantization', message: musical
    ? `${quantizedNotes} 个音符未落在每拍 ${grid} 格的整数位置，已按 Note Block Studio 规则向下取整；最大网格起音偏差 ${(maxError * 1000).toFixed(2)} ms。`
    : `已按 ${tempo} tick/s 量化，最大起音偏差 ${(maxError * 1000).toFixed(2)} ms。` });
  if (correctedNotes) diagnostics.push({ severity: 'info', code: 'nbs-source-roundoff', message: `${correctedNotes} 个起音在组合片段几何的浮点误差上界内紧邻整数网格，已恢复该网格位置；未对直接源音符位置应用宽容差吸附。` });
  if (!musical && project.tempos.length > 1) diagnostics.push({ severity: 'info', code: 'nbs-tempo-baked', message: '速度变化已转换为绝对起音时间，再映射至 NBS 固定时间网格。' });
  if (notes.some(n => n.height !== 0)) diagnostics.push({ severity: 'warning', code: 'nbs-height', message: 'NBS 不支持上下空间位置；高度信息保留在 NBSX 母版中。' });
  if (custom.length) diagnostics.push({ severity: 'warning', code: 'nbs-custom', message: '导出使用自定义乐器，接收端需要相应声音文件；原版乐器数量由所选 NBS 版本决定。' });
  const w = new Writer();
  w.u16(0); w.u8(version); w.u8(builtinCount); w.u16(lastTick + 1); w.u16(rows.length);
  w.str(project.name); w.str(project.author); w.str(String(project.provenance?.metadata.originalAuthor ?? '')); w.str(project.description);
  w.u16(Math.round(tempo * 100)); w.u8(0); w.u8(5); w.u8(clamp(project.timeSignatures[0]?.numerator ?? 4, 2, 8));
  for (let n = 0; n < 5; n++) w.i32(0);
  w.str(project.provenance?.filename ?? ''); w.u8(0); w.u8(0); w.u16(0);
  let previousTick = -1, cursor = 0;
  while (cursor < entries.length) {
    const tick = entries[cursor].tick; w.u16(tick - previousTick); previousTick = tick;
    let previousLayer = -1;
    while (cursor < entries.length && entries[cursor].tick === tick) {
      const n = entries[cursor++]; w.u16(n.layer - previousLayer); previousLayer = n.layer;
      w.u8(n.instrument); w.u8(n.key); w.u8(n.velocity); w.u8(n.pan); w.u16(n.pitch);
    }
    w.u16(0);
  }
  w.u16(0);
  for (const row of rows) { w.str(row.name); w.u8(0); w.u8(100); w.u8(100); }
  w.u8(custom.length + Number(usesTempoChanger));
  for (const ins of custom) {
    w.str(ins.name); w.str(project.assets.find(a => a.id === ins.assetId)?.name ?? `${ins.id}.ogg`);
    w.u8(clamp(111 - ins.rootMidi, 0, 87)); w.u8(0);
  }
  if (usesTempoChanger) { w.str('Tempo Changer'); w.str(''); w.u8(39); w.u8(0); }
  return { bytes: w.finish(), diagnostics };
}
