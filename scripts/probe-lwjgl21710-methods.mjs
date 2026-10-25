import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

const root = '.local/lwjgl21710-methods'; await mkdir(root, { recursive: true }); const f = Math.fround;
const run = (program, args) => { const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 3e6 }); assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`); return result.stdout; };
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.7.10/fixture.json'));
const metadata = JSON.parse(await readFile('.research/lwjgl21710-source/official-metadata.json')); assert.equal(fixture.clientSha1, metadata.downloads.client.sha1);
const artifacts = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(Boolean);
assert.equal(digest(await readFile(fixture.classpath[0])), fixture.clientSha1);
for (const filename of fixture.classpath.slice(1)) { const artifact = artifacts.find(item => filename.endsWith(item.path.replaceAll('/', path.sep))); assert(artifact); assert.equal(digest(await readFile(filename)), artifact.sha1); }
const cases = [[3, 1, 1, 1, 1], [3, .5, f(.2), 1, 1], [f(.5), 2, f(.7), f(.8), f(.9)], [f(.50000006), f(1.9999999), f(.33333334), f(3.0000002), f(1.0000001)]];
let seed = 0x17abc; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (let i = 0; i < 1000; i++) cases.push([f(random() * 4), f(random() * 3), f(random()), f(random() * 2), f(random() * 2)]);
for (const value of [0, f(.49999997), .5, f(.50000006), f(.99999994), 1, f(1.0000001), f(1.9999999), 2, f(2.0000002), f(3.9999998)]) for (const factor of [.5, 1, f(1.0000001), 2]) cases.push([value, value, f(.7), factor, factor]);
cases.push([f(.73), f(.91), f(.67), f(.8) * f(.6), f(.7) * f(1.1)]);
const neighbor = (value, delta) => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); bytes.writeUInt32LE(bytes.readUInt32LE() + delta); return bytes.readFloatLE(); };
const packetInputs = [...new Set([0, -.1, 5, ...[1, 31, 32, 62, 63, 64, 125, 126, 127, 254, 255, 256].flatMap(code => { const value = f(code / 63); return [neighbor(value, -1), value, neighbor(value, 1)]; })])];
await writeFile(`${root}/inputs.json`, JSON.stringify(cases)); await writeFile(`${root}/inputs.tsv`, cases.map(row => row.join('\t')).join('\n'));
await writeFile(`${root}/packet-inputs.tsv`, packetInputs.join('\n'));
const asm = path.resolve('.research/tools/asm-9.7.1.jar'), cp = [root, asm, ...fixture.classpath].join(path.delimiter);
run('javac', ['--release', '8', '-cp', cp, '-d', root, 'scripts/java/Lwjgl21710MethodProbe.java']);
const stdout = run('java', ['-cp', cp, 'studio.nbsx.research.Lwjgl21710MethodProbe', `${root}/inputs.tsv`, `${root}/math.bin`, `${root}/notes.bin`, `${root}/packet-inputs.tsv`, `${root}/packet.bin`]);
assert(stdout.includes('POOL\t28\t4'));
const math = await readFile(`${root}/math.bin`), notes = await readFile(`${root}/notes.bin`), packet = await readFile(`${root}/packet.bin`); assert.equal(math.readUInt32LE(4), cases.length);
const regressions = [];
for (let i = 0; i < cases.length; i++) {
  const [raw, pitch, category, eventVolume, eventPitch] = cases[i], gain = math.readFloatLE(8 + i * 8), actualPitch = math.readFloatLE(12 + i * 8);
  assert.equal(gain, f(Math.min(1, Math.max(0, raw * eventVolume * category)))); assert.equal(actualPitch, f(Math.min(2, Math.max(.5, pitch * eventPitch))));
  const prematureFloatGain = f(Math.min(1, Math.max(0, f(f(raw * eventVolume) * category))));
  if (gain !== prematureFloatGain) regressions.push({ input: { instanceVolume: raw, eventVolume, categoryVolume: category }, originalGain: gain, prematureFloatGain });
}
assert(regressions.length > 0); const noteResults = [];
for (let n = 0; n <= 24; n++) { const offset = 8 + n * 16, emitted = notes.readFloatLE(offset), transported = notes.readFloatLE(offset + 4), clamped = notes.readFloatLE(offset + 8), volume = notes.readFloatLE(offset + 12);
  assert.equal(emitted, f(2 ** ((n - 12) / 12))); const code = Math.max(0, Math.min(255, Math.trunc(f(emitted * 63)))); assert.equal(transported, f(code / 63)); assert.equal(clamped, f(Math.min(2, Math.max(.5, transported)))); assert.equal(volume, 3); noteResults.push({ note: n, originalEventPitch: emitted, encodedByte: code, transportedPitch: transported, originalEnginePitch: clamped }); }
const boundaries = []; for (let i = 0; i < packetInputs.length; i++) { const input = packetInputs[i], code = Math.max(0, Math.min(255, Math.trunc(f(input * 63)))), transported = packet.readFloatLE(8 + i * 8), clamped = packet.readFloatLE(12 + i * 8); assert.equal(transported, f(code / 63)); assert.equal(clamped, f(Math.min(2, Math.max(.5, transported)))); boundaries.push({ input, encodedByte: code, transportedPitch: transported, originalEnginePitch: clamped }); }
const sources = {}; for (const file of ['scripts/probe-lwjgl21710-methods.mjs', 'scripts/java/Lwjgl21710MethodProbe.java', asm]) sources[file] = digest(await readFile(file), 'sha256');
const report = { schema: 1, version: '1.7.10', clientSha1: fixture.clientSha1, engineMath: { cases: cases.length, exact: true, outputSha256: digest(math, 'sha256'), inputsSha256: digest(await readFile(`${root}/inputs.json`), 'sha256'), arithmetic: 'double products and double clamp, final cast to Java float' }, originalNoteBlockToPacketToEngine: noteResults, originalPacketBoundaryCases: boundaries, finitePrematureFloatCounterexamples: regressions.slice(0, 8), prematureFloatDifferences: regressions.length, originalPoolDefaults: { normal: 28, streaming: 4, meaning: 'Requested software pool bounds; actual successful allocation is not measured by this static-config probe' }, sources, rawOutputs: { math: `${root}/math.bin`, notes: `${root}/notes.bin`, packet: `${root}/packet.bin` }, scope: 'Original helpers, original NoteBlock method with isolated World output receiver, and original packet constructor/getter. No game world, native voice pool or waveform playback measured.', integratedWorldScenesAdded: 0 };
await writeFile('docs/evidence/java-1.7.10-numeric-components.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ mathCases: cases.length, originalNotes: noteResults.length, packetBoundaryCases: boundaries.length, prematureFloatDifferences: regressions.length, firstCounterexample: regressions[0], worldScenesAdded: 0 }));
