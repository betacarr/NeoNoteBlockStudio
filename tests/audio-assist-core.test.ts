import { describe, expect, it } from 'vitest';
import { activeStemGain, applyAudioWorkspace, fixedBeatGrid, mergeChordMarkers, moveChordBoundary, setWorkspaceTempo, validateAudioWorkspace, type AudioWorkspace } from '../src/core/audio-assist';
import { createDemo, createProject, validateProject } from '../src/core/project';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { encodeFloatWav, mixStemPcm, StemPlayer, type StemPcm } from '../src/audio/stem-player';

function fixture(count = 6) {
  const project = createProject();
  project.assets = Array.from({ length: count + 1 }, (_, i) => ({ id: `audio-${i}`, name: `audio-${i}.wav`, mime: 'audio/wav', data: bytesToBase64(encodeFloatWav({ sampleRate: 8000, channels: [new Float32Array(8000)] })) }));
  const workspace: AudioWorkspace = { id: 'workspace', name: 'Original generated test', sourceAssetId: 'audio-0', duration: 1, sampleRate: 8000, frames: 8000, stems: Array.from({ length: count }, (_, i) => ({ id: `stem-${i}`, role: `role-${i}`, name: `Stem ${i}`, assetId: `audio-${i + 1}`, gain: 1, muted: false, solo: false })), bpm: 120, firstBeat: 0, beats: [0, .5, 1], chords: [{ id: 'a', name: 'C', start: 0, end: .5, confidence: .8 }, { id: 'b', name: 'G', start: .5, end: 1, confidence: .3 }], model: { id: 'test-generated', version: '1' }, loop: { enabled: false, start: 0, end: 1 } };
  project.audioWorkspace = workspace;
  return { project, workspace };
}
describe('embedded audio-assist session', () => {
  it.each([2, 6, 8])('roundtrips %i stems with source, mappings and timing independent of cache', count => {
    const { project } = fixture(count); const originalTempo = structuredClone(project.tempos);
    const reopened = openNbsx(saveNbsx(project));
    expect(reopened.audioWorkspace).toEqual(project.audioWorkspace);
    expect(reopened.assets).toEqual(project.assets); expect(reopened.tempos).toEqual(originalTempo);
  });
  it('preserves old projects and their note content', () => { const p = createDemo(); const reopened = openNbsx(saveNbsx(p)); expect(reopened.audioWorkspace).toBeUndefined(); expect(reopened.patterns).toEqual(p.patterns); });
  it('rejects missing embedded bytes rather than silently relying on cache', () => { const { project } = fixture(); delete project.assets[3].data; expect(() => saveNbsx(project)).toThrow('未嵌入'); });
  it('rejects missing references, invalid alignment and invalid marker ranges', () => {
    for (const change of [(w: AudioWorkspace) => w.stems[0].assetId = 'missing', (w: AudioWorkspace) => w.frames += 2, (w: AudioWorkspace) => w.beats = [.5, .5], (w: AudioWorkspace) => w.chords[1].start = .25, (w: AudioWorkspace) => w.loop.end = 0]) {
      const { project, workspace } = fixture(); change(workspace); expect(() => validateProject(project)).toThrow();
    }
  });
  it('edits boundaries and merges without mutating analysis proposal', () => {
    const { workspace: w } = fixture(); const moved = moveChordBoundary(w.chords, 1, .7);
    expect(moved.map(c => [c.start, c.end])).toEqual([[0, .7], [.7, 1]]); expect(w.chords[0].end).toBe(.5);
    expect(mergeChordMarkers(moved, 0)).toEqual([{ ...w.chords[0], end: 1, confidence: .3 }]);
    expect(() => moveChordBoundary(w.chords, 1, 1)).toThrow();
  });
  it('regenerates a fixed beat grid for half/double tempo and first beat, with no project tempo mutation', () => {
    const { workspace: w, project: p } = fixture();
    expect(setWorkspaceTempo(w, 60).beats).toEqual([0, 1]); expect(setWorkspaceTempo(w, 240).beats).toEqual([0, .25, .5, .75, 1]);
    expect(fixedBeatGrid(120, .1, 1)).toEqual([.1, .6]); expect(p.tempos[0].bpm).toBe(120); expect(w.beats).toEqual([0, .5, 1]);
  });
  it('applies only on explicit action, preserving project tempos by default and dropping only exclusive old audio', () => {
    const { project: p, workspace: old } = fixture(2); p.tempos = [{ tick: 0, bpm: 99 }, { tick: 4000, bpm: 130 }];
    p.reference = { assetId: old.stems[0].assetId, startTick: 0, gain: 1 };
    const { project: replacement, workspace: w } = fixture(1);
    w.id = 'replacement'; w.bpm = 111; w.sourceAssetId = 'new-source'; w.stems[0].assetId = 'new-stem';
    const assets = replacement.assets.map((a, i) => ({ ...a, id: i ? 'new-stem' : 'new-source' }));
    const next = applyAudioWorkspace(p, w, assets);
    expect(next.tempos).toEqual(p.tempos); expect(next.assets.map(a => a.id)).toEqual(['audio-1', 'new-source', 'new-stem']);
    expect(p.audioWorkspace).toEqual(old); expect(p.assets).toHaveLength(3);
    expect(applyAudioWorkspace(p, w, assets, true).tempos).toEqual([{ tick: 0, bpm: 111 }]);
    expect(() => applyAudioWorkspace(p, w, [{ ...assets[0], id: 'audio-1', name: 'collision' }])).toThrow('冲突');
  });
  it('supports an analysis-only session with no separated stems', () => { const { project: p, workspace: w } = fixture(0); validateAudioWorkspace(w, p.assets); expect(openNbsx(saveNbsx(p)).audioWorkspace?.stems).toEqual([]); const data = new Float32Array(w.frames); data[3] = .3; expect(mixStemPcm(w, new Map([['__audio_source__', { sampleRate: w.sampleRate, channels: [data] }]])).channels[0][3]).toBeCloseTo(.3); });
});
describe('sample aligned stem mix and WAV', () => {
  it('mixes impulses at identical frames and preserves overs above full scale', () => {
    const { workspace: w } = fixture(2), buffers = new Map<string, StemPcm>();
    for (const s of w.stems) { const ch = new Float32Array(w.frames); ch[45] = .8; buffers.set(s.id, { sampleRate: 8000, channels: [ch] }); }
    const pcm = mixStemPcm(w, buffers); expect(pcm.channels[0][44]).toBe(0); expect(pcm.channels[0][45]).toBeCloseTo(1.6); expect(pcm.channels[0][46]).toBe(0);
    const bytes = encodeFloatWav(pcm), view = new DataView(bytes.buffer); expect(view.getUint16(20, true)).toBe(3); expect(view.getFloat32(44 + 45 * 4, true)).toBeCloseTo(1.6);
    w.stems[0].solo = true; expect(mixStemPcm(w, buffers).channels[0][45]).toBeCloseTo(.8);
    w.stems[0].muted = true; expect(mixStemPcm(w, buffers).channels[0][45]).toBe(0);
    expect(mixStemPcm(w, buffers, w.stems[0].id).channels[0][45]).toBeCloseTo(.8);
    expect(activeStemGain(w.stems[1], w.stems)).toBe(0);
  });
  it('rejects a shortened stem and invalid export ID', () => { const { workspace: w } = fixture(1); expect(() => mixStemPcm(w, new Map([['stem-0', { sampleRate: 8000, channels: [new Float32Array(7999)] }]]))).toThrow('未对齐'); expect(() => mixStemPcm(w, new Map(), 'missing')).toThrow('不存在'); });
  it('schedules all sources on the same clock and offset, with native aligned looping and immediate mixer control', async () => {
    const { workspace: w, project: p } = fixture(2); const starts: number[][] = [], nodes: any[] = [];
    const ctx = { currentTime: 10, destination: {}, sampleRate: 8000, resume: async () => {},
      decodeAudioData: async () => ({ sampleRate: 8000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }),
      createBufferSource: () => { const n: any = { connect: () => {}, disconnect: () => {}, stop: () => {}, start: (...args: number[]) => starts.push(args) }; nodes.push(n); return n; },
      createGain: () => ({ gain: { value: 0, setValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }) };
    const player = new StemPlayer(ctx as unknown as AudioContext); await player.load(w, p.assets);
    w.loop = { enabled: true, start: .2, end: .8 }; player.update(w); await player.play(.3);
    expect(starts).toEqual([[10.025, .3], [10.025, .3]]); expect(nodes.every(n => n.loop && n.loopStart === .2 && n.loopEnd === .8)).toBe(true);
    ctx.currentTime = 11.025; expect(player.currentTime).toBeCloseTo(.7); player.stop(); expect(player.playing).toBe(false); player.dispose();
  });
  it('does not restart sound after stop or disposal while the audio context is resuming', async () => {
    const { workspace: w, project: p } = fixture(1); let resume!: () => void; let created = 0;
    const ctx = { currentTime: 0, resume: () => new Promise<void>(resolve => resume = resolve), decodeAudioData: async () => ({ sampleRate: 8000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }), createBufferSource: () => { created++; throw new Error('must not schedule'); } };
    const player = new StemPlayer(ctx as unknown as AudioContext); player.update(w); await player.load(w, p.assets);
    const pending = player.play(); player.stop(); resume(); await pending; expect(player.playing).toBe(false); expect(created).toBe(0);
    const again = player.play(); player.dispose(); resume(); await again; expect(created).toBe(0);
  });
});

describe('separation-only analysis metadata', () => {
  it('round trips unanalysed audio without applying its placeholder tempo', () => {
    const {project,workspace}=fixture();
    workspace.analysisPerformed=false; workspace.beats=[]; workspace.chords=[];
    project.tempos=[{tick:0,bpm:87}];
    validateAudioWorkspace(workspace,project.assets);
    const reopened=openNbsx(saveNbsx(project));
    expect(reopened.audioWorkspace?.analysisPerformed).toBe(false);
    expect(applyAudioWorkspace(project,workspace,project.assets).tempos[0].bpm).toBe(87);
    expect(()=>applyAudioWorkspace(project,workspace,project.assets,true)).toThrow('尚未分析曲速');
    workspace.beats=[0];expect(()=>validateAudioWorkspace(workspace,project.assets)).toThrow('未执行分析');
  });
});
