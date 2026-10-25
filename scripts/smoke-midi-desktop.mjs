import { _electron as electron } from 'playwright';
import { extractFile } from '@electron/asar';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseMidi } from 'midi-file';
import { unzipSync, strFromU8 } from 'fflate';
import assert from 'node:assert/strict';

// Existing native menu handlers -> preload IPC -> App. Original MIDI uses the
// existing menu IPC because Electron's native menu has no Original MIDI item.
// Only file-dialog return values are controlled. Renderer access is read-only;
// no clicks, focus writes, synthesized input, React injection or product oracle.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' requires a value');
  return process.argv[index + 1];
};
const executableArgument = argument('--packaged'), executable = executableArgument && path.resolve(executableArgument);
const expectedVersion = argument('--expected-version') ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const appAsar = executable && path.join(path.dirname(executable), 'resources', 'app.asar');
if (executable) assert(!/(?:portable|setup)\.exe$/i.test(executable), 'Use an unpacked executable, not a launcher or installer');
const base = path.resolve('.local/midi-desktop'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, executable ? 'packaged-' : 'development-')), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), file).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalize = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const helperFile = path.join(root, 'fixture-helper.mjs'), virtualEntry = { name: 'midi-desktop-fixture.ts', contents: "export {expressionFixture} from './tests/fixtures/midi.ts';" };
const reportFile = path.join(root, 'report.json');
const sessions = [], processes = [], observations = [], readbacks = [], screenshots = [], rendererErrors = [], consoleErrors = [], unexpectedDialogs = [];
const report = { schema: 2, status: 'running', packaged: !!executable, root, profile, expectedVersion, runnerPid: process.pid,
  scope: 'Actual native Open/Save/Save As/Select All/Duplicate/Undo/Redo menu handlers -> preload IPC -> App, plus existing-menu-IPC Original MIDI; controlled file-dialog return values, read-only DOM, complete raw ZIP comparisons and a real process restart.',
  limitations: ['Original MIDI is an existing menu IPC command; the packaged Electron native menu has no corresponding visible item. Its self-drawn menu click is not claimed.',
    'File-picker results are controlled fixtures, not human chooser acceptance. No DOM actions, focus/scroll writes, mouse/keyboard synthesis or React injection.',
    'No MIDI/NBS export-panel interaction, physical gesture, playback, native/audio rendering, hardware MIDI or acoustic claim.',
    'Import checks use a hand-encoded MIDI fixture and literal musical/message assertions. The first saved raw project is the complete baseline for later edit/history/restart comparisons.',
    'Only root modifiedAt is ignored. New duplicate note IDs are checked once for freshness, then all later IDs must match exactly.'],
  sessions, processes, observations, readbacks, screenshots, rendererErrors, consoleErrors, unexpectedDialogs };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
let desktop, page, session, terminal, inputBytes, input, baseline, firstDuplicate;
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readDom = () => page.evaluate(() => ({ title: document.title, name: document.querySelector('input[aria-label="工程名称"]')?.value,
  editorReady: !!window.desktop && !!document.querySelector('.piano-viewport canvas'), heading: document.querySelector('.editor-heading')?.textContent ?? '',
  regions: [...document.querySelectorAll('[data-testid="region"]')].map(element => ({ id: element.getAttribute('data-region-id'), text: element.textContent })),
  message: document.querySelector('.status-message')?.textContent ?? '', modalCount: document.querySelectorAll('[role="dialog"]').length,
  fileHint: document.querySelector('.file-hint')?.textContent ?? '', undoDisabled: document.querySelector('button[aria-label="撤销"]')?.disabled,
  redoDisabled: document.querySelector('button[aria-label="重做"]')?.disabled })) ;
async function inspect(label, dirty) {
  const dom = await readDom(); assert(dom.editorReady, label + ': editor readiness must not depend on Minecraft samples');
  assert.equal(dom.modalCount, 0, label); assert.equal(dom.name, '旋律', label); assert.equal(dom.regions.length, 1, label + ': note editing must retain one region');
  if (dirty !== undefined) assert.equal(dom.title.startsWith('●'), dirty, label + ': dirty flag');
  observations.push({ session: session.index, label, dom }); return dom;
}
async function screenshot(label) {
  const file = path.join(root, label + '.png'); await page.screenshot({ path: file, fullPage: false }); screenshots.push({ session: session.index, label, file: await reference(file) });
}
async function menu(command) {
  await desktop.evaluate(({ Menu, BrowserWindow }, command) => {
    const state = globalThis.__midiDesktopFixture;
    if (command === 'original-midi') {
      state.commands.push({ command, delivery: 'existing-menu-IPC; no native visible item exists' });
      const target = BrowserWindow.getAllWindows()[0]; if (!target) throw new Error('Owned application window is missing');
      target.webContents.send('menu', command); return;
    }
    const labels = { open: ['文件', '打开 / 导入…'], save: ['文件', '保存工程'], 'save-as': ['文件', '另存为…'],
      'select-all': ['编辑', '全选'], duplicate: ['编辑', '独立复制'], undo: ['编辑', '撤销'], redo: ['编辑', '重做'] }, wanted = labels[command];
    if (!wanted) throw new Error('Unknown MIDI workflow menu command: ' + command);
    const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]);
    if (!item?.enabled || typeof item.click !== 'function') throw new Error('Actual native menu unavailable: ' + command);
    state.commands.push({ command, label: item.label, delivery: 'actual-native-menu-handler-to-preload-IPC' }); item.click();
  }, command); await flush();
}
async function dialog(kind, file, extension) {
  await desktop.evaluate((_, { kind, file, extension }) => {
    const state = globalThis.__midiDesktopFixture; if (state[kind]) throw new Error('Unconsumed ' + kind + ' fixture'); state[kind] = { file, extension };
  }, { kind, file, extension });
}
async function waitForFile(file) {
  const deadline = Date.now() + 30000;
  while (true) { try { if ((await stat(file)).size > 0) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Date.now() < deadline, 'Actual file write timed out: ' + file); await new Promise(resolve => setTimeout(resolve, 40)); }
}
async function rawArchive(file) {
  const bytes = await readFile(file), entries = unzipSync(bytes); assert(entries['project.json'], 'Missing raw project.json: ' + file);
  const project = JSON.parse(strFromU8(entries['project.json']));
  assert(project.midi?.sourceAssetId, 'Original MIDI archive identity must survive');
  const embeddedSource = entries['assets/' + project.midi.sourceAssetId]; assert(embeddedSource, 'Original MIDI bytes must be embedded');
  assert.deepEqual(embeddedSource, inputBytes, 'Embedded original MIDI must remain byte-exact');
  return { entries, project };
}
function importAssertions(project) {
  assert.equal(project.ppq, 480); assert.equal(project.tracks.length, 1); assert.equal(project.regions.length, 1); assert.equal(project.patterns.length, 1);
  assert.equal(project.tracks[0].sourceMidiTrack, 0); assert.equal(project.tracks[0].midiChannel, 2);
  assert.deepEqual(project.timeSignatures.map(({ tick, numerator, denominator }) => ({ tick, numerator, denominator })), [{ tick: 0, numerator: 7, denominator: 8 }]);
  assert.deepEqual(project.tempos.map(({ tick, bpm }) => ({ tick, bpm })), [{ tick: 0, bpm: 120 }]);
  const notes = project.patterns[0].notes; assert.equal(notes.length, 1);
  assert.equal(notes[0].tick, 0); assert.equal(notes[0].midi, 72); assert.equal(notes[0].duration, 120); assert.equal(notes[0].velocity, 100 / 127);
  assert.equal(notes[0].midiSource.releaseVelocity, 35); assert.equal(notes[0].midiSource.offSourceTrack, 0);
  const messages = [...(project.patterns[0].midiEvents ?? []), ...(project.midi.conductor ?? [])];
  const sysEx = messages.filter(({ event }) => event.type === 'sysEx' || event.type === 'endSysEx'); assert.equal(sysEx.length, 2);
  assert.deepEqual(sysEx.map(({ tick, event }) => ({ tick, type: event.type, data: event.data })), [
    { tick: 0, type: 'sysEx', data: [126, 127, 9, 1, 247] }, { tick: 60, type: 'endSysEx', data: [1, 2, 247] }]);
  assert(messages.some(({ event }) => event.type === 'unknownMeta' && event.metatypeByte === 126));
  assert(messages.some(({ event }) => event.type === 'sequencerSpecific'));
  assert(messages.some(({ tick, event }) => tick === 60 && event.type === 'controller' && event.controllerType === 11 && event.value === 96));
  assert(messages.some(({ event }) => event.type === 'programChange' && event.programNumber === 73));
}
function compareArchive(actual, expected, label) {
  assert.deepEqual(normalize(actual.project), normalize(expected), label + ': complete raw project.json');
  assert.deepEqual(Object.keys(actual.entries).sort(), Object.keys(baseline.entries).sort(), label + ': complete ZIP entry inventory');
  return Object.keys(baseline.entries).filter(name => name !== 'project.json').map(name => {
    assert.deepEqual(actual.entries[name], baseline.entries[name], label + ': embedded bytes ' + name);
    return { name, bytes: actual.entries[name].length, sha256: digest(actual.entries[name]) };
  });
}
async function save(label, expected, command = 'save-as') {
  const file = path.join(root, label + '.nbsx'); await dialog('save', file, 'nbsx'); await menu(command); await waitForFile(file);
  // Async resource discovery may replace the status message after a successful
  // save. The actual new file, clean state and full raw ZIP are the boundary.
  await page.waitForFunction(() => !document.title.startsWith('●'), undefined, { timeout: 30000 });
  const actual = await rawArchive(file); let embedded;
  if (!baseline) { importAssertions(actual.project); baseline = actual; await writeFile(path.join(root, 'baseline-raw.json'), JSON.stringify(actual.project, null, 2) + '\n'); }
  if (label === 'notes-duplicated') {
    const original = baseline.project.patterns[0].notes[0], copied = actual.project.patterns[0].notes[1];
    assert.equal(actual.project.patterns[0].notes.length, 2); assert.equal(typeof copied?.id, 'string'); assert(copied.id.length > 0 && copied.id !== original.id);
    const oldIds = new Set([baseline.project.id, ...baseline.project.tracks.map(item => item.id), ...baseline.project.regions.map(item => item.id), ...baseline.project.patterns.flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id), ...(pattern.midiEvents ?? []).map(event => event.id)]), ...baseline.project.instruments.map(item => item.id), ...baseline.project.assets.map(item => item.id), ...(baseline.project.midi.conductor ?? []).map(item => item.id)]);
    assert(!oldIds.has(copied.id), 'Duplicate note must receive one fresh ID');
    // Literal: source tick0/duration120, PPQ480, snap16 => next grid at120.
    // This is intentionally independent of the production clipboard planner.
    expected = structuredClone(baseline.project); expected.patterns[0].notes.push({ ...structuredClone(original), id: copied.id, tick: 120 });
    firstDuplicate = expected; report.duplicateNoteId = copied.id;
    await writeFile(path.join(root, 'duplicate-literal-expected.json'), JSON.stringify(expected, null, 2) + '\n');
  }
  embedded = compareArchive(actual, expected ?? baseline.project, label);
  readbacks.push({ session: session.index, label, file: await reference(file), completeRawManifestCompared: true, fullZipInventoryCompared: true, embedded,
    ignoredFields: ['root modifiedAt'], exactIDs: true, sourceNotes: actual.project.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0), regions: actual.project.regions.length });
  await inspect(label, false); return file;
}
async function open(file, imported = false) {
  await dialog('open', file, imported ? 'mid' : 'nbsx'); await menu('open');
  await page.waitForFunction(({ imported }) => document.querySelector('input[aria-label="工程名称"]')?.value === '旋律'
    && document.title.startsWith('●') === imported && document.querySelectorAll('[data-testid="region"]').length === 1, { imported }, { timeout: 30000 });
  await inspect(imported ? 'actual-midi-imported' : 'actual-nbsx-reopened', imported);
}
async function launch() {
  const launchArgs = [...(executable ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`];
  desktop = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: launchArgs, env: environment });
  const child = desktop.process(), record = { pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, signal: null }; processes.push(record);
  terminal = new Promise(resolve => child.once('exit', (exitCode, signal) => { Object.assign(record, { exitCode, signal, exitedAt: new Date().toISOString() }); resolve(record); }));
  session = { index: sessions.length + 1, pid: child.pid, launchArgs, audioMutedByHarness: true }; sessions.push(session);
  let stdout = '', stderr = ''; child.stdout?.on('data', bytes => { stdout += bytes; }); child.stderr?.on('data', bytes => { stderr += bytes; }); session.logs = () => ({ stdout, stderr });
  Object.assign(session, await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), evaluatedProcessPid: process.pid,
    appMetrics: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, creationTime: metric.creationTime })) })));
  assert.equal(session.version, expectedVersion); assert.equal(session.packaged, !!executable); assert.equal(path.resolve(session.userData), profile);
  if (executable) assert.equal(path.resolve(session.appPath), appAsar);
  record.browserPid = session.browserPid = session.evaluatedProcessPid; assert(processAlive(session.browserPid));
  page = await desktop.firstWindow(); const index = session.index;
  page.on('pageerror', error => rendererErrors.push({ session: index, message: error.message })); page.on('crash', () => rendererErrors.push({ session: index, message: 'Renderer crashed' }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ session: index, message: message.text() }); });
  page.on('dialog', value => { unexpectedDialogs.push({ session: index, type: value.type(), message: value.message() }); void value.dismiss(); });
  await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 });
  assert.equal((await readDom()).modalCount, 0);
  await desktop.evaluate(({ dialog }) => {
    globalThis.__midiDesktopFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
    dialog.showOpenDialog = async (...args) => {
      const state = globalThis.__midiDesktopFixture, wanted = state.open, options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties));
      if (!wanted || options?.title !== '打开工程或导入 MIDI / NBS / FLP' || !options.properties.includes('openFile')) {
        state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] };
      }
      state.open = null; state.calls.push({ kind: 'open', ...wanted, title: options.title }); return { canceled: false, filePaths: [wanted.file] };
    };
    dialog.showSaveDialog = async (...args) => {
      const state = globalThis.__midiDesktopFixture, wanted = state.save, options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters));
      if (!wanted || !options?.filters?.some(filter => filter.extensions.includes(wanted.extension))) {
        state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true };
      }
      state.save = null; state.calls.push({ kind: 'save', ...wanted }); return { canceled: false, filePath: wanted.file };
    };
  });
}
async function finishSession(force = false) {
  if (!desktop) return;
  session.dialogFixture = await desktop.evaluate(() => globalThis.__midiDesktopFixture).catch(() => null);
  if (!force) {
    assert(!(await page.title()).startsWith('●')); assert.equal(session.dialogFixture.open, null); assert.equal(session.dialogFixture.save, null); assert.deepEqual(session.dialogFixture.unexpected, []);
  } else await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await desktop.close();
  let timeout; const ended = await Promise.race([terminal, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned application did not exit after close')), 30000); })]).finally(() => clearTimeout(timeout));
  const pids = [...new Set([session.pid, session.browserPid, ...session.appMetrics.map(metric => metric.pid)])], deadline = Date.now() + 10000;
  while (pids.some(processAlive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  session.processExitChecks = pids.map(pid => ({ pid, alive: processAlive(pid) })); ended.browserExited = !processAlive(session.browserPid);
  const logs = session.logs(); delete session.logs;
  for (const [name, content] of Object.entries(logs)) { const file = path.join(root, `session-${session.index}-${name}.log`); await writeFile(file, content); session[name] = await reference(file); }
  session.closeMethod = force ? 'Failure cleanup: destroy only owned windows, then ElectronApplication.close' : 'ElectronApplication.close after clean saved project';
  desktop = undefined; page = undefined;
  if (!force) { assert.equal(ended.exitCode, 0); assert.equal(ended.signal, null); assert(session.processExitChecks.every(entry => !entry.alive), 'All owned observed processes must exit'); }
}
try {
  const compiled = await build({ stdin: { contents: virtualEntry.contents, resolveDir: process.cwd(), sourcefile: virtualEntry.name }, outfile: helperFile, bundle: true, platform: 'node', format: 'esm', metafile: true });
  const { expressionFixture } = await import(pathToFileURL(helperFile).href); inputBytes = expressionFixture(); input = path.join(root, 'expression.mid'); await writeFile(input, inputBytes);
  const parsed = parseMidi(inputBytes); assert.equal(parsed.header.ticksPerBeat, 480); assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].filter(event => event.type === 'noteOn').length, 1); assert.equal(parsed.tracks[0].filter(event => event.type === 'noteOff')[0].velocity, 35);
  report.input = await reference(input); report.fixtureHelper = { file: await reference(helperFile), virtualEntry: { name: virtualEntry.name, sha256: digest(virtualEntry.contents) }, inputs: {} };
  for (const file of Object.keys(compiled.metafile.inputs).sort()) if (file !== virtualEntry.name && !file.startsWith('<')) report.fixtureHelper.inputs[file.replaceAll('\\', '/')] = await sha256(file);
  report.sources = {};
  for (const file of ['scripts/smoke-midi-desktop.mjs', 'tests/fixtures/midi.ts', 'src/ui/App.tsx', 'src/core/container.ts', 'src/core/midi-import.ts', 'src/core/midi-export.ts', 'src/core/note-clipboard.ts', 'src/core/editor-interaction.ts', 'src/core/meter.ts', 'src/core/project.ts', 'src/core/types.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json', 'package-lock.json']) report.sources[file] = await sha256(file);
  if (executable) {
    report.images = [await reference(executable), await reference(appAsar)];
    const packageBytes = extractFile(appAsar, 'package.json'); assert.equal(JSON.parse(packageBytes).version, expectedVersion); report.packageJsonSha256 = digest(packageBytes);
    const html = extractFile(appAsar, 'dist/index.html'), entries = [...html.toString().matchAll(/(?:src|href)="(?:\.\/)?([^"?#]+\.(?:js|css))"/g)].map(match => path.join('dist', match[1]));
    assert(entries.some(file => file.endsWith('.js'))); assert(entries.some(file => file.endsWith('.css')));
    report.bundleIdentity = {};
    for (const file of ['dist/index.html', ...entries, 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
      const packaged = extractFile(appAsar, file), built = await readFile(file); assert.equal(digest(packaged), digest(built), file + ': package/current built identity');
      report.bundleIdentity[file.replaceAll('\\', '/')] = { bytes: packaged.length, packagedSha256: digest(packaged), localBuiltSha256: digest(built) };
    }
    assert.equal(Object.keys(report.bundleIdentity).length, 5);
  }
  await launch(); await open(input, true); await screenshot('actual-midi-imported');
  const saved = await save('roundtrip', undefined, 'save'); await open(saved);
  const restoredSource = path.join(root, 'original-copy.mid'); await dialog('save', restoredSource, 'mid'); await menu('original-midi'); await waitForFile(restoredSource);
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已另存原始 MIDI'), undefined, { timeout: 30000 });
  assert.deepEqual(new Uint8Array(await readFile(restoredSource)), inputBytes); report.originalFileExport = { file: await reference(restoredSource), byteExact: true, delivery: 'existing-menu-IPC; not visible-native-menu click' };
  await inspect('original-midi-byteexact', false);
  await menu('select-all'); await page.waitForFunction(() => document.querySelector('.editor-heading')?.textContent?.includes('已选择 1 个音符'), undefined, { timeout: 5000 });
  await menu('duplicate'); await page.waitForFunction(() => document.title.startsWith('●'), undefined, { timeout: 5000 }); await inspect('note-duplicate', true);
  await save('notes-duplicated'); await screenshot('notes-duplicated');
  await menu('undo'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.startsWith('撤销：'), undefined, { timeout: 5000 });
  await save('notes-undone', baseline.project);
  await menu('redo'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.startsWith('重做：'), undefined, { timeout: 5000 });
  const redone = await save('notes-redone', firstDuplicate); await screenshot('notes-redone'); await finishSession();
  await launch(); await open(redone); await save('resaved-after-restart', firstDuplicate); await screenshot('reopened-after-process-restart'); await finishSession();
  assert.equal(sessions.length, 2); assert.equal(readbacks.length, 5); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
  assert.deepEqual(await reference(input), report.input, 'Literal MIDI input must stay byte-identical');
  for (const image of report.images ?? []) assert.deepEqual(await reference(path.resolve(image.path)), image, 'Package image changed during acceptance');
  for (const [file, hash] of Object.entries(report.sources)) assert.equal(await sha256(file), hash, 'Input source changed during acceptance: ' + file);
  Object.assign(report, { status: 'passed', midiOpen: 'passed', sourceArchiveSaveReopen: 'passed', originalFileExportExact: 'passed', noteReleaseAndSysExPreserved: 'passed', noteDuplicateUndoRedo: 'passed',
    sourceNotes: 1, duplicatedNotes: 2, regions: 1, completeProjectCheckpoints: readbacks.length, applicationRestarted: true, terminalComplete: processes.every(entry => entry.exitCode === 0 && entry.signal === null && entry.browserExited) });
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); }
  await finishSession(true).catch(cleanupError => { report.cleanupError = String(cleanupError); }); process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString(); await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, expectedVersion, report: reportFile, sha256: await sha256(reportFile), sessions: sessions.length, completeSavedZipReadbacks: readbacks.length, originalFileByteExact: report.originalFileExport?.byteExact ?? false, terminal: processes }));
}
