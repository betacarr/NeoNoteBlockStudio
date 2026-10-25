import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { JavaDecoder, PcmSample } from '../src/core/types';

export type DecodedPcm = PcmSample & { pcm16?: Int16Array };
export function decodeJavaVorbis(decoder: JavaDecoder, encoded: { id: string; bytes: Uint8Array }[]): DecodedPcm[] {
  const temporary = mkdtempSync(path.join(tmpdir(), 'nbsx-codec-'));
  try {
    const files = encoded.map((sample, index) => { const filename = path.join(temporary, `${index}.ogg`); if (sample.bytes.length > 64 * 1024 * 1024) throw new Error('单采样超过 64 MB。'); writeFileSync(filename, sample.bytes); return filename; });
    const output = path.join(temporary, 'decoded.pcm');
    const run = spawnSync(decoder.executable, ['-Xmx512m', '-cp', decoder.classpath.join(path.delimiter), 'studio.nbsx.audio.NbsxVorbisDecoder', decoder.kind, output, ...files], { windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (run.status !== 0) throw new Error(`原版 JOrbis 解码失败：${(run.stderr || run.error?.message || 'Java 进程未成功退出').slice(0, 1200)}`);
    const bytes = readFileSync(output); let offset = 8;
    if (bytes.toString('ascii', 0, 4) !== 'NBSJ' || bytes.readUInt32LE(4) !== encoded.length) throw new Error('JOrbis 返回了无效 PCM。');
    return encoded.map(sample => {
      const sampleRate = bytes.readUInt32LE(offset), channels = bytes.readUInt32LE(offset + 4), length = bytes.readUInt32LE(offset + 8); offset += 12;
      if (![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 192000 || length % (channels * 2) || offset + length > bytes.length) throw new Error('JOrbis PCM 长度或格式无效。');
      const pcm16 = new Int16Array(length / 2); for (let i = 0; i < pcm16.length; i++) pcm16[i] = bytes.readInt16LE(offset + i * 2); offset += length;
      const data = Array.from({ length: channels }, (_, ch) => Float32Array.from({ length: pcm16.length / channels }, (_, frame) => pcm16[frame * channels + ch] / 32768));
      return { id: sample.id, sampleRate, channels, data, pcm16 };
    });
  } finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith('nbsx-codec-')) throw new Error('解码临时目录超出预期范围。');
    rmSync(temporary, { recursive: true, force: true });
  }
}
