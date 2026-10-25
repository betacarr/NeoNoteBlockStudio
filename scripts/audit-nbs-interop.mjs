import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fromArrayBuffer, Song, toArrayBuffer } from '@nbsjs/core';
import { digest } from './research-utils.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const baselineRef = argument('--baseline') ?? '894a00207e35e169a91d9bc393ffb71d63f78d61';
assert(/^[a-f0-9]{40}$/.test(baselineRef), 'Pass an explicit full baseline commit hash.');
const baseline = spawnSync('git', ['show', `${baselineRef}:src/core/nbs.ts`], { windowsHide: true, encoding: 'utf8' }); assert.equal(baseline.status, 0, baseline.stderr);
const output = path.resolve('.local/nbs-interop', `run-${Date.now()}`); await mkdir(output, { recursive: true });
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') });
const upstreamCommit = '7dd79ecb313d981c12bc4b69ad13201c4995a3ae', upstreamDirectory = path.resolve('.research/nbs-interop/upstream');
const upstreamRemote = spawnSync('git', ['-C', upstreamDirectory, 'remote', 'get-url', 'origin'], { windowsHide: true, encoding: 'utf8' });
assert.equal(upstreamRemote.status, 0, 'Prepare the official OpenNBS development checkout described in docs/nbs-interop-audit.md.');
assert.equal(upstreamRemote.stdout.trim().replace(/\.git$/, ''), 'https://github.com/OpenNBS/NoteBlockStudio');
const upstreamChecks = [
  ['scripts/open_song_nbs/open_song_nbs.gml', ['custom_index_diff = first_custom_index - song_first_custom_index', 'newsong.layerlock[b] = buffer_read_byte()'], 'The source header defines the custom-instrument boundary; v4+ layer states are read as a byte.'],
  ['scripts/save_song/save_song.gml', ['if (nbsver < 6) song_first_custom_index = 16', 'buffer_write_byte(b < cursong.endb2 ? cursong.layerlock[b] : 0)'], 'The writer changes the custom-instrument boundary for older targets and preserves the layer-state value.'],
  ['scripts/add_layer/add_layer.gml', ['if (lock == 2) solostrnew +='], 'Layer state 2 is added to the solo set.'],
  ['scripts/control_step/control_step.gml', ['current_song.layerlock[b] = 1', 'a = 0', 'else if (a)', 'current_song.tempo = floor(abs(current_song.song_pit[xx, b])) / 15'], 'Ordinary sounds exclude non-solo and state-1 layers before play_sound; Tempo Changer uses absolute fine pitch divided by 15.'],
  ['scripts/play_sound/play_sound.gml', ['keyshift = key + (ins.key + (pit/100) - 78)', '0.5 * power(2, keyshift / 12)'], 'The custom key and fine-pitch equation implies sampler MIDI root 111 minus the NBS custom key.'],
];
const upstreamSources = [];
for (const [file, expected, interpretation] of upstreamChecks) {
  const raw = spawnSync('git', ['-C', upstreamDirectory, 'show', `${upstreamCommit}:${file}`], { windowsHide: true });
  assert.equal(raw.status, 0, raw.stderr?.toString());
  for (const snippet of expected) assert(raw.stdout.toString('utf8').includes(snippet), `Missing upstream source guard: ${file}: ${snippet}`);
  const snapshot = path.join(output, 'upstream', file); await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, raw.stdout);
  const blob = spawnSync('git', ['-C', upstreamDirectory, 'rev-parse', `${upstreamCommit}:${file}`], { windowsHide: true, encoding: 'utf8' }); assert.equal(blob.status, 0, blob.stderr);
  upstreamSources.push({ path: file, url: `https://github.com/OpenNBS/NoteBlockStudio/blob/${upstreamCommit}/${file}`, gitBlob: blob.stdout.trim(), snapshot: await reference(snapshot), interpretation });
}
const sources = ['src/core/nbs.ts', 'src/core/instruments.ts', 'src/core/project.ts', 'src/core/time.ts', 'tests/fixtures/nbs-interop.ts', 'tests/nbs-interop.test.ts', 'scripts/audit-nbs-interop.mjs'];
const currentSources = Object.fromEntries(await Promise.all(sources.map(async file => [file, (await reference(file)).sha256])));
const baselineFile = path.join(output, 'baseline-nbs.ts'); await writeFile(baselineFile, baseline.stdout);
const contents = "export {importNbs,exportNbs} from './src/core/nbs.ts';export {nbsFixture} from './tests/fixtures/nbs-interop.ts';export {flattenNotes,createProject,newNote} from './src/core/project.ts';";
async function bundle(name, before) {
  const filename = path.join(output, `${name}.mjs`);
  await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'nbs-interop.ts' }, outfile: filename, bundle: true, platform: 'node', format: 'esm', plugins: before ? [{ name: 'pinned-nbs-baseline', setup(builder) { builder.onLoad({ filter: /[\\/]src[\\/]core[\\/]nbs\.ts$/ }, () => ({ contents: baseline.stdout, loader: 'ts', resolveDir: path.resolve('src/core') })); } }] : [] });
  return { module: await import(pathToFileURL(filename).href), reference: await reference(filename) };
}
const before = await bundle('before', true), after = await bundle('after', false), checks = [];
function inspect(bytes) {
  const oracle = fromArrayBuffer(Uint8Array.from(bytes).buffer);
  return { builtinCount: bytes[3], noteInstrument: oracle.layers.all[0].notes.all[0].instrument, definitions: Object.values(oracle.instruments.all).filter(instrument => !instrument.isBuiltIn).map(instrument => ({ name: instrument.name, soundFile: instrument.soundFile, key: instrument.key })) };
}
for (const version of [0, 1, 2, 3, 4, 5, 6]) {
  const sourceCount = version <= 2 ? 10 : version >= 6 ? 20 : 16;
  const source = after.module.nbsFixture({ version, builtinCount: sourceCount, custom: [{ name: 'My Marimba', soundFile: 'marimba.ogg', key: 57 }], notes: [{ tick: 0, instrument: sourceCount }, { tick: 4, instrument: 0 }] });
  const sourceFile = path.join(output, `source-v${version}.nbs`); await writeFile(sourceFile, source);
  for (const target of [4, 5, 6]) {
    const filename = `source-v${version}.nbs`, originalProject = before.module.importNbs(source, filename).project, currentProject = after.module.importNbs(source, filename).project;
    const previous = before.module.exportNbs(originalProject, target, 10), current = after.module.exportNbs(currentProject, target, 10);
    const previousFile = path.join(output, `before-v${version}-to-v${target}.nbs`), currentFile = path.join(output, `after-v${version}-to-v${target}.nbs`);
    await writeFile(previousFile, previous.bytes); await writeFile(currentFile, current.bytes);
    const old = inspect(previous.bytes), fixed = inspect(current.bytes);
    assert.equal(fixed.noteInstrument, target === 6 ? 20 : 16);
    assert.deepEqual(fixed.definitions, [{ name: 'My Marimba', soundFile: 'marimba.ogg', key: 57 }]);
    const reload = after.module.importNbs(current.bytes, 'again.nbs').project, note = after.module.flattenNotes(reload)[0], instrument = reload.instruments.find(item => item.id === note.effectiveInstrument);
    assert.equal(instrument.rootMidi, 54); assert.equal(instrument.name, 'My Marimba');
    assert(current.diagnostics.some(item => item.code === 'nbs-custom'));
    checks.push({ sourceVersion: version, sourceBuiltinCount: sourceCount, targetVersion: target, source: await reference(sourceFile), before: { ...old, file: await reference(previousFile), customIdentityLost: !old.definitions.length }, after: { ...fixed, file: await reference(currentFile), customIdentityPreserved: true, samplerRoot: instrument.rootMidi }, exactCustomMapping: true });
  }
}
const empty = after.module.createProject(), invalidTempo = before.module.exportNbs(empty, 5, .004);
let previousError; try { before.module.importNbs(invalidTempo.bytes, 'zero-tempo.nbs'); } catch (error) { previousError = String(error); } assert(previousError?.includes('速度'));
assert.throws(() => after.module.exportNbs(empty, 5, .004), /0.01/);
const loopSource = after.module.nbsFixture({ version: 5, loop: { enabled: true, count: 3, start: 4 }, notes: [{ tick: 0, instrument: 0 }] });
const loopBefore = before.module.exportNbs(before.module.importNbs(loopSource, 'loop.nbs').project, 6, 20), loopAfter = after.module.exportNbs(after.module.importNbs(loopSource, 'loop.nbs').project, 6, 20);
assert(!loopBefore.diagnostics.some(item => item.code === 'nbs-song-loop-loss'));
assert(loopAfter.diagnostics.some(item => item.code === 'nbs-song-loop-loss'));
const soloSong = new Song(); soloSong.layers.create().notes.create(0, 0); const soloLayer = soloSong.layers.create(); soloLayer.isSolo = true; soloLayer.notes.create(0, 1);
const soloBytes = new Uint8Array(toArrayBuffer(soloSong)), soloFile = path.join(output, 'independent-solo.nbs'); await writeFile(soloFile, soloBytes);
const soloBefore = before.module.importNbs(soloBytes, 'solo.nbs').project, soloAfter = after.module.importNbs(soloBytes, 'solo.nbs').project;
assert.equal(before.module.flattenNotes(soloBefore).length, 2); assert.deepEqual(after.module.flattenNotes(soloAfter).map(note => note.effectiveInstrument), ['bass']);
assert.equal(soloAfter.tracks[1].solo, true); assert.equal(soloAfter.tracks[1].locked, false);
const lockedSong = new Song(); lockedSong.layers.create().notes.create(0, 0); const lockedLayer = lockedSong.layers.create(); lockedLayer.isLocked = true; lockedLayer.notes.create(0, 1);
const lockedBytes = new Uint8Array(toArrayBuffer(lockedSong)), lockedFile = path.join(output, 'independent-locked.nbs'); await writeFile(lockedFile, lockedBytes);
const lockedBefore = before.module.importNbs(lockedBytes, 'locked.nbs').project, lockedResult = after.module.importNbs(lockedBytes, 'locked.nbs'), lockedAfter = lockedResult.project;
assert.equal(before.module.flattenNotes(lockedBefore).length, 2); assert.deepEqual(after.module.flattenNotes(lockedAfter).map(note => note.effectiveInstrument), ['harp']);
assert.equal(lockedAfter.tracks[1].locked, true); assert.equal(lockedAfter.tracks[1].muted, true); assert.equal(after.module.flattenNotes(lockedAfter, true).length, 2);
assert(lockedResult.diagnostics.some(item => item.code === 'nbs-layer-state'));
const lockedExport = after.module.exportNbs(lockedAfter, 6, 20); assert(lockedExport.diagnostics.some(item => item.code === 'nbs-audible-tracks'));
const editorLocked = after.module.createProject(); editorLocked.tracks[0].locked = true; editorLocked.patterns[0].notes = [after.module.newNote(0, 66)];
assert.equal(after.module.flattenNotes(editorLocked).length, 1); assert(!after.module.exportNbs(editorLocked, 6, 20).diagnostics.some(item => item.code === 'nbs-audible-tracks'));
for (const state of [3, 255]) assert.throws(() => after.module.importNbs(after.module.nbsFixture({ version: 6, layers: [{ state }], notes: [{ tick: 0, instrument: 0 }] }), 'unknown.nbs'), /层状态/);
const replacementProject = after.module.createProject(); replacementProject.patterns[0].notes = [after.module.newNote(0, 66)];
replacementProject.instruments.find(instrument => instrument.id === 'harp').assetId = 'replacement';
replacementProject.assets.push({ id: 'replacement', name: 'my-harp.ogg', mime: 'audio/ogg', data: 'AQID' });
const replacementBefore = before.module.exportNbs(replacementProject, 6, 20), replacementChecks = [];
assert(!replacementBefore.diagnostics.some(item => item.code === 'nbs-builtin-sample'));
const replacementSnapshot = structuredClone(replacementProject);
for (const target of [4, 5, 6]) {
  const result = after.module.exportNbs(replacementProject, target, 20), exportedFile = path.join(output, `builtin-replacement-to-v${target}.nbs`); await writeFile(exportedFile, result.bytes);
  const parsed = inspect(result.bytes); assert.equal(parsed.noteInstrument, 0); assert.equal(parsed.definitions.length, 0);
  const diagnostic = result.diagnostics.find(item => item.code === 'nbs-builtin-sample'); assert(diagnostic); assert.equal(diagnostic.severity, 'warning');
  replacementChecks.push({ targetVersion: target, file: await reference(exportedFile), unchangedBuiltinIndex: parsed.noteInstrument, customDefinitions: parsed.definitions.length, diagnostic });
}
assert.deepEqual(replacementProject, replacementSnapshot);
for (const [file, sha256] of Object.entries(currentSources)) assert.equal((await reference(file)).sha256, sha256);
const report = {
  schema: 1, scope: 'NBS binary interoperability and conversion diagnostics only; no Minecraft audio or PCM claims.', output,
  sources: [{ title: 'OpenNBS official NBS format', url: 'https://noteblock.studio/nbs' }, { title: 'OpenNBS nbs.js independent implementation', url: 'https://github.com/OpenNBS/nbs.js' }],
  upstream: { repository: 'https://github.com/OpenNBS/NoteBlockStudio', commit: upstreamCommit, sources: upstreamSources, rawSourceInIgnoredSnapshotsOnly: true },
  baseline: { commit: baselineRef, source: await reference(baselineFile), bundle: before.reference }, currentBundle: after.reference, currentSources,
  oracle: { version: JSON.parse(await readFile('node_modules/@nbsjs/core/package.json')).version, code: await reference('node_modules/@nbsjs/core/dist/index.js'), types: await reference('node_modules/@nbsjs/core/dist/index.d.ts') },
  customIdentityCases: checks.length, baselineLossCases: checks.filter(item => item.before.customIdentityLost).length, exactCustomMapping: true, checks,
  invalidTempo: { input: .004, baselineProducesZeroTempo: true, baselineReloadError: previousError, currentRejectsBeforeWriting: true },
  loopReport: { baselineSilentlyDisabled: true, currentDiagnostic: loopAfter.diagnostics.find(item => item.code === 'nbs-song-loop-loss'), currentExportStillDisablesSourceLoop: true },
  soloLayers: { fixture: await reference(soloFile), baselineAudibleNotes: 2, currentAudibleNotes: 1, currentKeepsAllSourceNotes: after.module.flattenNotes(soloAfter, true).length === 2, soloAndLockedDistinct: true },
  lockedLayers: { fixture: await reference(lockedFile), baselineAudibleNotes: 2, currentAudibleNotes: 1, currentKeepsAllSourceNotes: true, importedLockAlsoMutes: true, ordinaryEditorLockStillAudible: true, importDiagnostic: lockedResult.diagnostics.find(item => item.code === 'nbs-layer-state'), exportDiagnostic: lockedExport.diagnostics.find(item => item.code === 'nbs-audible-tracks'), unknownStatesRejected: [3, 255] },
  builtinSampleReplacement: { baselineSilentlyUsesBuiltin: true, currentRetainsBuiltinSemantics: true, projectAssetUnchanged: true, checks: replacementChecks },
  limitations: [
    '@nbsjs/core 6.1.0 always writes a 20-entry built-in table and its reader ignores the source header count; legacy fixtures are therefore independently encoded from the specification. Oracle checks inspect raw note indices and the custom-definition list, not its faulty custom-index lookup.',
    'Fixtures use ASCII text. This report does not certify all Unicode/legacy text encodings, special event semantics, or every metadata field.',
    'Tempo Changer onset baking, layer/note volume and pan, custom tuning/per-note overrides and v6 brass identities have separate focused unit tests. Tempo Changer is not supported by the independent oracle.',
    'Whole-song loop settings stay in NBSX provenance and are explicitly reported as omitted by NBS export; no automatic region-loop conversion is introduced.',
  ],
};
const rawReport = path.join(output, 'report.json'); await writeFile(rawReport, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/nbs-custom-identity-interop.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: rawReport, customIdentityCases: checks.length, baselineLossCases: report.baselineLossCases, currentPreserved: true, zeroTempoRejected: true, loopLossReported: true }));
