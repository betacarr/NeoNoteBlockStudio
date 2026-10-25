import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

/** Only fingerprints referenced audio files; does not decode, execute or modify them. */
export async function inspectFlpSamples(sourcePath: string, samples: { id: number; path: string }[]): Promise<Record<number, { sha256: string; path: string }>> {
  if (!path.isAbsolute(sourcePath) || !/\.flp$/i.test(sourcePath) || !Array.isArray(samples) || samples.length > 1024) throw new Error('FLP 采样核对请求无效。');
  const result: Record<number, { sha256: string; path: string }> = {}, cache = new Map<string, { sha256: string; path: string }>();
  let total = 0;
  for (const sample of samples) {
    if (!sample || !Number.isInteger(sample.id) || sample.id < 0 || sample.id > 65535 || typeof sample.path !== 'string' || sample.path.length > 32768 || sample.path.includes('\0')) throw new Error('FLP 采样引用无效。');
    if (!sample.path || /%[^%]+%/.test(sample.path) || !/\.(?:ogg|wav|flac|mp3|aif|aiff)$/i.test(sample.path)) continue;
    const filename = path.resolve(path.dirname(sourcePath), sample.path);
    if (cache.has(filename)) { result[sample.id] = cache.get(filename)!; continue; }
    let file;
    try {
      file = await open(filename, 'r');
      const details = await file.stat();
      if (!details.isFile() || details.size > 16 * 1024 * 1024 || total + details.size > 128 * 1024 * 1024) continue;
      total += details.size;
      // Read no more than the checked size, even if a file changes during inspection.
      const bytes = new Uint8Array(details.size);
      let at = 0;
      while (at < bytes.length) {
        const read = await file.read(bytes, at, bytes.length - at, at);
        if (!read.bytesRead) break;
        at += read.bytesRead;
      }
      if (at !== bytes.length || (await file.stat()).size !== details.size) continue;
      const match = { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') };
      cache.set(filename, match); result[sample.id] = match;
    } catch { /* Missing/unreadable files require manual calibration in the review. */ }
    finally { await file?.close().catch(() => {}); }
  }
  return result;
}
