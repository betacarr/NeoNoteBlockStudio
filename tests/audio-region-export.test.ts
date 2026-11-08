import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AudioAssetStore, readAudioWavLayout } from '../electron/audio-asset-store';
import { exportAudioRegions, validateRegionExport } from '../electron/audio-region-export';
import { encodeFloatWav } from '../src/audio/stem-player';
import type { AudioRegionExportRequest } from '../src/core/audio-region-export';

async function readPayload(filename: string) {
  const input = await open(filename, 'r');
  try {
    const layout = await readAudioWavLayout(input);
    const bytes = Buffer.alloc(layout.frames * layout.alignment);
    await input.read(bytes, 0, bytes.length, layout.dataOffset);
    return { layout, bytes };
  } finally { await input.close(); }
}

describe('export selected audio regions', () => {
  it('keeps stereo samples and rate through adjacent fractional trims, and assigns distinct filenames', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'neonbs-regions-'));
    try {
      const sampleRate = 48000;
      const channels = [Float32Array.from({ length: 60 }, (_, index) => index / 16), Float32Array.from({ length: 60 }, (_, index) => -index / 17)];
      const pcm = Buffer.from(encodeFloatWav({ sampleRate, channels }));
      const source = path.join(root, 'source.wav');
      await writeFile(source, pcm);
      const store = new AudioAssetStore();
      const file = await store.register(1, source, { sampleRate, frames: 60, channels: 2 });
      const existing = path.join(root, 'BASS.wav');
      await writeFile(existing, 'existing file');
      const start = 1.4 / sampleRate, split = 26.5 / sampleRate, end = 51.2 / sampleRate;
      const request: AudioRegionExportRequest = { sources: [{ file }], regions: [
        { source: 0, name: 'Bass', offsetSeconds: start, durationSeconds: split - start },
        { source: 0, name: 'bass.wav', offsetSeconds: split, durationSeconds: end - split },
      ] };
      validateRegionExport(request);
      const files = await exportAudioRegions(request, { directory: root }, asset => store.inputPath(1, asset));
      expect(files.map(filename => path.basename(filename))).toEqual(['Bass (2).wav', 'bass (3).wav']);
      expect(await readFile(existing, 'utf8')).toBe('existing file');
      const first = await readPayload(files[0]), second = await readPayload(files[1]);
      expect(first.layout).toMatchObject({ sampleRate, frames: 25, channels: 2 });
      expect(second.layout).toMatchObject({ sampleRate, frames: 25, channels: 2 });
      expect(Buffer.concat([first.bytes, second.bytes])).toEqual(pcm.subarray(44 + 8, 44 + 51 * 8));
      expect((await readdir(root)).some(name => name.startsWith('.neonbs-export-'))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('supports embedded WAV and leaves all outputs untouched when a batch has an invalid range', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'neonbs-regions-'));
    try {
      const pcm = Buffer.from(encodeFloatWav({ sampleRate: 44100, channels: [Float32Array.of(.25, .5, -.5)] }));
      const request: AudioRegionExportRequest = { sources: [{ data: pcm.toString('base64') }], regions: [
        { source: 0, name: '片段', offsetSeconds: 1 / 44100, durationSeconds: 2 / 44100 },
        { source: 0, name: '无效', offsetSeconds: 1, durationSeconds: 1 },
      ] };
      const resolve = async () => { throw new Error('Embedded audio should not resolve a managed asset'); };
      await expect(exportAudioRegions(request, { directory: root }, resolve)).rejects.toThrow('超出源音频');
      expect(await readdir(root)).toEqual([]);
      const target = path.join(root, 'chosen.wav');
      await exportAudioRegions({ ...request, regions: [request.regions[0]] }, { file: target }, resolve);
      const result = await readPayload(target);
      expect(result.layout).toMatchObject({ sampleRate: 44100, frames: 2, channels: 1 });
      expect(result.bytes).toEqual(pcm.subarray(48));
      const sidecar = path.join(root, 'test.nbsx.assets');
      await mkdir(sidecar);
      await expect(exportAudioRegions({ ...request, regions: [request.regions[0]] }, { directory: sidecar }, resolve)).rejects.toThrow('工程资源目录');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
