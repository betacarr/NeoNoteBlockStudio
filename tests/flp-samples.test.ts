import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectFlpSamples } from '../electron/flp-samples';

async function cleanup(folder: string) {
  if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('nbsx-flp-')) throw new Error('Unexpected temporary directory');
  await rm(folder, { recursive: true, force: true });
}

describe('read-only desktop FLP sample fingerprints', () => {
  it('resolves relative and absolute referenced samples, without changing source bytes', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'nbsx-flp-'));
    try {
      await mkdir(path.join(folder, 'samples'));
      const source = path.join(folder, 'song.flp'), sample = path.join(folder, 'samples', 'pling.ogg');
      const content = Uint8Array.of(2, 4, 6, 8); await writeFile(source, 'original-flp'); await writeFile(sample, content);
      const result = await inspectFlpSamples(source, [{ id: 1, path: path.join('samples', 'pling.ogg') }, { id: 2, path: sample }]);
      const check = { path: sample, sha256: createHash('sha256').update(content).digest('hex') };
      expect(result).toEqual({ 1: check, 2: check });
      expect(await readFile(source, 'utf8')).toBe('original-flp'); expect(new Uint8Array(await readFile(sample))).toEqual(content);
    } finally { await cleanup(folder); }
  });

  it('leaves missing, macro, non-audio and oversized references unverified', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'nbsx-flp-'));
    try {
      await writeFile(path.join(folder, 'text.txt'), 'private'); await writeFile(path.join(folder, 'large.wav'), Buffer.alloc(16 * 1024 * 1024 + 1));
      const result = await inspectFlpSamples(path.join(folder, 'song.flp'), [
        { id: 0, path: 'absent.ogg' }, { id: 1, path: '%FLStudioUserData%/sample.wav' }, { id: 2, path: 'text.txt' }, { id: 3, path: 'large.wav' },
      ]);
      expect(result).toEqual({});
    } finally { await cleanup(folder); }
  });

  it('rejects malformed inspection requests before accessing files', async () => {
    await expect(inspectFlpSamples('relative.flp', [])).rejects.toThrow();
    await expect(inspectFlpSamples(path.resolve('song.nbsx'), [])).rejects.toThrow();
    await expect(inspectFlpSamples(path.resolve('song.flp'), [{ id: -1, path: 'x.wav' }])).rejects.toThrow();
    await expect(inspectFlpSamples(path.resolve('song.flp'), [{ id: 1, path: 'x\0.wav' }])).rejects.toThrow();
    await expect(inspectFlpSamples(path.resolve('song.flp'), Array(1025).fill({ id: 1, path: 'x.wav' }))).rejects.toThrow();
  });
});
