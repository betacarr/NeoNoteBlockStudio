import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeJavaVorbis } from '../electron/java-decoder';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe('Java Vorbis adapter package isolation', () => {
  it.each(['legacy-jorbis', 'jorbis'] as const)('uses the isolated helper for %s without changing the checked classpath', kind => {
    let temporary = '';
    vi.mocked(spawnSync).mockImplementation((_file, args) => {
      expect(args?.[3]).toBe('studio.nbsx.audio.NbsxVorbisDecoder');
      expect(args?.[2]).toBe(['checked-helper-root', 'original-signed-client.jar'].join(path.delimiter));
      expect(args?.[4]).toBe(kind);
      const output = String(args?.[5]); temporary = path.dirname(output);
      const packet = Buffer.alloc(24);
      packet.write('NBSJ'); packet.writeUInt32LE(1, 4);
      packet.writeUInt32LE(44100, 8); packet.writeUInt32LE(1, 12); packet.writeUInt32LE(4, 16);
      packet.writeInt16LE(-32768, 20); packet.writeInt16LE(16384, 22);
      writeFileSync(output, packet);
      return { pid: 1, output: ['', '', ''], stdout: '', stderr: '', status: 0, signal: null };
    });
    const result = decodeJavaVorbis({ executable: 'java', classpath: ['checked-helper-root', 'original-signed-client.jar'], kind }, [{ id: 'harp', bytes: new Uint8Array([1, 2, 3]) }]);
    expect(result[0].sampleRate).toBe(44100);
    expect(Array.from(result[0].pcm16!)).toEqual([-32768, 16384]);
    expect(Array.from(result[0].data[0])).toEqual([-1, .5]);
    expect(existsSync(temporary)).toBe(false);
  });
});
