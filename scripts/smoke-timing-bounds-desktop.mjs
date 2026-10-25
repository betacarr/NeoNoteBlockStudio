import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { appendFileSync, createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Existing native menu callbacks -> preload -> App; only dialog-return fixtures
// and read-only DOM observations. No synthetic input, focus/scroll/React writes.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' requires a value');
  return process.argv[index + 1];
};
const prepareOnly = process.argv.includes('--prepare-only'), executableArgument = argument('--packaged');
assert(prepareOnly || executableArgument, 'Use --prepare-only or --packaged <unpacked executable>.');
const executable = executableArgument ? path.resolve(executableArgument) : undefined;
if (executable) assert(!/portable\.exe$/i.test(executable), 'Use the unpacked executable.');
const expectedVersion = argument('--expected-version') ?? '0.1.32';
const root = path.resolve('.local/timing-bounds-desktop', 'run-' + Date.now()), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const startedAt = new Date().toISOString(), terminalFile = path.join(root, 'terminal.json'), applicationLog = path.join(root, 'application-terminal.log');
let runnerStatus = 'preparing', applicationProcess;
process.once('exit', exitCode => writeFileSync(terminalFile, JSON.stringify({
  schema: 1, runnerPid: process.pid, exitCode, startedAt, exitedAt: new Date().toISOString(), status: runnerStatus,
  applicationProcess, scope: 'Actual Node exit event and owned Electron child exit event; no audio/native research process.',
}, null, 2) + '\n'));
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalized = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const runnerSource = path.join(root, 'runner-source.mjs'); await writeFile(runnerSource, await readFile(new URL(import.meta.url)));
const helper = path.join(root, 'fixture-helper.mjs'), helperEntry = 'timing-bounds-desktop-fixtures.ts';
const helperSource = "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx} from './src/core/container.ts';";
const bundled = await build({ stdin: { contents: helperSource, resolveDir: process.cwd(), sourcefile: helperEntry }, outfile: helper, platform: 'node', format: 'esm', bundle: true, metafile: true });
const { createProject, newNote, saveNbsx, openNbsx } = await import(pathToFileURL(helper).href);
const helperInputs = {};
for (const input of Object.keys(bundled.metafile.inputs).sort()) if (!input.startsWith('<') && input !== helperEntry) helperInputs[input.replaceAll('\\', '/')] = await sha256(path.resolve(input));
const definitions = [
  { key: 'large-offset', period: 1, length: 1, offset: 1e12, loop: true, ticks: [0], expectedCount: 1, save: true },
  { key: 'empty-long', period: 1, length: 1e12, offset: 0, loop: true, ticks: [], expectedCount: 0, save: true },
  { key: 'legacy-far', period: 4, length: 4, offset: 0, loop: false, ticks: [0, 1e12], expectedCount: 1, save: true },
  { key: 'over-budget', period: 1, length: 1e12, offset: 0, loop: true, ticks: [0], expectedCount: null, save: false },
  { key: 'normal', period: 1920, length: 1920, offset: 0, loop: false, ticks: [120, 600], expectedCount: 2, save: true },
];
const fixtures = [];
for (const definition of definitions) {
  const project = createProject('Timing bounds ' + definition.key);
  project.id = 'timing-bounds-' + definition.key; project.ppq = 480;
  project.createdAt = project.modifiedAt = '2026-01-01T00:00:00.000Z';
  const { sound: ignoredSound, nbsIndex: ignoredIndex, ...baseInstrument } = project.instruments[0];
  // Independent silent instrument prevents optional portable-save resource
  // embedding from changing the expected project; no loaded-library prerequisite.
  project.instruments = [{ ...baseInstrument, id: 'timing-fixture-silent', name: 'Timing persistence fixture', englishName: 'Timing persistence fixture' }];
  Object.assign(project.tracks[0], { id: definition.key + '-track', name: definition.key + ' track', instrumentId: project.instruments[0].id, sourceMidiTrack: 2, midiChannel: 3 });
  Object.assign(project.patterns[0], { id: definition.key + '-pattern', name: definition.key + ' source', length: definition.period,
    notes: definition.ticks.map((tick, index) => ({ ...newNote(tick, 66 + index, 1.25), id: definition.key + '-note-' + index,
      velocity: .625, pan: -.125, height: .5, detune: -7.25, instrumentId: project.instruments[0].id,
      midiSource: { onOrder: 2 * index, offOrder: 2 * index + 1, releaseVelocity: 53, offSourceTrack: 2 } })),
    midiEvents: [{ id: definition.key + '-controller', tick: .25, order: 5, sourceTrack: 2, event: { deltaTime: 0, type: 'controller', channel: 3, controllerType: 64, value: 127 } }],
  });
  Object.assign(project.regions[0], { id: definition.key + '-region', trackId: project.tracks[0].id, patternId: project.patterns[0].id,
    start: 0, length: definition.length, offset: definition.offset, loop: definition.loop });
  project.assets.push({ id: 'timing-fixture-resource', name: 'retained.bin', mime: 'application/octet-stream', data: 'AAECA//+', path: 'relative/retained.bin' });
  project.provenance = { kind: 'midi', filename: definition.key + '.mid', metadata: { purpose: 'timing-bound persistence', untouched: [1, 'value'] } };
  const file = path.join(root, definition.key + '.nbsx'); await writeFile(file, saveNbsx(project));
  const parsed = openNbsx(new Uint8Array(await readFile(file)));
  assert.deepEqual(normalized(parsed), normalized(project), definition.key + ': fixture schema/container roundtrip');
  fixtures.push({ ...definition, project: parsed, file, identity: await reference(file) });
}
const selectedSourceSha256 = {};
for (const file of ['scripts/smoke-timing-bounds-desktop.mjs', 'src/ui/App.tsx', 'src/ui/CommitNumberInput.tsx', 'src/core/project.ts', 'src/core/expansion.ts', 'src/core/inspector-timing.ts', 'src/core/container.ts', 'src/core/types.ts', 'src/core/meter.ts', 'src/core/editor-commands.ts', 'src/core/editor-selection.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json']) selectedSourceSha256[file] = await sha256(file);
const preparedFile = path.join(root, 'fixtures.json');
await writeFile(preparedFile, JSON.stringify({ schema: 1, status: 'prepared', applicationLaunched: false, expectedVersion, root, profile,
  selectedSourceSha256, runnerSource: await reference(runnerSource),
  fixtureHelper: { scope: 'Same-source Node schema/container fixture construction and complete NBSX readback only.', file: await reference(helper), virtualEntrySha256: createHash('sha256').update(helperSource).digest('hex'), inputs: helperInputs },
  fixtures: fixtures.map(fixture => ({ key: fixture.key, file: fixture.identity, name: fixture.project.name, period: fixture.period, length: fixture.length, offset: fixture.offset, loop: fixture.loop, sourceTicks: fixture.ticks, expectedFooterCount: fixture.expectedCount, savePlanned: fixture.save })),
  plannedFullProjectReadbacks: 4, oversizedScope: 'Open and read DOM, then native New/Open/Save a normal project. Oversized Save semantics are not tested.',
}, null, 2) + '\n');

if (prepareOnly) {
  runnerStatus = 'prepared';
  console.log(JSON.stringify({ status: runnerStatus, applicationLaunched: false, fixtures: fixtures.length, plannedFullProjectReadbacks: 4, report: preparedFile, sha256: await sha256(preparedFile), terminal: terminalFile }));
} else {
  const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
  const rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], observations = [], checkpoints = [], screenshots = [];
  const checks = { oversizedOpen: false, saveRejected: { status: 'not-tested', reason: 'Legal source persistence is independent of local portable-library availability; only over-budget open and subsequent normal operations are accepted here.' }, normalAfterOversized: false };
  const reportFile = path.join(root, 'report.json');
  const report = { schema: 1, status: 'running', expectedVersion, applicationVersion: null, packaged: true, root, profile, runnerPid: process.pid, startedAt,
    selectedSourceSha256, prepared: await reference(preparedFile), runnerSource: await reference(runnerSource), terminal: path.relative(process.cwd(), terminalFile).replaceAll('\\', '/'),
    rendererErrors, consoleErrors, unexpectedDialogs, observations, checkpoints, screenshots, checks, fullProjectReadbacks: 0,
    scope: 'Actual packaged native menu callbacks -> preload -> App Open/Save As/New, isolated dialog-return fixtures, read-only footer/diagnostics DOM, and complete saved NBSX semantic comparison.',
    limitations: ['No physical input, human file chooser, numeric editing, draft rejection/blur/undo gesture, scroll/focus writes or React state injection.', 'The Node fixture/readback bundle is same-source schema/container checking; no independent file-format implementation claim.', 'Only root modifiedAt is ignored in full-project comparisons; all notes, source ranges, metadata and resources must remain exact.', 'The oversized project is only opened and observed; its Save behavior and GUI shortening are not tested. No local game library is required.', 'No playback, audio export, native rendering, audio matrix, hardware or FPS acceptance.'],
  };
  let desktop, page, ended;
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readDom = () => page.evaluate(() => ({
    title: document.title, footer: document.querySelector('.status-bar')?.textContent ?? '',
    message: document.querySelector('.status-message')?.textContent ?? '',
    warningCount: Number(document.querySelector('.warning-count')?.textContent?.trim() ?? 'NaN'),
    regionCount: document.querySelectorAll('[data-testid="region"]').length,
    canvasCount: document.querySelectorAll('.piano-viewport canvas').length,
    pianoHeading: [...document.querySelectorAll('.editor-heading')].find(element => element.textContent?.includes('钢琴卷帘'))?.textContent ?? '',
    resourceLabel: document.querySelector('.resource-card strong')?.textContent ?? '',
    modalCount: document.querySelectorAll('[role="dialog"]').length,
  }));
  const screenshot = async label => { const file = path.join(root, label + '.png'); await page.screenshot({ path: file }); screenshots.push({ label, file: await reference(file) }); };
  const command = async name => {
    await desktop.evaluate(({ Menu }, name) => {
      const labels = { open: '打开 / 导入…', 'save-as': '另存为…', new: '新建工程' };
      if (!Object.hasOwn(labels, name)) throw Error('Unsupported fixture command: ' + name);
      const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === '文件')?.submenu?.items.find(item => item.label.replaceAll('&', '') === labels[name]);
      if (!item?.enabled || typeof item.click !== 'function') throw Error('Original native menu unavailable: ' + name);
      globalThis.__timingBoundsFixture.commands.push({ name, label: item.label, delivery: 'existing-native-menu-callback-to-preload-IPC' }); item.click();
    }, name);
    await flush();
  };
  const inspect = async fixture => {
    const dom = await readDom();
    assert(dom.title.includes(fixture.project.name)); assert(!dom.title.startsWith('●'));
    assert.equal(dom.regionCount, 1); assert.equal(dom.canvasCount, 1); assert.equal(dom.modalCount, 0);
    if (fixture.expectedCount === null) { assert(dom.footer.includes('音符展开超限')); assert(dom.warningCount > 0); }
    else { assert(dom.footer.includes(`1 轨 · ${fixture.expectedCount} 音符`), fixture.key + ': literal footer count'); assert(!dom.footer.includes('音符展开超限')); }
    observations.push({ label: fixture.key + '-opened', fixture: fixture.key, dom }); return dom;
  };
  const open = async fixture => {
    await desktop.evaluate((_, file) => { const state = globalThis.__timingBoundsFixture; if (state.open) throw Error('Unconsumed Open fixture'); state.open = file; }, fixture.file);
    await command('open');
    await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), fixture.project.name, { timeout: 60000 });
    await flush(); await inspect(fixture); await screenshot(fixture.key + '-opened');
  };
  const save = async fixture => {
    const file = path.join(root, fixture.key + '-saved.nbsx');
    await desktop.evaluate((_, file) => { const state = globalThis.__timingBoundsFixture; if (state.save) throw Error('Unconsumed Save fixture'); state.save = file; }, file);
    await command('save-as');
    await page.waitForFunction(name => document.querySelector('.status-message')?.textContent?.includes(`已保存 ${name}.nbsx`) && !document.title.startsWith('●'), fixture.project.name, { timeout: 30000 });
    const project = openNbsx(new Uint8Array(await readFile(file)));
    assert.deepEqual(normalized(project), normalized(fixture.project), fixture.key + ': full saved-project semantic mismatch');
    checkpoints.push({ label: fixture.key + '-saved', file: await reference(file), completeProjectCompared: true, ignoredFields: ['modifiedAt'],
      ppq: project.ppq, sourceTicks: project.patterns[0].notes.map(note => note.tick), sourceLength: project.patterns[0].length, region: project.regions[0], resources: project.assets.length });
    report.fullProjectReadbacks = checkpoints.length;
    await inspect(fixture);
  };
  const waitForExit = async () => {
    let timer;
    await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned application did not exit')), 30000); })]).finally(() => clearTimeout(timer));
  };
  try {
    runnerStatus = 'running';
    report.images = [await reference(executable), await reference(path.join(path.dirname(executable), 'resources', 'app.asar'))];
    desktop = await electron.launch({ executablePath: executable, args: ['--mute-audio', `--user-data-dir=${profile}`], env: environment });
    const child = desktop.process(); applicationProcess = report.applicationProcess = { pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, signal: null };
    ended = new Promise(resolve => child.once('exit', (exitCode, signal) => { Object.assign(applicationProcess, { exitCode, signal, exitedAt: new Date().toISOString() }); resolve(); }));
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream?.on('data', bytes => appendFileSync(applicationLog, `[${new Date().toISOString()} ${name}] ${bytes}`));
    const identity = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), runtime: process.versions }));
    report.applicationIdentity = identity; report.applicationVersion = identity.version;
    assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(identity.userData, profile);
    page = await desktop.firstWindow();
    page.on('pageerror', error => rendererErrors.push(error.message)); page.on('crash', () => rendererErrors.push('Renderer crashed'));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => { unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
    await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    assert.equal((await readDom()).modalCount, 0);
    await desktop.evaluate(({ dialog }) => {
      globalThis.__timingBoundsFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
      dialog.showOpenDialog = async (...args) => {
        const state = globalThis.__timingBoundsFixture, options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties));
        if (!state.open || options?.title !== '打开工程或导入 MIDI / NBS') { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
        const file = state.open; state.open = null; state.calls.push({ kind: 'open', file }); return { canceled: false, filePaths: [file] };
      };
      dialog.showSaveDialog = async (...args) => {
        const state = globalThis.__timingBoundsFixture, options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters));
        if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save' }); return { canceled: true }; }
        const file = state.save; state.save = null; state.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file };
      };
    });
    for (const fixture of fixtures.slice(0, 3)) { await open(fixture); await save(fixture); }
    const oversized = fixtures.find(fixture => fixture.key === 'over-budget'); await open(oversized); checks.oversizedOpen = true;
    await command('new');
    await page.waitForFunction(() => document.title.includes('未命名工程') && !document.title.startsWith('●') && document.querySelector('.status-bar')?.textContent?.includes('1 轨 · 0 音符'), undefined, { timeout: 30000 });
    observations.push({ label: 'native-new-after-oversized', dom: await readDom() });
    const normal = fixtures.find(fixture => fixture.key === 'normal'); await open(normal); await save(normal); await screenshot('normal-after-oversized-saved');
    checks.normalAfterOversized = true;
    report.dialogFixture = await desktop.evaluate(() => globalThis.__timingBoundsFixture);
    assert.equal(report.dialogFixture.open, null); assert.equal(report.dialogFixture.save, null); assert.deepEqual(report.dialogFixture.unexpected, []);
    assert.equal(report.dialogFixture.calls.filter(call => call.kind === 'open').length, 5);
    assert.equal(report.dialogFixture.calls.filter(call => call.kind === 'save').length, 4);
    assert.equal(checkpoints.length, 4); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
    for (const [file, hash] of Object.entries(selectedSourceSha256)) assert.equal(await sha256(file), hash, 'Selected source changed during run: ' + file);
    for (const [file, hash] of Object.entries(helperInputs)) assert.equal(await sha256(file), hash, 'Fixture/readback input changed during run: ' + file);
    await desktop.close(); await waitForExit(); desktop = undefined; page = undefined;
    assert.equal(applicationProcess.exitCode, 0); assert.equal(applicationProcess.signal, null);
    report.status = runnerStatus = 'passed'; report.fullProjectReadbacks = checkpoints.length;
  } catch (error) {
    report.status = runnerStatus = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;
    if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); }
    if (desktop) report.dialogFixtureAtFailure = await desktop.evaluate(() => globalThis.__timingBoundsFixture).catch(() => null);
  } finally {
    if (desktop) {
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
      await desktop.close().catch(() => {}); await waitForExit().catch(error => { report.cleanupError = String(error); process.exitCode = 1; report.status = runnerStatus = 'failed'; });
    }
    report.finishedAt = new Date().toISOString();
    if (await stat(applicationLog).then(() => true).catch(() => false)) report.applicationTerminal = await reference(applicationLog);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, expectedVersion, applicationVersion: report.applicationVersion, fullProjectReadbacks: report.fullProjectReadbacks, checks, report: reportFile, sha256: await sha256(reportFile), terminal: terminalFile, error: report.error }));
  }
}
