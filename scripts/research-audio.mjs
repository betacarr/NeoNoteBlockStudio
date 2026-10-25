import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.research');
const cache = path.join(root, 'metadata');
await mkdir(cache, { recursive: true });
const source = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
const manifest = await getJson(source);
const versions = manifest.versions.filter(v => ['release', 'old_beta', 'old_alpha'].includes(v.type)
  && !/(?:pre|rc|snapshot)/i.test(v.id)).sort((a, b) => a.releaseTime.localeCompare(b.releaseTime));
let cursor = 0, completed = 0;
const results = [], failures = [];
console.log(`Inspecting official metadata for ${versions.length} released/historical Java versions; snapshots excluded.`);
async function worker() {
  while (cursor < versions.length) {
    const version = versions[cursor++];
    const localPath = path.join(cache, `${version.id.replaceAll(/[^\w.-]/g, '_')}.json`);
    try {
      let metadata;
      try { metadata = JSON.parse(await readFile(localPath, 'utf8')); }
      catch { metadata = await getJson(version.url); await writeFile(localPath, JSON.stringify(metadata, null, 2)); }
      const libraries = (metadata.libraries ?? []).filter(l => /lwjgl|paulscode|jcraft|jorbis|jogg|openal/i.test(l.name));
      const backend = libraries.map(l => ({ name: l.name, natives: l.natives, downloads: l.downloads, rules: l.rules }));
      results.push({ id: version.id, type: version.type, released: version.releaseTime,
        metadataUrl: version.url, client: metadata.downloads?.client,
        mappings: metadata.downloads?.client_mappings, assetIndex: metadata.assetIndex,
        libraries: backend, audioStatus: 'metadata-only',
        audioEvidence: [], gameMeasurement: null,
        note: 'Dependency metadata is not proof of audio behaviour equivalence or complete change detection.' });
    } catch (error) { failures.push({ id: version.id, error: String(error) }); }
    completed++;
    if (completed % 25 === 0) console.log(`${completed}/${versions.length} metadata records inspected.`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
results.sort((a, b) => a.released.localeCompare(b.released));
let previousSignature;
const changes = [];
for (const version of results) {
  const signature = JSON.stringify(version.libraries.map(l => l.name).sort());
  if (signature !== previousSignature) changes.push({ id: version.id, libraries: version.libraries.map(l => l.name), classification: 'candidate-dependency-boundary', verifiedBehaviourChange: false });
  previousSignature = signature;
}
await writeFile(path.join(root, 'audio-version-matrix.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), source, latest: manifest.latest,
  scope: 'Java Edition released versions, including historical public alpha/beta releases; no snapshots, prereleases or release candidates.',
  status: 'research-in-progress', versions: results, candidateDependencyBoundaries: changes, failures,
  remaining: ['Compare and decompile relevant audio bytecode across released versions.', 'Compare asset hashes and sound definitions.', 'Validate native backend and settings.', 'Measure against in-game recordings.'],
}, null, 2));
console.log(JSON.stringify({ inspected: results.length, candidateBoundaries: changes.length, failures: failures.length, output: path.join(root, 'audio-version-matrix.json') }));
if (failures.length) process.exitCode = 1;
