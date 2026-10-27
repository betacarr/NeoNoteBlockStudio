import bank from '../../third_party/minecraft-samples/manifest.json';
import type { SampleLibrary } from '../core/types';

export const PREVIEW_SAMPLE_BANK = bank;
const digest = async (algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

/** Shipped files only: playback never downloads game resources at runtime. */
export async function loadBundledPreviewSamples(
  base: URL = new URL('./sounds/', document.baseURI), read: typeof fetch = fetch,
): Promise<SampleLibrary['samples']> {
  const entries = await Promise.all(bank.samples.map(async sample => {
    const response = await read(new URL(sample.file, base));
    if (!response.ok) throw new Error(`内置试听采样缺失：${sample.id}。请重新安装完整版本。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== sample.bytes || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'OggS'
      || await digest('SHA-256', bytes) !== sample.sha256 || await digest('SHA-1', bytes) !== sample.sha1) throw new Error(`内置试听采样校验失败：${sample.id}。请重新安装完整版本。`);
    return [sample.id, { name: sample.resource, bytes, sha1: sample.sha1 }] as const;
  }));
  return Object.fromEntries(entries);
}
