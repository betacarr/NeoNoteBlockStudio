import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fromArrayBuffer } from '@nbsjs/core';
import { digest } from './research-utils.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const baselineRef = argument('--baseline') ?? 'f26fcc6c14661c04f6706f2ac64364654988693c';
assert(/^[a-f0-9]{40}$/.test(baselineRef));
const baseline = spawnSync('git', ['show', `${baselineRef}:src/core/nbs.ts`], { windowsHide: true }); assert.equal(baseline.status, 0, baseline.stderr.toString());
const output = path.resolve('.local/nbs-functional-events', `run-${Date.now()}`); await mkdir(output, { recursive: true });
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') });
const productFiles = ['src/core/nbs.ts', 'src/core/project.ts', 'src/core/time.ts', 'src/core/instruments.ts'];
const auditFiles = ['tests/fixtures/nbs-interop.ts', 'tests/nbs-functional-events.test.ts', 'scripts/audit-nbs-functional-events.mjs'];
const currentSources = Object.fromEntries(await Promise.all([...productFiles, ...auditFiles].map(async file => [file, (await reference(file)).sha256])));
const sourceCommit = '7dd79ecb313d981c12bc4b69ad13201c4995a3ae', sourceCache = path.resolve('.research/nbs-interop/upstream');
const remote = spawnSync('git', ['-C', sourceCache, 'remote', 'get-url', 'origin'], { windowsHide: true, encoding: 'utf8' }); assert.equal(remote.status, 0, 'Prepare the official source cache described in docs/nbs-interop-audit.md.');
assert.equal(remote.stdout.trim().replace(/\.git$/, ''), 'https://github.com/OpenNBS/NoteBlockStudio');
const sourceChecks = [
  ['scripts/control_step/control_step.gml', ['for (b = current_song.colfirst[xx]; b <= current_song.collast[xx]; b += 1)', 'current_song.layerlock[b] = 1', 'if (insname = "Tempo Changer") current_song.tempo = floor(abs(current_song.song_pit[xx, b])) / 15', 'else if (a)'], 'Ascending layers execute functional events before the ordinary-sound audibility branch; last event sets the column tempo even when its layer is inactive.'],
  ['scripts/toggle_playing/toggle_playing.gml', ['songs[song].tempo = get_tempo_from_tick(xx)', 'if (insname = "Tempo Changer") songs[song].tempo = floor(abs(songs[song].song_pit[xx, b])) / 15', 'else if (a)'], 'Starting playback in a column uses the same functional-event rule.'],
  ['scripts/control_draw/control_draw.gml', ['current_song.marker_pos += (current_song.tempo / room_speed) * (1 / currspeed)'], 'Tempo zero makes normal marker advancement zero until external seeking/control changes it.'],
  ['scripts/update_tempo_changes/update_tempo_changes.gml', ['for (var b = 0; b <= current_song.collast[a]; b += 1)', 'if (tempo_changes[array_length(tempo_changes) - 1][0] = a) array_pop(tempo_changes)', 'array_push(tempo_changes, [a, abs(current_song.song_pit[a, b] / 15)])'], 'The source tempo table also resolves repeated column events by the final layer.'],
  ['scripts/get_tempo_from_tick/get_tempo_from_tick.gml', ['if (tick < songs[song].tempo_changes[i][0])'], 'The tempo table applies a change at its exact tick boundary.'],
  ['scripts/open_song_nbs/open_song_nbs.gml', ['if newsong.song_nbs_version>=4', 'var pit = buffer_read_short()', 'pit = 0', 'song_first_custom_index = 0'], 'Versions before 4 have no fine-pitch field and default it to zero. The pinned app old-v0 custom-index remapping has a separate limitation.'],
  ['scripts/draw_window_edit_tempo_changer/draw_window_edit_tempo_changer.gml', ['temp_tempo = int64(tempo_changer_set_tempo)', 'if (temp_tempo > 0 && temp_tempo < 32768)'], 'The original Tempo Changer dialog accepts integer BPM 1..32767, including 12000; it does not accept zero or negative values.'],
];
const originalSources = [];
for (const [file, gates, interpretation] of sourceChecks) {
  const raw = spawnSync('git', ['-C', sourceCache, 'show', `${sourceCommit}:${file}`], { windowsHide: true }); assert.equal(raw.status, 0, raw.stderr.toString());
  const text = raw.stdout.toString('utf8'); for (const gate of gates) assert(text.includes(gate), `Missing source gate: ${file}: ${gate}`);
  if (file.endsWith('control_step.gml')) assert(text.indexOf('if (insname = "Tempo Changer")') < text.indexOf('else if (a)'));
  const snapshot = path.join(output, 'upstream', file); await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, raw.stdout);
  const blob = spawnSync('git', ['-C', sourceCache, 'rev-parse', `${sourceCommit}:${file}`], { windowsHide: true, encoding: 'utf8' }); assert.equal(blob.status, 0, blob.stderr);
  originalSources.push({ path: file, url: `https://github.com/OpenNBS/NoteBlockStudio/blob/${sourceCommit}/${file}`, gitBlob: blob.stdout.trim(), snapshot: await reference(snapshot), interpretation });
}
const baselineFile = path.join(output, 'baseline-nbs.ts'); await writeFile(baselineFile, baseline.stdout);
const contents = "export {importNbs,exportNbs} from './src/core/nbs.ts';export {nbsFixture} from './tests/fixtures/nbs-interop.ts';export {flattenNotes,validateProject} from './src/core/project.ts';export {createTempoMap} from './src/core/time.ts';";
async function bundle(name, old) {
  const file = path.join(output, `${name}.mjs`);
  await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'functional-event-audit.ts' }, outfile: file, bundle: true, platform: 'node', format: 'esm', plugins: old ? [{ name: 'pinned-nbs-baseline', setup(builder) { builder.onLoad({ filter: /[\\/]src[\\/]core[\\/]nbs\.ts$/ }, () => ({ contents: baseline.stdout.toString('utf8'), loader: 'ts', resolveDir: path.resolve('src/core') })); } }] : [] });
  return { module: await import(pathToFileURL(file).href), file: await reference(file) };
}
const before = await bundle('before', true), after = await bundle('after', false), cases = [];
function add(name, version, events, layers = [{}, {}], domain = 'finite-file-event') {
  const builtinCount = version === 0 ? 10 : version === 6 ? 20 : 16;
  cases.push({ name, domain, options: { version, builtinCount, tempo: 10, layers, custom: [{ name: 'Tempo Changer', soundFile: '' }], notes: [...[0, 4, 8].map(tick => ({ tick, instrument: 0 })), ...events.map(event => ({ tick: 4, layer: 1, instrument: builtinCount, ...event }))] } });
}
for (const version of [4, 5, 6]) {
  add(`v${version}-positive`, version, [{ detune: 300 }]);
  add(`v${version}-negative`, version, [{ detune: -300 }]);
  add(`v${version}-muted-event-solo-music`, version, [{ detune: -300, velocity: 0 }], [{ solo: true }, { locked: true }]);
  add(`v${version}-non-solo-event`, version, [{ detune: 300 }], [{ solo: true }, {}]);
  add(`v${version}-zero-volume-event`, version, [{ detune: 300, velocity: 0 }], [{}, { volume: 0 }]);
  add(`v${version}-solo-functional-layer`, version, [{ detune: 300 }], [{}, { solo: true }]);
}
for (const [name, first, last] of [['zero-then-positive', 0, 300], ['positive-then-negative', 600, -300], ['high-then-supported', 12000, 300], ['positive-then-zero', 300, 0]]) add(name, 5, [{ detune: first }, { layer: 2, detune: last }], [{}, {}, { locked: true }]);
add('zero-initial-event', 5, [{ tick: 0, detune: 0 }], undefined, 'structural-file-input-original-dialog-rejects');
add('zero-middle-event', 5, [{ detune: 0 }], undefined, 'structural-file-input-original-dialog-rejects');
add('negative-initial-event', 5, [{ tick: 0, detune: -300 }]);
for (const version of [0, 1, 2, 3]) add(`v${version}-missing-fine-pitch`, version, [{ detune: 300 }], undefined, 'legacy-schema-without-fine-pitch');
for (const detune of [10001, 12000, 32767, -32768]) add(`unrepresentable-${detune}`, 5, [{ detune }], undefined, detune > 0 ? 'original-dialog-accepted' : 'signed-short-file-boundary');
for (const detune of [1, -1, 10000, -10000]) add(`representable-${detune}`, 5, [{ detune }]);

// Independent transcription of the source's column/layer order and equations.
// This is a source-derived oracle, not execution of the original GameMaker app.
function expected(options) {
  const normalized = options.notes.map(note => ({ ...note, layer: note.layer ?? 0, detune: options.version >= 4 ? note.detune ?? 0 : 0 })).sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  const state = layer => options.version < 4 ? 0 : options.layers[layer]?.state ?? (options.layers[layer]?.solo ? 2 : options.layers[layer]?.locked ? 1 : 0);
  const solo = options.layers.some((_, index) => state(index) === 2), effective = new Map();
  for (const note of normalized) if (note.instrument === options.builtinCount) effective.set(note.tick, Math.abs(note.detune));
  const unsupported = [...effective].find(([, bpm]) => bpm === 0 || bpm > 10000);
  const tempos = new Map([[0, options.tempo * 15]]); for (const [tick, bpm] of effective) tempos.set(tick * 240, bpm);
  let tick = 0, seconds = 0, tps = options.tempo; const onsets = [], unreachableOrdinaryTicks = [];
  for (const next of [...new Set(normalized.map(note => note.tick))]) {
    if (tps !== 0) seconds += (next - tick) / tps;
    const reachable = tps !== 0 || next === tick;
    for (const note of normalized.filter(note => note.tick === next)) {
      if (note.instrument === options.builtinCount) continue;
      if (state(note.layer) === 1 || (solo && state(note.layer) !== 2)) continue;
      if (reachable) onsets.push({ tick: next, seconds }); else unreachableOrdinaryTicks.push(next);
    }
    if (reachable && effective.has(next)) tps = effective.get(next) / 15;
    tick = next;
  }
  return { convertible: !unsupported, unsupported: unsupported ? { tick: unsupported[0], bpm: unsupported[1], reason: unsupported[1] === 0 ? 'zero-stops-normal-playback' : 'exceeds-NBSX-validation-bound' } : undefined, tempos: [...tempos].sort((a, b) => a[0] - b[0]).map(([tick, bpm]) => ({ tick, bpm })), onsets, unreachableOrdinaryTicks };
}
function observe(module, bytes) {
  try {
    const result = module.importNbs(bytes, 'functional-fixture.nbs'), project = result.project, timing = module.createTempoMap(project);
    let validationError; try { module.validateProject(project); } catch (error) { validationError = String(error); }
    return { project, result: { accepted: true, tempos: project.tempos, onsets: module.flattenNotes(project).map(note => ({ tick: note.absoluteTick / 240, seconds: timing.seconds(note.absoluteTick) })), validatesAsNbsx: !validationError, validationError, diagnostics: result.diagnostics } };
  } catch (error) { return { result: { accepted: false, error: String(error) } }; }
}
const checks = [];
for (const item of cases) {
  const bytes = after.module.nbsFixture(item.options), fixture = path.join(output, `${item.name}.nbs`); await writeFile(fixture, bytes);
  const model = expected(item.options), previous = observe(before.module, bytes), current = observe(after.module, bytes); let fixedGrid;
  if (model.convertible) {
    assert.equal(current.result.accepted, true, item.name); assert.equal(current.result.validatesAsNbsx, true, item.name); assert.deepEqual(current.result.tempos, model.tempos, item.name);
    assert.equal(current.result.onsets.length, model.onsets.length, item.name);
    model.onsets.forEach((note, index) => { assert.equal(current.result.onsets[index].tick, note.tick); assert(Math.abs(current.result.onsets[index].seconds - note.seconds) < 1e-12, item.name); });
    const converted = after.module.exportNbs(current.project, 6, 20), file = path.join(output, `${item.name}-fixed.nbs`); await writeFile(file, converted.bytes);
    const oracle = fromArrayBuffer(Uint8Array.from(converted.bytes).buffer), ticks = oracle.layers.all.flatMap(layer => layer.notes.getTicks).sort((a, b) => a - b);
    assert.deepEqual(ticks, model.onsets.map(note => Math.round(note.seconds * 20)).sort((a, b) => a - b), item.name); fixedGrid = { ticks, tempo: oracle.getTempo(), file: await reference(file) };
  } else {
    assert.equal(previous.result.accepted, true, item.name); assert.equal(current.result.accepted, false, item.name);
    if (model.unsupported.bpm > 10000) assert.equal(previous.result.validatesAsNbsx, false, item.name);
    assert(current.result.error.includes(`tick ${model.unsupported.tick}`)); assert(current.result.error.includes(String(model.unsupported.bpm)));
  }
  checks.push({ name: item.name, domain: item.domain, options: item.options, fixture: await reference(fixture), sourceModel: model, pinnedApplicationV0CustomRemappingNotCertified: item.options.version === 0, before: previous.result, after: current.result, fixedGrid, passed: true });
}
for (const [file, sha256] of Object.entries(currentSources)) assert.equal((await reference(file)).sha256, sha256, `Changed during audit: ${file}`);
const report = {
  schema: 1, scope: 'NBS Tempo Changer conversion and explicit import boundaries; source-derived timing oracle, no original GameMaker runtime, world audio or PCM execution claims.', output,
  upstream: { repository: 'https://github.com/OpenNBS/NoteBlockStudio', commit: sourceCommit, sources: originalSources, rawSourceInIgnoredSnapshotsOnly: true },
  format: 'https://noteblock.studio/nbs', baseline: { commit: baselineRef, source: await reference(baselineFile), bundle: before.file, onlyNbsModuleReplaced: true }, currentBundle: after.file, currentSources,
  independentBinaryOracle: { version: JSON.parse(await readFile('node_modules/@nbsjs/core/package.json')).version, code: await reference('node_modules/@nbsjs/core/dist/index.js'), scope: 'Reads only the resulting v6 fixed-grid export; does not implement Tempo Changer.' },
  cases: checks.length, convertibleCases: checks.filter(item => item.sourceModel.convertible).length, explicitBoundaryRejections: checks.filter(item => !item.sourceModel.convertible).length, allPassed: true,
  checks,
  limitations: [
    'The zero event is structurally encodable but rejected by the original Tempo Changer dialog. Positive 12000 BPM is accepted by that dialog and demonstrates a reachable NBSX reopen failure in the baseline.',
    'For legacy v0, this checks the declared custom definition and the absence of the fine-pitch field. The pinned OpenNBS v0 loader does not remap the old ten-entry custom boundary to its current built-in table, so this report does not claim that app plays a v0 custom instrument as Tempo Changer.',
    'A zero tempo stops normal progression; external seeking or changing settings can resume. That interactive behavior cannot be represented by the current positive-tempo project model, so import refuses it rather than silently inventing onsets.',
    'Same-tick transient zero/high events overridden by a final supported event remain convertible. Dynamic edits, user seeking, frame scheduling, whole-song loops and other functional instruments are outside this report.',
  ],
};
const file = path.join(output, 'report.json'); await writeFile(file, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/nbs-functional-events.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: file, cases: report.cases, convertible: report.convertibleCases, explicitRejections: report.explicitBoundaryRejections, allPassed: true }));
