import { describe, expect, it } from 'vitest';
import { FlpError, readFlp } from '../src/core/flp-parser';

// Hand-encoded records and literal field expectations, independent of the
// production decoder and of the Python implementation. No FL Studio playback,
// plug-in execution, file/sample resolution or copyrighted corpus is required.
function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
function numeric(value: number, size: 1 | 2 | 4): Uint8Array {
  const bytes = new Uint8Array(size), data = new DataView(bytes.buffer);
  if (size === 1) data.setUint8(0, value); else if (size === 2) data.setUint16(0, value, true); else data.setUint32(0, value, true);
  return bytes;
}
function event(id: number, data: Uint8Array): Uint8Array {
  const length: number[] = []; let size = data.length;
  if (id >= 192) { while (size > 127) { length.push((size % 128) | 128); size = Math.floor(size / 128); } length.push(size); }
  return join([Uint8Array.from([id, ...length]), data]);
}
const num = (id: number, value: number, size: 1 | 2 | 4) => event(id, numeric(value, size));
const ascii = (value: string) => new TextEncoder().encode(value);
function unicode(value: string) { const bytes = new Uint8Array(value.length * 2), data = new DataView(bytes.buffer); for (let at = 0; at < value.length; at++) data.setUint16(at * 2, value.charCodeAt(at), true); return bytes; }
function file(body: Uint8Array[], channels = 1, ppq = 96): Uint8Array {
  const data = join(body), bytes = new Uint8Array(22 + data.length), header = new DataView(bytes.buffer);
  bytes.set(ascii('FLhd')); header.setUint32(4, 6, true); header.setUint16(8, 0, true); header.setUint16(10, channels, true); header.setUint16(12, ppq, true);
  bytes.set(ascii('FLdt'), 14); header.setUint32(18, data.length, true); bytes.set(data, 22); return bytes;
}
function note({ position = 48, channel = 0, key = 66, length = 24, flags = 0x4000, pan = 64, velocity = 100, fine = 120, release = 64 }: {
  position?: number; channel?: number; key?: number; length?: number; flags?: number; pan?: number; velocity?: number; fine?: number; release?: number;
} = {}) {
  const bytes = new Uint8Array(24), data = new DataView(bytes.buffer);
  data.setUint32(0, position, true); data.setUint16(4, flags, true); data.setUint16(6, channel, true); data.setUint32(8, length, true); data.setUint16(12, key, true);
  bytes[16] = fine; bytes[18] = release; bytes[20] = pan; bytes[21] = velocity; bytes[22] = bytes[23] = 128; return bytes;
}
function clip(stride = 88, { position = 192, length = 384, start = 0, end = 384, index = 20481, reverseTrack = 499, flags = 64 }: {
  position?: number; length?: number; start?: number; end?: number; index?: number; reverseTrack?: number; flags?: number;
} = {}) {
  const bytes = new Uint8Array(stride), data = new DataView(bytes.buffer);
  data.setUint32(0, position, true); data.setUint16(4, 20480, true); data.setUint16(6, index, true); data.setUint32(8, length, true); data.setUint16(12, reverseTrack, true); data.setUint16(18, flags, true);
  data.setUint32(24, start, true); data.setUint32(28, end, true);
  if (stride === 60) data.setFloat32(52, 1, true); if (stride >= 80) data.setFloat64(64, 1, true); return bytes;
}
function sampler(size = 168) { const bytes = new Uint8Array(size), data = new DataView(bytes.buffer); data.setFloat64(136, 1, true); if (size >= 168) data.setFloat64(160, .5, true); return bytes; }
function track(size = 66, enabled = 1, id = 1) { const bytes = new Uint8Array(size), data = new DataView(bytes.buffer); data.setUint32(0, id, true); bytes[12] = enabled; return bytes; }
function controller(tick: number, target: number, value: number) { const bytes = new Uint8Array(12), data = new DataView(bytes.buffer); data.setUint32(0, tick, true); data.setUint32(4, target, true); data.setInt32(8, value, true); return bytes; }
interface Options {
  version?: string; stride?: number; trackSize?: number; params?: Uint8Array; playlist?: Uint8Array;
  names?: Uint8Array[]; patternExtra?: Uint8Array[]; channelExtra?: Uint8Array[]; endExtra?: Uint8Array[];
  tempos?: Uint8Array[]; notes?: Uint8Array;
}
function fixture({ version = '26.1.1.5547', stride = 88, trackSize = 66, params, playlist, names, patternExtra = [], channelExtra = [], endExtra = [], tempos, notes }: Options = {}) {
  return file([
    event(199, ascii(version + '\0')), num(172, 1, version.startsWith('26.') ? 1 : 4), ...(tempos ?? [num(156, 120000, 4)]),
    num(65, 1, 2), event(224, notes ?? note()), ...patternExtra,
    num(64, 0, 2), num(21, 0, 1), num(0, 1, 1), ...(names ?? [event(203, unicode('玻璃 pling\0'))]), num(135, 66, 4),
    ...(params ? [event(215, params)] : []), ...channelExtra,
    num(99, 0, 2), event(233, playlist ?? clip(stride)), event(238, track(trackSize)), ...endExtra,
  ]);
}

describe('FLP confirmed record layouts and raw source identity', () => {
  it.each([
    ['20.8.3.2304', 32, 158, 66], ['21.2.3.4004', 60, 168, 66],
    ['24.2.2.4597', 60, 168, 70], ['25.1.3.4922', 80, 168, 70], ['26.1.1.5547', 88, 168, 70],
  ] as const)('reads %s without borrowing its playlist stride from the version', (version, stride, paramsSize, trackSize) => {
    const bytes = fixture({ version, stride, params: sampler(paramsSize), trackSize }), before = bytes.slice(), result = readFlp(bytes);
    expect(result).toMatchObject({ version, ppq: 96, bpm: 120, beatsBar: 4, tracks: { 1: true }, issues: [] });
    expect(result.patterns).toEqual({ 1: [{ position: 48, channel: 0, key: 66, length: 24, velocity: 100, pan: 64, fine: 120, flags: 0x4000 }] });
    expect(result.channels[0]).toEqual({ id: 0, name: '玻璃 pling', enabled: true, kind: 0, root: 66, sample: '', pitch: 0, fine: 0, pan: 6400, volume: 10000, issues: [],
      sampler: { layoutBytes: paramsSize, arpDirection: 0, addToKey: false, stretchTime: 0, stretchPitchCents: 0, stretchMultiplier: 0, sampleStart: 0, sampleLength: 1, sampleStartOffset: 0 } });
    expect(result.clips).toEqual([{ pattern: 1, position: 192, length: 384, offset: 0, end: 384, track: 1, muted: false }]);
    expect(result.metadata).toMatchObject({ format_profile: `FL ${version.split('.')[0]}`, tempo_source: 'event156', playlist_layouts: [stride], sampler_layouts: [paramsSize], track_layouts: [trackSize] });
    expect(result.metadata.compatibility_validation).toBe(version.startsWith('21.') ? 'synthetic_layout_tests_only' : 'real_corpus_structural');
    expect(result.metadata).not.toHaveProperty('source_path'); expect(result.metadata).not.toHaveProperty('sha256'); expect(bytes).toEqual(before);
  });

  it('handles a nonzero byteOffset and never retains mutable views in parsed objects', () => {
    const original = fixture(), envelope = join([Uint8Array.of(5, 6, 7), original, Uint8Array.of(8, 9)]);
    const result = readFlp(envelope.subarray(3, 3 + original.length)); envelope.fill(255);
    expect(result.patterns[1][0].key).toBe(66); expect(result.channels[0].name).toBe('玻璃 pling'); expect(result.metadata.playlist_layouts).toEqual([88]);
  });

  it('preserves duplicate note order, raw flags, wide keys and every musical field for the importer', () => {
    const result = readFlp(fixture({ notes: join([note({ position: 0xffffffff, channel: 500, key: 130, length: 0, flags: 0x4001, pan: 128, velocity: 128, fine: 121 }), note({ key: 70 }), note({ key: 70 })]) }));
    expect(result.patterns[1]).toEqual([
      { position: 0xffffffff, channel: 500, key: 130, length: 0, flags: 0x4001, pan: 128, velocity: 128, fine: 121 },
      { position: 48, channel: 0, key: 70, length: 24, flags: 0x4000, pan: 64, velocity: 100, fine: 120 },
      { position: 48, channel: 0, key: 70, length: 24, flags: 0x4000, pan: 64, velocity: 100, fine: 120 },
    ]);
  });

  it('maps 193 to explicit pattern names and does not confuse 231 display-group names', () => {
    const result = readFlp(fixture({ patternExtra: [event(193, unicode('旋律\0')), event(231, unicode('Display group\0')), num(65, 4, 2), event(193, unicode('低音\0')), event(224, note({ key: 48 }))] }));
    expect(result.patternNames).toEqual({ 1: '旋律', 4: '低音' }); expect(result.patterns[4][0].key).toBe(48); expect(result.metadata.event_counts).toMatchObject({ 193: 2, 231: 1 });
    expect(() => readFlp(fixture({ patternExtra: [event(193, unicode('A')), event(193, unicode('B'))] }))).toThrow('冲突名称');
    const unspecified = readFlp(file([event(199, ascii('26.1.1\0')), num(156, 120000, 4), event(193, unicode('Unknown'))], 0));
    expect(unspecified.patternNames).toBeUndefined(); expect(unspecified.issues).toContainEqual(expect.stringContaining('未猜测名称归属'));
  });

  it('preserves explicit channel-name precedence, sample paths and signed cents/levels without filesystem work', () => {
    const levels = new Uint8Array(12), data = new DataView(levels.buffer); data.setInt32(0, -20, true); data.setUint32(4, 8750, true); data.setInt32(8, -37, true);
    const result = readFlp(fixture({ names: [event(192, unicode('Legacy')), event(203, unicode('Explicit')), event(192, unicode('Ignored'))],
      channelExtra: [num(0, 0, 1), num(21, 4, 1), num(142, 0xffffffff, 4), event(219, levels), event(196, unicode('relative/sounds/lead.ogg\0'))] }));
    expect(result.channels[0]).toMatchObject({ name: 'Explicit', enabled: false, kind: 4, pitch: -37, fine: -1, pan: -20, volume: 8750, sample: 'relative/sounds/lead.ogg', sampler: {} });
  });

  it.each([32, 60, 80, 88])('keeps a selected pattern audible and integer crop windows intact at stride %i', stride => {
    const result = readFlp(fixture({ stride, playlist: clip(stride, { start: 48, end: 432, flags: 0x8040, reverseTrack: 497 }) }));
    expect(result.clips[0]).toEqual({ pattern: 1, position: 192, length: 384, offset: 48, end: 432, track: 3, muted: false }); expect(result.issues).toEqual([]);
  });

  it.each([0xffffffff, 0xbf800000])('resolves only the confirmed unset crop sentinel %i', sentinel => {
    const result = readFlp(fixture({ playlist: clip(88, { start: sentinel, end: sentinel }) }));
    expect(result.clips[0]).toMatchObject({ offset: 0, end: 384 });
    expect(readFlp(fixture({ playlist: clip(88, { start: 48, end: sentinel }) })).clips[0]).toMatchObject({ offset: 48, end: 432 });
  });

  it('leaves audio clips as channel references and does not interpret their floating offsets as pattern ticks', () => {
    const result = readFlp(fixture({ playlist: clip(88, { index: 0, start: 0x3f000000, end: 0x7fc00000 }) }));
    expect(result.clips[0]).toEqual({ channel: 0, position: 192, length: 384, offset: 0, end: 384, track: 1, muted: false });
    expect(result.clips[0]).not.toHaveProperty('pattern');
  });

  it.each([44, 66, 70])('reads enabled/motion/grouping at their confirmed track-%i offsets', size => {
    const value = track(size, 0, 3), data = new DataView(value.buffer); data.setUint32(size === 44 ? 18 : 22, 7, true); value[size === 44 ? 42 : 46] = 1;
    const result = readFlp(fixture({ endExtra: [event(238, value)] }));
    expect(result.tracks[3]).toBe(false); expect(result.metadata.grouped_tracks).toEqual([3]); expect(result.issues).toContain('轨道 3 使用 Performance motion');
  });
});

describe('FLP static tempo evidence and unsupported playback controls', () => {
  it('reads the legacy coarse/fine tempo without inventing a modern value', () => {
    const result = readFlp(fixture({ tempos: [num(66, 92, 2), num(93, 25, 2)] }));
    expect(result.bpm).toBe(92.025); expect(result.metadata.tempo_source).toBe('legacy66+93'); expect(result.issues).toEqual([]);
  });

  it('separates actual automation from structural issues, and summarizes all controller values', () => {
    const result = readFlp(fixture({ patternExtra: [event(223, join([controller(3456, 0x40000005, 120000), controller(4000, 0x40000005, 90000), controller(5000, 0x40000005, 120000), controller(123, 0x40000006, 120000)]))], endExtra: [num(11, 1, 1)] }));
    expect(result.warnings).toContainEqual(expect.stringContaining('不改变速度'));
    expect(result.issues).toContain('工程 Swing 不为零，起音行为尚不支持');
    expect(result.metadata.automation_issues).toEqual([
      expect.stringContaining('实际变速'), expect.stringContaining('0x40000006'),
    ]);
    expect(result.metadata.pattern_controller_summary).toEqual([
      { pattern: 1, target: '0x40000005', count: 3, tick_min: 3456, tick_max: 5000, value_min: 90000, value_max: 120000 },
      { pattern: 1, target: '0x40000006', count: 1, tick_min: 123, tick_max: 123, value_min: 120000, value_max: 120000 },
    ]);
  });

  it('retains repeated same-BPM events at nonzero positions without claiming a tempo change', () => {
    const result = readFlp(fixture({ patternExtra: [event(223, join([controller(0, 0x40000005, 120000), controller(96, 0x40000005, 120000), controller(3456, 0x40000005, 120000)]))] }));
    expect(result.issues).toEqual([]); expect(result.metadata).not.toHaveProperty('automation_issues');
    expect(result.warnings.filter(value => value.includes('不改变速度'))).toHaveLength(1);
  });

  it('flags conflicting global and initialization tempos and nonempty links, not external MIDI inputs', () => {
    const result = readFlp(fixture({ tempos: [num(156, 120000, 4), num(156, 90000, 4), num(66, 119, 2)], endExtra: [event(216, controller(0, 0x40000005, 80000)), event(227, Uint8Array.of(1)), event(234, Uint8Array.of(1)), event(226, Uint8Array.of(1))] }));
    expect((result.metadata.automation_issues as string[]).some(value => value.includes('多个不同速度'))).toBe(true);
    expect((result.metadata.automation_issues as string[]).some(value => value.includes('新旧速度'))).toBe(true);
    expect((result.metadata.automation_issues as string[]).some(value => value.includes('初始化控制'))).toBe(true);
    expect((result.metadata.automation_issues as string[]).filter(value => value.includes('控制器链接'))).toHaveLength(2);
    expect(result.warnings).toContainEqual(expect.stringContaining('外部 MIDI')); expect((result.metadata.automation_issues as string[]).some(value => value.includes('外部 MIDI'))).toBe(false);
  });

  it('records unsupported clip mute/scale/crop and multiple arrangements without silently dropping notes', () => {
    const value = clip(88, { flags: 32, start: 12 }), data = new DataView(value.buffer); data.setFloat64(64, 2, true);
    const result = readFlp(fixture({ playlist: value, endExtra: [num(99, 1, 2), event(242, Uint8Array.of(1)), event(243, Uint8Array.of(1))] }));
    expect(result.clips).toHaveLength(1); expect(result.clips[0].muted).toBe(false);
    expect(result.issues).toEqual([expect.stringContaining('裁切窗口'), expect.stringContaining('未知播放片段 flags=0x0020'), expect.stringContaining('缩放 2'), expect.stringContaining('多个 Arrangement')]);
    expect(result.warnings.filter(value => value.includes('扩展事件'))).toHaveLength(2);
  });

  it('reads sampler signed parameters and reports unmodeled arp/key/stretch/start/formant behavior', () => {
    const value = sampler(), data = new DataView(value.buffer);
    data.setUint32(40, 2, true); value[63] = 1; data.setUint32(96, 12, true); data.setInt32(100, -123, true); data.setInt32(104, -9, true);
    data.setFloat64(128, .25, true); data.setFloat64(136, .5, true); data.setFloat64(144, .125, true); data.setFloat64(160, .75, true);
    const result = readFlp(fixture({ params: value }));
    expect(result.channels[0].sampler).toEqual({ layoutBytes: 168, arpDirection: 2, addToKey: true, stretchTime: 12, stretchPitchCents: -123, stretchMultiplier: -9, sampleStart: .25, sampleLength: .5, sampleStartOffset: .125, formantUnhandled: true });
    expect(result.channels[0].issues).toEqual([expect.stringContaining('琶音'), expect.stringContaining('Add to key'), expect.stringContaining('时间拉伸'), expect.stringContaining('起止位置'), expect.stringContaining('Formant')]);
  });

  it('retains unsupported sampler layouts/nonfinite positions as channel issues rather than defaulting them', () => {
    expect(readFlp(fixture({ params: sampler(160) })).channels[0].issues).toContainEqual(expect.stringContaining('160 字节'));
    const value = sampler(); new DataView(value.buffer).setFloat64(144, NaN, true);
    const result = readFlp(fixture({ params: value })); expect(result.channels[0].issues).toContainEqual(expect.stringContaining('非有限'));
    expect(result.channels[0].sampler).toEqual({});
  });

  it('flags pitch LFO only in the fifth envelope, as well as channel shift/swing/mono/echo', () => {
    const envelope = new Uint8Array(48); new DataView(envelope.buffer).setInt32(44, -1, true);
    const delay = new Uint8Array(20); new DataView(delay.buffer).setUint32(0, 1, true);
    const mono = new Uint8Array(9); mono[8] = 1;
    const result = readFlp(fixture({ notes: note({ release: 63 }), channelExtra: [num(89, 1, 2), num(97, 127, 2), event(209, delay), event(221, mono), ...Array.from({ length: 5 }, () => event(218, envelope))] }));
    expect(result.channels[0].issues).toEqual(['通道 Time shift 非零', '通道 Swing 系数不是默认 128', '采样器回声重复', '单音/滑音模式', 'Pitch 包络 / LFO 无法保留']);
    expect(result.warnings).toContain('存在音符调制/释放参数：不能等价保留');
  });
});

describe('FLP corruption, ambiguous layouts and bounded allocation', () => {
  it.each([0, 1, 14, 21])('rejects an incomplete %i-byte header with a controlled parser error', size => {
    expect(() => readFlp(new Uint8Array(size))).toThrow(FlpError);
  });

  it('rejects chunk mismatches and non-project files', () => {
    const damaged = fixture(); damaged[14] = 0; expect(() => readFlp(damaged)).toThrow('数据长度');
    const wrongLength = fixture(); new DataView(wrongLength.buffer).setUint32(18, 0, true); expect(() => readFlp(wrongLength)).toThrow('数据长度');
    const wrongType = fixture(); new DataView(wrongType.buffer).setUint16(8, 1, true); expect(() => readFlp(wrongType)).toThrow('完整 FLP');
    const wrongHeader = fixture(); new DataView(wrongHeader.buffer).setUint32(4, 7, true); expect(() => readFlp(wrongHeader)).toThrow('文件头');
  });

  it.each(['19.0', '27.1', '26', '26.a', '26.1\0.0', '26.-1', '9007199254740992.0'])('refuses unknown or malformed version %s', version => {
    expect(() => readFlp(fixture({ version }))).toThrow(FlpError);
  });

  it('requires exactly one version before the version-dependent event 172', () => {
    expect(() => readFlp(file([num(156, 120000, 4)]))).toThrow('工程版本');
    expect(() => readFlp(fixture({ endExtra: [event(199, ascii('26.1.1\0'))] }))).toThrow('重复');
    expect(() => readFlp(file([num(172, 1, 4), event(199, ascii('26.1.1\0')), num(156, 120000, 4)]))).toThrow('版本之前');
    expect(() => readFlp(fixture({ version: '25.2.4.4960', stride: 80 }))).toThrow('event 172');
  });

  it.each([Uint8Array.of(203), Uint8Array.of(203, 128), Uint8Array.of(203, 128, 128, 128, 128, 128), Uint8Array.of(203, 127), Uint8Array.of(65, 1)])('rejects truncated or unterminated event data %j', bytes => {
    expect(() => readFlp(file([event(199, ascii('26.1.1\0')), bytes]))).toThrow(FlpError);
  });

  it('rejects malformed UTF-16 rather than replacing bytes, and enforces note/levels/controllers lengths', () => {
    expect(() => readFlp(fixture({ names: [event(203, Uint8Array.of(1))] }))).toThrow('UTF-16');
    expect(() => readFlp(fixture({ names: [event(203, Uint8Array.of(0, 216))] }))).toThrow('UTF-16');
    expect(() => readFlp(fixture({ notes: new Uint8Array(23) }))).toThrow('24 字节');
    expect(() => readFlp(fixture({ channelExtra: [event(219, new Uint8Array(11))] }))).toThrow('Levels');
    expect(() => readFlp(fixture({ patternExtra: [event(223, new Uint8Array(11))] }))).toThrow('控制事件');
  });

  it('rejects duplicate channels, mismatched counts and conflicting track states', () => {
    expect(() => readFlp(fixture({ channelExtra: [num(64, 0, 2)] }))).toThrow('重复通道');
    const bytes = fixture(); new DataView(bytes.buffer).setUint16(10, 2, true); expect(() => readFlp(bytes)).toThrow('通道数');
    expect(() => readFlp(fixture({ endExtra: [event(238, track(66, 0))] }))).toThrow('冲突静音');
    expect(() => readFlp(fixture({ trackSize: 48 }))).toThrow('轨道描述布局');
    expect(() => readFlp(fixture({ endExtra: [event(238, track(66, 2, 2))] }))).toThrow('静音状态');
  });

  it('rejects missing/conflicting legacy tempos and invalid BPM/PPQ rather than guessing defaults', () => {
    expect(() => readFlp(fixture({ tempos: [] }))).toThrow('唯一速度');
    expect(() => readFlp(fixture({ tempos: [num(66, 120, 2), num(66, 90, 2)] }))).toThrow('唯一速度');
    expect(() => readFlp(fixture({ tempos: [num(156, 0, 4)] }))).toThrow('PPQ 或速度');
    const bytes = fixture(); new DataView(bytes.buffer).setUint16(12, 9601, true); expect(() => readFlp(bytes)).toThrow('PPQ 或速度');
    expect(() => readFlp(fixture({ endExtra: [num(17, 0, 1)] }))).toThrow('拍号分子');
  });

  it('rejects both unrecognized and genuinely ambiguous playlist layouts', () => {
    expect(() => readFlp(fixture({ playlist: new Uint8Array(72) }))).toThrow('唯一确认');
    const ambiguous = new Uint8Array(240), data = new DataView(ambiguous.buffer);
    for (const at of [0, 60, 80, 120, 160, 180]) { data.setUint16(at + 4, 20480, true); data.setUint16(at + 6, 20481, true); }
    expect(() => readFlp(fixture({ playlist: ambiguous }))).toThrow('候选 [60, 80]');
  });

  it('preflights byte/note/clip limits before allocating their parsed objects', () => {
    expect(() => readFlp(new Uint8Array(128 * 1024 * 1024 + 1))).toThrow('128 MiB');
    expect(() => readFlp(file([event(199, ascii('26.' + '1.'.repeat(1000) + '1'))]))).toThrow('版本字段过长');
    const oversizedNotes = new Uint8Array(2000001 * 24);
    expect(() => readFlp(file([event(199, ascii('26.1.1\0')), num(156, 120000, 4), event(224, oversizedNotes)]))).toThrow('音符超过 200 万');
    const manyClips = new Uint8Array(100001 * 32), data = new DataView(manyClips.buffer);
    for (let at = 0; at < manyClips.length; at += 32) data.setUint16(at + 4, 20480, true);
    expect(() => readFlp(fixture({ playlist: manyClips }))).toThrow('片段超过 10 万');
  });

  it('bounds scalar event counts as well as file size', () => {
    // Repeated one-byte value events are only 4 MB but would otherwise build
    // millions of diagnostics/state transitions despite the file-size bound.
    const repeated = new Uint8Array(2000001 * 2);
    expect(() => readFlp(file([event(199, ascii('26.1.1\0')), repeated], 0))).toThrow('事件超过 200 万');
  });
});
