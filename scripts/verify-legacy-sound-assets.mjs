import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { build } from 'esbuild';
import { digest, verifiedArtifact } from './research-utils.mjs';

// Compare the application loader against the original clients' resource-index
// and default-pack classes. This is an asset-path test, not an audio/world pass.
const layouts = JSON.parse(await readFile('src/data/sound-asset-layouts.json', 'utf8'));
const fixture = JSON.parse(await readFile('tests/fixtures/legacy-sound-assets.json', 'utf8'));
const catalog = JSON.parse(await readFile('src/data/java-releases.json', 'utf8')).versions;
const target = path.resolve('.local/legacy-resource-layout'), assetsRoot = path.join(target, 'assets');
await mkdir(target, { recursive: true });
const bundle = await build({ stdin: { contents: "export { loadNoteBlockSoundAssets, soundAssetLayout } from './src/core/sound-assets.ts';", resolveDir: process.cwd(), sourcefile: 'legacy-resource-loader.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { loadNoteBlockSoundAssets, soundAssetLayout } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const compiled = spawnSync('javac', ['--release', '8', '-d', target, 'scripts/java/LegacyResourceProbe.java'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.stderr);
const observations = [];
for (const [clientHash, version] of Object.entries(layouts.defaultDomainRoot.clients)) {
  const release = catalog.find(item => item.id === version);
  assert.equal(release.clientSha1, clientHash);
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
  const clientPath = path.resolve(`.research/clients/${version}.jar`), client = await readFile(clientPath);
  assert.equal(digest(client), metadata.downloads.client.sha1);
  assert.equal(digest(client), clientHash);
  const classFiles = Object.entries(unzipSync(client, { filter: entry => entry.name.endsWith('.class') }));
  const findClass = marker => {
    const matches = classFiles.filter(([, bytes]) => Buffer.from(bytes).includes(Buffer.from(marker)));
    assert.equal(matches.length, 1, `${version}: expected one original role for ${marker}`);
    const [filename, bytes] = matches[0];
    return { name: filename.slice(0, -6).replaceAll('/', '.'), sha1: digest(bytes) };
  };
  const classes = { resourceIndex: findClass('indexes/'), defaultResourcePack: findClass('minecraft:pack.mcmeta'), soundHandler: findClass('Invalid sounds.json') };
  const indexPath = path.join(assetsRoot, 'indexes', `${metadata.assetIndex.id}.json`);
  await verifiedArtifact(metadata.assetIndex, indexPath);
  const indexBytes = await readFile(indexPath), index = JSON.parse(indexBytes);
  assert.equal(digest(indexBytes), fixture.indexes.find(item => item.id === metadata.assetIndex.id).sha1);
  for (const [name, object] of Object.entries(fixture.objects)) assert.deepEqual(index.objects[name], object, `${version}: official index fixture differs at ${name}`);
  const objectPath = object => path.join(assetsRoot, 'objects', object.hash.slice(0, 2), object.hash);
  const readObject = async object => {
    const filename = objectPath(object);
    await verifiedArtifact({ url: `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, sha1: object.hash, size: object.size }, filename);
    const bytes = await readFile(filename); assert.equal(digest(bytes), object.hash); return new Uint8Array(bytes);
  };
  const definitions = JSON.parse(new TextDecoder().decode(await readObject(index.objects['sounds.json'])));
  assert.deepEqual(Object.fromEntries(Object.entries(definitions).filter(([key]) => key.startsWith('note.'))), fixture.definitions);
  const loaded = await loadNoteBlockSoundAssets(index, soundAssetLayout(clientHash, index), readObject);
  assert.equal(Object.keys(loaded.samples).length, 6);
  assert.equal(loaded.samples.bass.name, 'sounds/note/bassattack.ogg');
  const dependencies = [];
  for (const library of metadata.libraries.filter(item => /^(?:com\.google\.guava:guava|com\.google\.code\.gson:gson|commons-io:commons-io|org\.apache\.logging\.log4j:log4j-(?:api|core)|org\.apache\.commons:commons-lang3):/.test(item.name))) {
    const artifact = library.downloads?.artifact; assert(artifact, `Missing official dependency ${library.name}`);
    const filename = path.resolve('.research/libraries', artifact.path);
    await verifiedArtifact(artifact, filename); dependencies.push({ name: library.name, path: filename, sha1: artifact.sha1 });
  }
  const paths = ['sounds.json', ...Object.values(loaded.samples).map(sample => sample.name)];
  const original = spawnSync('java', ['-Djava.awt.headless=true', '-cp', [target, clientPath, ...dependencies.map(item => item.path)].join(path.delimiter), 'studio.nbsx.research.LegacyResourceProbe', assetsRoot, metadata.assetIndex.id, classes.resourceIndex.name, classes.defaultResourcePack.name, ...paths], { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2e6 });
  assert.equal(original.status, 0, `${version}: ${original.stderr}\n${original.stdout}`);
  const resources = original.stdout.split(/\r?\n/).filter(line => line.startsWith('RESOURCE\t')).map(line => {
    const [, logicalPath, sha1, size] = line.split('\t'); return { logicalPath, sha1, size: Number(size) };
  });
  assert.equal(resources.length, paths.length);
  for (const resource of resources) {
    const key = resource.logicalPath.replace(/^minecraft:/, ''), expected = index.objects[key];
    assert.equal(resource.sha1, expected.hash); assert.equal(resource.size, expected.size);
    const sample = Object.values(loaded.samples).find(item => item.name === key);
    if (sample) assert.equal(digest(sample.bytes), resource.sha1);
  }
  observations.push({ version, clientSha1: clientHash, metadataUrl: release.metadataUrl, assetIndex: metadata.assetIndex, classes, definitionsSha1: index.objects['sounds.json'].hash,
    dependencies: dependencies.map(({ name, sha1 }) => ({ name, sha1 })), resources, selectedSamples: Object.fromEntries(Object.entries(loaded.samples).map(([id, sample]) => [id, { event: loaded.soundEvents[id].event, path: sample.name, sha1: sample.sha1, size: sample.bytes.length }])), exact: true });
  console.log(`${version}: original ResourceIndex/DefaultResourcePack and application agree for ${resources.length} official resources`);
}
const report = { schema: 1, scope: 'Official default-domain root asset-index layout only; original unmodified ResourceIndex and DefaultResourcePack invocation. Not a codec, mixer, world-recording or instrument-availability acceptance.',
  fixtureSha256: digest(await readFile('tests/fixtures/legacy-sound-assets.json'), 'sha256'), probeSha256: digest(await readFile('scripts/java/LegacyResourceProbe.java'), 'sha256'),
  loaderSha256: digest(await readFile('src/core/sound-assets.ts'), 'sha256'), layoutSha256: digest(await readFile('src/data/sound-asset-layouts.json'), 'sha256'), observations, exact: observations.every(item => item.exact) };
await writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2));
if (process.argv.includes('--write-evidence')) { await mkdir('docs/evidence', { recursive: true }); await writeFile('docs/evidence/legacy-sound-assets.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ versions: observations.length, resourceReads: observations.reduce((sum, item) => sum + item.resources.length, 0), exact: report.exact }));
