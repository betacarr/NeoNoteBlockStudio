import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseMidi } from 'midi-file';

// Original native menu -> preload -> actual App. Read-only DOM and file results;
// no synthetic mouse/key, DOM click/focus/scroll writes, or React-state injection.
const argument = name => { const i = process.argv.indexOf(name); if (i < 0) return; assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), name + ' requires a value'); return process.argv[i + 1]; };
const prepareOnly = process.argv.includes('--prepare-only'), observeBefore = process.argv.includes('--observe-before'), exeArgument = argument('--packaged');
assert(prepareOnly || exeArgument, 'Use --prepare-only or --packaged <unpacked exe>.');
const executable = exeArgument ? path.resolve(exeArgument) : undefined; if (executable) assert(!/portable\.exe$/i.test(executable));
const expectedVersion = argument('--expected-version') ?? (observeBefore ? '0.1.28' : JSON.parse(await readFile('package.json', 'utf8')).version);
const root = path.resolve('.local/clipboard-desktop', 'run-' + Date.now()), profile = path.join(root, 'profile'); await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalize = project => { const copy = structuredClone(project); delete copy.modifiedAt; return copy; };
const runnerSource = path.join(root, 'runner-source.mjs'); await writeFile(runnerSource, await readFile(new URL(import.meta.url)));
const helper = path.join(root, 'helper.mjs'), helperEntry = 'clipboard-desktop-fixtures.ts';
const helperSource = "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx,bytesToBase64} from './src/core/container.ts'; export {exportMidi} from './src/core/midi.ts';";
const bundle = await build({ stdin: { contents: helperSource, sourcefile: helperEntry, resolveDir: process.cwd() }, outfile: helper, platform: 'node', format: 'esm', bundle: true, metafile: true });
const { createProject, newNote, saveNbsx, openNbsx, bytesToBase64, exportMidi } = await import(pathToFileURL(helper).href);
const helperInputs = {}; for (const input of Object.keys(bundle.metafile.inputs).sort()) if (input !== helperEntry && !input.startsWith('<')) helperInputs[input.replaceAll('\\', '/')] = await sha256(path.resolve(input));
function tinyWav(value) {
  const bytes = new Uint8Array(44 + 480 * 2), data = new DataView(bytes.buffer), text = (at, value) => [...value].forEach((char, i) => { bytes[at + i] = char.charCodeAt(0); });
  text(0, 'RIFF'); data.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, 48000, true); data.setUint32(28, 96000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, 960, true);
  for (let frame = 0; frame < 480; frame++) data.setInt16(44 + frame * 2, frame % 2 ? value : -value, true); return bytes;
}
const archiveMidi = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 3, 192, 77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0, 77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0]);
const cases = [];
for (const custom of [false, true]) {
  const key = custom ? 'custom-collision' : 'ppq';
  const projects = {};
  for (const role of ['source', 'target']) {
    const p = createProject(`${key} clipboard ${role}`), source = role === 'source'; p.id = `${key}-${role}`; p.createdAt = p.modifiedAt = '2026-01-01T00:00:00.000Z'; p.ppq = source ? 480 : 960;
    const { sound: ignoredSound, nbsIndex: ignoredIndex, ...instrument } = p.instruments[0];
    p.instruments = [{ ...instrument, id: 'clipboard-default', name: 'Clipboard private default', englishName: 'Clipboard private default' }];
    Object.assign(p.tracks[0], { id: `${key}-${role}-track`, name: `${role} track`, instrumentId: 'clipboard-default', sourceMidiTrack: source ? 7 : 1, midiChannel: source ? 7 : 2 });
    p.patterns[0] = { id: `${key}-${role}-pattern`, name: `${role} clip`, length: source ? 1920 : 3840, notes: source ? [
      { ...newNote(120, 60, 240), id: `${key}-source-a`, velocity: .7, pan: -.2, detune: 9.125, height: .25, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 17 } },
      { ...newNote(600, 67, 480), id: `${key}-source-b`, velocity: .4, pan: .3, detune: -12.5, height: -.5, midiSource: { onOrder: 4, offOrder: 5, releaseVelocity: 73, offSourceTrack: 18 } },
    ] : [{ ...newNote(2400, 55, 120), id: `${key}-target-guard`, velocity: .5, pan: -.1, midiSource: { onOrder: 6, offOrder: 7, releaseVelocity: 29, offSourceTrack: 1 } }],
      midiEvents: [{ id: `${key}-${role}-controller`, tick: 240, order: 1, sourceTrack: source ? 7 : 1, event: { deltaTime: 0, type: 'controller', channel: source ? 7 : 2, controllerType: 64, value: source ? 127 : 0 } }] };
    p.regions[0] = { id: `${key}-${role}-region`, trackId: p.tracks[0].id, patternId: p.patterns[0].id, start: 0, length: p.patterns[0].length, offset: 0, loop: false };
    if (!source) { p.assets.push({ id: 'clipboard-target-midi', name: 'target-source.mid', mime: 'audio/midi', data: bytesToBase64(archiveMidi) }); p.midi = { schema: 1, format: 1, sourceAssetId: 'clipboard-target-midi', sourceTrackNames: ['Conductor', 'Target stream'], conductor: [] }; }
    if (custom) {
      const bytes = tinyWav(source ? 1000 : 2000);
      p.assets.push({ id: 'clipboard-sample', name: source ? 'source-tone.wav' : 'target-original.wav', mime: 'audio/wav', data: bytesToBase64(bytes), sha1: createHash('sha1').update(bytes).digest('hex') });
      p.instruments.push({ ...instrument, id: 'clipboard-custom', name: source ? 'Source custom instrument' : 'Target original instrument', englishName: source ? 'Source custom' : 'Target original', assetId: 'clipboard-sample', rootMidi: source ? 66 : 60, gmProgram: source ? 80 : 21 });
      p.patterns[0].notes[0].instrumentId = 'clipboard-custom';
    }
    const file = path.join(root, `${key}-${role}.nbsx`); await writeFile(file, saveNbsx(p)); projects[role] = { project: p, file, identity: await reference(file) };
  }
  cases.push({ key, custom, ...projects });
}
const selectedSourceSha256 = {};
for (const file of ['scripts/smoke-clipboard-desktop.mjs', 'src/ui/App.tsx', 'src/core/types.ts', 'src/core/project.ts', 'src/core/container.ts', 'src/core/midi.ts', 'src/core/midi-export.ts', 'src/core/meter.ts', 'src/core/editor-commands.ts', 'src/core/editor-selection.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json']) selectedSourceSha256[file] = await sha256(file);
try { selectedSourceSha256['src/core/note-clipboard.ts'] = await sha256('src/core/note-clipboard.ts'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const preparedFile = path.join(root, 'fixtures.json');
await writeFile(preparedFile, JSON.stringify({ schema: 1, status: 'prepared', applicationLaunched: false, observeBefore, expectedVersion, root, profile, selectedSourceSha256, runnerSource: await reference(runnerSource),
  helper: { scope: 'same-source Node fixture/container/MIDI-export helper, independent midi-file byte reader; not packaged GUI MIDI export', file: await reference(helper), virtualEntrySha256: createHash('sha256').update(helperSource).digest('hex'), inputs: helperInputs },
  cases: cases.map(c => ({ key: c.key, custom: c.custom, source: c.source.identity, target: c.target.identity, sourceNotes: c.source.project.patterns[0].notes, targetNotes: c.target.project.patterns[0].notes })),
  literalExpected: { ticks: [0, 960], durations: [480, 960], observeBeforeTicks: [0, 480], observeBeforeDurations: [240, 480], routeTrack: 1, noteOffTicks: [480, 1920], releaseVelocity: [45, 73] }, plannedSavedReadbacks: observeBefore ? 1 : 7 }, null, 2) + '\n');
if (prepareOnly) console.log(JSON.stringify({ status: 'prepared', applicationLaunched: false, cases: 2, observeBefore, plannedSavedReadbacks: observeBefore ? 1 : 7, report: preparedFile, sha256: await sha256(preparedFile) }));
else {
  const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
  const observations = [], checkpoints = [], screenshots = [], rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], midiChecks = [];
  const reportFile = path.join(root, 'report.json'), report = { schema: 1, status: 'running', observeBefore, packaged: true, root, profile, expectedVersion, runnerPid: process.pid, selectedSourceSha256, prepared: await reference(preparedFile), observations, checkpoints, screenshots, rendererErrors, consoleErrors, unexpectedDialogs, midiChecks,
    scope: 'Actual packaged original main-process native-menu handlers -> preload -> App Copy/Open/Paste/Save As/Undo/Redo, isolated dialog-return fixtures, read-only DOM and complete saved NBSX comparison. No synthetic input, focus/scroll writes or React injection.',
    limitations: ['No physical shortcut, pointer or human file-picker claim.', 'Only modifiedAt is ignored in full-project comparisons; randomized new note/instrument/asset IDs are checked for uniqueness, references and exact source data.', 'MIDI note-off route checking uses same-source Node exportMidi on the saved packaged project and independent midi-file byte parsing, not packaged GUI export.', 'No audio playback/native rendering or version audio matrix.'],
    baselineProvenance: observeBefore ? 'Frozen executable/asar identities prove the old runtime. Working-tree source hashes identify current fixture tooling, not equivalence to old packaged product source.' : undefined };
  let desktop, page, child, terminal;
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readDom = () => page.evaluate(() => { const text = document.querySelector('.editor-heading')?.textContent ?? ''; const active = document.activeElement; return { title: document.title, heading: text, selectedNotes: Number(text.match(/已选择\s*(\d+)\s*个音符/)?.[1] ?? 0), regionCount: document.querySelectorAll('[data-testid=region]').length, message: document.querySelector('.status-message')?.textContent ?? '', activeElement: active ? { tag: active.tagName, label: active.getAttribute('aria-label'), textInput: active.matches('input,textarea,select,[contenteditable="true"]') } : null }; });
  const command = async name => { await desktop.evaluate(({ Menu }, name) => {
    const labels = { open: ['文件', '打开 / 导入…'], 'save-as': ['文件', '另存为…'], copy: ['编辑', '复制'], paste: ['编辑', '粘贴'], 'select-all': ['编辑', '全选'], undo: ['编辑', '撤销'], redo: ['编辑', '重做'] }, wanted = labels[name]; if (!wanted) throw Error('Unsupported command ' + name);
    const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]); if (!item?.enabled || typeof item.click !== 'function') throw Error('Original native menu unavailable ' + name);
    globalThis.__clipboardFixture.commands.push({ name, label: item.label, delivery: 'original-native-menu-to-preload-IPC' }); item.click();
  }, name); await flush(); };
  const inspect = async (label, selected) => { const dom = await readDom(); assert.equal(dom.regionCount, 1, label); assert.equal(dom.selectedNotes, selected, label); assert(!dom.activeElement?.textInput, label + ': native text editor owns commands'); observations.push({ label, dom }); };
  const screenshot = async label => { const file = path.join(root, label + '.png'); await page.screenshot({ path: file }); screenshots.push({ label, file: await reference(file) }); };
  const open = async (fixture, file = fixture.file) => { await desktop.evaluate((_, file) => { const s = globalThis.__clipboardFixture; if (s.open) throw Error('Unconsumed Open'); s.open = file; }, file); await command('open'); await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●') && !/已选择\s*[1-9]\d*\s*个音符/.test(document.querySelector('.editor-heading')?.textContent ?? ''), fixture.project.name, { timeout: 60000 }); await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 }); await flush(); await inspect('open-' + path.basename(file), 0); };
  const save = async (label, check) => { const file = path.join(root, label + '.nbsx'); await desktop.evaluate((_, file) => { const s = globalThis.__clipboardFixture; if (s.save) throw Error('Unconsumed Save'); s.save = file; }, file); await command('save-as'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 }); const project = openNbsx(new Uint8Array(await readFile(file))); const details = check(project) ?? {}; checkpoints.push({ label, file: await reference(file), completeProjectCompared: true, ignoredFields: ['modifiedAt'], ...details }); return { project, file }; };
  const pasted = (actual, c, before = false) => {
    const baseline = c.target.project, expected = structuredClone(baseline), target = actual.patterns[0], oldIds = new Set(baseline.patterns[0].notes.map(note => note.id)), clones = target.notes.filter(note => !oldIds.has(note.id));
    assert.equal(clones.length, 2); assert.equal(target.notes.length, 3); assert.deepEqual(target.notes.filter(note => oldIds.has(note.id)), baseline.patterns[0].notes);
    const allIds = new Set([...baseline.patterns.flatMap(p => p.notes.map(n => n.id)), ...c.source.project.patterns.flatMap(p => p.notes.map(n => n.id))]);
    for (const note of clones) { assert(!allIds.has(note.id)); allIds.add(note.id); }
    const migratedInstruments = actual.instruments.filter(i => !baseline.instruments.some(old => old.id === i.id)), migratedAssets = actual.assets.filter(a => !baseline.assets.some(old => old.id === a.id));
    let mappedInstrument;
    if (c.custom) {
      assert.equal(migratedInstruments.length, 1); assert.equal(migratedAssets.length, 1); mappedInstrument = migratedInstruments[0]; const asset = migratedAssets[0], sourceInstrument = c.source.project.instruments.find(i => i.id === 'clipboard-custom'), sourceAsset = c.source.project.assets.find(a => a.id === 'clipboard-sample');
      assert.notEqual(mappedInstrument.id, 'clipboard-custom'); assert.notEqual(asset.id, 'clipboard-sample'); assert.equal(mappedInstrument.assetId, asset.id);
      assert.deepEqual({ ...mappedInstrument, id: sourceInstrument.id, assetId: sourceInstrument.assetId }, sourceInstrument); assert.deepEqual({ ...asset, id: sourceAsset.id }, sourceAsset);
      expected.instruments.push(structuredClone(mappedInstrument)); expected.assets.push(structuredClone(asset));
    } else { assert.deepEqual(migratedInstruments, []); assert.deepEqual(migratedAssets, []); }
    for (let i = 0; i < 2; i++) {
      const source = structuredClone(c.source.project.patterns[0].notes[i]); source.id = clones[i].id; source.tick = (before ? [0, 480] : [0, 960])[i]; source.duration = (before ? [240, 480] : [480, 960])[i];
      if (!before) delete source.midiSource.offSourceTrack;
      if (c.custom && i === 0) source.instrumentId = mappedInstrument.id;
      assert.deepEqual(clones[i], source, c.key + ': pasted note fields'); expected.patterns[0].notes.push(source);
    }
    assert.deepEqual(normalize(actual), normalize(expected), c.key + ': other project/resource data changed');
    return { targetPpq: actual.ppq, pastedTicks: clones.map(n => n.tick), pastedDurations: clones.map(n => n.duration), noteIds: clones.map(n => n.id), migratedInstruments: migratedInstruments.map(i => i.id), migratedAssets: migratedAssets.map(a => a.id), mappedSourceMidi: clones.map(n => n.midiSource) };
  };
  const midiRoute = async (label, project) => {
    const bytes = exportMidi(project).bytes, file = path.join(root, label + '-node-helper.mid'); await writeFile(file, bytes); const parsed = parseMidi(bytes);
    const events = parsed.tracks.flatMap((track, index) => { let tick = 0; return track.map(event => ({ ...event, tick: tick += event.deltaTime, track: index })); });
    const relevant = events.filter(e => ['noteOn', 'noteOff'].includes(e.type) && [60, 67].includes(e.noteNumber));
    assert.equal(parsed.header.ticksPerBeat, 960); assert.equal(parsed.tracks.length, 2);
    assert.deepEqual(relevant.map(e => [e.track, e.tick, e.type, e.channel, e.noteNumber, e.velocity]), [[1, 0, 'noteOn', 2, 60, 89], [1, 480, 'noteOff', 2, 60, 45], [1, 960, 'noteOn', 2, 67, 51], [1, 1920, 'noteOff', 2, 67, 73]]);
    midiChecks.push({ label, scope: 'Same-source Node exportMidi(saved project) -> independent midi-file byte parser, not packaged GUI export', file: await reference(file), sourceForeignRoutes: [17, 18], actualTracks: parsed.tracks.length, pastedNoteEvents: relevant });
  };
  try {
    report.images = [await reference(executable), await reference(path.join(path.dirname(executable), 'resources', 'app.asar'))];
    desktop = await electron.launch({ executablePath: executable, args: ['--mute-audio', `--user-data-dir=${profile}`], env }); child = desktop.process(); report.applicationProcess = { pid: child.pid, startedAt: new Date().toISOString() };
    terminal = new Promise(resolve => child.once('exit', (exitCode, signal) => { Object.assign(report.applicationProcess, { exitCode, signal, exitedAt: new Date().toISOString() }); resolve(); }));
    const identity = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), runtime: process.versions })); report.applicationIdentity = identity; assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(identity.userData, profile);
    page = await desktop.firstWindow(); page.on('pageerror', e => rendererErrors.push(e.message)); page.on('crash', () => rendererErrors.push('Renderer crashed')); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }); page.on('dialog', d => { unexpectedDialogs.push({ type: d.type(), message: d.message() }); void d.dismiss(); });
    await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 }); assert.equal(await page.getByRole('dialog').count(), 0); await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    await desktop.evaluate(({ dialog }) => {
      globalThis.__clipboardFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
      dialog.showOpenDialog = async (...args) => { const s = globalThis.__clipboardFixture, o = args.find(v => v && typeof v === 'object' && Array.isArray(v.properties)); if (!s.open || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(o?.title)) { s.unexpected.push({ kind: 'open', title: o?.title }); return { canceled: true, filePaths: [] }; } const file = s.open; s.open = null; s.calls.push({ kind: 'open', file }); return { canceled: false, filePaths: [file] }; };
      dialog.showSaveDialog = async (...args) => { const s = globalThis.__clipboardFixture, o = args.find(v => v && typeof v === 'object' && Array.isArray(v.filters)); if (!s.save || !o?.filters?.some(f => f.extensions.includes('nbsx'))) { s.unexpected.push({ kind: 'save' }); return { canceled: true }; } const file = s.save; s.save = null; s.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file }; };
    });
    for (const c of observeBefore ? cases.slice(0, 1) : cases) {
      await open(c.source); await command('select-all'); await inspect(c.key + '-source-selected', 2); await command('copy'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已复制 2 个音符')); await screenshot(c.key + '-source-copied');
      await open(c.target); await command('paste'); await inspect(c.key + '-pasted', 2);
      const first = await save(c.key + '-pasted', project => pasted(project, c, observeBefore)); await screenshot(c.key + '-pasted');
      if (observeBefore) { report.beforeFinding = { desiredTicks: [0, 960], desiredDurations: [480, 960], observedTicks: checkpoints.at(-1).pastedTicks, observedDurations: checkpoints.at(-1).pastedDurations, result: 'PPQ480 values were pasted unscaled into PPQ960; musical time/duration is halved', featureAccepted: false }; break; }
      await midiRoute(c.key + '-pasted', first.project);
      await command('undo'); await inspect(c.key + '-undo', 0); await save(c.key + '-undo', project => { assert.deepEqual(normalize(project), normalize(c.target.project)); return { restoredCompleteTarget: true }; });
      await command('redo'); await inspect(c.key + '-redo', 2); const restored = await save(c.key + '-redo', project => { assert.deepEqual(normalize(project), normalize(first.project)); return pasted(project, c); });
      if (c.custom) { await open({ ...c.target, file: restored.file }); const reopened = await save(c.key + '-reopened', project => { assert.deepEqual(normalize(project), normalize(first.project)); return pasted(project, c); }); await midiRoute(c.key + '-reopened', reopened.project); await screenshot(c.key + '-reopened'); }
    }
    report.dialogFixture = await desktop.evaluate(() => globalThis.__clipboardFixture); assert.equal(report.dialogFixture.open, null); assert.equal(report.dialogFixture.save, null); assert.deepEqual(report.dialogFixture.unexpected, []);
    assert.equal(checkpoints.length, observeBefore ? 1 : 7); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
    await desktop.close(); let timer; await Promise.race([terminal, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned app did not terminate')), 30000); })]).finally(() => clearTimeout(timer)); desktop = undefined; page = undefined;
    assert.equal(report.applicationProcess.exitCode, 0); assert.equal(report.applicationProcess.signal, null); report.status = observeBefore ? 'observed-before' : 'passed'; report.fullProjectReadbacks = checkpoints.length;
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, expectedVersion, fullProjectReadbacks: checkpoints.length, report: reportFile, sha256: await sha256(reportFile) }));
  } catch (error) {
    report.status = 'failed'; report.error = error.stack ?? String(error); if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); } if (desktop) report.dialogFixture = await desktop.evaluate(() => globalThis.__clipboardFixture).catch(() => null);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.error(JSON.stringify({ status: 'failed', report: reportFile, error: String(error) })); throw error;
  } finally { await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop?.close().catch(() => {}); }
}
