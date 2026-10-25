import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { digest } from './research-utils.mjs';
import { reviewLwjgl218Source } from './review-lwjgl218-source.mjs';

const source = await reviewLwjgl218Source(), numericFile = source.numericComponents.path;
const numericBytes = await readFile(numericFile); assert.equal(digest(numericBytes, 'sha256'), source.numericComponents.sha256);
const numeric = JSON.parse(numericBytes), math = await readFile(numeric.rawOutputs.math);
assert.equal(digest(math, 'sha256'), numeric.engineMath.outputSha256);
const inputsFile = path.join(path.dirname(numeric.rawOutputs.math), 'inputs.json'), inputsBytes = await readFile(inputsFile);
assert.equal(digest(inputsBytes, 'sha256'), numeric.engineMath.inputsSha256);
const inputs = JSON.parse(inputsBytes).map(row => row.map(Number)); assert.equal(inputs.length, math.readUInt32LE(4));
const output = path.resolve('.local/lwjgl218-product-parameters', `run-${Date.now()}`); await mkdir(output, { recursive: true });
await build({ stdin: { contents: "export {gameVolumeParameters,gameEventPitchParameters,gamePitchParameters} from './src/audio/volume.ts';export {noteAudioParameters} from './src/audio/parameters.ts';export {createProject,newNote,flattenNotes} from './src/core/project.ts';", resolveDir: process.cwd(), sourcefile: 'lwjgl218-product.ts' }, outfile: path.join(output, 'product.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { gameVolumeParameters, gameEventPitchParameters, gamePitchParameters, noteAudioParameters, createProject, newNote, flattenNotes } = await import(pathToFileURL(path.join(output, 'product.mjs')).href);
const bits = value => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return bytes.readUInt32LE(); };
const mathCases = [], noteCases = [], boundaryCases = [];
for (let index = 0; index < inputs.length; index++) {
  const [volume, pitch, category, eventVolume, eventPitch] = inputs[index];
  const gain = gameVolumeParameters('java-1.8', volume, .7, category, eventVolume), productPitch = gameEventPitchParameters('java-1.8', pitch, eventPitch);
  const originalGainBits = math.readUInt32LE(8 + index * 8), originalPitchBits = math.readUInt32LE(12 + index * 8);
  assert.equal(bits(gain.gain), originalGainBits, `Original engine gain case ${index}`);
  assert.equal(bits(productPitch), originalPitchBits, `Original event pitch case ${index}`);
  assert.equal(gain.listenerGain, Math.fround(.7));
  mathCases.push({ case: index, originalGainBits, productGainBits: bits(gain.gain), originalPitchBits, productPitchBits: bits(productPitch), exact: true });
}
const project = createProject(); project.audio.profileId = 'java-1.8';
for (const original of numeric.originalNoteBlockToPacketToEngine) {
  project.tracks[0].instrumentId = source.facts.materials.find(item => item.eventId === original.instrumentEventId).instrument;
  const instance = Math.pow(2, (original.note - 12) / 12), product = gamePitchParameters(project.audio.profileId, instance);
  assert.equal(bits(product), bits(original.originalEnginePitch));
  project.patterns[0].notes = [newNote(0, 54 + original.note)];
  const parameters = noteAudioParameters(project, flattenNotes(project)[0]); assert.equal(bits(parameters.pitch), bits(original.originalEnginePitch));
  noteCases.push({ instrument: project.tracks[0].instrumentId, note: original.note, encodedByte: original.encodedByte, originalPitchBits: bits(original.originalEnginePitch), productPitchBits: bits(product), projectPitchBits: bits(parameters.pitch), exact: true });
}
for (const original of numeric.originalPacketBoundaryCases) {
  const product = gamePitchParameters(project.audio.profileId, original.input); assert.equal(bits(product), bits(original.originalEnginePitch));
  boundaryCases.push({ input: original.input, encodedByte: original.encodedByte, originalPitchBits: bits(original.originalEnginePitch), productPitchBits: bits(product), exact: true });
}
const files = ['src/audio/volume.ts', 'src/audio/parameters.ts', 'src/audio/profiles.ts', 'src/core/project.ts', 'src/data/audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/world-audio-facts.json', 'scripts/verify-lwjgl218-parameters.mjs'];
const productSources = Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(file), 'sha256')])));
const report = { schema: 1, version: '1.8', clientSha1: source.officialSources.clientSha1, exact: true,
  scope: 'Production volume/event-pitch/packet-pitch helpers and project note parameter path compared with archived unchanged original class invocations. Finite explicit component inputs; no original world, waveform, scheduling or native pool capacity claim.',
  originalSource: { path: 'docs/evidence/java-1.8-audio-source.json', sha256: digest(await readFile('docs/evidence/java-1.8-audio-source.json'), 'sha256') },
  originalNumeric: { path: numericFile, sha256: digest(numericBytes, 'sha256') }, productSources, mathCases, noteCases, boundaryCases, worldScenesAdded: 0 };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
await writeFile('docs/evidence/java-1.8-product-parameters.json', JSON.stringify({ ...report, rawReport: { path: path.relative(process.cwd(), path.join(output, 'report.json')).replaceAll('\\', '/'), sha256: digest(await readFile(path.join(output, 'report.json')), 'sha256') } }, null, 2));
console.log(JSON.stringify({ exact: true, engineMathCases: mathCases.length, allOriginalNoteValues: noteCases.length, packetBoundaryCases: boundaryCases.length, worldScenesAdded: 0 }));
