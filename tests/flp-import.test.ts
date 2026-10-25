import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, openNbsx, saveNbsx } from '../src/core/container';
import { flpChannelChoiceError, importFlp, prepareFlpImport, withFlpSampleChecks } from '../src/core/flp-import';
import { flattenNotes, validateProject } from '../src/core/project';

// Handwritten FL event records. No production parser or converter creates fixtures.
const cat = (chunks: Uint8Array[]) => { const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; } return result; };
const event = (id: number, data: Uint8Array) => {
  const header = [id]; if (id >= 192) { let size = data.length; do { const next = size % 128; size = Math.floor(size / 128); header.push(next | (size ? 128 : 0)); } while (size); }
  return cat([Uint8Array.from(header), data]);
};
const numberEvent = (id: number, value: number) => { const bytes = new Uint8Array(id < 64 ? 1 : id < 128 ? 2 : 4); new DataView(bytes.buffer).setUint8(0, value & 255); if (bytes.length >= 2) new DataView(bytes.buffer).setUint16(0, value & 65535, true); if (bytes.length === 4) new DataView(bytes.buffer).setUint32(0, value >>> 0, true); return event(id, bytes); };
const textEvent = (id: number, value: string) => { const bytes = new Uint8Array((value.length + 1) * 2), view = new DataView(bytes.buffer); for (let at = 0; at < value.length; at++) view.setUint16(at * 2, value.charCodeAt(at), true); return event(id, bytes); };
interface InputNote { position?: number; channel?: number; key?: number; length?: number; velocity?: number; pan?: number; fine?: number; flags?: number }
interface InputChannel { id?: number; name?: string; root?: number; enabled?: boolean; kind?: number; pan?: number; volume?: number; pitch?: number; fine?: number; sample?: string; samplerPitch?: number; extra?: Uint8Array[] }
interface InputClip { pattern?: number; channel?: number; position?: number; length?: number; offset?: number; track?: number; flags?: number }
function fixture(options: { channels?: InputChannel[]; patterns?: Record<number, InputNote[]>; clips?: InputClip[]; tracks?: Record<number, boolean>; extra?: Uint8Array[] } = {}) {
  const channels = options.channels ?? [{ name: 'pling', root: 66 }], chunks: Uint8Array[] = [event(199, new TextEncoder().encode('26.1.1.5547\0')), numberEvent(156, 120000)];
  for (const [id, notes] of Object.entries(options.patterns ?? { 1: [{}] })) {
    chunks.push(numberEvent(65, Number(id)), textEvent(193, `Source ${id}`));
    const bytes = new Uint8Array(notes.length * 24), view = new DataView(bytes.buffer);
    notes.forEach((note, index) => { const at = index * 24; view.setUint32(at, note.position ?? 0, true); view.setUint16(at + 4, note.flags ?? 0x4000, true); view.setUint16(at + 6, note.channel ?? 0, true); view.setUint32(at + 8, note.length ?? 24, true); view.setUint16(at + 12, note.key ?? 66, true); bytes[at + 16] = note.fine ?? 120; bytes[at + 18] = 64; bytes[at + 20] = note.pan ?? 64; bytes[at + 21] = note.velocity ?? 100; bytes[at + 22] = bytes[at + 23] = 128; });
    chunks.push(event(224, bytes));
  }
  channels.forEach((channel, index) => {
    chunks.push(numberEvent(64, channel.id ?? index), numberEvent(21, channel.kind ?? 0), numberEvent(0, channel.enabled === false ? 0 : 1), textEvent(203, channel.name ?? `unknown ${index}`), textEvent(196, channel.sample ?? 'sample.ogg'), numberEvent(135, channel.root ?? 66), numberEvent(142, channel.fine ?? 0));
    const levels = new Uint8Array(12), levelView = new DataView(levels.buffer); levelView.setInt32(0, channel.pan ?? 6400, true); levelView.setUint32(4, channel.volume ?? 10000, true); levelView.setInt32(8, channel.pitch ?? 0, true); chunks.push(event(219, levels));
    if (channel.samplerPitch !== undefined) { const sampler = new Uint8Array(168), view = new DataView(sampler.buffer); view.setInt32(100, channel.samplerPitch, true); view.setFloat64(136, 1, true); view.setFloat64(160, .5, true); chunks.push(event(215, sampler)); }
    for (const extra of channel.extra ?? []) chunks.push(extra);
  });
  chunks.push(numberEvent(99, 0));
  const clips = options.clips ?? [{ pattern: 1 }], playlist = new Uint8Array(clips.length * 88), playlistView = new DataView(playlist.buffer);
  clips.forEach((clip, index) => { const at = index * 88, length = clip.length ?? 384, offset = clip.offset ?? 0; playlistView.setUint32(at, clip.position ?? 0, true); playlistView.setUint16(at + 4, 20480, true); playlistView.setUint16(at + 6, clip.pattern === undefined ? clip.channel ?? 0 : 20480 + clip.pattern, true); playlistView.setUint32(at + 8, length, true); playlistView.setUint16(at + 12, 500 - (clip.track ?? 1), true); playlistView.setUint16(at + 18, clip.flags ?? 64, true); playlistView.setUint32(at + 24, offset, true); playlistView.setUint32(at + 28, offset + length, true); playlistView.setFloat64(at + 64, 1, true); });
  chunks.push(event(233, playlist));
  for (const [id, enabled] of Object.entries(options.tracks ?? { 1: true })) { const track = new Uint8Array(66); new DataView(track.buffer).setUint32(0, Number(id), true); track[12] = Number(enabled); chunks.push(event(238, track)); }
  for (const extra of options.extra ?? []) chunks.push(extra);
  const body = cat(chunks), header = new Uint8Array(22), view = new DataView(header.buffer); header.set(new TextEncoder().encode('FLhd')); view.setUint32(4, 6, true); view.setUint16(10, channels.length, true); view.setUint16(12, 96, true); header.set(new TextEncoder().encode('FLdt'), 14); view.setUint32(18, body.length, true);
  return cat([header, body]);
}
const choicesFor = (plan: Awaited<ReturnType<typeof prepareFlpImport>>) => plan.channels.map(row => ({ id: row.id, instrumentId: row.instrumentId, baselineMidi: row.baselineMidi, confirmed: true, selected: row.selected }));
const PLING_HASH = 'd7e3638d4c0fba4614f24ba94d6380935ae2341536d76989e44f00ffd94a1459';
const allChoices = (plan: Awaited<ReturnType<typeof prepareFlpImport>>) => choicesFor(plan).map(choice => ({ ...choice, instrumentId: choice.instrumentId || 'harp', selected: true }));

describe('FLP import review and sampler calibration', () => {
  it('owns source bytes, hashes the actual payload, counts source and active notes and never falls back for an unknown name', async () => {
    const bytes = fixture({ channels: [{ name: 'Mystery' }, { name: 'flute', enabled: false }, { name: 'Plugin', kind: 2 }], patterns: { 1: [{}, { position: 400 }, { channel: 1 }, { channel: 2 }] } });
    const original = bytes.slice(), plan = await prepareFlpImport(bytes, 'source.flp');
    expect(plan.sourceSha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(plan.channels.map(row => [row.id, row.noteCount, row.activeNoteCount, row.selected, row.instrumentId, row.verified])).toEqual([[0, 2, 1, true, '', false], [1, 1, 0, false, 'flute', false], [2, 1, 1, false, '', false]]);
    bytes[0] = 0; expect(plan.bytes).toEqual(original); expect(plan.bytes).not.toBe(bytes);
    const choices = choicesFor(plan); expect(() => importFlp(plan, choices, { acknowledgeWarnings: true })).toThrow('有效');
    choices[0].instrumentId = 'bell'; expect(importFlp(plan, choices, { acknowledgeWarnings: true }).project.tracks[0].instrumentId).toBe('bell');
  });

  it('treats aliases and copy suffixes only as suggestions requiring manual confirmation', async () => {
    const plan = await prepareFlpImport(fixture({ channels: [{ name: ' DBASS #2 ' }, { name: 'unrelated harp sound' }], patterns: { 1: [{}, { channel: 1 }] } }), 'aliases.flp');
    expect(plan.channels.map(row => [row.instrumentId, row.verified])).toEqual([['bass', false], ['', false]]);
    expect(flpChannelChoiceError(plan, { ...choicesFor(plan)[0], confirmed: false })).toContain('确认');
  });

  it('binds byte verification to the exact known instrument and baseline, not a filename or a later edited choice', async () => {
    const first = await prepareFlpImport(fixture({ channels: [{ name: 'harp', sample: 'not-pling.wav' }] }), 'known.flp');
    const verified = withFlpSampleChecks(first, { 0: { sha256: PLING_HASH, path: 'authorized-reference.ogg' } });
    expect(verified.source).toBe(first.source); expect(verified.bytes).toBe(first.bytes); expect(verified.sourceSha256).toBe(first.sourceSha256);
    expect(first.channels[0]).toMatchObject({ instrumentId: 'harp', verified: false });
    expect(verified.channels[0]).toMatchObject({ instrumentId: 'pling', baselineMidi: 66, verified: true, sampleSha256: PLING_HASH });
    const choice = { ...choicesFor(verified)[0], confirmed: false };
    expect(flpChannelChoiceError(verified, choice)).toBeUndefined();
    expect(flpChannelChoiceError(verified, { ...choice, instrumentId: 'harp' })).toContain('确认');
    expect(flpChannelChoiceError(verified, { ...choice, baselineMidi: 66.125 })).toContain('确认');
    expect(flpChannelChoiceError(verified, { ...choice, baselineMidi: 66.125, confirmed: true })).toBeUndefined();
    const manual = importFlp(verified, [{ ...choice, instrumentId: 'harp', confirmed: true }], { acknowledgeWarnings: true });
    expect(manual.project.provenance!.metadata.channelChoices).toEqual([expect.objectContaining({ instrumentId: 'harp', verified: false, confirmed: true })]);
    expect(withFlpSampleChecks(verified, { 0: { sha256: '0'.repeat(64) } }).channels[0]).toMatchObject({ instrumentId: 'harp', verified: false });
  });

  it('rejects invalid choices and requires explicit warning acknowledgement', async () => {
    const plan = await prepareFlpImport(fixture(), 'guards.flp'), choices = choicesFor(plan);
    expect(() => importFlp(plan, choices, { acknowledgeWarnings: false })).toThrow('确认');
    expect(() => importFlp(plan, [], { acknowledgeWarnings: true })).toThrow('至少');
    expect(() => importFlp(plan, [...choices, choices[0]], { acknowledgeWarnings: true })).toThrow('重复');
    expect(flpChannelChoiceError(plan, { ...choices[0], id: 999 })).toContain('不存在');
    for (const baselineMidi of [-1, 128, NaN, Infinity, -Infinity]) expect(flpChannelChoiceError(plan, { ...choices[0], baselineMidi })).toContain('有限数');
    expect(flpChannelChoiceError(plan, { ...choices[0], instrumentId: 'missing' })).toContain('有效');
  });
});

describe('FLP source notes, playlist copies and explicit limitations', () => {
  it('preserves sub-cent calibration, sampler pitch, note length, linear velocity and Python pan semantics without simulating channel gain', async () => {
    const plan = await prepareFlpImport(fixture({ channels: [{ name: 'pling', root: 66, pitch: 17, fine: 2, samplerPitch: 100, pan: 9600, volume: 2345 }], patterns: { 1: [{ key: 70, fine: 121, length: 37, velocity: 128, pan: 96 }, { position: 12, key: 66, fine: 120, length: 0, velocity: 0, pan: 0 }] } }), 'parameters.flp');
    const choices = choicesFor(plan); choices[0].baselineMidi = 66.125;
    const { project, diagnostics } = importFlp(plan, choices, { acknowledgeWarnings: true }), notes = project.patterns[0].notes;
    expect(notes[0]).toMatchObject({ tick: 0, midi: 71, duration: 37, velocity: 1, pan: .5, height: 0 }); expect(notes[0].detune).toBeCloseTo(41.5, 10);
    expect(notes[1]).toMatchObject({ tick: 12, duration: 0, velocity: 0, pan: -.25 });
    expect(project.ppq).toBe(96); expect(project.tempos).toEqual([{ tick: 0, bpm: 120 }]); expect(project.tracks[0]).toMatchObject({ volume: 1, pan: 0 });
    expect(diagnostics.some(diagnostic => diagnostic.message.includes('非线性'))).toBe(true);
    expect(project.provenance!.metadata.channelParameters).toEqual([expect.objectContaining({ volume: 2345, pan: 9600 })]);
  });

  it('clones complete source notes independently per playlist copy while preserving half-open crops and source order', async () => {
    const plan = await prepareFlpImport(fixture({ patterns: { 1: [{ position: 96, key: 70 }, { position: 0 }, { position: 48 }, { position: 95 }, { position: 96 }] }, clips: [{ pattern: 1, position: 192, offset: 48, length: 48 }, { pattern: 1, position: 500, offset: 48, length: 48 }] }), 'copies.flp');
    const before = structuredClone(plan), { project } = importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true });
    expect(project.regions.map(region => [region.start, region.offset, region.length, region.loop])).toEqual([[192, 48, 48, false], [500, 48, 48, false]]);
    expect(project.patterns.map(pattern => pattern.notes.map(note => note.tick))).toEqual([[96, 0, 48, 95, 96], [96, 0, 48, 95, 96]]);
    expect(flattenNotes(project).map(note => note.absoluteTick)).toEqual([192, 239, 500, 547]);
    expect(project.patterns[0].notes[0]).not.toBe(project.patterns[1].notes[0]);
    const ids = project.patterns.flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id)]); expect(new Set(ids).size).toBe(ids.length);
    project.patterns[0].notes[0].duration = 99; expect(project.patterns[1].notes[0].duration).toBe(24); expect(plan).toEqual(before);
  });

  it('splits by FL playlist row, channel and mute state, preserving an explicitly selected disabled sampler', async () => {
    const plan = await prepareFlpImport(fixture({ channels: [{ name: 'pling' }, { name: 'flute', enabled: false }], patterns: { 1: [{}, { channel: 1 }] }, tracks: { 1: true, 2: false }, clips: [{ pattern: 1 }, { pattern: 1, track: 2, position: 384 }] }), 'muted.flp');
    expect(plan.channels.map(row => [row.activeNoteCount, row.selected])).toEqual([[1, true], [0, false]]);
    const { project } = importFlp(plan, allChoices(plan), { acknowledgeWarnings: true });
    expect(project.tracks.map(track => [track.instrumentId, track.muted])).toEqual([['pling', false], ['flute', true], ['pling', true], ['flute', true]]);
    expect(flattenNotes(project)).toHaveLength(1); expect(flattenNotes(project, true)).toHaveLength(4);
  });

  it('preserves coincident unisons as distinct notes and rejects an empty playlist selection', async () => {
    const plan = await prepareFlpImport(fixture({ patterns: { 1: [{}, {}, { key: 70 }] } }), 'unison.flp');
    const notes = importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true }).project.patterns[0].notes;
    expect(notes.map(note => note.midi)).toEqual([66, 66, 70]); expect(new Set(notes.map(note => note.id)).size).toBe(3);
    const outside = await prepareFlpImport(fixture({ patterns: { 1: [{ position: 400 }] } }), 'outside.flp');
    expect(() => importFlp(outside, allChoices(outside), { acknowledgeWarnings: true })).toThrow('没有有效起音');
  });

  it('allows acknowledged notes-only automation and audio omissions while retaining their original evidence', async () => {
    const controller = new Uint8Array(12), view = new DataView(controller.buffer); view.setUint32(4, 0x40000005, true); view.setInt32(8, 90000, true);
    const plan = await prepareFlpImport(fixture({ channels: [{ name: 'pling' }, { kind: 4 }, { kind: 5 }], clips: [{ pattern: 1 }, { channel: 1 }, { channel: 2 }], extra: [numberEvent(65, 1), event(223, controller)] }), 'omissions.flp');
    expect(plan.blockers).toEqual([]); expect(plan.warnings.some(warning => warning.includes('音频片段'))).toBe(true); expect(plan.warnings.some(warning => warning.includes('自动化'))).toBe(true);
    const { project } = importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true });
    expect(project.tempos).toEqual([{ tick: 0, bpm: 120 }]); expect(project.regions).toHaveLength(1);
    expect(project.provenance!.metadata.ignored).toMatchObject({ clips: [{ channel: 1 }, { channel: 2 }], automationIssues: [expect.stringContaining('实际变速')] });
    const sourceBefore = structuredClone(plan.source);
    (project.provenance!.metadata.ignored as { automationIssues: string[] }).automationIssues.push('later project edit');
    expect(plan.source).toEqual(sourceBefore);
  });

  it('keeps structural blockers fatal even after warnings and every channel are confirmed', async () => {
    for (const extra of [[numberEvent(99, 1)], [numberEvent(11, 1)]]) {
      const plan = await prepareFlpImport(fixture({ extra }), 'structural.flp');
      expect(plan.blockers.length).toBeGreaterThan(0); expect(() => importFlp(plan, allChoices(plan), { acknowledgeWarnings: true })).toThrow('无法导入');
    }
    const flags = await prepareFlpImport(fixture({ clips: [{ pattern: 1, flags: 96 }] }), 'flags.flp');
    expect(flags.blockers.some(blocker => blocker.includes('flags'))).toBe(true);
  });

  it('requires plugins and unsupported sampler channels to be skipped rather than confirmed into normal notes', async () => {
    for (const channel of [{ name: 'flute', kind: 2 }, { name: 'flute', extra: [numberEvent(89, 1)] }]) {
      const plan = await prepareFlpImport(fixture({ channels: [{ name: 'pling' }, channel], patterns: { 1: [{}, { channel: 1 }] } }), 'unsupported.flp');
      expect(() => importFlp(plan, allChoices(plan), { acknowledgeWarnings: true })).toThrow();
      const selected = choicesFor(plan); selected[1].selected = false;
      const result = importFlp(plan, selected, { acknowledgeWarnings: true }); expect(result.project.tracks).toHaveLength(1);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'flp-skipped-channels' }));
    }
  });

  it('blocks slide and unknown note flags even outside the current crop, but allows that channel to be skipped', async () => {
    for (const flags of [0x4008, 0x4001]) {
      const plan = await prepareFlpImport(fixture({ channels: [{ name: 'pling' }, { name: 'flute' }], patterns: { 1: [{}, { channel: 1, position: 500, flags }] } }), 'slide.flp');
      expect(flpChannelChoiceError(plan, allChoices(plan)[1])).toBeDefined();
      expect(importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true }).project.patterns).toHaveLength(1);
    }
  });

  it('does not guess Play truncated notes retriggers across the left crop boundary', async () => {
    const input = { patterns: { 1: [{ position: 0, length: 96 }, { position: 48 }] }, clips: [{ pattern: 1, offset: 48, length: 48 }] };
    const plain = await prepareFlpImport(fixture(input), 'plain.flp'), retrigger = await prepareFlpImport(fixture({ ...input, extra: [numberEvent(30, 1)] }), 'retrigger.flp');
    expect(importFlp(plain, choicesFor(plain), { acknowledgeWarnings: true }).project.patterns[0].notes).toHaveLength(2);
    expect(() => importFlp(retrigger, choicesFor(retrigger), { acknowledgeWarnings: true })).toThrow('重触发');
  });

  it('rejects actual fractional pitch outside MIDI without clipping and retains legal pitches outside vanilla note-block range', async () => {
    for (const baselineMidi of [0, 127]) {
      const plan = await prepareFlpImport(fixture({ patterns: { 1: [{ key: baselineMidi === 0 ? 65 : 67 }] } }), 'range.flp'), choices = choicesFor(plan); choices[0].baselineMidi = baselineMidi;
      expect(() => importFlp(plan, choices, { acknowledgeWarnings: true })).toThrow('未裁剪');
    }
    const plan = await prepareFlpImport(fixture({ patterns: { 1: [{ key: 79 }] } }), 'wide.flp');
    expect(importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true }).project.patterns[0].notes[0].midi).toBe(79);
    const choices = choicesFor(plan); choices[0].baselineMidi = 114.01;
    expect(() => importFlp(plan, choices, { acknowledgeWarnings: true })).toThrow('未裁剪');
  });

  it('budgets source-note copies before conversion rather than silently truncating a repeated pattern', async () => {
    const plan = await prepareFlpImport(fixture({ patterns: { 1: Array.from({ length: 2001 }, () => ({})) }, clips: Array.from({ length: 1000 }, () => ({ pattern: 1 })) }), 'budget.flp');
    expect(() => importFlp(plan, choicesFor(plan), { acknowledgeWarnings: true })).toThrow('200 万');
    expect(plan.source.patterns[1]).toHaveLength(2001);
  });

  it('budgets independent copies and playlist/channel tracks against the existing project schema', async () => {
    const tooManyCopies = await prepareFlpImport(fixture({ channels: [{ name: 'pling' }, { name: 'flute' }], patterns: { 1: [{}, { channel: 1 }] }, clips: Array.from({ length: 50001 }, () => ({ pattern: 1 })) }), 'copies-limit.flp');
    expect(() => importFlp(tooManyCopies, choicesFor(tooManyCopies), { acknowledgeWarnings: true })).toThrow('10 万');
    const channels = Array.from({ length: 21 }, () => ({ name: 'pling' })), patterns = { 1: channels.map((_, channel) => ({ channel })) }, tracks = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [index + 1, true]));
    const tooManyTracks = await prepareFlpImport(fixture({ channels, patterns, tracks, clips: Array.from({ length: 500 }, (_, index) => ({ pattern: 1, track: index + 1 })) }), 'tracks-limit.flp');
    expect(() => importFlp(tooManyTracks, choicesFor(tooManyTracks), { acknowledgeWarnings: true })).toThrow('1 万');
  });

  it('bounds review work before enumerating a large playlist/channel product', async () => {
    const channels = Array.from({ length: 10001 }, () => ({ name: 'pling' }));
    const bytes = fixture({ channels, patterns: { 1: channels.map((_, channel) => ({ channel })) }, clips: Array.from({ length: 200 }, () => ({ pattern: 1 })) });
    await expect(prepareFlpImport(bytes, 'summary-budget.flp')).rejects.toThrow('组合超过 200 万');
  });

  it('embeds exact original FLP bytes and roundtrips the complete editable project without modifying source or choices', async () => {
    const bytes = fixture(), plan = await prepareFlpImport(bytes, 'original.flp', { 0: { sha256: PLING_HASH } });
    const choices = choicesFor(plan).map(choice => ({ ...choice, confirmed: false })), before = structuredClone(plan), choicesBefore = structuredClone(choices);
    const { project } = importFlp(plan, choices, { acknowledgeWarnings: true }); expect(validateProject(project)).toBe(project);
    expect(project.provenance).toMatchObject({ kind: 'flp', filename: 'original.flp', metadata: { sha256: plan.sourceSha256, version: '26.1.1.5547', ppq: 96, bpm: 120 } });
    const asset = project.assets.find(asset => asset.id === project.provenance!.metadata.sourceAssetId)!;
    expect(asset.mime).toBe('application/x-fl-studio-project'); expect(base64ToBytes(asset.data!)).toEqual(bytes);
    const reopened = openNbsx(saveNbsx(project)), expected = structuredClone(project); expected.modifiedAt = reopened.modifiedAt;
    expect(reopened).toEqual(expected); expect(plan).toEqual(before); expect(choices).toEqual(choicesBefore); expect(bytes).toEqual(before.bytes);
  });
});

const actualPath = process.env.NBSX_FLP_FIXTURE ?? '', oraclePath = process.env.NBSX_FLP_ORACLE ?? '';
const sourceCatalogue = process.env.NBSX_FLP2NBS_CATALOG ?? '';
describe('local real FLP against prior independent Python raw occurrences', () => {
  it.skipIf(!existsSync(actualPath) || !existsSync(oraclePath) || !existsSync(sourceCatalogue))('matches all 884 active occurrences and 3095 stored notes with the original source unchanged', async () => {
    const oracle = JSON.parse(readFileSync(oraclePath, 'utf8')), bytes = new Uint8Array(readFileSync(actualPath)), hash = createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe(oracle.source.sha256);
    const checks = Object.fromEntries(oracle.analysis.channels.map((row: { channel_id: number; pitch_profile: { sample_sha256: string; sample_file: string } }) => {
      const sample = readFileSync(row.pitch_profile.sample_file), sha256 = createHash('sha256').update(sample).digest('hex'); expect(sha256).toBe(row.pitch_profile.sample_sha256);
      return [row.channel_id, { sha256, path: row.pitch_profile.sample_file }];
    }));
    const plan = await prepareFlpImport(bytes, '本地验证曲目A.flp', checks);
    expect(plan.blockers).toEqual([]); expect(plan.channels.filter(row => row.selected).map(row => row.id)).toEqual([5, 6, 11, 12, 13, 14]);
    expect(plan.channels.filter(row => row.selected).every(row => row.verified)).toBe(true);
    const { project } = importFlp(plan, choicesFor(plan).map(choice => ({ ...choice, confirmed: false })), { acknowledgeWarnings: true });
    const catalogueText = readFileSync(sourceCatalogue, 'utf8');
    const catalogue = [...catalogueText.matchAll(/'([a-f0-9]{64})': \{'instrument_id': (\d+), 'file': '[^']+', 'sample_at_root_nbs_key': 45\}/g)];
    expect(catalogue).toHaveLength(16);
    for (const [, sha256, index] of catalogue) {
      const checked = withFlpSampleChecks(plan, { 0: { sha256 } }).channels.find(row => row.id === 0)!;
      expect(checked).toMatchObject({ verified: true, instrumentId: project.instruments.find(instrument => instrument.nbsIndex === Number(index))!.id, baselineMidi: 66 });
    }
    expect(project.ppq).toBe(96); expect(project.tempos).toEqual([{ tick: 0, bpm: 92 }]);
    expect(project.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0)).toBe(3095);
    const actual = flattenNotes(project), instrumentChannel = new Map<number, string>(oracle.analysis.channels.map((row: { channel_id: number; instrument_id: number }) => [row.channel_id, project.instruments.find(instrument => instrument.nbsIndex === row.instrument_id)!.id]));
    expect(actual).toHaveLength(884);
    const expected = oracle.active_occurrences.map(({ absoluteTick, note }: { absoluteTick: number; note: { channel: number; key: number; length: number; velocity: number; pan: number; fine: number } }) => {
      const channel = oracle.project.channels[note.channel];
      return [absoluteTick, note.length, 66 + note.key - channel.root + (channel.pitch + channel.fine + (channel.sampler.stretch_pitch_cents ?? 0) + (note.fine - 120) * 10) / 100,
        note.velocity / 128, channel.pan === 6400 ? note.pan / 64 - 1 : (note.pan / 64 + channel.pan / 6400) / 2 - 1, instrumentChannel.get(note.channel)];
    });
    const sort = (left: (number | string | undefined)[], right: (number | string | undefined)[]) => JSON.stringify(left).localeCompare(JSON.stringify(right));
    expect(actual.map(note => [note.absoluteTick, note.duration, note.midi + note.detune / 100, note.velocity, note.effectivePan, note.effectiveInstrument]).sort(sort)).toEqual(expected.sort(sort));
    const reopened = openNbsx(saveNbsx(project)), normalized = structuredClone(project); normalized.modifiedAt = reopened.modifiedAt; expect(reopened).toEqual(normalized);
    expect(createHash('sha256').update(readFileSync(actualPath)).digest('hex')).toBe(hash);
  });
});
