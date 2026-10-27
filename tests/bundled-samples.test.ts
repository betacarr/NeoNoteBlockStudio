import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { loadBundledPreviewSamples, PREVIEW_SAMPLE_BANK } from '../src/audio/bundled-samples';
import { INSTRUMENTS } from '../src/core/instruments';
import { createProject, newNote } from '../src/core/project';
import { resolveNoteBlockSounds } from '../src/core/sound-events';

const base = new URL('https://local.test/sounds/');
const localRead: typeof fetch = async input => {
  const url = new URL(String(input));
  expect(url.origin).toBe(base.origin);
  return new Response(Uint8Array.from(await readFile('.local/minecraft-preview-assets' + url.pathname)));
};
afterEach(() => vi.unstubAllGlobals());

describe('Shipped preview bank without a Minecraft installation', () => {
  it('matches the independently hashed official version, asset index and sound-event mappings', async () => {
    const official = async (sha1: string) => {
      const bytes = await readFile(`.local/minecraft-preview-provenance/${sha1}.json`);
      expect(createHash('sha1').update(bytes).digest('hex')).toBe(sha1);
      return JSON.parse(bytes.toString('utf8'));
    };
    const version = await official(PREVIEW_SAMPLE_BANK.metadata.sha1), index = await official(version.assetIndex.sha1);
    expect(version.id).toBe('26.3'); expect(version.assetIndex).toEqual(PREVIEW_SAMPLE_BANK.assetIndex);
    const sounds = resolveNoteBlockSounds(await official(index.objects['minecraft/sounds.json'].hash));
    const samples = await loadBundledPreviewSamples(base, localRead);
    for (const item of PREVIEW_SAMPLE_BANK.samples) {
      expect(item.event).toBe(`block.note_block.${item.id}`);
      expect(sounds[item.id]).toEqual({ event: item.event, path: item.resource, volume: item.volume, pitch: item.pitch, attenuationDistance: item.attenuationDistance });
      expect(createHash('sha1').update(samples[item.id].bytes).digest('hex')).toBe(index.objects[item.resource].hash);
      expect(samples[item.id].bytes.length).toBe(index.objects[item.resource].size);
      expect(samples[item.id].name).toBe(item.resource);
    }
  });
  it('uses the harp2 and bassattack files actually referenced by the game, without instrument normalization', () => {
    expect(PREVIEW_SAMPLE_BANK.samples.find(item => item.id === 'harp')?.resource).toBe('minecraft/sounds/note/harp2.ogg');
    expect(PREVIEW_SAMPLE_BANK.samples.find(item => item.id === 'bass')?.resource).toBe('minecraft/sounds/note/bassattack.ogg');
    for (const sample of PREVIEW_SAMPLE_BANK.samples) expect([sample.volume, sample.pitch, sample.attenuationDistance]).toEqual([1, 1, 16]);
  });
  it('passes the original encoded bytes to the decoder without changing individual sample amplitude', async () => {
    const samples = await loadBundledPreviewSamples(base, localRead), decoded: Uint8Array[] = [];
    const buffer = { duration: 1 };
    vi.stubGlobal('AudioContext', class { decodeAudioData = async (bytes: ArrayBuffer) => { decoded.push(new Uint8Array(bytes)); return buffer; }; });
    const engine = new AudioEngine(); await engine.setPreviewSamples(samples);
    expect(decoded).toEqual(Object.values(samples).map(sample => sample.bytes));
    for (const id of Object.keys(samples)) expect(engine.bufferFor(id)).toBe(buffer);
  });
  it('provides all 20 instrument IDs and reads only local packaged URLs', async () => {
    const samples = await loadBundledPreviewSamples(base, localRead);
    expect(Object.keys(samples).sort()).toEqual(INSTRUMENTS.map(item => item.id).sort());
    for (const sample of Object.values(samples)) expect(sample.sha1).toMatch(/^[a-f0-9]{40}$/);
  });
  it('rejects a missing packaged file with an actionable message', async () => {
    await expect(loadBundledPreviewSamples(base, async () => new Response(null, { status: 404 }))).rejects.toThrow('重新安装');
  });
  it('rejects a modified file even when its name and length are unchanged', async () => {
    const tampered: typeof fetch = async input => {
      const response = await localRead(input), bytes = new Uint8Array(await response.arrayBuffer());
      bytes[bytes.length - 1] ^= 1;
      return new Response(bytes);
    };
    await expect(loadBundledPreviewSamples(base, tampered)).rejects.toThrow('校验失败');
  });
  it('does not require Java, resume the output device, or claim a native game library', async () => {
    const context = { decodeAudioData: vi.fn(async () => ({ duration: 1 })), resume: vi.fn() };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const engine = new AudioEngine();
    expect(await engine.setPreviewSamples(await loadBundledPreviewSamples(base, localRead))).toBe(20);
    expect(context.resume).not.toHaveBeenCalled();
    expect(engine.library).toBeUndefined();
    expect(engine.bufferFor('harp')).toBeDefined();
    expect(engine.bufferFor('harp', false)).toBeUndefined();
    expect(engine.bufferFor('missing-custom-instrument')).toBeUndefined();
  });
  it('keeps explicit game/project samples ahead of preview samples, even if preview decoding finishes later', async () => {
    const fallback = { duration: 1 }, explicit = { duration: 2 } as AudioBuffer;
    const context = { decodeAudioData: vi.fn(async () => fallback) };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const engine = new AudioEngine();
    engine.buffers.set('harp', explicit);
    await engine.setPreviewSamples({ harp: { name: 'harp', bytes: new Uint8Array(1), sha1: '' } });
    expect(engine.bufferFor('harp')).toBe(explicit);
    expect(engine.bufferFor('harp', false)).toBe(explicit);
    engine.buffers.clear();
    expect(engine.bufferFor('harp')).toBe(fallback);
  });
  it('does not pass fallback audio into strict native comparison', async () => {
    const context = { decodeAudioData: vi.fn(async () => ({ duration: 1 })) };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const engine = new AudioEngine(), project = createProject();
    project.patterns[0].notes.push(newNote(0, 66));
    await engine.setPreviewSamples({ harp: { name: 'harp', bytes: new Uint8Array(1), sha1: '' } });
    engine.library = { root: '', version: 'test', profileId: project.audio.profileId, samples: {}, nativeLibrary: 'fixture', nativeDecoder: 'fixture' };
    await expect(engine.nativeRequest(project)).rejects.toThrow('原生对照缺少目标版本采样');
  });
});
