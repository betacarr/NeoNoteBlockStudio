import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { verifiedArtifact } from './research-utils.mjs';
const version = process.argv[2] ?? '21';
if (!/^\d+$/.test(version)) throw new Error('Expected Java major version');
const directory = path.resolve('.local/runtimes', `temurin-${version}`);
await mkdir(directory, { recursive: true });
const url = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`;
let records;
try { records = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8')); }
catch { const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`Runtime metadata HTTP ${response.status}`); records = await response.json(); await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(records, null, 2)); }
const artifact = records[0]?.binary?.package; if (!artifact) throw new Error('Official runtime metadata has no package');
const archive = await verifiedArtifact(artifact, path.join(directory, 'runtime.zip'), 'sha256');
let executable;
for (const [name, bytes] of Object.entries(unzipSync(await readFile(archive)))) {
  const filename = path.resolve(directory, ...name.split('/'));
  if (!filename.startsWith(directory + path.sep)) throw new Error('Runtime archive path escaped destination');
  if (name.endsWith('/')) { await mkdir(filename, { recursive: true }); continue; }
  await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
  if (/\/bin\/java\.exe$/.test(name)) executable = filename;
}
if (!executable) throw new Error('No Java executable in runtime');
await writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ source: url, version: records[0].version, checksum: artifact.checksum, executable }, null, 2));
console.log(JSON.stringify({ executable, version: records[0].version.semver }));
