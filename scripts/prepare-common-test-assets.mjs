import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Public Open Note Block Studio examples, pinned to a source commit and hashes.
// Download only into the ignored local test cache; never into app resources.
const manifest = JSON.parse(await readFile('tests/fixtures/common-assets.json', 'utf8'));
const root = path.resolve('.local/common-assets'); await mkdir(root, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of manifest.files) {
  if (path.basename(file.file) !== file.file || !file.url.startsWith(`https://raw.githubusercontent.com/OpenNBS/NoteBlockStudio/${manifest.commit}/`)) throw new Error('Invalid test asset reference.');
  const filename = path.join(root, file.file);
  const cached = await readFile(filename).catch(() => undefined);
  if (cached && digest(cached) === file.sha256) continue;
  const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Test asset download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Test asset checksum mismatch: ${file.file}`);
  await writeFile(filename, bytes);
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: 'prepared', files: manifest.files.length, commit: manifest.commit }));
