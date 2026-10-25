import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const root = path.resolve('.local/midi-interop', `run-${Date.now()}`), repository = path.resolve('.local/midi-fixtures/tonejs');
const python = process.argv.includes('--python') ? process.argv[process.argv.indexOf('--python') + 1] : 'python';
if (!python) throw new Error('--python requires an interpreter path');
await mkdir(path.join(root, 'out'), { recursive: true });
await build({ stdin: { contents: "export { importMidi, exportMidi, originalMidi } from './src/core/midi.ts'; export { saveNbsx,openNbsx } from './src/core/container.ts'; export { expressionFixture, programChangeFixture } from './tests/fixtures/midi.ts';", resolveDir: process.cwd(), sourcefile: 'midi-interop.ts' }, outfile: path.join(root, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { importMidi, exportMidi, originalMidi, saveNbsx, openNbsx, expressionFixture, programChangeFixture } = await import(pathToFileURL(path.join(root, 'helper.mjs')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(directory) { const result = []; for (const item of await readdir(directory, { withFileTypes: true })) { if (item.name === '.git') continue; const filename = path.join(directory, item.name); if (item.isDirectory()) result.push(...await walk(filename)); else if (/\.mid(i)?$/i.test(item.name)) result.push(filename); } return result; }
const commit = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { windowsHide: true, encoding: 'utf8' }); assert.equal(commit.status, 0, commit.stderr);
const fixtures = [{ id: 'hand-expressions', bytes: expressionFixture() }, { id: 'hand-program-change', bytes: programChangeFixture() }];
for (const filename of (await walk(repository)).sort()) fixtures.push({ id: path.relative(repository, filename).replaceAll('\\', '/'), bytes: new Uint8Array(await readFile(filename)) });
const cases = [], importFailures = [];
for (let i = 0; i < fixtures.length; i++) {
  const fixture = fixtures[i], stem = path.join(root, 'out', `case-${String(i).padStart(3, '0')}`);
  await writeFile(stem + '-input.mid', fixture.bytes);
  try {
    const started = performance.now(), imported = importMidi(fixture.bytes, path.basename(fixture.id) + '.mid');
    const container = saveNbsx(imported.project), restored = openNbsx(container), source = originalMidi(restored);
    assert.equal(hash(source.bytes), hash(fixture.bytes), 'Embedded original MIDI changed');
    const exported = exportMidi(restored); await writeFile(stem + '.mid', exported.bytes); await writeFile(stem + '.nbsx', container);
    cases.push({ id: fixture.id, input: stem + '-input.mid', output: stem + '.mid', sourceSha256: hash(fixture.bytes), exportedSha256: hash(exported.bytes), sourceBytes: fixture.bytes.length, editorTracks: restored.tracks.length, editorNotes: restored.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0), originalFileExact: true, milliseconds: Math.round(performance.now() - started), diagnostics: [...imported.diagnostics, ...exported.diagnostics] });
  } catch (error) { importFailures.push({ id: fixture.id, error: String(error) }); }
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ cases }, null, 2));
const oracle = spawnSync(python, ['scripts/verify_midi_mido.py', path.join(root, 'manifest.json'), path.join(root, 'oracle.json')], { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (oracle.stdout) console.log(oracle.stdout.trim()); if (oracle.stderr) console.error(oracle.stderr.slice(0, 3000));
if (oracle.error) throw oracle.error;
const comparison = await readFile(path.join(root, 'oracle.json'), 'utf8').then(JSON.parse).catch(() => { throw new Error('Independent verifier produced no fresh report; check Python/Mido.'); });
const report = { source: { repository: 'https://github.com/Tonejs/Midi', commit: commit.stdout.trim() }, oracle: comparison.oracle, oracleVersion: comparison.version,
  scope: 'SMF 0/1 PPQ, untouched import -> NBSX save/reopen -> format-1 export. Compare all semantic messages, per-channel/SysEx ordering at equal ticks, PPQ and final tick; regenerated track names and canonical running-status/note-off encodings are excluded.',
  exact: oracle.status === 0 && comparison.exact && !importFailures.length, importFailures, cases: cases.map(({ input: _input, output: _output, ...item }) => ({ ...item, comparison: comparison.observations.find(observation => observation.id === item.id) })) };
report.implementationSha256 = {};
for (const file of ['src/core/midi.ts','src/core/midi-import.ts','src/core/midi-export.ts','src/core/midi-events.ts','src/core/smf.ts','src/core/midi-text.ts','src/core/container.ts','src/core/project.ts','src/core/meter.ts','src/core/time.ts','src/core/types.ts','scripts/verify_midi_mido.py','scripts/verify-midi-interop.mjs','tests/fixtures/midi.ts']) report.implementationSha256[file] = hash(await readFile(file));
report.nodeVersion = process.version;
await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ imported: cases.length, importFailures, exact: report.exact, report: path.join(root, 'result.json') }));
assert(report.exact, 'Independent MIDI comparison failed');
if (process.argv.includes('--write-evidence')) { await mkdir('docs/evidence', { recursive: true }); await writeFile('docs/evidence/midi-interop.json', JSON.stringify(report, null, 2)); }
