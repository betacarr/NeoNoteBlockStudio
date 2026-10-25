import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { boundaryMappings, reviewedVolumeBoundarySource } from './audit-volume-boundary-source.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

const output = path.resolve('.local/modern-pitch-order', `run-${Date.now()}`); await mkdir(output, { recursive: true });
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') });
const bits = value => { const b = Buffer.alloc(4); b.writeFloatLE(value); return b.readUInt32LE().toString(16).padStart(8, '0'); };
const value = bitPattern => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(bitPattern, 16)); return b.readFloatLE(); };
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { windowsHide: true, cwd, encoding: 'utf8', maxBuffer: 16e6, timeout: 90000 });
  assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`); return result.stdout;
}
const inputs = []; for (const eventPitch of [.3, .7, 1, 1.1, 1.2, 1.25, 1.5, 2]) for (let note = 0; note <= 24; note++) inputs.push({ note, eventPitch });
const input = path.join(output, 'cases.tsv'); await writeFile(input, inputs.map(row => `${row.note}\t${row.eventPitch}`).join('\n'));
const productSources = Object.fromEntries(await Promise.all(['src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/profiles.ts', 'src/data/audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/early-audio-facts.json'].map(async file => [file, (await reference(file)).sha256])));
const productFile = path.join(output, 'product.mjs');
await build({ stdin: { contents: "export {noteAudioParameters} from './src/audio/parameters.ts';export {createProject} from './src/core/project.ts';", resolveDir: process.cwd(), sourcefile: 'pitch-order.ts' }, outfile: productFile, platform: 'node', format: 'esm', bundle: true });
const { noteAudioParameters, createProject } = await import(pathToFileURL(productFile).href);
const records = [];
for (const version of ['1.21.8', '1.21.9']) {
  await reviewedVolumeBoundarySource(version);
  const mapping = await boundaryMappings(version), metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`)), fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`));
  const client = path.resolve(`.research/clients/${version}.jar`), clientBytes = await readFile(client); assert.equal(digest(clientBytes), metadata.downloads.client.sha1);
  assert.equal(digest(await readFile(fixture.classpath[0])), metadata.downloads.client.sha1);
  const zip = unzipSync(clientBytes), rawDirectory = path.resolve('.research/pitch-boundary', version), directory = path.join(output, version); await mkdir(rawDirectory, { recursive: true }); await mkdir(directory, { recursive: true });
  const names = { noteBlock: 'net.minecraft.world.level.block.NoteBlock', simple: 'net.minecraft.client.resources.sounds.SimpleSoundInstance', abstract: 'net.minecraft.client.resources.sounds.AbstractSoundInstance', instance: 'net.minecraft.client.resources.sounds.SoundInstance', attenuation: 'net.minecraft.client.resources.sounds.SoundInstance$Attenuation', sound: 'net.minecraft.client.resources.sounds.Sound', soundType: 'net.minecraft.client.resources.sounds.Sound$Type', constant: 'net.minecraft.util.valueproviders.ConstantFloat', sampled: 'net.minecraft.util.valueproviders.SampledFloat', engine: 'net.minecraft.client.sounds.SoundEngine', source: 'net.minecraft.sounds.SoundSource', random: 'net.minecraft.util.RandomSource', location: 'net.minecraft.resources.ResourceLocation', shared: 'net.minecraft.SharedConstants', bootstrap: 'net.minecraft.server.Bootstrap', mth: 'net.minecraft.util.Mth' };
  const config = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, mapping.cls(name)]));
  const method = (key, owner, signature) => config[key] = mapping.method(names[owner], signature);
  const field = (key, owner, name) => config[key] = mapping.field(names[owner], name);
  method('notePitch', 'noteBlock', 'float getPitchFromNote(int)'); method('getPitch', 'abstract', 'float getPitch()'); method('calculate', 'engine', 'float calculatePitch(net.minecraft.client.resources.sounds.SoundInstance)');
  method('constantOf', 'constant', 'net.minecraft.util.valueproviders.ConstantFloat of(float)'); method('createRandom', 'random', 'net.minecraft.util.RandomSource create(long)');
  method('parse', 'location', 'net.minecraft.resources.ResourceLocation parse(java.lang.String)'); method('detectVersion', 'shared', 'void tryDetectVersion()'); method('bootStrap', 'bootstrap', 'void bootStrap()');
  field('records', 'source', 'RECORDS'); field('linear', 'attenuation', 'LINEAR'); field('fileType', 'soundType', 'FILE'); field('pitchField', 'abstract', 'pitch'); field('soundField', 'abstract', 'sound');
  const classes = [], bindings = [], raw = {};
  const descriptorType = name => ({ void: 'V', float: 'F', double: 'D', int: 'I', long: 'J', boolean: 'Z', byte: 'B', short: 'S', char: 'C' }[name] ?? `L${(mapping.blocks.has(name) ? mapping.cls(name) : name).replaceAll('.', '/')};`);
  for (const [key, name] of Object.entries(names)) {
    const original = config[key], bytes = zip[original + '.class']; assert(bytes);
    const disassembly = run('javap', ['-classpath', client, '-c', '-p', '-s', original]);
    const rawFile = path.join(rawDirectory, original + '.javap.txt'); await writeFile(rawFile, disassembly);
    classes.push({ name, originalName: original, classSha256: digest(bytes, 'sha256'), rawDisassembly: await reference(rawFile) }); raw[name] = disassembly;
    const code = methodCodeHashes(bytes);
    for (const line of mapping.blocks.get(name).lines) {
      const parts = line.trim().replace(/^\d+:\d+:/, '').match(/^(\S+) ([^(]+)\(([^)]*)\) -> (\S+)$/); if (!parts) continue;
      const [, result, named, args, member] = parts, descriptor = '(' + (args ? args.split(',').map(descriptorType).join('') : '') + ')' + descriptorType(result);
      if (/getPitchFromNote|triggerEvent|calculatePitch|getPitch|sample|^of$|^clamp$|^<init>$/.test(named) && code[member + descriptor]) bindings.push({ role: `${name}.${named}`, owner: original, member, descriptor, codeSha256: code[member + descriptor] });
    }
  }
  const rawFile = path.join(rawDirectory, 'raw-evidence.json'); await writeFile(rawFile, JSON.stringify({ version, classes, bindings, disassemblies: raw }, null, 2));
  const configFile = path.join(directory, 'probe.properties'); await writeFile(configFile, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n'));
  run('javac', ['--release', '8', '-d', directory, 'scripts/java/ModernPitchOrderProbe.java']);
  const java = JSON.parse(await readFile('.local/runtimes/temurin-21/runtime.json')).executable, resultFile = path.join(directory, 'original.tsv');
  const stdout = run(java, ['-cp', [directory, ...fixture.classpath].join(path.delimiter), 'studio.nbsx.research.ModernPitchOrderProbe', configFile, input, resultFile], directory); await writeFile(path.join(directory, 'probe.log'), stdout);
  const lines = (await readFile(resultFile, 'utf8')).trim().split(/\r?\n/), headers = lines.shift().split('\t'); assert.equal(lines.length, inputs.length);
  const project = createProject(); project.audio.mode = 'vanilla'; project.audio.profileId = `java-${version}`;
  const instrument = project.instruments.find(item => item.id === 'harp'); assert(instrument);
  const observations = lines.map((line, index) => {
    const original = Object.fromEntries(line.split('\t').map((item, column) => [headers[column], item])), item = inputs[index];
    const note = { midi: instrument.rootMidi + item.note - 12, detune: 0, gain: 1, effectiveInstrument: instrument.id, effectivePan: 0, height: 0 };
    const actual = noteAudioParameters(project, note, { soundEvents: { [instrument.id]: { pitch: item.eventPitch, volume: 1, attenuationDistance: 16 } } }).pitch;
    const previous = Math.fround(Math.max(.5, Math.min(2, Math.pow(2, (item.note - 12) / 12) * item.eventPitch)));
    assert.equal(original.instancePitchBits, original.storedInstanceBits);
    return { ...item, original, originalPitch: value(original.enginePitchBits), productPitch: actual, productPitchBits: bits(actual), previousPitch: previous, previousPitchBits: bits(previous), strictBitExact: original.enginePitchBits === bits(actual), previousBitExact: original.enginePitchBits === bits(previous) };
  });
  const differences = observations.filter(row => !row.strictBitExact), counterexample = observations.find(row => row.note === 1 && row.eventPitch === 1.5);
  assert(counterexample && !counterexample.previousBitExact);
  records.push({ version, classes, bindings, sourceEvidence: await reference(`docs/evidence/java-${version}-volume-boundary-source.json`), rawEvidence: await reference(rawFile), cases: observations.length, strictBitExact: !differences.length, differences, counterexample, previousDifferences: observations.filter(row => !row.previousBitExact).length, observations, rawFiles: await Promise.all([configFile, input, resultFile, path.join(directory, 'probe.log'), path.join(directory, 'studio/nbsx/research/ModernPitchOrderProbe.class')].map(reference)) });
  console.log(JSON.stringify({ version, cases: observations.length, strictBitExact: !differences.length, previousDifferences: records.at(-1).previousDifferences, counterexample }));
}
for (const [file, sha256] of Object.entries(productSources)) assert.equal((await reference(file)).sha256, sha256, 'Product changed during pitch probe.');
const report = { schema: 1, scope: 'Original NoteBlock.getPitchFromNote, actual SimpleSoundInstance/Sound/ConstantFloat constructors, AbstractSoundInstance.getPitch and SoundEngine.calculatePitch on explicit component state. Original registry bootstrap only; no world, native mixer or playback measured.', output, componentRows: inputs.length * 2, worldScenesAdded: 0, strictBitExact: records.every(row => row.strictBitExact), productSources, helper: await reference('scripts/probe-modern-pitch-order.mjs'), javaHelper: await reference('scripts/java/ModernPitchOrderProbe.java'), productBundle: await reference(productFile), records };
const rawReport = path.join(output, 'report.json'); await writeFile(rawReport, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/java-1.21.8-1.21.9-pitch-order-components.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: rawReport, componentRows: report.componentRows, strictBitExact: report.strictBitExact }));
if (!report.strictBitExact) process.exitCode = 1;
