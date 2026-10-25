import { _electron as electron } from 'playwright';
import { extractFile } from '@electron/asar';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

// Original native-menu handlers -> preload IPC -> actual App. Renderer access
// is read-only. Only native file-dialog return values are controlled fixtures.
// No page.click, input synthesis, DOM mutation, React injection or split oracle
// imported from product code. Expected geometry is literal below.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' requires a value');
  return process.argv[index + 1];
};
const executableArgument = argument('--packaged'), expectedVersion = argument('--expected-version');
assert(executableArgument && expectedVersion, 'Use --packaged <unpacked executable> --expected-version <version>.');
const executable = path.resolve(executableArgument), appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
assert(!/(?:portable|setup)\.exe$/i.test(executable), 'Use the unpacked executable, not a launcher or installer.');
const sourceFile = path.resolve('.local/region-split-ui/source.nbsx');
const root = path.resolve('.local/region-split-desktop', 'run-' + Date.now()), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalize = project => { const copy = structuredClone(project); delete copy.modifiedAt; return copy; };
const rawArchive = async file => {
  const bytes = await readFile(file), entries = unzipSync(bytes);
  assert(entries['project.json'], 'Missing raw project.json: ' + file);
  return { bytes, entries, project: JSON.parse(strFromU8(entries['project.json'])) };
};
const objectIds = project => [project.id, ...project.tracks.map(item => item.id), ...project.patterns.flatMap(item => [item.id, ...item.notes.map(note => note.id), ...(item.midiEvents ?? []).map(event => event.id)]), ...project.regions.map(item => item.id), ...project.instruments.map(item => item.id), ...project.assets.map(item => item.id), ...(project.midi?.conductor ?? []).map(item => item.id)];
const sessions = [], processes = [], observations = [], readbacks = [], screenshots = [], rendererErrors = [], consoleErrors = [], unexpectedDialogs = [];
const reportFile = path.join(root, 'report.json');
const report = { schema: 1, status: 'running', root, profile, runnerPid: process.pid, expectedVersion, packaged: true, sources: {}, bundleIdentity: {}, sessions, processes, observations, readbacks, screenshots, rendererErrors, consoleErrors, unexpectedDialogs,
  scope: 'Two isolated packaged Electron sessions. Existing native Open/Next Bar/Split/Undo/Redo/Save As handlers -> main menu IPC -> preload -> actual App; real file writes, raw full ZIP/JSON oracle, restart then reopen/resave.',
  limitations: ['Menu click handlers are invoked in the original main process; this is native menu/IPC workflow acceptance, not physical mouse/keyboard input.', 'Only native file-dialog return values are fixture-controlled; no renderer command replacement, React-state injection, page.click, focus/scroll write or synthesized input.', 'The independent input fixture changes only the first time signature from 4/4 to 2/4 so one actual Next Bar command reaches tick960. Expected split is literal, never produced by a split planner.', 'The static native Split item remains enabled; boundary rejection is tested through its real App handler and full saved output, while toolbar disabled styling is read separately.', 'Only root modifiedAt and declared fresh identity slots are normalized; all other JSON fields, array order, MIDI archive and embedded sample bytes are strict.', 'No acoustic/native PCM, playback, hardware MIDI, multi-selection pointer gesture or physical shortcut claim.'] };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
let desktop, page, session, terminal, fixture, baseline, expectedSplit, expectedEntries, freshPlaceholders, oldIds, firstSplit;
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readDom = () => page.evaluate(() => {
  const split = document.querySelector('button[aria-label="在播放头拆分片段"]');
  return { title: document.title, message: document.querySelector('.status-message')?.textContent ?? '',
    transport: document.querySelector('[data-testid="transport-position"]')?.textContent ?? null,
    signature: document.querySelector('[data-testid="transport-signature"]')?.textContent ?? null,
    selectedRegionIds: [...document.querySelectorAll('[data-testid="region"].selected')].map(region => region.getAttribute('data-region-id')),
    regions: [...document.querySelectorAll('[data-testid="region"]')].map(region => ({ id: region.getAttribute('data-region-id'), trackId: region.getAttribute('data-track-id'), label: region.querySelector('.region-label')?.textContent })),
    trackIds: [...document.querySelectorAll('[data-testid="track-header"]')].map(track => track.getAttribute('data-track-id')),
    activeTrack: document.querySelector('.track-header.active')?.getAttribute('data-track-id') ?? null,
    splitButton: split ? { disabled: split.disabled, title: split.getAttribute('title') } : null,
    modalCount: document.querySelectorAll('[role="dialog"]').length };
});
async function menu(command) {
  await desktop.evaluate(({ Menu }, command) => {
    const labels = { open: ['文件', '打开 / 导入…'], 'save-as': ['文件', '另存为…'], 'next-bar': ['播放', '下一小节'], split: ['编辑', '在播放头拆分片段'], undo: ['编辑', '撤销'], redo: ['编辑', '重做'] };
    const wanted = labels[command]; if (!wanted) throw new Error('Unsupported original menu: ' + command);
    const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]);
    if (!item?.enabled || typeof item.click !== 'function') throw new Error('Original native menu unavailable: ' + command);
    globalThis.__regionSplitFixture.commands.push({ command, label: item.label, enabled: item.enabled, delivery: 'original-native-menu-to-preload-IPC' }); item.click();
  }, command); await flush();
}
async function inspect(label, split, selected, position) {
  const dom = await readDom(); assert.equal(dom.modalCount, 0, label); assert.equal(dom.regions.length, split ? 6 : 5, label);
  assert.deepEqual(dom.trackIds, baseline.tracks.map(track => track.id), label + ': track order');
  assert.deepEqual(dom.selectedRegionIds, [selected], label + ': primary selection'); assert.equal(dom.activeTrack, 'split-track-a');
  assert(dom.splitButton, label + ': actual split toolbar button missing'); if (position) assert.equal(dom.transport, position, label + ': literal transport position');
  observations.push({ session: session.index, label, dom }); return dom;
}
async function screenshot(label) {
  const file = path.join(root, label + '.png'); await page.screenshot({ path: file, fullPage: false }); screenshots.push({ session: session.index, label, file: await reference(file) });
}
function compare(actual, split, exactFirstIds, label) {
  const expected = split ? expectedSplit : baseline, value = structuredClone(actual.project), forward = new Map(), reverse = new Map();
  const wanted = split ? freshPlaceholders : new Set();
  function pair(items, targets, location) {
    assert.equal(items.length, targets.length, label + ': ' + location + ' count');
    targets.forEach((item, index) => {
      if (!wanted.has(item.id)) return;
      const actualId = items[index].id;
      assert(!oldIds.has(actualId), label + ': fresh identity reused an original'); assert(!forward.has(actualId), label + ': duplicate fresh identity');
      forward.set(actualId, item.id); reverse.set(item.id, actualId);
    });
  }
  pair(value.patterns, expected.patterns, 'patterns'); pair(value.regions, expected.regions, 'regions');
  value.patterns.forEach((pattern, index) => { pair(pattern.notes, expected.patterns[index].notes, 'notes'); pair(pattern.midiEvents ?? [], expected.patterns[index].midiEvents ?? [], 'MIDI events'); });
  assert.equal(reverse.size, wanted.size, label + ': all declared fresh identities');
  const map = id => forward.get(id) ?? id;
  for (const pattern of value.patterns) { pattern.id = map(pattern.id); for (const note of pattern.notes) note.id = map(note.id); for (const event of pattern.midiEvents ?? []) event.id = map(event.id); }
  for (const region of value.regions) { region.id = map(region.id); region.patternId = map(region.patternId); }
  assert.deepEqual(normalize(value), normalize(expected), label + ': complete literal project.json');
  assert.deepEqual(Object.keys(actual.entries).sort(), Object.keys(expectedEntries).sort(), label + ': full ZIP entry inventory');
  const embedded = [];
  for (const [entry, bytes] of Object.entries(expectedEntries)) if (entry !== 'project.json') {
    assert.deepEqual(actual.entries[entry], bytes, label + ': embedded bytes ' + entry); embedded.push({ entry, bytes: bytes.length, sha256: digest(bytes) });
  }
  if (exactFirstIds) {
    assert(firstSplit, 'First saved split must precede identity-preserving checkpoints');
    assert.deepEqual(reverse, firstSplit.identities, label + ': exact original split IDs');
    assert.deepEqual(normalize(actual.project), firstSplit.project, label + ': full first split with exact IDs');
  }
  return { freshIdentities: reverse, embedded };
}
async function save(label, split, exactFirstIds = false) {
  const file = path.join(root, label + '.nbsx');
  await desktop.evaluate((_, file) => { const state = globalThis.__regionSplitFixture; if (state.save) throw new Error('Unconsumed save fixture'); state.save = file; }, file);
  await menu('save-as');
  const deadline = Date.now() + 30000; while (true) {
    try { if ((await stat(file)).size > 0) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Date.now() < deadline, 'Real NBSX write timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 50));
  }
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 });
  const actual = await rawArchive(file), result = compare(actual, split, exactFirstIds, label);
  readbacks.push({ session: session.index, label, file: await reference(file), completeRawManifestCompared: true, fullZipInventoryCompared: true, embedded: result.embedded,
    normalizedDeclaredFreshIds: result.freshIdentities.size, firstSplitIdentitiesExact: exactFirstIds, tracks: actual.project.tracks.length, patterns: actual.project.patterns.length,
    regions: actual.project.regions.length, sourceNotes: actual.project.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0) });
  return { file, project: normalize(actual.project), identities: result.freshIdentities };
}
async function open(file, split, label) {
  await desktop.evaluate((_, file) => { const state = globalThis.__regionSplitFixture; if (state.open) throw new Error('Unconsumed Open fixture'); state.open = file; }, file);
  await menu('open');
  await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), baseline.name, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 }); await flush();
  const dom = await inspect(label, split, 'split-region-a', '1.1.00'); assert.equal(dom.signature, '2/4'); assert.equal(dom.splitButton.disabled, true);
}
async function launch() {
  const launchArgs = ['--mute-audio', `--user-data-dir=${profile}`]; desktop = await electron.launch({ executablePath: executable, args: launchArgs, env: environment });
  const child = desktop.process(), record = { pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, signal: null }; processes.push(record);
  terminal = new Promise(resolve => child.once('exit', (exitCode, signal) => { Object.assign(record, { exitCode, signal, exitedAt: new Date().toISOString() }); resolve(record); }));
  session = { index: sessions.length + 1, pid: child.pid, launchArgs, audioMutedByHarness: true }; sessions.push(session);
  let stdout = '', stderr = ''; child.stdout?.on('data', bytes => { stdout += bytes; }); child.stderr?.on('data', bytes => { stderr += bytes; }); session.logs = () => ({ stdout, stderr });
  const identity = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), evaluatedProcessPid: process.pid,
    runtime: process.versions, appMetrics: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, creationTime: metric.creationTime })) }));
  Object.assign(session, identity); assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(path.resolve(identity.userData), profile); assert.equal(path.resolve(identity.appPath), appAsar);
  const browser = identity.appMetrics.find(metric => metric.type === 'Browser'); assert(browser?.pid > 0, 'Owned Browser process must be observable'); session.browserPid = record.browserPid = browser.pid; assert(processAlive(browser.pid));
  page = await desktop.firstWindow(); const index = session.index;
  page.on('pageerror', error => rendererErrors.push({ session: index, message: error.message })); page.on('crash', () => rendererErrors.push({ session: index, message: 'Renderer crashed' }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ session: index, message: message.text() }); });
  page.on('dialog', dialog => { unexpectedDialogs.push({ session: index, type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
  await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 }); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
  await desktop.evaluate(({ dialog }) => {
    globalThis.__regionSplitFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
    dialog.showOpenDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties)), state = globalThis.__regionSplitFixture;
      if (!state.open || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(options?.title) || !options.properties.includes('openFile')) { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
      const file = state.open; state.open = null; state.calls.push({ kind: 'open', file, title: options.title }); return { canceled: false, filePaths: [file] };
    };
    dialog.showSaveDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters)), state = globalThis.__regionSplitFixture;
      if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true }; }
      const file = state.save; state.save = null; state.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file };
    };
  });
}
async function finishSession(force = false) {
  if (!desktop) return;
  session.dialogFixture = await desktop.evaluate(() => globalThis.__regionSplitFixture).catch(() => null);
  try {
    if (!force) {
      assert(!(await page.title()).startsWith('●')); assert.equal(session.dialogFixture.open, null); assert.equal(session.dialogFixture.save, null); assert.deepEqual(session.dialogFixture.unexpected, []);
      assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'open').length, 1); assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'save').length, session.index === 1 ? 5 : 1);
    } else await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await desktop.close(); let timeout;
    const ended = await Promise.race([terminal, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned process did not exit after close; no restart attempted')), 30000); })]).finally(() => clearTimeout(timeout));
    if (session.browserPid) {
      const deadline = Date.now() + 10000; while (processAlive(session.browserPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      ended.browserExited = !processAlive(session.browserPid); assert(ended.browserExited, 'Owned Browser process must exit');
    }
    if (!force) { assert.equal(ended.exitCode, 0); assert.equal(ended.signal, null); }
  } finally {
    const logs = session.logs?.() ?? {}; delete session.logs;
    for (const [name, content] of Object.entries(logs)) { const file = path.join(root, `session-${session.index}-${name}.log`); await writeFile(file, content); session[name] = await reference(file); }
    session.closeMethod = force ? 'Failure cleanup of owned windows, then ElectronApplication.close' : 'ElectronApplication.close after clean saved project';
  }
  desktop = undefined; page = undefined;
}
try {
  await writeFile(path.join(root, 'runner-source.mjs'), await readFile(new URL(import.meta.url))); report.runnerSource = await reference(path.join(root, 'runner-source.mjs'));
  report.images = [await reference(executable), await reference(appAsar)]; report.literalSource = await reference(sourceFile);
  assert.equal(report.literalSource.sha256, 'ab560ac53a7d02c431e1a1777cb4586b404a4079b53748e00b43e347b3bdc94d', 'Independent source fixture identity changed');
  const source = await rawArchive(sourceFile); baseline = structuredClone(source.project); assert.equal(baseline.ppq, 480);
  assert.deepEqual(baseline.timeSignatures[0], { tick: 0, numerator: 4, denominator: 4 }); baseline.timeSignatures[0].numerator = 2;
  assert.equal(baseline.regions[0].id, 'split-region-a'); assert.deepEqual(baseline.regions[0], { id: 'split-region-a', trackId: 'split-track-a', patternId: 'split-pattern-a', start: 240, length: 1440, offset: 120, loop: false });
  assert.equal(baseline.regions.filter(region => region.patternId === 'split-pattern-a').length, 2); assert(baseline.tracks[3].locked);
  const usedInstruments = new Set([...baseline.tracks.map(track => track.instrumentId), ...baseline.patterns.flatMap(pattern => pattern.notes.flatMap(note => note.instrumentId === undefined ? [] : [note.instrumentId]))]);
  assert(baseline.instruments.filter(instrument => usedInstruments.has(instrument.id)).every(instrument => instrument.assetId && source.entries['assets/' + instrument.assetId]), 'All used instrument samples must already be portable');
  fixture = path.join(root, 'source-2-4.nbsx'); expectedEntries = { ...source.entries, 'project.json': strToU8(JSON.stringify(baseline)) };
  await writeFile(fixture, zipSync(expectedEntries, { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') }));
  await writeFile(path.join(root, 'source-2-4.json'), JSON.stringify(baseline, null, 2) + '\n');
  expectedSplit = structuredClone(baseline);
  const clonePattern = (pattern, id) => ({ ...structuredClone(pattern), id, notes: pattern.notes.map((note, index) => ({ ...structuredClone(note), id: `${id}-note-${index}` })),
    ...(pattern.midiEvents === undefined ? {} : { midiEvents: pattern.midiEvents.map((event, index) => ({ ...structuredClone(event), id: `${id}-event-${index}` })) }) });
  const pattern = baseline.patterns.find(pattern => pattern.id === 'split-pattern-a'), left = clonePattern(pattern, 'new-a-left-source'), right = clonePattern(pattern, 'new-a-right-source');
  expectedSplit.patterns.push(left, right);
  expectedSplit.regions[0] = { ...expectedSplit.regions[0], patternId: left.id, length: 720, midiEndExclusive: true };
  expectedSplit.regions.splice(1, 0, { id: 'new-a-right-region', trackId: 'split-track-a', patternId: right.id, start: 960, length: 720, offset: 840, loop: false });
  freshPlaceholders = new Set([left, right].flatMap(pattern => [pattern.id, ...pattern.notes.map(note => note.id), ...(pattern.midiEvents ?? []).map(event => event.id)]).concat('new-a-right-region'));
  oldIds = new Set(objectIds(baseline));
  await writeFile(path.join(root, 'expected-one-a-split.json'), JSON.stringify(expectedSplit, null, 2) + '\n');
  await writeFile(path.join(root, 'expected-one-a-split.nbsx'), zipSync({ ...expectedEntries, 'project.json': strToU8(JSON.stringify(expectedSplit)) }, { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') }));
  report.fixture = await reference(fixture); report.expected = { cutTick: 960, nativeNavigation: '2/4 at tick0 => one Next Bar reaches 2.1.00/tick960', onlySelectedSource: 'split-region-a', freshPlaceholders: [...freshPlaceholders],
    baseline: await reference(path.join(root, 'source-2-4.json')), split: await reference(path.join(root, 'expected-one-a-split.json')), expectedSplitZip: await reference(path.join(root, 'expected-one-a-split.nbsx')) };
  for (const file of ['scripts/smoke-region-split-desktop.mjs', 'src/ui/App.tsx', 'src/ui/Arrangement.tsx', 'src/core/region-split.ts', 'src/core/types.ts', 'src/core/project.ts', 'src/core/container.ts', 'src/core/meter.ts', 'src/core/midi-export.ts', 'src/core/editor-selection.ts', 'src/ui/export-context.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json', 'package-lock.json']) report.sources[file] = await sha256(file);
  const packageBytes = extractFile(appAsar, 'package.json'); assert.equal(JSON.parse(packageBytes).version, expectedVersion); report.packageJsonSha256 = digest(packageBytes);
  const htmlPath = path.join('dist', 'index.html'), html = extractFile(appAsar, htmlPath);
  const entries = [...html.toString().matchAll(/(?:src|href)="(?:\.\/)?([^"?#]+\.(?:js|css))"/g)].map(match => path.join('dist', match[1]));
  assert(entries.some(file => file.endsWith('.js')), 'Packaged renderer entry must be identifiable');
  for (const file of [htmlPath, ...entries, path.join('dist-electron', 'main.cjs'), path.join('dist-electron', 'preload.cjs')]) {
    const packagedBytes = extractFile(appAsar, file), builtBytes = await readFile(path.resolve(file)); assert.equal(digest(packagedBytes), digest(builtBytes), file + ': packaged/current built bundle identity');
    report.bundleIdentity[file.replaceAll('\\', '/')] = { packagedSha256: digest(packagedBytes), currentBuiltSha256: digest(builtBytes), bytes: packagedBytes.length };
  }
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  await launch(); await open(fixture, false, 'source-opened'); await save('baseline-saved', false);
  await menu('next-bar'); const atCut = await inspect('actual-next-bar-at-cut', false, 'split-region-a', '2.1.00'); assert.equal(atCut.splitButton.disabled, false);
  await menu('split'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已拆分 1 个片段'), undefined, { timeout: 5000 });
  firstSplit = await save('split-saved', true); const rightId = firstSplit.identities.get('new-a-right-region');
  const afterSplit = await inspect('split-right-selected', true, rightId, '2.1.00'); assert.equal(afterSplit.splitButton.disabled, true); await screenshot('split-saved');
  await menu('undo'); await inspect('undo-original-selection', false, 'split-region-a', '2.1.00'); await save('undo-saved', false);
  await menu('redo'); await inspect('redo-original-right-selection', true, rightId, '2.1.00'); await save('redo-saved', true, true);
  await menu('split'); const boundary = await inspect('boundary-native-handler-noop', true, rightId, '2.1.00'); assert.equal(boundary.splitButton.disabled, true); assert(!boundary.title.startsWith('●'), 'Boundary rejection must not dirty the document');
  assert.match(boundary.message, /播放头不在.*内部/); await save('boundary-rejected-saved', true, true); await screenshot('boundary-rejected');
  await finishSession();
  await launch(); await open(firstSplit.file, true, 'reopened-after-process-restart'); await save('restart-resaved', true, true); await screenshot('restart-resaved'); await finishSession();
  assert.equal(sessions.length, 2); assert.equal(readbacks.length, 6); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
  assert.deepEqual(await reference(sourceFile), report.literalSource, 'Independent original source unchanged'); assert.deepEqual(await reference(fixture), report.fixture, 'Prepared input fixture unchanged');
  for (const image of report.images) assert.equal(await sha256(path.resolve(image.path)), image.sha256, 'Packaged image changed');
  for (const [file, expected] of Object.entries(report.sources)) assert.equal(await sha256(file), expected, 'Source changed during acceptance: ' + file);
  report.status = 'passed'; report.applicationRestarted = true; report.completeSavedZipReadbacks = readbacks.length;
  report.terminalComplete = processes.every(record => record.exitCode === 0 && record.signal === null && record.browserExited);
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); }
  await finishSession(true).catch(cleanupError => { report.cleanupError = String(cleanupError); }); process.exitCode = 1;
} finally {
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, expectedVersion, report: reportFile, sha256: await sha256(reportFile), sessions: sessions.length, completeSavedZipReadbacks: readbacks.length, terminal: processes }));
}
