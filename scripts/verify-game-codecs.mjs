import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const version = process.argv[2] ?? '1.20.5';
const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
const comparison = JSON.parse(await readFile('.research/audio-source-comparison.json', 'utf8')).results.find(v => v.id === version);
const decoderClass = comparison.classes.find(c => /\.(OggAudioStream|JOrbisAudioStream)$/.test(c.name));
const modern = decoderClass.name.endsWith('.JOrbisAudioStream');
const java = process.argv.includes('--java') ? path.resolve(process.argv[process.argv.indexOf('--java') + 1])
  : metadata.javaVersion.majorVersion > 16 ? JSON.parse(await readFile(`.local/runtimes/temurin-${metadata.javaVersion.majorVersion}/runtime.json`, 'utf8')).executable : 'java';
const target = path.resolve('.local/codec-comparisons', version); await mkdir(target, { recursive: true });
const compiled = spawnSync('javac', ['--release', '8', '-d', target, 'scripts/java/GameCodecProbe.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
const index = JSON.parse(await readFile(path.join(fixture.root, 'assets/indexes', metadata.assetIndex.id + '.json')));
const names = Object.keys(fixture.sounds), encoded = [], files = [], hashes = [];
for (const id of names) {
  const object = index.objects[fixture.sounds[id].path], filename = path.join(fixture.root, 'assets/objects', object.hash.slice(0, 2), object.hash);
  encoded.push({ id, bytes: new Uint8Array(await readFile(filename)) }); files.push(filename); hashes.push(object.hash);
}
const output = path.join(target, 'original.pcm');
const unobfuscated = decoderClass.obfuscated === decoderClass.name;
const result = spawnSync(java, [`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, '-cp', [target, ...fixture.classpath].join(path.delimiter), 'studio.nbsx.research.GameCodecProbe', decoderClass.obfuscated, unobfuscated ? 'getFormat' : 'a', unobfuscated ? 'readAll' : 'b', files[0], output, ...files.slice(1)], { windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, result.stderr);
await build({ stdin: { contents: "export { decodeGameVorbis, minecraftPcm16 } from './electron/vorbis.ts'; export { decodeJavaVorbis } from './electron/java-decoder.ts';", resolveDir: process.cwd(), sourcefile: 'game-codec-helper.ts' }, outfile: path.join(target, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['koffi'] });
const { decodeGameVorbis, minecraftPcm16, decodeJavaVorbis } = await import(pathToFileURL(path.join(target, 'helper.mjs')).href);
const decoded = modern ? decodeJavaVorbis({ executable: java, classpath: [path.resolve('dist-electron/java'), ...fixture.classpath.filter(p => /jorbis-[^/\\]+\.jar$/.test(p))], kind: 'jorbis' }, encoded) : decodeGameVorbis(path.join(fixture.nativeDir, 'lwjgl_stb.dll'), encoded);
const original = await readFile(output); assert.equal(original.toString('ascii', 0, 4), 'NBSJ'); assert.equal(original.readUInt32LE(4), names.length);
const observations = []; let offset = 8;
for (let i = 0; i < names.length; i++) {
  const rate = original.readUInt32LE(offset), channels = original.readUInt32LE(offset + 4), bytes = original.readUInt32LE(offset + 8); offset += 12;
  const sample = decoded[i], pcm = sample.pcm16 ? Buffer.from(sample.pcm16.buffer, sample.pcm16.byteOffset, sample.pcm16.byteLength) : Buffer.alloc(sample.data[0].length * sample.channels * 2);
  if (!sample.pcm16) for (let frame = 0; frame < sample.data[0].length; frame++) for (let ch = 0; ch < sample.channels; ch++) pcm.writeInt16LE(minecraftPcm16(sample.data[ch][frame]), (frame * sample.channels + ch) * 2);
  const source = original.subarray(offset, offset + bytes); offset += bytes;
  let changed = 0, maxError = 0; for (let at = 0; at + 1 < Math.min(source.length, pcm.length); at += 2) { const error = Math.abs(source.readInt16LE(at) - pcm.readInt16LE(at)); if (error) changed++; maxError = Math.max(maxError, error); }
  observations.push({ instrument: names[i], sampleSha1: hashes[i], sampleRate: rate, channels, originalBytes: bytes, adapterBytes: pcm.length, exact: rate === sample.sampleRate && channels === sample.channels && source.equals(pcm), changedSamples: changed, maxPcmError: maxError });
}
const report = { version, clientSha1: fixture.clientSha1, codec: decoderClass.name, evidence: 'original-client-class-invocation', gameWorldRecording: 'pending', observations, exact: observations.every(o => o.exact) };
await writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version, codec: report.codec, samples: observations.length, exact: report.exact, mismatches: observations.filter(o => !o.exact), report: path.join(target, 'result.json'), gameWorldRecording: 'pending' })); assert(report.exact, 'An original client sample differs from the adapter');
