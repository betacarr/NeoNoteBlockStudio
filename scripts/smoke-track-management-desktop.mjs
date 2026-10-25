import { _electron as electron } from 'playwright';
import { extractFile } from '@electron/asar';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';

// Original native menus -> preload -> actual App, real file writes and raw ZIP
// literal answers. No synthesized input, DOM mutation or React/command injection.
const argument = name => { const at = process.argv.indexOf(name); if (at < 0) return; assert(process.argv[at + 1] && !process.argv[at + 1].startsWith('--'), name + ' needs a value'); return process.argv[at + 1]; };
const exeArgument = argument('--packaged'), expectedVersion = argument('--expected-version');
assert(exeArgument && expectedVersion, 'Use --packaged <unpacked executable> --expected-version <version>.');
const executable = path.resolve(exeArgument), appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
assert(!/(?:portable|setup)\.exe$/i.test(executable), 'Use the unpacked executable.');
const sourceFile = path.resolve('.local/track-management-ui/source.nbsx'), root = path.resolve('.local/track-management-desktop', 'run-' + Date.now()), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const rawArchive = async file => { const bytes = await readFile(file), entries = unzipSync(bytes); assert(entries['project.json'], 'Missing raw manifest'); return { bytes, entries, project: JSON.parse(strFromU8(entries['project.json'])) }; };
const normalized = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const sessions = [], processes = [], observations = [], readbacks = [], screenshots = [], rendererErrors = [], consoleErrors = [], unexpectedDialogs = [];
const reportFile = path.join(root, 'report.json'), report = { schema: 1, status: 'running', root, profile, expectedVersion, runnerPid: process.pid, sources: {}, bundleIdentity: {}, sessions, processes, observations, readbacks, screenshots, rendererErrors, consoleErrors, unexpectedDialogs,
  scope: 'Two packaged sessions, actual native Open/Track Down/Delete Track/Undo/Redo/Save As menus -> main/preload IPC -> App; eight complete raw ZIP readbacks and one clean restart.',
  limitations: ['Original native handlers are invoked in the main process; no physical mouse/keyboard delivery is claimed.', 'Native chooser return values are fixtures. Renderer evaluation reads DOM only; no page.click, focus/scroll writes, React state or replacement command.', 'Track Up and instrument filtering are not executed by this script; they have separate actual GUI/component evidence.', 'Only root modifiedAt is ignored. No identity normalization, MIDI-route, sample, order or metadata allowance.', 'No audio playback, native PCM, external DAW, acoustic or macOS acceptance.'] };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
let desktop, page, session, terminal, baseline, down, deleted, entries;
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readDom = () => page.evaluate(() => ({ title: document.title, message: document.querySelector('.status-message')?.textContent ?? '',
  trackIds: [...document.querySelectorAll('[data-testid="track-header"]')].map(node => node.getAttribute('data-track-id')),
  activeTrack: document.querySelector('.track-header.active')?.getAttribute('data-track-id') ?? null,
  selectedRegions: [...document.querySelectorAll('[data-testid="region"].selected')].map(node => node.getAttribute('data-region-id')),
  regions: [...document.querySelectorAll('[data-testid="region"]')].map(node => ({ id: node.getAttribute('data-region-id'), trackId: node.getAttribute('data-track-id') })),
  filter: document.querySelector('select[aria-label="编曲区乐器筛选"]')?.value ?? null, modalCount: document.querySelectorAll('[role="dialog"]').length }));
async function menu(command) {
  await desktop.evaluate(({ Menu }, command) => {
    const labels = { open: ['文件', '打开 / 导入…'], 'save-as': ['文件', '另存为…'], 'track-down': ['轨道', '下移当前轨道'], 'delete-track': ['轨道', '删除当前轨道'], undo: ['编辑', '撤销'], redo: ['编辑', '重做'] }, wanted = labels[command];
    if (!wanted) throw Error('Unsupported native fixture command ' + command);
    const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]);
    if (!item?.enabled || typeof item.click !== 'function') throw Error('Original native menu unavailable: ' + command);
    globalThis.__trackManagementFixture.commands.push({ command, label: item.label, enabled: item.enabled, delivery: 'original-native-menu-to-preload-IPC' }); item.click();
  }, command); await flush();
}
async function inspect(label, expected, selectedTrack, selectedRegion) {
  const dom = await readDom(); assert.equal(dom.modalCount, 0, label); assert.equal(dom.filter, '', label + ': unfiltered fixture');
  assert.deepEqual(dom.trackIds, expected.tracks.map(t => t.id), label + ': visible document track order'); assert.equal(dom.activeTrack, selectedTrack, label + ': active track');
  assert.deepEqual(dom.selectedRegions, [selectedRegion], label + ': selection identity');
  assert.deepEqual(dom.regions, expected.tracks.flatMap(track => expected.regions.filter(region => region.trackId === track.id).map(region => ({ id: region.id, trackId: region.trackId }))), label + ': complete per-track region order');
  observations.push({ label, session: session.index, dom }); return dom;
}
async function screenshot(label) { const file = path.join(root, label + '.png'); await page.screenshot({ path: file, fullPage: false }); screenshots.push({ label, session: session.index, file: await reference(file) }); }
async function save(label, expected, selectedTrack, selectedRegion) {
  const file = path.join(root, label + '.nbsx'); await desktop.evaluate((_, file) => { const state = globalThis.__trackManagementFixture; if (state.save) throw Error('Unconsumed save fixture'); state.save = file; }, file);
  await menu('save-as'); const deadline = Date.now() + 30000;
  while (true) { try { if ((await stat(file)).size > 0) break; } catch (error) { if (error.code !== 'ENOENT') throw error; } assert(Date.now() < deadline, 'Real save timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 50)); }
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 });
  const actual = await rawArchive(file); assert.deepEqual(normalized(actual.project), normalized(expected), label + ': whole literal manifest and surviving identities');
  assert.deepEqual(Object.keys(actual.entries).sort(), Object.keys(entries).sort(), label + ': full ZIP entry inventory'); const embedded = [];
  for (const [name, bytes] of Object.entries(entries)) if (name !== 'project.json') { assert.deepEqual(actual.entries[name], bytes, label + ': embedded ' + name); embedded.push({ name, bytes: bytes.length, sha256: digest(bytes) }); }
  readbacks.push({ label, session: session.index, file: await reference(file), completeRawManifestMatched: true, completeZipInventoryMatched: true, ignoredFields: ['root modifiedAt'], idNormalization: false, trackIds: actual.project.tracks.map(t => t.id), channels: actual.project.tracks.map((t, index) => [t.id, t.midiChannel ?? index % 16, t.midiChannel ?? 'implicit']), regions: actual.project.regions.length, patterns: actual.project.patterns.length, embedded });
  await inspect(label, expected, selectedTrack, selectedRegion); return file;
}
async function open(file, expected, selectedTrack, selectedRegion) {
  await desktop.evaluate((_, file) => { const state = globalThis.__trackManagementFixture; if (state.open) throw Error('Unconsumed open fixture'); state.open = file; }, file); await menu('open');
  await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), baseline.name, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 }); await flush(); await inspect('opened-session-' + session.index, expected, selectedTrack, selectedRegion);
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
    globalThis.__trackManagementFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
    dialog.showOpenDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties)), state = globalThis.__trackManagementFixture;
      if (!state.open || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(options?.title) || !options.properties.includes('openFile')) { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
      const file = state.open; state.open = null; state.calls.push({ kind: 'open', file, title: options.title }); return { canceled: false, filePaths: [file] };
    };
    dialog.showSaveDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters)), state = globalThis.__trackManagementFixture;
      if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true }; }
      const file = state.save; state.save = null; state.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file };
    };
  });
}
async function finishSession(force = false) {
  if (!desktop) return;
  session.dialogFixture = await desktop.evaluate(() => globalThis.__trackManagementFixture).catch(() => null);
  try {
    if (!force) {
      assert(!(await page.title()).startsWith('●')); assert.equal(session.dialogFixture.open, null); assert.equal(session.dialogFixture.save, null); assert.deepEqual(session.dialogFixture.unexpected, []);
      assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'open').length, 1); assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'save').length, session.index === 1 ? 7 : 1);
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
  report.images = [await reference(executable), await reference(appAsar)]; report.source = await reference(sourceFile); assert.equal(report.source.sha256, '6658465ff12477909eb2f640fefe2eaae7faf9cda8baef33a5f85ce8e95eeb61', 'Independent input identity');
  const source = await rawArchive(sourceFile); baseline = source.project; entries = source.entries;
  assert.deepEqual(baseline.tracks.map(t => t.id), ['track-a', 'track-b', 'track-c', 'track-d', 'track-e']); assert.equal(baseline.tracks[0].midiChannel, undefined); assert.equal(baseline.tracks[1].midiChannel, undefined); assert(baseline.tracks[1].locked);
  // Independently literal full answers, not product track-management calls.
  down = structuredClone(baseline); down.tracks = [{ ...down.tracks[1], midiChannel: 1 }, { ...down.tracks[0], midiChannel: 0 }, down.tracks[2], down.tracks[3], down.tracks[4]];
  deleted = structuredClone(baseline); deleted.tracks = [{ ...deleted.tracks[1], midiChannel: 1 }, deleted.tracks[2], { ...deleted.tracks[3], midiChannel: 3 }, deleted.tracks[4]]; deleted.regions = deleted.regions.slice(1);
  // C still uses the A/C shared source, so no source/asset/MIDI bucket is removed.
  assert.equal(deleted.patterns.length, 4); assert.equal(deleted.regions[1].patternId, 'pattern-shared');
  for (const [name, project] of Object.entries({ source: baseline, 'a-down': down, 'a-deleted': deleted })) {
    const file = path.join(root, 'expected-' + name + '.nbsx'); await writeFile(file, zipSync({ ...entries, 'project.json': strToU8(JSON.stringify(project)) }, { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') }));
    await writeFile(path.join(root, 'expected-' + name + '.json'), JSON.stringify(project, null, 2) + '\n'); (report.expected ??= {})[name] = await reference(file);
  }
  for (const file of ['scripts/smoke-track-management-desktop.mjs', 'src/ui/App.tsx', 'src/ui/Arrangement.tsx', 'src/ui/Mixer.tsx', 'src/core/track-management.ts', 'src/core/types.ts', 'src/core/project.ts', 'src/core/container.ts', 'src/core/editor-selection.ts', 'src/core/midi-export.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json', 'package-lock.json']) report.sources[file] = await sha256(file);
  const packageBytes = extractFile(appAsar, 'package.json'); assert.equal(JSON.parse(packageBytes).version, expectedVersion); report.packagedPackageSha256 = digest(packageBytes);
  const htmlFile = path.join('dist', 'index.html'), html = extractFile(appAsar, htmlFile), renderer = [...html.toString().matchAll(/(?:src|href)="(?:\.\/)?([^"?#]+\.(?:js|css))"/g)].map(match => path.join('dist', match[1])); assert(renderer.some(file => file.endsWith('.js')));
  for (const file of [htmlFile, ...renderer, path.join('dist-electron', 'main.cjs'), path.join('dist-electron', 'preload.cjs')]) { const pack = extractFile(appAsar, file), built = await readFile(file); assert.equal(digest(pack), digest(built), 'Packaged/current built entry ' + file); report.bundleIdentity[file.replaceAll('\\', '/')] = { bytes: pack.length, packagedSha256: digest(pack), currentBuiltSha256: digest(built) }; }
  await launch(); await open(sourceFile, baseline, 'track-a', 'region-a'); await save('baseline-saved', baseline, 'track-a', 'region-a');
  await menu('track-down'); await save('a-down', down, 'track-a', 'region-a'); await screenshot('a-down');
  await menu('undo'); await save('down-undone', baseline, 'track-a', 'region-a');
  await menu('redo'); await save('down-redone', down, 'track-a', 'region-a');
  await menu('undo'); await inspect('restore-source-before-delete', baseline, 'track-a', 'region-a');
  await menu('delete-track'); await save('a-deleted', deleted, 'track-b', 'region-b');
  await menu('undo'); await save('delete-undone', baseline, 'track-a', 'region-a');
  await menu('redo'); const lastFile = await save('delete-redone', deleted, 'track-b', 'region-b'); await screenshot('delete-redone'); await finishSession();
  await launch(); await open(lastFile, deleted, 'track-b', 'region-b'); await save('restart-resaved', deleted, 'track-b', 'region-b'); await screenshot('restart-resaved'); await finishSession();
  assert.equal(sessions.length, 2); assert.equal(readbacks.length, 8); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
  assert.deepEqual(await reference(sourceFile), report.source); for (const image of report.images) assert.equal(await sha256(path.resolve(image.path)), image.sha256); for (const [file, hash] of Object.entries(report.sources)) assert.equal(await sha256(file), hash, 'Source changed during acceptance: ' + file);
  report.status = 'passed'; report.applicationRestarted = true; report.completeSavedZipReadbacks = readbacks.length; report.terminalComplete = processes.every(record => record.exitCode === 0 && record.signal === null && record.browserExited);
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); } await finishSession(true).catch(error => { report.cleanupError = String(error); }); process.exitCode = 1;
} finally { await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, expectedVersion, sessions: sessions.length, completeSavedZipReadbacks: readbacks.length, report: reportFile, sha256: await sha256(reportFile), terminal: processes })); }
