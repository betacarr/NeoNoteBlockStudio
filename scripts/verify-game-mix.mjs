import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const version = process.argv[2] ?? '1.16.5';
const blockFrames = process.argv.includes('--block-size') ? Number(process.argv[process.argv.indexOf('--block-size') + 1]) : 96000;
if (!Number.isInteger(blockFrames) || blockFrames < 1 || blockFrames > 96000) throw new Error('Invalid reference render block size');
const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
const sourceRecord = JSON.parse(await readFile('.research/audio-source-comparison.json', 'utf8')).results.find(v => v.id === version);
const mappings = sourceRecord.mappingsSha1 ? await readFile(`.research/source-comparison/${version}/mappings.txt`, 'utf8') : undefined;
function className(name) { if (!mappings) return name; const line = mappings.split('\n').find(l => l.startsWith(name + ' -> ')); if (!line) throw new Error(`Missing class mapping: ${name}`); return line.slice(line.indexOf(' -> ') + 4, -1); }
function methodName(type, signature) {
  const name = signature.match(/ (\w+)\(/)[1]; if (!mappings) return name;
  const start = mappings.indexOf(type + ' -> '), block = mappings.slice(start).split(/\n(?=\S[^\n]* -> )/)[0];
  const line = block.split('\n').find(l => l.includes(signature + ' -> ')); if (!line) throw new Error(`Missing method mapping: ${type}.${signature}`);
  return line.slice(line.lastIndexOf(' -> ') + 4);
}
const channel = 'com.mojang.blaze3d.audio.Channel', buffer = 'com.mojang.blaze3d.audio.SoundBuffer', listener = 'com.mojang.blaze3d.audio.Listener';
const codec = sourceRecord.classes.find(c => /\.(OggAudioStream|JOrbisAudioStream)$/.test(c.name)).name;
const index = JSON.parse(await readFile(path.join(fixture.root, 'assets/indexes', metadata.assetIndex.id + '.json'))), object = index.objects[fixture.sounds.harp.path];
const sample = path.join(fixture.root, 'assets/objects', object.hash.slice(0, 2), object.hash);
const properties = {
  blockFrames,
  channel: className(channel), buffer: className(buffer), listener: className(listener), vector: className('net.minecraft.world.phys.Vec3'), codec: className(codec), sample: sample.replaceAll('\\', '/'),
  format: methodName(codec, 'javax.sound.sampled.AudioFormat getFormat()'), readAll: mappings ? 'b' : 'readAll',
  resetListener: methodName(listener, 'void reset()'), createChannel: methodName(channel, 'com.mojang.blaze3d.audio.Channel create()'),
  attach: methodName(channel, 'void attachStaticBuffer(com.mojang.blaze3d.audio.SoundBuffer)'), position: methodName(channel, 'void setSelfPosition(net.minecraft.world.phys.Vec3)'),
  pitch: methodName(channel, 'void setPitch(float)'), gain: methodName(channel, 'void setVolume(float)'), attenuation: methodName(channel, 'void linearAttenuation(float)'),
  play: methodName(channel, 'void play()'), destroyChannel: methodName(channel, 'void destroy()'), discardBuffer: methodName(buffer, 'void discardAlBuffer()'),
};
const positions = [{ name: 'center', x: 0, y: 0 }, { name: 'right', x: 2, y: 0 }, { name: 'left', x: -2, y: 0 }, { name: 'above', x: 0, y: 12 }, { name: 'below', x: 0, y: -12 }, { name: 'far-above', x: 0, y: 40 }, { name: 'outside-range', x: 0, y: 48 }, { name: 'low-pitch', x: 0, y: 0, pitch: .5 }, { name: 'high-pitch', x: 0, y: 0, pitch: 2 }];
const cases = [false, true].flatMap(hrtf => positions.map(p => ({ ...p, z: -2, pitch: p.pitch ?? 1, gain: .7, hrtf })));
const target = path.resolve('.local/mix-comparisons', version); await mkdir(target, { recursive: true });
const config = path.join(target, 'probe.properties'), casesFile = path.join(target, 'cases.tsv'), originalFile = path.join(target, 'original.pcm');
await writeFile(config, Object.entries(properties).map(([key, value]) => `${key}=${value}`).join('\n'));
await writeFile(casesFile, cases.map(c => [c.x, c.y, c.z, c.pitch, c.gain, c.hrtf].join('\t')).join('\n'));
const compiled = spawnSync('javac', ['--release', '8', '-cp', fixture.classpath.join(path.delimiter), '-d', target, 'scripts/java/GameMixProbe.java'], { windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }); assert.equal(compiled.status, 0, compiled.stderr);
const java = metadata.javaVersion.majorVersion > 16 ? JSON.parse(await readFile(`.local/runtimes/temurin-${metadata.javaVersion.majorVersion}/runtime.json`, 'utf8')).executable : 'java';
const run = spawnSync(java, [`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, '-cp', [target, ...fixture.classpath].join(path.delimiter), 'studio.nbsx.research.GameMixProbe', config, casesFile, originalFile], { windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 }); assert.equal(run.status, 0, run.stderr);
await build({ stdin: { contents: "export { render } from './electron/audio-worker.ts';", resolveDir: process.cwd(), sourcefile: 'mix-helper.ts' }, outfile: path.join(target, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['koffi'] });
const { render } = await import(pathToFileURL(path.join(target, 'helper.mjs')).href);
const nativeFiles = await readdir(fixture.nativeDir), nativeLibrary = path.join(fixture.nativeDir, nativeFiles.find(n => /^OpenAL\.dll$/i.test(n)));
const modern = /JOrbis/.test(codec), nativeDecoder = modern ? undefined : path.join(fixture.nativeDir, 'lwjgl_stb.dll');
const javaDecoder = modern ? { executable: java, classpath: [path.resolve('dist-electron/java'), ...fixture.classpath.filter(p => /jorbis-[^/\\]+\.jar$/.test(p))], kind: 'jorbis' } : undefined;
const bytes = await readFile(originalFile); assert.equal(bytes.toString('ascii', 0, 4), 'NBSM'); assert.equal(bytes.readUInt32LE(4), cases.length);
const observations = []; let offset = 8;
for (const test of cases) {
  const rate = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4); offset += 8;
  const original = bytes.subarray(offset, offset + size); offset += size;
  const result = render({ nativeLibrary, nativeDecoder, javaDecoder, encodedSamples: [{ id: 'harp', bytes: new Uint8Array(await readFile(sample)) }], samples: [], sampleRate: rate, duration: 2, directional: test.hrtf,
    events: [{ time: 0, instrument: 'harp', pitch: test.pitch, gain: test.gain, x: test.x, y: test.y, z: test.z, maxDistance: 48 }] });
  const pcm = Buffer.from(result.wav).subarray(44); let changed = 0, squaredError = 0, maxError = 0, referenceEnergy = 0, left = 0, right = 0;
  for (let at = 0; at + 1 < Math.min(original.length, pcm.length); at += 2) {
    const expected = original.readInt16LE(at), actual = pcm.readInt16LE(at), error = Math.abs(expected - actual); if (error) changed++;
    squaredError += error ** 2; referenceEnergy += expected ** 2; maxError = Math.max(maxError, error); if (at % 4) right += actual ** 2; else left += actual ** 2;
  }
  observations.push({ name: test.name, hrtf: test.hrtf, exact: original.equals(pcm), maxPcmError: maxError, changedSamples: changed, normalizedRmsError: referenceEnergy ? Math.sqrt(squaredError / referenceEnergy) : squaredError ? null : 0, leftEnergy: left, rightEnergy: right, backend: result.backend });
}
const report = { version, referenceBlockFrames: blockFrames, editorBlockFrames: 1024, evidence: 'original-client-codec-buffer-channel-listener-invocation', gameWorldRecording: 'pending', clientSha1: fixture.clientSha1, sampleSha1: object.hash, observations, exact: observations.every(o => o.exact) };
const reportFile = path.join(target, blockFrames === 96000 ? 'result.json' : `result-block-${blockFrames}.json`);
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version, blockFrames, cases: cases.length, exact: report.exact, mismatches: observations.filter(o => !o.exact), report: reportFile, gameWorldRecording: 'pending' }));
assert(report.exact, 'Original client channel output differs from the editor native renderer');
