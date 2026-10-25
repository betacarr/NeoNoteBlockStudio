import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';
import { boundaryMappings, reviewedVolumeBoundarySource } from './audit-volume-boundary-source.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const output = path.resolve('.local/strict-volume-boundary', `run-${Date.now()}`);
await mkdir(output, { recursive: true });
const relative = file => path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
const reference = async file => ({ path: relative(file), sha256: digest(await readFile(file), 'sha256') });
const bits = value => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return bytes.readUInt32LE().toString(16).padStart(8, '0'); };
const fromBits = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(parseInt(value, 16)); return bytes.readFloatLE(); };
const text = value => Object.is(value, -0) ? '-0.0' : String(value);
const run = (command, args) => {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 8e6, timeout: 90000 });
  assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const baseline = await reference('docs/evidence/java-1.21.8-1.21.9-volume-components.json');
const signedZeroBaseline = await reference('docs/evidence/java-1.21.8-1.21.9-signed-zero-components.json');
const baselineReport = JSON.parse(await readFile(baseline.path));
const baselineCases = path.join(baselineReport.root, 'cases.tsv');
const rows = (await readFile(baselineCases, 'utf8')).trim().split(/\r?\n/);
assert.equal(rows.length, 949);
const cases = rows.map((row, index) => {
  const [raw, category, master] = row.split('\t').map(Number);
  return { rawBits: bits(Math.fround(raw)), category: text(category), master: text(master), label: `baseline-${index}`, baselineIndex: index };
});
function add(rawBits, category, master, label) { cases.push({ rawBits, category: text(category), master: text(master), label }); }
for (const rawBits of ['00000001', '80000001', '007fffff', '807fffff', '00800000', '80800000', '7f7fffff', 'ff7fffff']) {
  for (const category of [0, -0, .2, .5, .7, 1]) for (const master of [0, -0, .7, 1]) add(rawBits, category, master, 'float-underflow-and-extrema');
}
for (const rawBits of ['7fc00000', 'ffc00000', '7fc12345', 'ffc12345', '7f812345', 'ff812345']) {
  for (const category of [0, -0, .2, 1]) for (const master of [0, -0, .7, 1]) add(rawBits, category, master, 'synthetic-nan-payload');
}
for (const category of [0, -0, Number.MIN_VALUE, 2 ** -150, .2, .5, 1]) {
  for (const master of [0, -0, Number.MIN_VALUE, .7, 1]) add(bits(3), category, master, 'note-block-accepted-option-zero-and-underflow');
}
for (const invalid of [NaN, Infinity, -Infinity, -.0000001, 1.0000001]) {
  for (const rawBits of [bits(3), '00000000', '80000000', '7fc00000']) {
    add(rawBits, invalid, .7, 'synthetic-invalid-category-option');
    add(rawBits, .2, invalid, 'synthetic-invalid-master-option');
  }
}
const input = path.join(output, 'cases.tsv');
await writeFile(input, cases.map(row => [row.rawBits, row.category, row.master].join('\t')).join('\n') + '\n');
await writeFile(path.join(output, 'cases.json'), JSON.stringify(cases, null, 2));
const sourceFiles = ['src/audio/volume.ts', 'src/audio/profiles.ts', 'src/data/audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/early-audio-facts.json'];
const productSources = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, (await reference(file)).sha256])));
const product = path.join(output, 'product.mjs');
await build({ stdin: { contents: "export {gameVolumeParameters} from './src/audio/volume.ts';", resolveDir: process.cwd(), sourcefile: 'strict-gain-component.ts' }, outfile: product, bundle: true, format: 'esm', platform: 'node' });
const { gameVolumeParameters } = await import(pathToFileURL(product).href);
await copyFile('scripts/java/StrictVolumeBoundaryProbe.java', path.join(output, 'StrictVolumeBoundaryProbe.java'));
await copyFile('scripts/probe-strict-volume-boundary.mjs', path.join(output, 'probe-strict-volume-boundary.mjs'));

const records = [];
for (const version of ['1.21.8', '1.21.9']) {
  const source = await reviewedVolumeBoundarySource(version), mapping = await boundaryMappings(version);
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`));
  const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`));
  assert.equal(fixture.clientSha1, metadata.downloads.client.sha1);
  const artifacts = metadata.libraries.flatMap(library => [library.downloads?.artifact, ...Object.values(library.downloads?.classifiers ?? {})]).filter(Boolean);
  for (const filename of fixture.classpath) {
    const artifact = artifacts.find(item => filename.replaceAll('\\', '/').endsWith('/' + item.path));
    assert.equal(digest(await readFile(filename)), artifact ? artifact.sha1 : metadata.downloads.client.sha1, `Original classpath mismatch: ${filename}`);
  }
  const nativeBytes = await readFile(path.join(fixture.nativeDir, 'OpenAL.dll'));
  let nativeArtifact;
  for (const artifact of artifacts.filter(item => /lwjgl-openal.*natives-windows/.test(item.path))) {
    const jar = await readFile(path.join(fixture.root, 'libraries', artifact.path));
    assert.equal(digest(jar), artifact.sha1);
    const entries = unzipSync(jar, { filter: entry => path.basename(entry.name).toLowerCase() === 'openal.dll' });
    if (Object.values(entries).some(bytes => digest(bytes, 'sha256') === digest(nativeBytes, 'sha256'))) nativeArtifact = artifact;
  }
  assert(nativeArtifact, 'OpenAL DLL must match an original official native archive.');
  const directory = path.join(output, version); await mkdir(directory, { recursive: true });
  const configuration = {};
  const className = (key, name) => configuration[key] = mapping.cls(name);
  const field = (key, owner, name) => configuration[key] = mapping.field(owner, name);
  const method = (key, owner, signature) => configuration[key] = mapping.method(owner, signature);
  const engine = 'net.minecraft.client.sounds.SoundEngine', options = 'net.minecraft.client.Options', option = 'net.minecraft.client.OptionInstance', category = 'net.minecraft.sounds.SoundSource', channel = 'com.mojang.blaze3d.audio.Channel', listener = 'com.mojang.blaze3d.audio.Listener', mth = 'net.minecraft.util.Mth';
  for (const [key, name] of Object.entries({ engine, options, option, category, channel, listener, mth })) className(key, name);
  for (const [key, owner, name] of [['master', category, 'MASTER'], ['records', category, 'RECORDS'], ['volumeMap', options, 'soundSourceVolumes'], ['engineOptions', engine, 'options'], ['optionValue', option, 'value'], ['optionValues', option, 'values'], ['source', channel, 'source']]) field(key, owner, name);
  for (const [key, owner, signature] of [
    ['createSlider', options, 'net.minecraft.client.OptionInstance createSoundSliderOptionInstance(java.lang.String,net.minecraft.sounds.SoundSource)'],
    ['optionGet', option, 'java.lang.Object get()'], ['getVolume', options, 'float getSoundSourceVolume(net.minecraft.sounds.SoundSource)'],
    ['getFinalVolume', options, 'float getFinalSoundSourceVolume(net.minecraft.sounds.SoundSource)'], ['calculate', engine, 'float calculateVolume(float,net.minecraft.sounds.SoundSource)'],
    ['validate', 'net.minecraft.client.OptionInstance$UnitDouble', 'java.util.Optional validateValue(java.lang.Double)'], ['resetListener', listener, 'void reset()'],
    ['createChannel', channel, 'com.mojang.blaze3d.audio.Channel create()'], ['setVolume', channel, 'void setVolume(float)'], ['destroyChannel', channel, 'void destroy()'],
    ['clamp', mth, 'float clamp(float,float,float)'],
  ]) method(key, owner, signature);
  if (version === '1.21.8') method('setGain', listener, 'void setGain(float)');
  const configFile = path.join(directory, 'probe.properties');
  await writeFile(configFile, Object.entries(configuration).map(([key, value]) => `${key}=${value}`).join('\n'));
  run('javac', ['--release', '8', '-cp', fixture.classpath.join(path.delimiter), '-d', directory, 'scripts/java/StrictVolumeBoundaryProbe.java']);
  const java = JSON.parse(await readFile('.local/runtimes/temurin-21/runtime.json')).executable;
  const resultFile = path.join(directory, 'original-bits.tsv'), optionFile = path.join(directory, 'original-options.properties');
  const stdout = run(java, [`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, `-Djava.library.path=${fixture.nativeDir}`, '-cp', [directory, ...fixture.classpath].join(path.delimiter), 'studio.nbsx.research.StrictVolumeBoundaryProbe', configFile, input, resultFile, optionFile]);
  await writeFile(path.join(directory, 'probe.log'), stdout);
  const lines = (await readFile(resultFile, 'utf8')).trim().split(/\r?\n/), headers = lines.shift().split('\t');
  assert.equal(lines.length, cases.length);
  const observations = lines.map((line, index) => {
    const row = Object.fromEntries(line.split('\t').map((value, column) => [headers[column], value]));
    const item = cases[index], raw = fromBits(item.rawBits), categoryValue = Number(item.category), masterValue = Number(item.master);
    const actual = gameVolumeParameters(`java-${version}`, raw, masterValue, categoryValue);
    const gainBits = bits(actual.gain), listenerBits = bits(actual.listenerGain);
    const validOptions = row.categoryAccepted === 'true' && row.masterAccepted === 'true';
    const domain = !validOptions ? 'synthetic-invalid-options-state' : raw === 3 ? 'note-block-raw3-accepted-options' : Number.isFinite(raw) ? 'synthetic-finite-instance-valid-options' : 'synthetic-nonfinite-instance-valid-options';
    const nativeApplied = row.sourceGainBits !== 'not-applied';
    assert.equal(Number(row.alError), 0, `Original AL error in ${version}/${index}`);
    return {
      case: index, label: item.label, baselineIndex: item.baselineIndex, domain,
      input: { rawBits: item.rawBits, rawText: text(raw), observedJavaRawBits: row.rawInputBits, category: item.category, master: item.master, categoryBits: row.categoryBits, masterBits: row.masterBits, categoryAccepted: row.categoryAccepted === 'true', masterAccepted: row.masterAccepted === 'true' },
      original: { gainBits: row.engineGainBits, listenerBits: row.expectedListenerBits, optionsFinalBits: row.finalVolumeBits, directClampBits: row.clampRawBits, directMathMinBits: row.mathMinRawBits, alSourceBits: nativeApplied ? row.sourceGainBits : undefined, alListenerBits: nativeApplied ? row.listenerGainBits : undefined },
      product: { gainBits, listenerBits },
      gainBitExact: row.engineGainBits === gainBits,
      listenerBitExact: row.expectedListenerBits === listenerBits,
      nativeApplied,
      nativeSourceBitExact: nativeApplied ? row.sourceGainBits === gainBits : undefined,
      nativeListenerBitExact: nativeApplied ? row.listenerGainBits === listenerBits : undefined,
      strictBitExact: row.engineGainBits === gainBits && row.expectedListenerBits === listenerBits && (!nativeApplied || row.sourceGainBits === gainBits && row.listenerGainBits === listenerBits),
    };
  });
  const domains = Object.fromEntries([...new Set(observations.map(row => row.domain))].map(domain => {
    const selected = observations.filter(row => row.domain === domain);
    return [domain, { cases: selected.length, strictBitExact: selected.every(row => row.strictBitExact), differences: selected.filter(row => !row.strictBitExact).length }];
  }));
  const differences = observations.filter(row => !row.strictBitExact);
  const record = {
    version, cases: observations.length, clientSha1: fixture.clientSha1,
    sourceEvidence: await reference(`docs/evidence/java-${version}-volume-boundary-source.json`),
    clampBinding: source.bindings.find(binding => binding.role === 'net.minecraft.util.Mth.clamp(FFF)F'),
    originalClasses: configuration,
    originalOpenAL: { sha256: digest(nativeBytes, 'sha256'), archive: nativeArtifact.path, archiveSha1: nativeArtifact.sha1 },
    javaExecutable: await reference(java),
    optionsFactoryEvidence: await readFile(optionFile, 'utf8'),
    strictBitExact: differences.length === 0, domains, differences, observations,
    rawFiles: await Promise.all([input, path.join(output, 'cases.json'), configFile, resultFile, optionFile, path.join(directory, 'probe.log'), path.join(directory, 'studio/nbsx/research/StrictVolumeBoundaryProbe.class')].map(reference)),
  };
  records.push(record);
  console.log(JSON.stringify({ version, cases: record.cases, strictBitExact: record.strictBitExact, domains, output: directory }));
}
for (const [file, sha256] of Object.entries(productSources)) assert.equal((await reference(file)).sha256, sha256, `Product changed during probe: ${file}`);
assert.deepEqual(await reference(baseline.path), baseline, 'Frozen baseline report changed.');
assert.deepEqual(await reference(signedZeroBaseline.path), signedZeroBaseline, 'Frozen signed-zero baseline changed.');
const report = {
  schema: 1, output, baseline, signedZeroBaseline, baselineCases: await reference(baselineCases),
  scope: 'Strict raw float-bit recheck of original SoundEngine/Options/Mth and original Channel/Listener calls on explicit synthetic state. Not a full running engine. Original Options validation distinguishes accepted inputs from injected invalid option state. No NaN or signed-zero comparison waiver.',
  strictAllBitExact: records.every(record => record.strictBitExact),
  strictNoteBlockAcceptedOptionsBitExact: records.every(record => record.domains['note-block-raw3-accepted-options'].strictBitExact),
  componentRows: records.reduce((count, record) => count + record.cases, 0), worldScenesAdded: 0,
  nanScope: 'Raw signaling/quiet NaN payload/sign cases and invalid Options are synthetic robustness observations on this JVM/V8 environment. Bit differences remain failures even when both values are NaN. IEEE NaN payload portability is not asserted.',
  productSources, records,
  helpers: await Promise.all(['scripts/probe-strict-volume-boundary.mjs', 'scripts/java/StrictVolumeBoundaryProbe.java', path.join(output, 'probe-strict-volume-boundary.mjs'), path.join(output, 'StrictVolumeBoundaryProbe.java'), product].map(reference)),
};
const rawReport = path.join(output, 'report.json'); await writeFile(rawReport, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--write-evidence')) {
  const destination = argument('--evidence') ?? 'docs/evidence/java-1.21.8-1.21.9-strict-gain-components.json';
  assert(![baseline.path, signedZeroBaseline.path].map(file => path.resolve(file)).includes(path.resolve(destination)), 'Cannot overwrite baseline evidence.');
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ report: rawReport, cases: report.componentRows, strictAllBitExact: report.strictAllBitExact, strictNoteBlockAcceptedOptionsBitExact: report.strictNoteBlockAcceptedOptionsBitExact }));
if (!report.strictAllBitExact) process.exitCode = 1;
