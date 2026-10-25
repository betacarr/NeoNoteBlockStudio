import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--game-root')) throw new Error('Pass --game-root for a complete original 1.12.2 installation');
const version=process.argv.includes('--version')?arg('--version'):'1.12.2',sourceClass=process.argv.includes('--source-class')?arg('--source-class'):'paulscode.sound.libraries.SourceLWJGLOpenAL';
const gameRoot = path.resolve(arg('--game-root')), target = path.resolve('.local/legacy-gain-comparison',version); await mkdir(target, { recursive: true });
const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
const selected = metadata.libraries.filter(l => /^com.paulscode:(librarylwjglopenal|soundsystem):/.test(l.name) || l.name === 'org.lwjgl.lwjgl:lwjgl:2.9.4-nightly-20150209' || l.name === 'org.lwjgl:lwjgl:3.1.6');
const classpath = [];
for (const library of selected) { const artifact = library.downloads.artifact, filename = path.join(gameRoot, 'libraries', artifact.path); assert.equal(digest(await readFile(filename)), artifact.sha1); classpath.push(filename); }
if(version!=='1.12.2'){const client=path.join(gameRoot,'versions',version,version+'.jar');assert.equal(digest(await readFile(client)),metadata.downloads.client.sha1);classpath.push(client);}
const compiled = spawnSync('javac', ['--release', '8', '-cp', classpath.join(path.delimiter), '-d', target, 'scripts/java/LegacyGainProbe.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
let seed = 0x65a71e4; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const cases = [[0, 0, 0, 48, .7], [2, 0, -2, 48, .7], [0, 48, 0, 48, 1], [0, 47.999996, 0, 48, .7], [0, 48.000004, 0, 48, .7]];
for (let i = 0; i < 2000; i++) cases.push([random() * 100 - 50, random() * 100 - 50, -2, 16 + random() * 80, random()]);
const casesFile = path.join(target, 'cases.tsv'), output = path.join(target, 'original.bin');
// Match the actual float ABI. Decimalising a double exactly halfway between
// floats before Java parsing can introduce a second, unrelated rounding step.
await writeFile(casesFile, cases.map(c => c.map(Math.fround).join('\t')).join('\n'));
const run = spawnSync('java', ['-cp', [target, ...classpath].join(path.delimiter), 'studio.nbsx.research.LegacyGainProbe', casesFile, output, sourceClass], { windowsHide: true, encoding: 'utf8', timeout: 30000 }); assert.equal(run.status, 0, run.stderr);
await build({ stdin: { contents: "export { legacyLinearAttenuation, legacySourceGain } from './src/audio/legacy.ts';", resolveDir: process.cwd(), sourcefile: 'legacy-gain-helper.ts' }, outfile: path.join(target, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { legacyLinearAttenuation, legacySourceGain } = await import(pathToFileURL(path.join(target, 'helper.mjs')).href);
const bytes = await readFile(output); assert.equal(bytes.toString('ascii', 0, 4), 'NBLG'); assert.equal(bytes.readUInt32LE(4), cases.length);
const mismatches = []; let offset = 8;
for (const [index, [x, y, z, range, volume]] of cases.entries()) {
  const distance = bytes.readFloatLE(offset), gain = bytes.readFloatLE(offset + 4), effective = bytes.readFloatLE(offset + 8); offset += 12;
  const actualGain = legacyLinearAttenuation(x, y, z, range), actualEffective = legacySourceGain(volume, x, y, z, range);
  if (gain !== actualGain || effective !== actualEffective) mismatches.push({ index, x, y, z, range, volume, distance, gain, actualGain, effective, actualEffective });
}
const report = { version,class: sourceClass, clientSha1:metadata.downloads.client.sha1,librarySha1: selected.find(l => l.name.includes(':librarylwjglopenal:'))?.downloads.artifact.sha1, cases: cases.length, exact: !mismatches.length, mismatches, gameWorldRecording: 'pending' };
await writeFile(path.join(target, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ cases: report.cases, exact: report.exact, mismatches: mismatches.slice(0, 5), librarySha1: report.librarySha1, report: path.join(target, 'result.json') })); assert(report.exact, 'Legacy Java attenuation arithmetic differs');
