import { readFile, writeFile, mkdir, copyFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
const version = process.argv[2] ?? '1.20.5';
const existingRoot = process.argv.includes('--game-root') ? path.resolve(process.argv[process.argv.indexOf('--game-root') + 1]) : undefined;
if (!/^[\w.-]+$/.test(version)) throw new Error('Invalid version');
const root = path.resolve('.local/game-fixtures', version);
const metadataBytes = await readFile(`.research/metadata/${version}.json`), metadata = JSON.parse(metadataBytes);
if (metadata.type !== 'release') throw new Error('Only released clients are prepared');
await mkdir(path.join(root, 'versions', version), { recursive: true });
const client = await readFile(`.research/clients/${version}.jar`);
if (digest(client) !== metadata.downloads.client.sha1) throw new Error('Original client checksum mismatch');
await writeFile(path.join(root, 'versions', version, `${version}.jar`), client);
await writeFile(path.join(root, 'versions', version, `${version}.json`), metadataBytes);
await mkdir('.local/research-helpers', { recursive: true });
const helper = path.join(await mkdtemp(path.resolve('.local/research-helpers/fixture-')), 'fixture.mjs');
await build({ stdin: { contents: "export { libraryAllowed } from './src/core/releases.ts'; export { soundAssetLayout,loadNoteBlockSoundAssets } from './src/core/sound-assets.ts';", resolveDir: process.cwd(), sourcefile: 'fixture-helper.ts' }, outfile: helper, platform: 'node', format: 'esm', bundle: true });
const { libraryAllowed, soundAssetLayout,loadNoteBlockSoundAssets } = await import(pathToFileURL(helper).href);
async function libraryArtifact(artifact, target) {
  const cache = path.resolve('.research/libraries', artifact.path);
  if (existingRoot) try {
    const local = await readFile(path.join(existingRoot, 'libraries', artifact.path));
    if (digest(local) === artifact.sha1) { await mkdir(path.dirname(cache), { recursive: true }); await writeFile(cache, local); }
  } catch {}
  await verifiedArtifact(artifact, cache); await mkdir(path.dirname(target), { recursive: true }); await copyFile(cache, target);
}
const indexPath = path.join(root, 'assets/indexes', metadata.assetIndex.id + '.json');
await verifiedArtifact(metadata.assetIndex, indexPath); const index = JSON.parse(await readFile(indexPath));
const getObject = async value => {
  const target = path.join(root, 'assets/objects', value.hash.slice(0, 2), value.hash);
  await verifiedArtifact({ url: `https://resources.download.minecraft.net/${value.hash.slice(0, 2)}/${value.hash}`, sha1: value.hash, size: value.size }, target); return target;
};
const { soundEvents: sounds } = await loadNoteBlockSoundAssets(index, soundAssetLayout(metadata.downloads.client.sha1, index), async object => readFile(await getObject(object)));
const jobs = [], queued = new Map();
function queueLibrary(artifact, target, extractNatives) {
  const key = path.resolve(target), existing = queued.get(key);
  if (existing) {
    if (existing.artifact.sha1 !== artifact.sha1) throw new Error(`Conflicting official fixture artifact: ${artifact.path}`);
    existing.extractNatives ||= extractNatives;
    return;
  }
  // Older launcher metadata can expose one native archive as both artifact and
  // classifier. Copy it once before reading, so concurrent jobs cannot reopen
  // another copy's target while Windows still holds its write handle.
  const job = { artifact, extractNatives }; queued.set(key, job);
  jobs.push(async () => {
    await libraryArtifact(job.artifact, target);
    if (job.extractNatives) for (const [name, bytes] of Object.entries(unzipSync(await readFile(target), { filter: e => /\.dll$/i.test(e.name) && !/x86\//.test(e.name) }))) await writeFile(path.join(nativeDir, path.basename(name)), bytes);
  });
}
const nativeDir = path.join(root, 'natives'); await mkdir(nativeDir, { recursive: true });
const classpath = [path.join(root, 'versions', version, `${version}.jar`)];
for (const library of metadata.libraries.filter(l => libraryAllowed(l, process.platform, process.arch))) {
  const artifact = library.downloads?.artifact;
  if (artifact) {
    const target = path.join(root, 'libraries', artifact.path); classpath.push(target);
    queueLibrary(artifact, target, /-natives-windows\.jar$/.test(artifact.path));
  }
  const native = library.downloads?.classifiers?.['natives-windows'];
  if (native) queueLibrary(native, path.join(root, 'libraries', native.path), true);
}
let cursor = 0, done = 0;
async function worker() { while (cursor < jobs.length) { await jobs[cursor++](); done++; if (done % 20 === 0) console.log(`${done}/${jobs.length} checked audio fixtures`); } }
await Promise.all([worker(), worker(), worker()]);
const record = { version, root, nativeDir, classpath, sounds, clientSha1: metadata.downloads.client.sha1, assetIndex: metadata.assetIndex, purpose: 'Audio-only research fixture. Not a full playable game asset installation.' };
await writeFile(path.join(root, 'fixture.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ version, root, sampleEvents: Object.keys(sounds).length, dependencies: classpath.length - 1 }));
