import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Actual packaged renderer + native menu handlers. Game discovery is controlled
// to return no installations; HTTP(S), game-resource loads and native rendering
// are denied. Renderer access is read-only. Peaks are software output evidence,
// not a claim about physical speakers or the reporter's unknown configuration.
const arg = name => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--packaged'), '--packaged EXE required');
const executable = path.resolve(arg('--packaged')), missing = process.argv.includes('--expect-missing');
assert(!/(?:setup|portable)\.exe$/i.test(executable), 'Use the unpacked app executable');
const base = path.resolve('.local/preview-desktop'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, missing ? 'baseline-' : 'packaged-')), profile = path.join(root, 'profile');
await mkdir(profile);
const helper = path.join(root, 'fixture.mjs');
await build({ stdin: { contents: "export {createProject,newTrack,newNote} from './src/core/project';export {saveNbsx} from './src/core/container';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: helper });
const { createProject, newTrack, newNote, saveNbsx } = await import(pathToFileURL(helper).href);
const project = createProject('默认音色离线检查'); project.tracks = []; project.patterns = []; project.regions = [];
project.audio.mode = 'studio'; project.audio.masterGain = .5;
for (const [index, instrument] of project.instruments.entries()) {
  const track = newTrack(`Sample ${index + 1} ${instrument.id}`, index, instrument.id); track.volume = .1;
  const pattern = { id: `sample-pattern-${index}`, name: instrument.id, length: project.ppq * 4, notes: Array.from({ length: 8 }, (_, n) => newNote(n * project.ppq / 2, 66)) };
  project.tracks.push(track); project.patterns.push(pattern); project.regions.push({ id: `sample-region-${index}`, trackId: track.id, patternId: pattern.id, start: 0, length: pattern.length, offset: 0, loop: false });
}
assert.deepEqual(project.tracks.map(track => track.instrumentId), project.instruments.map(instrument => instrument.id));
const fixture = path.join(root, 'preview.nbsx'); await writeFile(fixture, saveNbsx(project));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const report = { status: 'running', expectedMissing: missing, profile, instruments: project.tracks.map(track => track.instrumentId), rendererErrors: [], trackPeaks: {}, masterPeak: 0 };
let desktop;
try {
  desktop = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`, '--mute-audio'], env, timeout: 60000 });
  const page = await desktop.firstWindow(); page.on('pageerror', error => report.rendererErrors.push(error.message));
  const reloaded = page.waitForEvent('domcontentloaded');
  await desktop.evaluate(({ app, ipcMain, session, BrowserWindow }) => {
    const state = globalThis.__previewFixture = { discovery: 0, gameLoads: 0, nativeRenders: 0, network: [] };
    for (const channel of ['minecraft:discover', 'minecraft:load', 'audio:render']) ipcMain.removeHandler(channel);
    ipcMain.handle('minecraft:discover', () => { state.discovery++; return []; });
    ipcMain.handle('minecraft:load', () => { state.gameLoads++; throw new Error('No Minecraft resources in this fixture'); });
    ipcMain.handle('audio:render', () => { state.nativeRenders++; throw new Error('No native renderer in this fixture'); });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => { state.network.push(request.url); done({ cancel: true }); });
    app.setName('NeoNBS'); BrowserWindow.getAllWindows()[0].webContents.reload();
  });
  await reloaded;
  await page.waitForFunction(() => !!document.querySelector('.piano-viewport canvas'));
  if (!missing) await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length === 20);
  await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, fixture);
  const menu = async (group, label) => desktop.evaluate(({ Menu }, labels) => {
    const item = Menu.getApplicationMenu()?.items.find(item => item.label.replaceAll('&', '') === labels[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === labels[1]);
    if (!item?.enabled || typeof item.click !== 'function') throw new Error('Native menu unavailable: ' + labels.join('/'));
    item.click();
  }, [group, label]);
  await menu('文件', '打开 / 导入…'); await page.waitForFunction(() => document.title.includes('默认音色离线检查'));
  await menu('视图', '混音器'); await page.waitForFunction(() => !!document.querySelector('.mixer-strip'));
  report.loadedSamples = await page.locator('.sample-dot.loaded').count();
  await menu('播放', '播放 / 暂停');
  if (missing) {
    await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('缺少采样'));
    assert.equal(report.loadedSamples, 0);
    report.status = 'reproduced-missing-samples';
  } else {
    await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('实时试听'));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const meters = await page.evaluate(() => [...document.querySelectorAll('.mixer-meter[role="meter"]')].map(node => ({ label: node.getAttribute('aria-label'), peak: Number(node.getAttribute('aria-valuenow')) })));
      for (const meter of meters) {
        if (meter.label === '总输出电平') report.masterPeak = Math.max(report.masterPeak, meter.peak);
        else report.trackPeaks[meter.label] = Math.max(report.trackPeaks[meter.label] ?? 0, meter.peak);
      }
      if (Object.values(report.trackPeaks).filter(value => value > 0).length === 20 && report.masterPeak > 0) break;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    assert.equal(Object.values(report.trackPeaks).filter(value => value > 0).length, 20, 'Every shipped instrument must generate a positive track signal');
    assert(report.masterPeak > 0, 'Actual master output must carry signal');
    report.status = 'passed'; await menu('播放', '播放 / 暂停');
  }
  report.message = await page.locator('.status-message').textContent();
  report.boundaries = await desktop.evaluate(() => globalThis.__previewFixture);
  report.runtime = await desktop.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData') }));
  assert(report.runtime.packaged); assert.equal(path.resolve(report.runtime.userData), profile);
  assert.equal(report.boundaries.gameLoads, 0); assert.equal(report.boundaries.nativeRenders, 0); assert.deepEqual(report.boundaries.network, []); assert.deepEqual(report.rendererErrors, []);
  await page.screenshot({ path: path.join(root, 'output-proof.png') });
} catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  if (desktop) { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
  console.log(JSON.stringify({ status: report.status, version: report.runtime?.version, loadedSamples: report.loadedSamples, positiveTrackPeaks: Object.values(report.trackPeaks).filter(value => value > 0).length, masterPeak: report.masterPeak, report: path.relative(process.cwd(), path.join(root, 'report.json')) }));
}
