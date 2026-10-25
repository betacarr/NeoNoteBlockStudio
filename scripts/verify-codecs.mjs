import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { build } from 'esbuild';
const arg = key => process.argv[process.argv.indexOf(key) + 1];
if (!process.argv.includes('--game-root')) throw new Error('Pass --game-root for a complete original 1.16.5 installation; optionally --legacy-root for 1.12.2.');
const gameRoot = path.resolve(arg('--game-root')), target = path.resolve('.local/codec-verification');
await mkdir(target, { recursive: true });
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const metadata = JSON.parse(await readFile('.research/metadata/1.16.5.json', 'utf8'));
const libraryAllowed = library => {
  if (!library.rules) return true; let allowed = false;
  for (const rule of library.rules) if (!rule.os || rule.os.name === 'windows') allowed = rule.action === 'allow';
  return allowed;
};
const classpath = [path.join(gameRoot, 'versions/1.16.5/1.16.5.jar')];
assert.equal(sha1(await readFile(classpath[0])), metadata.downloads.client.sha1);
const nativeDir = path.join(target, 'natives'); await mkdir(nativeDir, { recursive: true });
for (const library of metadata.libraries.filter(libraryAllowed)) {
  const artifact = library.downloads?.artifact;
  if (artifact) { const filename = path.join(gameRoot, 'libraries', artifact.path); const bytes = await readFile(filename); assert.equal(sha1(bytes), artifact.sha1); classpath.push(filename); }
  const native = library.downloads?.classifiers?.['natives-windows'];
  if (native && /org.lwjgl:lwjgl(?::|-stb:)/.test(library.name)) {
    const bytes = await readFile(path.join(gameRoot, 'libraries', native.path)); assert.equal(sha1(bytes), native.sha1);
    for (const [name, contents] of Object.entries(unzipSync(bytes, { filter: e => /\.dll$/i.test(e.name) && !/x86\//.test(e.name) }))) await writeFile(path.join(nativeDir, path.basename(name)), contents);
  }
}
const index = JSON.parse(await readFile(path.join(gameRoot, 'assets/indexes/1.16.json'))), object = index.objects['minecraft/sounds/note/harp2.ogg'];
const ogg = await readFile(path.join(gameRoot, 'assets/objects', object.hash.slice(0, 2), object.hash)); assert.equal(sha1(ogg), object.hash);
const sampleFile = path.join(target, 'harp2.ogg'); await writeFile(sampleFile, ogg);
await build({ stdin: { contents: "export { decodeGameVorbis, minecraftPcm16 } from './electron/vorbis.ts'; export { decodeJavaVorbis } from './electron/java-decoder.ts';", resolveDir: process.cwd(), sourcefile: 'codec-helper.ts' }, outfile: path.join(target, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['koffi'] });
const { decodeGameVorbis, minecraftPcm16, decodeJavaVorbis } = await import(pathToFileURL(path.join(target, 'helper.mjs')).href);
const compiled = spawnSync('javac', ['--release', '8', '-d', target, 'scripts/java/GameCodecProbe.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
const output = path.join(target, 'original.pcm');
const result = spawnSync('java', [`-Dorg.lwjgl.librarypath=${nativeDir}`, '-cp', [target, ...classpath].join(path.delimiter), 'studio.nbsx.research.GameCodecProbe', 'ddx', 'a', 'b', sampleFile, output], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, result.stderr);
const original = await readFile(output), raw = decodeGameVorbis(path.join(nativeDir, 'lwjgl_stb.dll'), [{ id: 'harp', bytes: ogg }])[0];
const pcm = Buffer.alloc(raw.data[0].length * raw.channels * 2);
for (let frame = 0; frame < raw.data[0].length; frame++) for (let ch = 0; ch < raw.channels; ch++) pcm.writeInt16LE(minecraftPcm16(raw.data[ch][frame]), (frame * raw.channels + ch) * 2);
const same = pcm.equals(original.subarray(20));
const observations = { client: '1.16.5', clientSha1: metadata.downloads.client.sha1, sampleSha1: object.hash, originalPcmBytes: original.length - 20, adapterPcmBytes: pcm.length, exactOriginalClientCodecMatch: same, gameRecording: 'pending' };
await writeFile(path.join(target, 'result.json'), JSON.stringify(observations, null, 2));
console.log(JSON.stringify(observations));
assert(same, 'Original client push-data decoding differs from the adapter memory decoder');
const modernMetadata = JSON.parse(await readFile('.research/metadata/1.20.5.json'));
const modernArtifact = modernMetadata.libraries.find(l => /^org.jcraft:jorbis:/.test(l.name)).downloads.artifact;
const codecJar = path.join(target, 'jorbis.jar'); let bytes;
try { bytes = await readFile(codecJar); } catch { const r = await fetch(modernArtifact.url); if (!r.ok) throw new Error(`HTTP ${r.status}`); bytes = Buffer.from(await r.arrayBuffer()); }
assert.equal(sha1(bytes), modernArtifact.sha1); await writeFile(codecJar, bytes);
const modern = decodeJavaVorbis({ executable: 'java', classpath: [path.resolve('dist-electron/java'), codecJar], kind: 'jorbis' }, [{ id: 'harp', bytes: ogg }])[0];
assert.equal(modern.sampleRate, original.readUInt32LE(8)); assert(modern.pcm16.length > 1000);
console.log(JSON.stringify({ jorbisAdapter: 'passed', frames: modern.pcm16.length / modern.channels, sampleRate: modern.sampleRate, note: 'Original-client JOrbis comparison still required.' }));
if (process.argv.includes('--legacy-root')) {
  const legacyRoot = path.resolve(arg('--legacy-root')), legacyMetadata = JSON.parse(await readFile('.research/metadata/1.12.2.json'));
  const libraries = legacyMetadata.libraries.filter(l => /^com.paulscode:(codecjorbis|soundsystem):/.test(l.name)); const paths = [];
  for (const library of libraries) { const artifact = library.downloads.artifact, filename = path.join(legacyRoot, 'libraries', artifact.path); assert.equal(sha1(await readFile(filename)), artifact.sha1); paths.push(filename); }
  const legacy = decodeJavaVorbis({ executable: 'java', classpath: [path.resolve('dist-electron/java'), ...paths], kind: 'legacy-jorbis' }, [{ id: 'harp', bytes: ogg }])[0];
  assert(legacy.pcm16.length > 1000); console.log(JSON.stringify({ legacyOriginalCodec: 'passed', frames: legacy.pcm16.length / legacy.channels, sampleRate: legacy.sampleRate }));
}
