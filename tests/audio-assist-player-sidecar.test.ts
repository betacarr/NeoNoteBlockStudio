import { afterEach, describe, expect, it, vi } from 'vitest';
import { StemPlayer } from '../src/audio/stem-player';
import type { AudioWorkspace } from '../src/core/audio-assist';
import type { Asset } from '../src/core/types';

function fixture(duration = 305, count = 6) {
  const sampleRate = 44100, frames = duration * sampleRate;
  const assets: Asset[] = Array.from({ length: count + 1 }, (_, i) => { const sha256 = i.toString(16).padStart(64, '0'); return { id: `file-${i}`, name: `${i}.wav`, mime: 'audio/wav', audioFile: { sha256, bytes: 44 + frames * 8, sampleRate, frames, channels: 2, file: `audio/${sha256}.wav` } }; });
  const workspace: AudioWorkspace = { id: 'full-song', name: 'Full song', sourceAssetId: 'file-0', duration, sampleRate, frames, bpm: 120, firstBeat: 0, beats: [], chords: [], stems: assets.slice(1).map((a, i) => ({ id: `stem-${i}`, role: `${i}`, name: `分轨 ${i}`, assetId: a.id, gain: 1, muted: false, solo: false })), model: { id: 'fixture', version: '1' }, loop: { enabled: false, start: 0, end: duration } };
  const starts: number[][] = [];
  const context = { sampleRate, currentTime: 0, destination: {}, resume: async () => {}, decodeAudioData: vi.fn(async () => ({ sampleRate, duration, numberOfChannels: 2 })), createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {}, start(...args: number[]) { starts.push(args); } }), createGain: () => ({ gain: { value: 0, setValueAtTime() {} }, connect() {}, disconnect() {} }) };
  return { workspace, assets, context, starts };
}
afterEach(() => vi.unstubAllGlobals());
describe('managed audio playback', () => {
  it('loads all six full-song sidecars beyond the old archive limit through desktop capabilities without base64', async () => {
    const { workspace, assets, context, starts } = fixture();
    expect(assets.slice(1).reduce((sum, a) => sum + a.audioFile!.bytes, 0)).toBeGreaterThan(240 * 1024 ** 2);
    const resolver = vi.fn(async () => 'nbsx://app/audio-assets/token-1'); vi.stubGlobal('window', { desktop: { resolveAudioAsset: resolver } });
    // Virtual decoder/transfer exercise duration and routing, without allocating 754 MB in a unit test.
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => ({ byteLength: assets[0].audioFile!.bytes }) })); vi.stubGlobal('fetch', fetcher);
    const player = new StemPlayer(context as unknown as AudioContext); await player.load(workspace, assets); await player.play(300);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(6); expect(resolver).toHaveBeenCalledTimes(6); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(starts).toEqual(Array(6).fill([.025, 300])); player.dispose();
  });
  it('requires the desktop resolver and never interprets a descriptor as an absolute filesystem path', async () => {
    const { workspace, assets, context } = fixture(1, 1); vi.stubGlobal('window', {});
    await expect(new StemPlayer(context as unknown as AudioContext).load(workspace, assets)).rejects.toThrow('桌面版');
  });
  it.each(['file:///C:/private.wav', 'https://example.com/audio.wav', 'nbsx://other/audio-assets/token', 'nbsx://app/assets/token', 'nbsx://app/audio-assets/token?q=1', 'nbsx://app/audio-assets/token#fragment'])('rejects a non-capability URL %s without fetching', async url => {
    const { workspace, assets, context } = fixture(1, 1); vi.stubGlobal('window', { desktop: { resolveAudioAsset: async () => url } }); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(new StemPlayer(context as unknown as AudioContext).load(workspace, assets)).rejects.toThrow('未获授权'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports missing sidecars or byte corruption without leaving partially loaded playback', async () => {
    const { workspace, assets, context } = fixture(1, 1); vi.stubGlobal('window', { desktop: { resolveAudioAsset: async () => 'nbsx://app/audio-assets/token' } });
    const player = new StemPlayer(context as unknown as AudioContext);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 })); await expect(player.load(workspace, assets)).rejects.toThrow('404'); await expect(player.play()).rejects.toThrow('先载入');
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(44) })); await expect(player.load(workspace, assets)).rejects.toThrow('大小不匹配');
  });
  it('rejects corrupted audio decoding and wrong channel metadata clearly', async () => {
    const { workspace, assets, context } = fixture(1, 1); vi.stubGlobal('window', { desktop: { resolveAudioAsset: async () => 'nbsx://app/audio-assets/token' } });
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(assets[0].audioFile!.bytes) }));
    context.decodeAudioData.mockRejectedValueOnce(new Error('bad RIFF')); const player = new StemPlayer(context as unknown as AudioContext); await expect(player.load(workspace, assets)).rejects.toThrow('解码失败');
    context.decodeAudioData.mockResolvedValueOnce({ sampleRate: 44100, duration: 1, numberOfChannels: 1 }); await expect(player.load(workspace, assets)).rejects.toThrow('声道');
  });
  it('cancels an in-flight transfer on disposal and does not decode or play stale results', async () => {
    const { workspace, assets, context } = fixture(1, 1); let deliver!: (response: object) => void; let signal!: AbortSignal;
    vi.stubGlobal('window', { desktop: { resolveAudioAsset: async () => 'nbsx://app/audio-assets/token' } });
    vi.stubGlobal('fetch', (_url: string, options: { signal: AbortSignal }) => { signal = options.signal; return new Promise(resolve => deliver = resolve); });
    const player = new StemPlayer(context as unknown as AudioContext); const loading = player.load(workspace, assets); await Promise.resolve(); await Promise.resolve();
    player.dispose(); expect(signal.aborted).toBe(true); deliver({ ok: true, arrayBuffer: async () => new ArrayBuffer(assets[0].audioFile!.bytes) }); await loading; expect(context.decodeAudioData).not.toHaveBeenCalled();
  });
  it('reports an explicit full-buffer memory limit for an hour-long six-stem session without truncating or downloading', async () => {
    const { workspace, assets, context } = fixture(3601); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const player = new StemPlayer(context as unknown as AudioContext); await expect(player.load(workspace, assets)).rejects.toThrow('内存过大'); expect(fetcher).not.toHaveBeenCalled(); expect(workspace.duration).toBe(3601); expect(assets[0].audioFile!.frames).toBe(3601 * 44100);
  });
});
