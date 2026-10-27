import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real native menus, preload IPC, local files and packaged renderer. Dialog
// answers are controlled fixtures. No DOM actions or React state injection.
const index = process.argv.indexOf('--packaged'); assert(index >= 0 && process.argv[index + 1], '--packaged EXE required');
const executable = path.resolve(process.argv[index + 1]); assert(!/(?:portable|setup)\.exe$/i.test(executable));
const expectedVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const base = path.resolve('.local/diagnostics-desktop'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'packaged-')), helper = path.join(root, 'fixture.mjs');
await build({ stdin: { contents: "export {createDemo} from './src/core/project';export {saveNbsx} from './src/core/container';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: helper });
const { createDemo, saveNbsx } = await import(pathToFileURL(helper).href);
const project = createDemo(); project.name = 'PRIVATE_PROJECT_SENTINEL'; project.description = 'PRIVATE_DESCRIPTION_SENTINEL';
const projectFile = path.join(root, 'PRIVATE_FILENAME_SENTINEL.nbsx'); await writeFile(projectFile, saveNbsx(project));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const reports = [];
async function until(check) { const end = Date.now() + 10000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Diagnostic fixture timed out'); }
async function run(unwritable) {
  const profile = path.join(root, unwritable ? 'unwritable-profile' : 'normal-profile'); await mkdir(profile);
  if (unwritable) await writeFile(path.join(profile, 'logs'), 'not a log directory');
  let desktop;
  const record = { storageScenario: unwritable ? 'unwritable' : 'normal', status: 'running' }; reports.push(record);
  try {
    desktop = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`, '--mute-audio'], env, timeout: 60000 });
    const page = await desktop.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length === 20);
    await desktop.evaluate(({ dialog, session }) => {
      const state = globalThis.__diagnosticFixture = { accept: false, cancelSave: false, output: '', source: '', prompts: 0, saves: 0, fallbackNotices: 0, network: [] };
      dialog.showMessageBox = async (_parent, options) => {
        options ??= _parent;
        if (options.title === '运行日志') { state.fallbackNotices++; return { response: 0, checkboxChecked: false }; }
        if (options.title !== '导出诊断包') throw new Error('Unexpected fixture dialog');
        state.prompts++; return { response: state.accept ? 1 : 0, checkboxChecked: false };
      };
      dialog.showSaveDialog = async () => { state.saves++; return { canceled: state.cancelSave, filePath: state.output }; };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [state.source] });
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => { state.network.push(request.url); done({ cancel: true }); });
    });
    const menu = (group, label) => desktop.evaluate(({ Menu }, labels) => {
      const item = Menu.getApplicationMenu()?.items.find(item => item.label.replaceAll('&', '') === labels[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === labels[1]);
      assertMenu(item);
      function assertMenu(value) { if (!value?.enabled || typeof value.click !== 'function') throw new Error('Diagnostic native menu unavailable'); value.click(); }
    }, [group, label]);
    const state = () => desktop.evaluate(() => globalThis.__diagnosticFixture);
    const configure = patch => desktop.evaluate((_, patch) => Object.assign(globalThis.__diagnosticFixture, patch), patch);
    const output = path.join(root, unwritable ? 'memory-only.zip' : 'diagnostics.zip'); await configure({ output });
    await menu('帮助', '导出诊断包…'); await until(async () => (await state()).prompts >= 1);
    assert.equal((await state()).saves, 0, 'Cancel before chooser must not write an archive');
    await configure({ accept: true, cancelSave: true }); await menu('帮助', '导出诊断包…'); await until(async () => (await state()).saves >= 1);
    assert.equal(await stat(output).then(() => true, () => false), false);
    await configure({ source: path.join(root, 'PRIVATE_MISSING_SENTINEL.nbsx') }); await menu('文件', '打开 / 导入…');
    await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('ENOENT'));
    await configure({ source: projectFile }); await menu('文件', '打开 / 导入…');
    await page.waitForFunction(() => document.title.includes('PRIVATE_PROJECT_SENTINEL'));
    await menu('播放', '播放 / 暂停'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('实时试听'));
    await menu('视图', '混音器');
    await page.waitForFunction(() => [...document.querySelectorAll('.mixer-meter[role="meter"]')].some(node =>
      node.getAttribute('aria-label') === '总输出电平' && Number(node.getAttribute('aria-valuenow')) > 0));
    await configure({ cancelSave: false }); await menu('帮助', '导出诊断包…'); await until(() => stat(output).then(() => true, () => false));
    const files = unzipSync(await readFile(output)); assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'logs/events.jsonl', 'summary.json']);
    const summary = JSON.parse(strFromU8(files['summary.json'])), entries = strFromU8(files['logs/events.jsonl']).trim().split('\n').map(line => JSON.parse(line));
    const privateHome = await desktop.evaluate(({ app }) => app.getPath('home'));
    const text = Object.values(files).map(bytes => strFromU8(bytes)).join('\n');
    for (const privateValue of [root, profile, privateHome, 'PRIVATE_PROJECT_SENTINEL', 'PRIVATE_DESCRIPTION_SENTINEL', 'PRIVATE_FILENAME_SENTINEL', 'PRIVATE_MISSING_SENTINEL']) assert(!text.includes(privateValue), 'Private fixture content reached diagnostic archive');
    assert.equal(summary.software.version, expectedVersion); assert.equal(summary.logs.storageAvailable, !unwritable); assert.equal(summary.liveSnapshotCaptured, true);
    assert.equal(summary.latestPlayback.loadedSamples, 20); assert.equal(summary.latestPlayback.mode, 'realtime');
    assert.equal(summary.latestPlayback.playing, true);
    for (const event of ['app.started', 'audio.preview.ready', 'audio.play.request', 'audio.play.started', 'audio.output.signal', 'ipc.failed', 'audio.snapshot']) assert(entries.some(entry => entry.event === event), 'Missing actual diagnostic event: ' + event);
    assert.deepEqual((await state()).network, []); assert.deepEqual(errors, []);
    if (!unwritable) {
      const raw = await readFile(path.join(profile, 'logs', 'runtime.log'), 'utf8');
      for (const value of [root, privateHome, 'PRIVATE_MISSING_SENTINEL']) assert(!raw.includes(value), 'Private data was written before export');
      const crashFile = path.join(root, 'renderer-crash.zip');
      await menu('播放', '停止并回到起点');
      const gone = page.waitForEvent('crash'); await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()); await gone;
      await configure({ output: crashFile }); await menu('帮助', '导出诊断包…'); await until(() => stat(crashFile).then(() => true, () => false));
      const crashed = unzipSync(await readFile(crashFile)), crashSummary = JSON.parse(strFromU8(crashed['summary.json']));
      assert.equal(crashSummary.liveSnapshotCaptured, false); assert(strFromU8(crashed['logs/events.jsonl']).includes('window.renderer_gone'));
      record.rendererCrashExport = 'passed';
    }
    else { await menu('帮助', '打开日志文件夹'); await until(async () => (await state()).fallbackNotices === 1); record.logFolderFallback = 'passed'; }
    record.records = entries.length; record.version = summary.software.version; record.storageAvailable = summary.logs.storageAvailable; record.status = 'passed';
  } catch (error) { record.status = 'failed'; record.error = String(error); throw error; }
  finally {
    if (desktop) { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
    await writeFile(path.join(root, 'report.json'), JSON.stringify({ reports }, null, 2));
  }
}
await run(false); await run(true);
console.log(JSON.stringify({ status: 'passed', reports, report: path.relative(process.cwd(), path.join(root, 'report.json')) }));
