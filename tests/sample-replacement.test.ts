import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applySampleReplacement, inspectSampleReplacement, type SampleReplacementTarget } from '../src/core/sample-replacement';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import { openNbsx, saveNbsx } from '../src/core/container';
import type { Asset } from '../src/core/types';

const replacement = (): Asset => ({ id: crypto.randomUUID(), name: 'replacement.wav', mime: 'audio/wav', data: 'UklGRg==' });
function fixture() {
  const p = createProject('Sample scope');
  p.tracks.push(newTrack('Other harp track', 1));
  p.patterns[0].notes = [
    { ...newNote(0, 66), id: 'implicit-harp', midiSource: { onOrder: 1, offOrder: 2, releaseVelocity: 55 } },
    { ...newNote(960, 69), id: 'explicit-bass', instrumentId: 'bass' },
    { ...newNote(1920, 72), id: 'explicit-harp', instrumentId: 'harp' },
  ];
  p.patterns[0].midiEvents = [{ id: 'expression', tick: 20, order: 3, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 7, value: 90 } }];
  p.drumPresets = [{ id: 'drum-preset', name: 'Independent kit', mappings: [{ id: 'drum-mapping', trigger: 36, notes: [
    { id: 'hit-harp', instrumentId: 'harp', midi: 66, offsetBeats: 0, durationBeats: .25, velocity: 1 },
    { id: 'hit-bass', instrumentId: 'bass', midi: 54, offsetBeats: .25, durationBeats: .25, velocity: .7 },
  ] }] }];
  validateProject(p);
  const track: SampleReplacementTarget = { scope: 'track', instrumentId: 'harp', trackId: p.tracks[0].id, noteIds: ['explicit-bass'] };
  const notes: SampleReplacementTarget = { scope: 'notes', instrumentId: 'bass', trackId: p.tracks[0].id,
    regionId: p.regions[0].id, patternId: p.patterns[0].id, noteIds: ['explicit-bass'] };
  return { p, track, notes };
}

describe('explicit sample replacement targets', () => {
  it('counts project-wide track defaults, explicit overrides and drum hits independently of the current note selection', () => {
    const { p, track, notes } = fixture();
    expect(inspectSampleReplacement(p, track)).toMatchObject({ instrument: { id: 'harp' }, references: { trackDefaults: 2, noteOverrides: 1, drumHits: 1, total: 4 } });
    expect(inspectSampleReplacement(p, notes)).toMatchObject({ instrument: { id: 'bass' }, references: { trackDefaults: 0, noteOverrides: 1, drumHits: 1, total: 2 } });
  });

  it('local track replacement creates a custom independent instrument and changes only that track default', () => {
    const { p, track } = fixture(), before = structuredClone(p), asset = replacement();
    const result = applySampleReplacement(p, track, asset);
    const custom = p.instruments.find(i => i.id === result.instrumentId)!;
    expect(result.instrumentId).not.toBe('harp'); expect(custom).toMatchObject({ rootMidi: before.instruments.find(i => i.id === 'harp')!.rootMidi, assetId: asset.id, sound: before.instruments.find(i => i.id === 'harp')!.sound });
    expect(custom).not.toHaveProperty('nbsIndex'); expect(custom.name).toContain('独立采样');
    expect(p.tracks[0].instrumentId).toBe(custom.id); expect(p.tracks[1]).toEqual(before.tracks[1]);
    expect(p.patterns).toEqual(before.patterns); expect(p.drumPresets).toEqual(before.drumPresets);
    expect(p.instruments.find(i => i.id === 'harp')).toEqual(before.instruments.find(i => i.id === 'harp'));
    expect(p.instruments.find(i => i.id === 'bass')).toEqual(before.instruments.find(i => i.id === 'bass'));
    expect(openNbsx(saveNbsx(p)).tracks).toEqual(p.tracks);
  });

  it('local selected-note replacement routes only explicit target notes and preserves their IDs on an unshared pattern', () => {
    const { p, notes } = fixture(), before = structuredClone(p), result = applySampleReplacement(p, notes, replacement());
    expect(result).toMatchObject({ patternId: notes.patternId, noteIds: ['explicit-bass'] });
    expect(p.patterns[0].notes.find(n => n.id === 'explicit-bass')!.instrumentId).toBe(result.instrumentId);
    expect(p.patterns[0].notes.filter(n => n.id !== 'explicit-bass')).toEqual(before.patterns[0].notes.filter(n => n.id !== 'explicit-bass'));
    expect(p.tracks).toEqual(before.tracks); expect(p.regions).toEqual(before.regions); expect(p.drumPresets).toEqual(before.drumPresets);
    expect(p.instruments.find(i => i.id === 'bass')!.assetId).toBeUndefined();
  });

  it('detaches a shared source only for the selected occurrence, remaps selected IDs and leaves other clips and MIDI data unchanged', () => {
    const { p, notes } = fixture();
    p.regions.push({ ...p.regions[0], id: 'other-occurrence', trackId: p.tracks[1].id, start: 7680 });
    const before = structuredClone(p), result = applySampleReplacement(p, notes, replacement());
    expect(result.patternId).not.toBe(notes.patternId); expect(result.noteIds).toHaveLength(1); expect(result.noteIds![0]).not.toBe('explicit-bass');
    expect(p.regions[0].patternId).toBe(result.patternId); expect(p.regions[1]).toEqual(before.regions[1]);
    expect(p.patterns[0]).toEqual(before.patterns[0]);
    const detached = p.patterns.find(pattern => pattern.id === result.patternId)!;
    expect(detached.notes.map(n => n.id).some(id => before.patterns[0].notes.some(n => n.id === id))).toBe(false);
    expect(detached.notes.find(n => n.id === result.noteIds![0])!.instrumentId).toBe(result.instrumentId);
    expect(detached.notes[0].midiSource).toEqual(before.patterns[0].notes[0].midiSource);
    expect(detached.midiEvents![0].id).not.toBe('expression'); expect(detached.midiEvents![0].event).toEqual(before.patterns[0].midiEvents![0].event);
    expect(validateProject(p)).toBe(p); expect(openNbsx(saveNbsx(p)).patterns).toEqual(p.patterns);
  });

  it('shared replacement changes the captured instrument only, without rerouting notes, tracks or drums', () => {
    const { p, notes } = fixture(), before = structuredClone(p), asset = replacement(), result = applySampleReplacement(p, notes, asset, true);
    expect(result).toEqual({ instrumentId: 'bass', patternId: notes.patternId, noteIds: ['explicit-bass'] });
    expect(p.instruments).toHaveLength(before.instruments.length); expect(p.instruments.find(i => i.id === 'bass')!.assetId).toBe(asset.id);
    expect(p.instruments.find(i => i.id === 'harp')).toEqual(before.instruments.find(i => i.id === 'harp'));
    for (const key of ['tracks', 'patterns', 'regions', 'drumPresets'] as const) expect(p[key]).toEqual(before[key]);
  });

  it('rejects stale, mixed, locked and audio targets before adding a resource or instrument', () => {
    const { p, track, notes } = fixture();
    p.tracks[0].instrumentId = 'bell'; let before = structuredClone(p);
    expect(() => applySampleReplacement(p, track, replacement())).toThrow('默认音色已改变'); expect(p).toEqual(before);
    expect(() => applySampleReplacement(p, { ...notes, noteIds: ['implicit-harp', 'explicit-bass'] }, replacement())).toThrow('实际音色已改变'); expect(p).toEqual(before);
    p.tracks[0].locked = true; before = structuredClone(p);
    expect(() => applySampleReplacement(p, notes, replacement())).toThrow('锁定'); expect(p).toEqual(before);
    p.tracks[0].locked = false; p.regions = []; p.tracks[0].kind = 'audio'; before = structuredClone(p);
    expect(() => applySampleReplacement(p, notes, replacement())).toThrow('轨道或乐器已失效'); expect(p).toEqual(before);
  });

  it('rejects conflicting IDs, invalid embedded audio and malformed explicit sharing without mutating the document', () => {
    const { p, track } = fixture(), before = structuredClone(p);
    expect(() => applySampleReplacement(p, track, { ...replacement(), id: p.tracks[0].id })).toThrow('标识已被工程对象使用');
    expect(() => applySampleReplacement(p, track, { ...replacement(), data: 'not#base64' })).toThrow('Base64');
    expect(() => applySampleReplacement(p, track, { ...replacement(), mime: 'text/plain' })).toThrow('音频资源');
    expect(() => applySampleReplacement(p, track, replacement(), 'yes' as unknown as boolean)).toThrow('明确替换全部引用');
    expect(p).toEqual(before);
  });

  it('works within an Immer transaction and a repeated identical shared sample replacement is a no-op', () => {
    const { p, track } = fixture(), asset = replacement();
    const changed = produce(p, draft => { applySampleReplacement(draft, track, asset, true); });
    expect(p.instruments.find(i => i.id === 'harp')!.assetId).toBeUndefined(); expect(changed.instruments.find(i => i.id === 'harp')!.assetId).toBe(asset.id);
    const same = produce(changed, draft => { applySampleReplacement(draft, track, asset, true); }); expect(same).toBe(changed);
  });

  it('refuses an over-capacity shared-source detach atomically', () => {
    const { p, notes } = fixture(); p.regions.push({ ...p.regions[0], id: 'another-occurrence', start: 10000 });
    while (p.patterns.length < 100000) p.patterns.push({ id: `unused-${p.patterns.length}`, name: 'Unused', length: 1, notes: [] });
    const instruments = p.instruments, originalPattern = p.patterns[0], originalRegion = p.regions[0], beforeAssets = p.assets.length;
    expect(() => applySampleReplacement(p, notes, replacement())).toThrow('工程对象数量超过安全上限');
    expect(p.instruments).toBe(instruments); expect(p.patterns).toHaveLength(100000); expect(p.patterns[0]).toBe(originalPattern); expect(p.regions[0]).toBe(originalRegion); expect(p.assets).toHaveLength(beforeAssets);
  });
});
