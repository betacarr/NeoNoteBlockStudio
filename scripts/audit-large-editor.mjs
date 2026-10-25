import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const root = path.resolve(option('--output') ?? `.local/large-editor-audit/run-${Date.now()}`);
assert(option('--baseline'), 'Pass --baseline <directory containing the archived source and two project fixtures>');
const baseline = path.resolve(option('--baseline'));
await mkdir(root, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {};
for (const file of ['scripts/audit-large-editor.mjs', 'src/ui/Arrangement.tsx', 'src/ui/arrangement-preview.ts', 'src/ui/arrangement-note-index.ts', 'src/ui/arrangement-note-cache.ts', 'src/ui/PianoRoll.tsx', 'src/ui/piano-note-index.ts', 'src/ui/piano-preview.ts', 'src/ui/piano-hit-test.ts', 'src/ui/styles.css', 'src/core/project.ts', 'src/core/midi-import.ts', 'src/core/meter.ts']) sources[file] = digest(await readFile(file));
const bundle = path.join(root, 'core.mjs');
await build({ stdin: { contents: "export {createProject,newNote,newTrack,flattenNotes,validateProject} from './src/core/project.ts'; export {importMidi} from './src/core/midi-import.ts'; export {createMeterMap} from './src/core/meter.ts'; export {saveNbsx} from './src/core/container.ts'; export {regionSourceRanges} from './src/core/editor-interaction.ts'; export {noteName} from './src/core/instruments.ts'; export {regionPreviewGeometry} from './src/ui/arrangement-preview.ts'; export {ArrangementNoteIndex} from './src/ui/arrangement-note-index.ts'; export {PianoNoteIndex} from './src/ui/piano-note-index.ts'; export {previewPianoNotes} from './src/ui/piano-preview.ts'; export {noteAt} from './src/ui/piano-hit-test.ts';", resolveDir: process.cwd(), sourcefile: 'editor-audit.ts' }, outfile: bundle, platform: 'node', format: 'esm', bundle: true });
const { createProject, newNote, newTrack, flattenNotes, validateProject, importMidi, createMeterMap, saveNbsx, regionSourceRanges, noteName, regionPreviewGeometry, ArrangementNoteIndex, PianoNoteIndex, previewPianoNotes, noteAt } = await import(pathToFileURL(bundle).href);
const report = { schema: 1, sources, scope: 'Offline original-source / geometry / import probes. No browser input, live editor FPS, GPU timing or native audio claim.', baseline: { path: path.relative(process.cwd(), baseline).replaceAll('\\', '/'), sha256: digest(await readFile(path.join(baseline, 'baseline.json'))) }, geometry: [], fixtures: [], cpuProbes: [], remainingRisks: [] };
report.bundle = { path: path.relative(process.cwd(), bundle).replaceAll('\\', '/'), sha256: digest(await readFile(bundle)) };
const baselineSource = (await readFile(path.join(baseline, 'Arrangement.tsx'), 'utf8')).replaceAll('\r\n', '\n');
const baselineReport = JSON.parse(await readFile(path.join(baseline, 'baseline.json')));
assert.equal(digest(await readFile(path.join(baseline, 'Arrangement.tsx'))), baselineReport.sources['src/ui/Arrangement.tsx']);
const oldStart = baselineSource.indexOf('    const draw = () => {'), oldEnd = baselineSource.indexOf('\n    };', oldStart);
assert(oldStart >= 0 && oldEnd > oldStart);
const oldDrawCode = transformSync(baselineSource.slice(oldStart, oldEnd + 7) + '\nreturn draw;', { loader: 'ts' }).code;
report.baseline.cases = [];
function baselinePreview(pattern, region) {
  const fills = [], context = { scale() {}, fillRect(...args) { fills.push(args); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const element = { clientWidth: 800, clientHeight: 44, getContext: () => context };
  Function('element', 'pattern', 'region', 'window', oldDrawCode)(element, pattern, region, { devicePixelRatio: 1 })();
  return fills.length;
}

function union(strokes) {
  const rows = new Map();
  for (const note of strokes) { const row = rows.get(note.midi) ?? []; row.push([note.x, note.x + note.width]); rows.set(note.midi, row); }
  const output = [];
  for (const [midi, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a[0] - b[0]); const merged = [];
    for (const [start, end] of row) { const last = merged.at(-1); if (last && start <= last[1] + 1e-8) last[1] = Math.max(last[1], end); else merged.push([start, end]); }
    for (const [start, end] of merged) output.push([midi, start, end]);
  }
  return output;
}
function compareGeometry(name, project, view) {
  validateProject(project); const pattern = project.patterns[0], region = project.regions[0], pixels = view.regionWidth / region.length;
  const flat = flattenNotes(project), expected = [];
  for (const note of flat) {
    const start = (note.absoluteTick - region.start) * pixels - view.offset, width = Math.max(2, note.duration * pixels);
    const left = Math.max(0, start), right = Math.min(view.width, start + width);
    if (right > left) expected.push({ midi: note.midi, x: left, width: right - left });
  }
  const queryStats = { visitedNodes: 0, testedNotes: 0, candidates: 0 };
  const actual = regionPreviewGeometry(pattern, region, view, new ArrangementNoteIndex(pattern.notes, pattern.length), queryStats), a = union(actual.notes), b = union(expected);
  assert.equal(a.length, b.length, name);
  a.forEach((row, i) => { assert.equal(row[0], b[i][0], name); assert(Math.abs(row[1] - b[i][1]) < 1e-7 && Math.abs(row[2] - b[i][2]) < 1e-7, name); });
  report.geometry.push({ name, view, storedOffset: region.offset, playbackOnsets: flat.length, visibleSourceStrokes: expected.length, emittedStrokes: actual.notes.length, visibleUnionMatchesPlayback: true, queryStats });
}
for (const [filename, views] of [
  ['501-source-cycles.project.json', [{ offset: 0, width: 800, regionWidth: 68136 }, { offset: 67500, width: 636, regionWidth: 68136 }, { offset: 68000, width: 136, regionWidth: 68136 }]],
  ['offset-beyond-500-cycles.project.json', [{ offset: 0, width: 544, regionWidth: 544 }, { offset: 130, width: 200, regionWidth: 544 }]],
]) {
  const project = JSON.parse(await readFile(path.join(baseline, filename), 'utf8'));
  report.baseline.cases.push({ name: filename, expectedPlaybackOnsets: flattenNotes(project).length, oldPreviewStrokes: baselinePreview(project.patterns[0], project.regions[0]) });
  views.forEach((view, i) => compareGeometry(`${filename}:${i}`, project, view));
  const output = path.join(root, filename.replace('.project.json', '.nbsx')), bytes = saveNbsx(project); await writeFile(output, bytes);
  report.fixtures.push({ path: path.relative(process.cwd(), output).replaceAll('\\', '/'), sha256: digest(bytes), expectedPlaybackOnsets: flattenNotes(project).length });
}
assert.deepEqual(report.baseline.cases.map(item => [item.expectedPlaybackOnsets, item.oldPreviewStrokes]), [[501, 500], [4, 0]]);
{
  const p = createProject('Dense loop strokes remain covered'); p.ppq = 480; p.patterns[0].length = 1; p.patterns[0].notes = [newNote(0, 60, 0)]; p.regions[0].length = 100000; p.regions[0].loop = true;
  compareGeometry('dense subpixel loops merge ink without dropping visible coverage', p, { offset: 1200, width: 800, regionWidth: 3400 });
}
{
  const p = createProject('True loop phase and far arrangement location'); p.ppq = 480; p.patterns[0].length = 1920; p.patterns[0].notes = [newNote(0, 60, 120), newNote(960, 67, 240)]; p.regions[0].start = 1152000; p.regions[0].offset = 501 * 1920 + 480; p.regions[0].length = 7680; p.regions[0].loop = true;
  compareGeometry('whole-period offset plus nonzero phase at bar601', p, { offset: 0, width: 544, regionWidth: 544 });
  const output = path.join(root, 'phase-offset-far.nbsx'), bytes = saveNbsx(p); await writeFile(output, bytes); report.fixtures.push({ path: path.relative(process.cwd(), output).replaceAll('\\', '/'), sha256: digest(bytes), expectedPlaybackOnsets: flattenNotes(p).length, regionStart: p.regions[0].start });
}
{
  let seed = 143144;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  report.generatedGeometry = { seed, cases: 120, toleranceCssPixels: 1e-7, oracle: 'Actual flattenNotes playback onsets and duration ink, unioned by pitch.' };
  for (let i = 0; i < 120; i++) {
    const p = createProject(), pattern = p.patterns[0], region = p.regions[0];
    pattern.length = 120 + random(2000); pattern.notes = Array.from({ length: 8 }, () => newNote(random(pattern.length + 100), 48 + random(37), random(pattern.length * 3)));
    region.loop = i % 3 !== 0; region.offset = random(pattern.length * 1000); region.length = 10 + random(pattern.length * 9);
    const regionWidth = 25 + random(10000), width = Math.min(regionWidth, 20 + random(850)), offset = random(Math.floor(regionWidth - width) + 1);
    compareGeometry(`deterministic phase/range case ${i}`, p, { offset, width, regionWidth });
  }
}

function midiFixture(count) {
  // Independent format-0 SMF: 480 PPQ; note on every30ticks, off after15ticks.
  const track = new Uint8Array(count * 8 + 4);
  for (let i = 0; i < count; i++) track.set([i ? 15 : 0, 0x90, 54 + i % 25, 100, 15, 0x80, 54 + i % 25, 45], i * 8);
  track.set([0, 255, 47, 0], count * 8);
  const bytes = new Uint8Array(22 + track.length); bytes.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107]); new DataView(bytes.buffer).setUint32(18, track.length); bytes.set(track, 22); return bytes;
}
const piano = (await readFile('src/ui/PianoRoll.tsx', 'utf8')).replaceAll('\r\n', '\n');
function block(startMarker, endMarker) { const start = piano.indexOf(startMarker), end = piano.indexOf(endMarker, start); assert(start >= 0 && end > start); return piano.slice(start, end); }
const rectLine = piano.split('\n').find(line => line.includes('  const rectFor = ')), hitLine = piano.split('\n').find(line => line.includes('  const hit = '));
const rawTickLine = piano.split('\n').find(line => line.includes('  const rawTick = '));
assert(rectLine && rawTickLine && hitLine, 'Actual piano geometry and hit helpers were not found.');
const drawCode = transformSync(block('  drawRef.current = () => {', '\n  useLayoutEffect'), { loader: 'ts' }).code;
const helperCode = transformSync(`${rectLine}\n${rawTickLine}\n${block('  const queryFor = ', '\n  const hit = ')}\n${hitLine}\nreturn {rectFor,hit,queryFor};`, { loader: 'ts' }).code;
function pianoProbe(project) {
  const p = { pattern: project.patterns[0], region: project.regions[0], track: project.tracks[0], zoom: 72, ppq: project.ppq, snap: 16, selected: new Set(), origin: 0, meter: createMeterMap(project), playhead: -1 };
  const current = { current: p }, scroll = { current: { x: 0, y: 774 } }, rowHeight = { current: 18 }, scale = () => current.current.zoom / current.current.ppq;
  const queries = [];
  class ObservedPianoNoteIndex extends PianoNoteIndex {
    query(window, stats) {
      const measured = stats ?? { visitedNodes: 0, testedNotes: 0 }, result = super.query(window, measured);
      queries.push({ kind: 'body', window, candidates: result.length, ...measured }); return result;
    }
    starts(start, end, stats) {
      const measured = stats ?? { visitedNodes: 0, testedNotes: 0 }, result = super.starts(start, end, measured);
      queries.push({ kind: 'onset', window: { start, end }, candidates: result.length, ...measured }); return result;
    }
  }
  const buildStart = performance.now(), index = new ObservedPianoNoteIndex(p.pattern.notes), indexBuildMs = performance.now() - buildStart;
  const noteIndex = () => index;
  const { rectFor: originalRect, hit, queryFor } = Function('current', 'scroll', 'scale', 'KEYBOARD', 'RULER', 'rowHeight', 'noteIndex', 'noteAt', helperCode)(current, scroll, scale, 58, 42, rowHeight, noteIndex, noteAt);
  let rectangles = 0, rectCalls = 0;
  const context = new Proxy({}, { get(_target, key) { if (key === 'measureText') return text => ({ width: String(text).length * 6 }); if (key === 'roundRect') return () => rectangles++; return () => {}; }, set() { return true; } });
  const drawRef = { current: undefined }, scope = { canvas: { current: { width: 1000, height: 420, getContext: () => context } }, size: { current: { width: 1000, height: 420 } }, current, drag: { current: null }, window: { devicePixelRatio: 1 }, scroll, rowHeight, scale, KEYBOARD: 58, RULER: 42, ROW: 18, VELOCITY: 78, TIMELINE: 26, black: midi => [1, 3, 6, 8, 10].includes(midi % 12), previewRegion: () => p.region, regionSourceRanges, noteIndex, queryFor, previewPianoNotes, rectFor: note => { rectCalls++; return originalRect(note); }, noteName, playbackBounds: () => ({ start: 0, end: p.region.length }), drawRef };
  Function(...Object.keys(scope), drawCode)(...Object.values(scope));
  drawRef.current();
  const initialQueries = queries.splice(0), bodyQuery = initialQueries.find(item => item.kind === 'body'), velocityQuery = initialQueries.find(item => item.kind === 'onset');
  assert(bodyQuery && velocityQuery, 'Actual draw must query both body and onset candidates.');
  assert.equal(rectCalls, bodyQuery.candidates);
  const counts = { sourceNotes: p.pattern.notes.length, bodyCandidatesPassedToGeometry: rectCalls, drawnBodyRectangles: rectangles, velocityOnsetCandidates: velocityQuery.candidates, initialDrawQueries: initialQueries };
  const missed = hit(500, 50), missQuery = queries.splice(0); assert.equal(missed, undefined);
  const sample = fn => { for (let i = 0; i < 3; i++) fn(); const times = []; for (let i = 0; i < 11; i++) { const t = performance.now(); fn(); times.push(performance.now() - t); } times.sort((a, b) => a - b); return { medianMs: times[5], maxMs: times.at(-1) }; };
  return { viewport: { width: 1000, height: 420 }, activeGesture: null, indexBuildMs, ...counts, hitMissQueries: missQuery,
    mockCanvasDraw: sample(() => drawRef.current()), actualHitMiss: sample(() => hit(500, 50)),
    timingScope: 'Informational Node CPU samples using the actual idle draw/index/preview/hit source and an inert recording context; not browser frame time or FPS. Index construction is recorded separately.' };
}
for (const count of [10000, 100000]) {
  const bytes = midiFixture(count), filename = path.join(root, `notes-${count}.mid`); await writeFile(filename, bytes);
  const start = performance.now(), imported = importMidi(bytes, path.basename(filename)), importMs = performance.now() - start;
  assert.equal(imported.project.patterns.length, 1); assert.equal(imported.project.patterns[0].notes.length, count);
  const region = imported.project.regions[0], width = Math.max(12, region.length / imported.project.ppq * 34) - 2;
  compareGeometry(`MIDI ${count} notes / beginning`, imported.project, { offset: 0, width: 800, regionWidth: width });
  compareGeometry(`MIDI ${count} notes / far end`, imported.project, { offset: width - 800, width: 800, regionWidth: width });
  const queryStats = { visitedNodes: 0, testedNotes: 0, candidates: 0 };
  const visible = regionPreviewGeometry(imported.project.patterns[0], region, { offset: 0, width: 800, regionWidth: width }, new ArrangementNoteIndex(imported.project.patterns[0].notes, imported.project.patterns[0].length), queryStats);
  report.cpuProbes.push({ notes: count, fixtureBytes: bytes.length, importMs, fullRegionCanvasRequestedBefore: { width, height: 42, rgbaBytesAtDpr1: Math.ceil(width) * 42 * 4, rgbaBytesAtDpr2: Math.ceil(width * 2) * 84 * 4 }, boundedPreview: { canvasWidth: 800, emittedStrokes: visible.notes.length, queryStats }, ...pianoProbe(imported.project) });
  report.fixtures.push({ path: path.relative(process.cwd(), filename).replaceAll('\\', '/'), sha256: digest(bytes), importedNotes: count });
}
report.remainingRisks = [
  'PianoRoll idle body, velocity and hit probes use the actual current index and preview helpers. Candidate counts describe this localized viewport; dense overlap, fit-all and wide minimum visual bodies can legitimately return the full source. CPU samples use an inert recording context and are not end-to-end browser FPS.',
  'An immutable source change rebuilds the current source index; this audit records construction separately. Gesture selection-index construction, commit, undo and React rendering are outside these idle CPU samples.',
  'Arrangement still renders all region and track DOM nodes. Current-array lookup maps remove repeated track/region/source searches, but full DOM virtualization remains separate work.',
  'Visible thumbnails query source/time-phase candidates; localized work depends on the actual overlap and minimum stroke width. Construction remains full-source work and these offline calls build fresh indexes, whereas the UI shares a lazy current-project cache.',
  'Backing-store byte counts describe old requested dimensions, not measured process memory. A separate optional hidden-renderer pixel probe covers only its explicitly tested canvas sizes.',
];
if (option('--canvas-report')) {
  const file = path.resolve(option('--canvas-report')), bytes = await readFile(file), result = JSON.parse(bytes);
  assert.equal(result.cases.find(item => item.requested.width === 800)?.pixelMatches, true);
  assert.equal(result.cases.find(item => item.requested.width === 68136)?.pixelMatches, false);
  assert.equal(result.cases.find(item => item.requested.width === 212566)?.pixelMatches, false);
  report.canvasPixelProbe = { path: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: digest(bytes), versions: result.versions, cases: result.cases };
}
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: path.join(root, 'report.json'), sha256: digest(await readFile(path.join(root, 'report.json'))), geometryCases: report.geometry.length, fixtures: report.fixtures, cpuProbes: report.cpuProbes }, null, 2));
