import { describe, expect, it } from 'vitest';
import { createAudioClipClipboard, deleteAudioClipGroup, inspectAudioClipSelection, planAudioClipPaste, type AudioClipPastePlan } from '../src/core/audio-region-clipboard';
import { createProject, newTrack, validateProject } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import type { AudioFileAsset, Project, Track } from '../src/core/types';
import { openNbsx, saveNbsx } from '../src/core/container';

function fixture() {
  const p = createProject('Audio clip editing');
  const a: Track = { ...newTrack('Audio A', 1), kind: 'audio' }, b: Track = { ...newTrack('Audio B', 2), kind: 'audio' };
  p.tracks.push(a, b);
  const file: AudioFileAsset = { sha256: 'a'.repeat(64), file: `audio/${'a'.repeat(64)}.wav`, sampleRate: 48000, frames: 480000, channels: 2, bytes: 3840044 };
  p.assets.push({ id: 'source-audio', name: 'source.wav', mime: 'audio/wav', audioFile: file });
  p.audioClips = [
    { id: 'clip-a', trackId: a.id, assetId: 'source-audio', name: 'Trimmed A', start: 1920, offsetSeconds: 1.25, durationSeconds: 2.5, muted: true },
    { id: 'clip-b', trackId: b.id, assetId: 'source-audio', name: 'Trimmed B', start: 3840, offsetSeconds: 2, durationSeconds: 1 },
  ];
  validateProject(p);
  return { p, a, b, ids: new Set(['clip-a', 'clip-b']) };
}
function apply(p: Project, plan: AudioClipPastePlan) {
  const next = structuredClone(p);
  next.tracks.push(...structuredClone(plan.tracks)); next.assets.push(...structuredClone(plan.assets));
  (next.audioClips ??= []).push(...structuredClone(plan.clips));
  return next;
}

describe('audio clip clipboard transactions', () => {
  it('copies complete trimmed clips and managed descriptors without modifying the source or sharing mutable data', () => {
    const { p, a, ids } = fixture(); a.locked = true;
    const before = structuredClone(p), copied = createAudioClipClipboard(p, ids, 7, 'clip-b');
    expect(p).toEqual(before); expect(copied.primaryClipId).toBe('clip-b'); expect(copied.clips).toEqual(p.audioClips);
    expect(copied.assets).toEqual(p.assets); expect(copied.tracks).toHaveLength(2);
    copied.clips[0].offsetSeconds = 5; copied.assets[0].audioFile!.channels = 1;
    expect(p.audioClips![0].offsetSeconds).toBe(1.25); expect(p.assets[0].audioFile!.channels).toBe(2);
    expect(inspectAudioClipSelection(p, ids).ok).toBe(false); expect(inspectAudioClipSelection(p, ids, undefined, true).ok).toBe(true);
  });

  it('pastes on original rows with new clip IDs, relative start offsets and original seconds; the plan is pure and roundtrips', () => {
    const { p, ids } = fixture(), before = structuredClone(p), copied = createAudioClipClipboard(p, ids, 3, 'clip-b');
    p.tempos = [{ tick: 0, bpm: 72 }, { tick: 8000, bpm: 180 }]; const original = structuredClone(p);
    const plan = planAudioClipPaste(p, copied, 9600, undefined, 3);
    expect(p).toEqual(original); expect(plan.tracks).toHaveLength(0); expect(plan.assets).toHaveLength(0);
    expect(plan.clips.map(c => c.start)).toEqual([9600, 11520]); expect(plan.clips.map(c => c.trackId)).toEqual(before.audioClips!.map(c => c.trackId));
    expect(plan.clips[0]).toMatchObject({ offsetSeconds: 1.25, durationSeconds: 2.5, muted: true });
    expect(plan.clips.every(c => !ids.has(c.id))).toBe(true); expect(plan.primaryClipId).toBe(plan.clips[1].id);
    const merged = apply(p, plan); expect(validateProject(merged)).toBe(merged);
    const roundtrip = openNbsx(saveNbsx(merged)); expect(roundtrip.audioClips).toEqual(merged.audioClips);
    expect(createTempoMap(merged).seconds(plan.clips[1].start)).toBeGreaterThan(createTempoMap(merged).seconds(plan.clips[0].start));
  });

  it('cut retains resources so a paste restores content after the source clips are gone', () => {
    const { p, ids } = fixture(), copied = createAudioClipClipboard(p, ids);
    const assets = structuredClone(p.assets), regions = structuredClone(p.regions);
    expect(deleteAudioClipGroup(p, ids).map(c => c.id)).toEqual(['clip-a', 'clip-b']);
    expect(p.audioClips).toEqual([]); expect(p.assets).toEqual(assets); expect(p.regions).toEqual(regions);
    const plan = planAudioClipPaste(p, copied, 0); expect(plan.clips.map(c => c.start)).toEqual([0, 1920]);
    expect(validateProject(apply(p, plan))).toBeDefined();
  });

  it('maps selected audio rows from the target and creates standalone audio rows without copying stack membership', () => {
    const { p, a, b, ids } = fixture();
    const group = { ...newTrack('Stems', 3), kind: 'audio' as const, audioGroup: { sourceClipId: 'clip-a', collapsed: false } };
    p.tracks.splice(p.tracks.indexOf(b), 0, group); b.parentTrackId = group.id;
    const copied = createAudioClipClipboard(p, ids), plan = planAudioClipPaste(p, copied, 5000, b.id);
    expect(plan.clips[0].trackId).toBe(b.id); expect(plan.tracks).toHaveLength(1); expect(plan.clips[1].trackId).toBe(plan.tracks[0].id);
    expect(plan.tracks[0].kind).toBe('audio'); expect(plan.tracks[0]).not.toHaveProperty('parentTrackId'); expect(plan.tracks[0]).not.toHaveProperty('audioGroup');
    expect(validateProject(apply(p, plan))).toBeDefined();
    expect(() => planAudioClipPaste(p, copied, 0, group.id)).toThrow('普通音频轨道');
    expect(a.id).not.toBe(b.id);
  });

  it('refuses invalid or partially locked/hidden selections without deleting any member', () => {
    const { p, a, b, ids } = fixture(), copied = createAudioClipClipboard(p, ids);
    b.locked = true; let before = structuredClone(p);
    expect(() => deleteAudioClipGroup(p, ids)).toThrow('锁定'); expect(p).toEqual(before);
    expect(() => planAudioClipPaste(p, copied, 0, a.id)).toThrow('锁定'); expect(p).toEqual(before);
    b.locked = false; before = structuredClone(p);
    expect(() => deleteAudioClipGroup(p, ids, new Set([a.id]))).toThrow('隐藏'); expect(p).toEqual(before);
    expect(() => createAudioClipClipboard(p, new Set(['clip-a', 'stale']))).toThrow('失效');
    expect(() => planAudioClipPaste(p, copied, 0, p.tracks[0].id)).toThrow('普通音频轨道');
    expect(() => deleteAudioClipGroup(p, new Set())).toThrow('请选择');
  });

  it('refuses cross-project and reopened-document paste explicitly, and rejects a changed resource rather than overwriting it', () => {
    const { p, ids } = fixture(), copied = createAudioClipClipboard(p, ids, 8), other = fixture().p;
    expect(() => planAudioClipPaste(other, copied, 0, undefined, 8)).toThrow('同一打开工程');
    expect(() => planAudioClipPaste(p, copied, 0, undefined, 9)).toThrow('同一打开工程');
    p.assets[0].name = 'replaced.wav'; const before = structuredClone(p);
    expect(() => planAudioClipPaste(p, copied, 0, undefined, 8)).toThrow('来源资源已改变'); expect(p).toEqual(before);
  });

  it('retains the full analysis resource closure and makes nested analysis independent on paste', () => {
    const { p } = fixture(), source = p.audioClips![0];
    p.assets.push({ ...structuredClone(p.assets[0]), id: 'analysis-stem', name: 'stem.wav' });
    source.analysis = { id: 'analysis', name: 'Analysis', sourceAssetId: 'source-audio', duration: 10, sampleRate: 48000, frames: 480000,
      bpm: 120, firstBeat: 0, beats: [0, .5], chords: [{ id: 'chord', start: 0, end: 1, name: 'C', confidence: .8 }], model: { id: 'fixture', version: '1' },
      loop: { enabled: false, start: 0, end: 10 }, stems: [{ id: 'stem', role: 'vocals', name: 'Vocals', assetId: 'analysis-stem', gain: 1, muted: false, solo: false }] };
    const copied = createAudioClipClipboard(p, new Set([source.id])), plan = planAudioClipPaste(p, copied, 0);
    expect(copied.assets.map(a => a.id)).toEqual(['source-audio', 'analysis-stem']);
    plan.clips[0].analysis!.chords[0].name = 'Dm'; expect(source.analysis.chords[0].name).toBe('C'); expect(copied.clips[0].analysis!.chords[0].name).toBe('C');
    expect(validateProject(apply(p, plan))).toBeDefined();
  });

  it('rejects overflowing time and malformed clipboard resources before modifying the document', () => {
    const { p, ids } = fixture(), copied = createAudioClipClipboard(p, ids), before = structuredClone(p);
    expect(() => planAudioClipPaste(p, copied, 1e12)).toThrow('超过工程范围');
    copied.assets[0].audioFile!.sha256 = 'invalid'; expect(() => planAudioClipPaste(p, copied, 0)).toThrow(); expect(p).toEqual(before);
  });
});
