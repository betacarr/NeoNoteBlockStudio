import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';

const root = path.resolve('.local/historical-audio-patch-methods'); await mkdir(root, { recursive: true });
const inventory = JSON.parse(await readFile('.research/historical-audio-patches/inventory.json'));
const baseline = JSON.parse(await readFile('.local/game-fixtures/1.13/fixture.json'));
const run = (command, args) => { const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2e6 }); assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`); return result.stdout; };
run('javac', ['--release', '8', '-cp', baseline.classpath.join(path.delimiter), '-d', root, 'scripts/java/HistoricalAudioMethodProbe.java', 'scripts/java/LegacyGainProbe.java', 'scripts/java/GameCodecProbe.java']);
const helperFile = path.join(root, 'production-helper.mjs');
await build({ stdin: { contents: "export {decodeGameVorbis,minecraftPcm16} from './electron/vorbis.ts'; export {decodeJavaVorbis} from './electron/java-decoder.ts'; export {legacyLinearAttenuation,legacySourceGain} from './src/audio/legacy.ts';", resolveDir: process.cwd(), sourcefile: 'historical-patch-probe.ts' }, outfile: helperFile, bundle: true, platform: 'node', format: 'esm', external: ['koffi'] });
const { decodeGameVorbis, decodeJavaVorbis, minecraftPcm16, legacyLinearAttenuation, legacySourceGain } = await import(pathToFileURL(helperFile).href);
let seed = 0x635b2e1; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const mathCases = [[3, 1, 1], [3, .2, .1], [0, 4, .7], [-1, 2.1, 1], [1, .5, 0]];
for (let i = 0; i < 1000; i++) mathCases.push([random() * 5, random() * 3, random()]);
const mathFile = path.join(root, 'math-cases.tsv'); await writeFile(mathFile, mathCases.map(row => row.map(Math.fround).join('\t')).join('\n'));
const gainCases = [[0, 0, 0, 48, .7], [2, 0, -2, 48, .7], [0, 48, 0, 48, 1], [0, 47.999996, 0, 48, .7], [0, 48.000004, 0, 48, .7]];
for (let i = 0; i < 2000; i++) gainCases.push([random() * 100 - 50, random() * 100 - 50, -2, 16 + random() * 80, random()]);
const gainFile = path.join(root, 'gain-cases.tsv'); await writeFile(gainFile, gainCases.map(row => row.map(Math.fround).join('\t')).join('\n'));
const records = [];
for (const version of ['1.13.1', '1.13.2', '1.14.1', '1.14.2', '1.14.3']) {
  const inspected = inventory.records.find(item => item.version === version), fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`)), metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`));
  const destination = path.join(root, version); await mkdir(destination, { recursive: true });
  assert.equal(fixture.clientSha1, metadata.downloads.client.sha1); assert.equal(inspected.clientSha1, fixture.clientSha1);
  assert.equal(digest(await readFile(fixture.classpath[0])), fixture.clientSha1);
  const artifacts = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(Boolean);
  for (const filename of fixture.classpath.slice(1)) { const artifact = artifacts.find(item => filename.endsWith(item.path.replaceAll('/', path.sep))); assert(artifact); assert.equal(digest(await readFile(filename)), artifact.sha1); }
  const sourceRoot = path.join('.research/historical-audio-patches', version, 'source');
  const engine = await readFile(path.join(sourceRoot, `${inspected.roles.SoundEngine}.java`), 'utf8'), options = await readFile(path.join(sourceRoot, `${inspected.roles.Options}.java`), 'utf8');
  const category = /private final Multimap<(\w+),/.exec(engine)[1];
  const instance = version.startsWith('1.13') ? /private final Map<String, (\w+)> i/.exec(engine)[1] : /private final Map<(\w+), \w+\.a> m/.exec(engine)[1];
  const optionMap = /public float a\(\w+ \w+\) \{\s*if \(this\.(\w+)\.containsKey/.exec(options)[1];
  const probeArguments = [inspected.roles.SoundEngine, inspected.roles.Options, instance, category, optionMap];
  const classpath = [root, ...fixture.classpath].join(path.delimiter), originalMath = path.join(destination, 'original-math.bin');
  run('java', ['-cp', classpath, 'studio.nbsx.research.HistoricalAudioMethodProbe', 'math', ...probeArguments, mathFile, originalMath]);
  const mathBytes = await readFile(originalMath); assert.equal(mathBytes.toString('ascii', 0, 4), 'NBSM'); assert.equal(mathBytes.readUInt32LE(4), mathCases.length);
  for (let i = 0; i < mathCases.length; i++) { const [raw, pitch, category] = mathCases[i].map(Math.fround); assert.equal(mathBytes.readFloatLE(8 + i * 8), Math.min(1, Math.max(0, Math.fround(raw * category))), `${version}: gain ${i}`); assert.equal(mathBytes.readFloatLE(12 + i * 8), Math.min(2, Math.max(.5, pitch)), `${version}: pitch ${i}`); }
  const record = { version, clientSha1: fixture.clientSha1, originalEngineMath: { cases: mathCases.length, exact: true, originalClass: inspected.roles.SoundEngine, soundInstance: instance, category, optionMap, pcmSha256: digest(mathBytes, 'sha256') } };
  if (version.startsWith('1.13')) {
    const original = path.join(destination, 'original-source-gain.bin');
    run('java', ['-cp', classpath, 'studio.nbsx.research.LegacyGainProbe', gainFile, original, inspected.roles.Source]);
    const bytes = await readFile(original); assert.equal(bytes.readUInt32LE(4), gainCases.length);
    for (let i = 0; i < gainCases.length; i++) { const [x, y, z, range, volume] = gainCases[i].map(Math.fround); assert.equal(bytes.readFloatLE(12 + i * 12), legacyLinearAttenuation(x, y, z, range)); assert.equal(bytes.readFloatLE(16 + i * 12), legacySourceGain(volume, x, y, z, range)); }
    record.originalSourceGain = { cases: gainCases.length, originalClass: inspected.roles.Source, exact: true, outputSha256: digest(bytes, 'sha256') };
  } else {
    const access = /private final Map<\w+, (\w+)\.a> m/.exec(engine)[1];
    const text = run('java', ['-cp', classpath, 'studio.nbsx.research.HistoricalAudioMethodProbe', 'lifecycle', ...probeArguments, access]);
    const observations = text.split(/\r?\n/).filter(line => /^(STOP|FINISHED)\t/.test(line)).map(line => { const [phase, active, expiry, categoryMembers, queuedCallbacks] = line.split('\t'); return { phase, active: +active, expiry: +expiry, categoryMembers: +categoryMembers, queuedCallbacks: +queuedCallbacks }; });
    assert.equal(observations.length, 2); const fixed = version !== '1.14.1';
    assert.deepEqual(observations[0], { phase: 'STOP', active: fixed ? 1 : 0, expiry: fixed ? 1 : 0, categoryMembers: 1, queuedCallbacks: 1 });
    assert.deepEqual(observations[1], { phase: 'FINISHED', active: 0, expiry: 0, categoryMembers: fixed ? 0 : 1, queuedCallbacks: 0 });
    record.originalLifecycle = { originalClass: inspected.roles.SoundEngine, accessClass: access, observations, syntheticState: true, noNativeCallbacksExecuted: true, scope: 'Original stop and private tick-cleanup methods on isolated state; no waveform/world acceptance.' };
  }
  const indexBytes = await readFile(path.join(fixture.root, 'assets/indexes', `${metadata.assetIndex.id}.json`)); assert.equal(digest(indexBytes), metadata.assetIndex.sha1); const index = JSON.parse(indexBytes);
  const names = Object.keys(fixture.sounds), encoded = [], files = [], samples = [];
  for (const id of names) { const object = index.objects[fixture.sounds[id].path], file = path.join(fixture.root, 'assets/objects', object.hash.slice(0, 2), object.hash), bytes = await readFile(file); assert.equal(digest(bytes), object.hash); encoded.push({ id, bytes: new Uint8Array(bytes) }); files.push(file); samples.push({ id, sha1: object.hash }); }
  const output = path.join(destination, 'original-codec.pcm');
  if (version.startsWith('1.13')) run('java', ['-cp', classpath, 'studio.nbsx.research.HistoricalAudioMethodProbe', 'legacy-codec', output, ...files]);
  else run('java', [`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, '-cp', classpath, 'studio.nbsx.research.GameCodecProbe', inspected.roles.Decoder, 'a', 'b', files[0], output, ...files.slice(1)]);
  const actual = version.startsWith('1.13') ? decodeJavaVorbis({ executable: 'java', classpath: [path.resolve('dist-electron/java'), ...fixture.classpath.filter(file => /codecjorbis-|soundsystem-/.test(file))], kind: 'legacy-jorbis' }, encoded) : decodeGameVorbis(path.join(fixture.nativeDir, 'lwjgl_stb.dll'), encoded);
  const original = await readFile(output); assert.equal(original.readUInt32LE(4), names.length); let offset = 8;
  const codec = [];
  for (let i = 0; i < names.length; i++) { const sample = actual[i], rate = original.readUInt32LE(offset), channels = original.readUInt32LE(offset + 4), length = original.readUInt32LE(offset + 8); offset += 12;
    const pcm = sample.pcm16 ? Buffer.from(sample.pcm16.buffer, sample.pcm16.byteOffset, sample.pcm16.byteLength) : Buffer.alloc(sample.data[0].length * sample.channels * 2);
    if (!sample.pcm16) for (let frame = 0; frame < sample.data[0].length; frame++) for (let ch = 0; ch < sample.channels; ch++) pcm.writeInt16LE(minecraftPcm16(sample.data[ch][frame]), (frame * sample.channels + ch) * 2);
    const reference = original.subarray(offset, offset + length); offset += length; assert.equal(rate, sample.sampleRate); assert.equal(channels, sample.channels); assert(reference.equals(pcm), `${version} ${names[i]} original codec PCM differs`);
    codec.push({ ...samples[i], rate, channels, bytes: length, originalPcmSha256: digest(reference, 'sha256'), productionPcmSha256: digest(pcm, 'sha256'), exact: true });
  }
  record.originalCodec = { kind: version.startsWith('1.13') ? 'original-CodecJOrbis' : 'original-client-STB-pushdata', class: inspected.roles.Decoder ?? 'paulscode.sound.codecs.CodecJOrbis', samples: codec, exact: true };
  record.nativeLibraries = {};
  for (const filename of ['OpenAL.dll', 'lwjgl_stb.dll']) {
    const bytes = await readFile(path.join(fixture.nativeDir, filename)), sha256 = digest(bytes, 'sha256'); let provenance;
    for (const artifact of artifacts.filter(item => /natives-windows/.test(item.path) && /lwjgl-(?:openal|stb)/.test(item.path))) {
      const archive = await readFile(path.join(fixture.root, 'libraries', artifact.path)).catch(() => undefined); if (!archive) continue; assert.equal(digest(archive), artifact.sha1);
      if (Object.entries(unzipSync(archive)).some(([name, entry]) => path.basename(name).toLowerCase() === filename.toLowerCase() && digest(entry, 'sha256') === sha256)) { provenance = artifact; break; }
    }
    assert(provenance); record.nativeLibraries[filename] = { sha256, artifact: provenance };
  }
  await writeFile(path.join(destination, 'result.json'), JSON.stringify(record, null, 2)); records.push(record);
  console.log(`${version}: original math ${mathCases.length}, ${record.originalSourceGain ? `source ${gainCases.length}, ` : 'stop/cleanup, '}codec ${codec.length} exact`);
}
const report = { schema: 1, records, integratedWorldScenesAdded: 0, scope: 'Original class/dependency component invocations only. No parent matrix scenes inherited or added.', sources: {} };
for (const file of ['scripts/probe-historical-audio-patches.mjs', 'scripts/java/HistoricalAudioMethodProbe.java', 'scripts/java/GameCodecProbe.java', 'scripts/java/LegacyGainProbe.java', 'electron/vorbis.ts', 'electron/java-decoder.ts', 'electron/java/NbsxVorbisDecoder.java', 'src/audio/legacy.ts']) report.sources[file] = digest(await readFile(file), 'sha256');
await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/historical-audio-patch-components.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ versions: records.length, originalCodecSamples: records.reduce((sum, item) => sum + item.originalCodec.samples.length, 0), integratedWorldScenesAdded: 0 }));
