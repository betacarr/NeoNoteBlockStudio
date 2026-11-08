import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { applyAudioWorkspace, projectUsesExternalAudio, requireEmbeddedAudioWorkspace, validateAudioAssets, validateAudioFileAsset, validateAudioWorkspace, type AudioWorkspace } from '../src/core/audio-assist';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createDemo } from '../src/core/project';
import type { Asset, AudioFileAsset } from '../src/core/types';

function fixture(count = 6) {
  const project = createDemo(), duration = 305, sampleRate = 44100, frames = duration * sampleRate;
  const assets: Asset[] = Array.from({ length: count + 1 }, (_, i) => {
    const sha256 = i.toString(16).padStart(64, '0');
    return { id: `managed-audio-${i}`, name: `${i}.wav`, mime: 'audio/wav', audioFile: { sha256, bytes: 44 + frames * 8, sampleRate, frames, channels: 2, file: `audio/${sha256}.wav` } };
  });
  const workspace: AudioWorkspace = { id: 'managed-workspace', name: '五分钟完整歌曲', sourceAssetId: assets[0].id, duration, sampleRate, frames, stems: assets.slice(1).map((asset, i) => ({ id: `stem-${i}`, role: `role-${i}`, name: `${i}`, assetId: asset.id, gain: 1, muted: false, solo: false })), bpm: 120, firstBeat: .05, beats: [.05, .55], chords: [], model: { id: 'metadata-test', version: '1' }, loop: { enabled: false, start: 0, end: duration } };
  project.assets.push(...assets); project.audioWorkspace = workspace;
  return { project, assets, workspace };
}
describe('managed full-song audio sidecars', () => {
  it.each([0, 6, 8])('keeps a full-length %i-stem manifest small, relocatable and independent of filesystem availability', count => {
    const { project, assets, workspace } = fixture(count);
    expect(projectUsesExternalAudio(project)).toBe(true);
    expect(() => validateAudioWorkspace(workspace, project.assets)).not.toThrow();
    expect(() => requireEmbeddedAudioWorkspace(project)).not.toThrow();
    const bytes = saveNbsx(project); expect(bytes.length).toBeLessThan(15000);
    const files = unzipSync(bytes); expect(Object.keys(files).filter(name => name.startsWith('assets/'))).toEqual([]);
    const reopened = openNbsx(bytes);
    expect(reopened.assets).toEqual(assets); expect(reopened.audioWorkspace).toEqual(workspace);
    expect(reopened.patterns).toEqual(project.patterns); expect(reopened.tempos).toEqual(project.tempos);
  });
  it('never serializes a transient absolute asset path with a sidecar descriptor', () => {
    const { project } = fixture(); project.assets[0].path = 'C:\\private\\not-for-manifest.wav';
    const manifest = JSON.parse(strFromU8(unzipSync(saveNbsx(project))['project.json']));
    expect(manifest.assets[0].path).toBeUndefined(); expect(manifest.assets[0].audioFile.file).toMatch(/^audio\/[a-f0-9]{64}\.wav$/);
    expect(project.assets[0].path).toBeDefined();
  });
  it('does not weaken archive limits or require sidecar files to be present to open note content', () => {
    const { project } = fixture();
    const reopened = openNbsx(saveNbsx(project)); expect(reopened.patterns[0].notes).toHaveLength(30);
    expect(reopened.assets.every(a => a.audioFile && !a.data && !a.path)).toBe(true);
  });
  it.each(['../audio/hash.wav', '/audio/hash.wav', 'C:\\audio\\hash.wav', 'audio/../hash.wav', 'https://example.com/audio.wav', 'audio/hash.wav'])('rejects arbitrary or traversing descriptor paths: %s', file => {
    const { assets } = fixture(); expect(() => validateAudioFileAsset({ ...assets[0].audioFile, file })).toThrow();
  });
  it('rejects extra transient fields, unsafe metadata, dual sources and alignment mismatches', () => {
    const { project, assets, workspace } = fixture(); const file = assets[0].audioFile!;
    for (const change of [{ token: 'runtime' }, { path: 'C:\\private' }, { sha256: file.sha256.toUpperCase().replace('0', 'A') }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { channels: 0 }, { frames: -1 }, { sampleRate: 0 }]) expect(() => validateAudioFileAsset({ ...file, ...change })).toThrow();
    assets[0].data = 'AAAA'; expect(() => validateAudioAssets(assets)).toThrow('同时'); delete assets[0].data;
    assets[0].audioFile!.frames--; expect(() => validateAudioWorkspace(workspace, project.assets)).toThrow('未对齐');
  });
  it('applies managed resources without base64 and preserves original project until committed', () => {
    const original = createDemo(), { workspace, assets } = fixture();
    const next = applyAudioWorkspace(original, workspace, assets);
    expect(next.audioWorkspace).toEqual(workspace); expect(next.assets).toEqual(assets); expect(original.audioWorkspace).toBeUndefined(); expect(original.assets).toEqual([]);
    expect(openNbsx(saveNbsx(next)).audioWorkspace).toEqual(workspace);
  });
});
