import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export const digest = (bytes, algorithm = 'sha1') => createHash(algorithm).update(bytes).digest('hex');
export async function verifiedArtifact(artifact, filename, algorithm = 'sha1') {
  const expected = artifact[algorithm] ?? artifact.checksum;
  if (!/^[a-f0-9]{40,64}$/.test(expected)) throw new Error('Missing artifact checksum');
  try { const bytes = await readFile(filename); if (digest(bytes, algorithm) === expected) return filename; } catch {}
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.download-${randomUUID()}`;
  try {
    const response = await fetch(artifact.url ?? artifact.link, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const hash = createHash(algorithm); let size = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, callback) { size += chunk.length; hash.update(chunk); if (size > (artifact.size ?? 256 * 1024 * 1024) + 1024) callback(new Error('Artifact exceeds declared size')); else callback(null, chunk); } }), createWriteStream(temporary, { flags: 'wx' }));
    if (hash.digest('hex') !== expected || (artifact.size && size !== artifact.size)) throw new Error('Artifact checksum/size mismatch');
    await rename(temporary, filename); return filename;
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
