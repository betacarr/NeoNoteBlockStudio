import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const bank = JSON.parse(await readFile('third_party/opennbs-samples/manifest.json', 'utf8'));
const folder = '.local/preview-assets/sounds';
await mkdir(folder, { recursive: true });
if ((await readdir('.local/preview-assets')).some(name => name !== 'sounds')
  || (await readdir(folder)).some(name => !bank.samples.some(sample => sample.file === name))) throw new Error('Unexpected file in the dedicated preview asset cache. Inspect it before building.');
const valid = (bytes, sample) => bytes.length === sample.bytes && bytes.subarray(0, 4).toString() === 'OggS'
  && createHash('sha256').update(bytes).digest('hex') === sample.sha256;
await Promise.all(bank.samples.map(async sample => {
  if (!/^[a-z_]+\.ogg$/.test(sample.file)) throw new Error('Invalid preview sample filename.');
  const target = path.join(folder, sample.file);
  try { if (valid(await readFile(target), sample)) return; } catch { /* Download a missing or invalid cache entry. */ }
  const response = await fetch(new URL(sample.file, bank.baseUrl), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Preview sample download failed: ${sample.file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes, sample)) throw new Error(`Preview sample checksum mismatch: ${sample.file}`);
  await writeFile(target, bytes);
}));
console.log(`Preview samples ready: ${bank.samples.length} verified files, pinned to ${bank.revision.slice(0, 12)}.`);
