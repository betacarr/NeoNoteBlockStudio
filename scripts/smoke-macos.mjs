import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('This smoke test requires macOS.');
const index = process.argv.indexOf('--packaged');
if (index >= 0 && !process.argv[index + 1]) throw new Error('--packaged requires the app executable.');
const executablePath = index >= 0 ? path.resolve(process.argv[index + 1]) : undefined;
const base = path.resolve('.local/macos-smoke'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile');
const helper = path.join(root, 'helper.mjs');
await build({ stdin: { contents: "export { createProject, newNote } from './src/core/project.ts'; export { saveNbsx, openNbsx } from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'macos-helper.ts' }, outfile: helper, bundle: true, platform: 'node', format: 'esm' });
const { createProject, newNote, saveNbsx, openNbsx } = await import(pathToFileURL(helper).href);
const fixture = createProject('macOS 工程验收'); fixture.patterns[0].notes = [newNote(0, 60, 240)];
// Original synthetic tone, embedded only in the isolated test project. No game
// files or external sample library are needed for the playback acceptance.
const frames = 12000, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i / 48000 * 440 * Math.PI * 2) * 4000 * (1 - i / frames)), 44 + i * 2);
fixture.assets.push({ id: 'mac-test-tone', name: 'synthetic-tone.wav', mime: 'audio/wav', data: wav.toString('base64') });
fixture.instruments.find(instrument => instrument.id === 'harp').assetId = 'mac-test-tone';
const source = path.join(root, 'finder-open.nbsx'), saved = path.join(root, 'saved.nbsx');
await writeFile(source, saveNbsx(fixture));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : ['.']), source, '--mute-audio', `--user-data-dir=${profile}`], env, timeout: 120000 });
const errors = [], checks = [];
let page, exited = false;
desktop.on('close', () => { exited = true; });
const record = value => { checks.push(value); console.log(value); };
const observe = async () => {
  page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(60000);
  await page.locator('.piano-viewport canvas').waitFor();
};
const menu = async (group, label) => {
  await desktop.evaluate(({ Menu }, { group, label }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === group)?.submenu?.items.find(item => item.label === label);
    if (!item?.enabled || typeof item.click !== 'function') throw new Error('Menu unavailable: ' + label);
    item.click();
  }, { group, label });
};
const dirty = async () => { await menu('编辑', '独立复制'); await page.waitForFunction(() => document.title.startsWith('● ')); };
const dialog = async (response, canceled = false) => desktop.evaluate(({ dialog }, { response, canceled, saved }) => {
  globalThis.__macSaveDialogCalls = 0;
  dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
  dialog.showSaveDialog = async () => { globalThis.__macSaveDialogCalls++; return { canceled, filePath: canceled ? undefined : saved }; };
}, { response, canceled, saved });
const closeWindow = async () => {
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert.equal(await desktop.evaluate(async ({ BrowserWindow }) => {
    // CDP reports the renderer closed before Cocoa has always finished tearing
    // down its BrowserWindow, especially during Rosetta translation.
    for (let i = 0; i < 100 && BrowserWindow.getAllWindows().length; i++) await new Promise(resolve => setTimeout(resolve, 25));
    return BrowserWindow.getAllWindows().length;
  }), 0);
  assert.equal(exited, false);
};
try {
  await observe(); await page.waitForFunction(() => document.title.includes('macOS 工程验收'));
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), !!executablePath);
  record('startup project and isolated profile');
  assert.equal(await desktop.evaluate(({ app }) => process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('koffi').load('/usr/lib/libSystem.B.dylib').func('int getpid()')()), desktop.process().pid);
  record('native Koffi loads and calls a system library');
  // Loop the short fixture so a cold Rosetta translation cannot finish the
  // entire song between Play and the first UI observation.
  await menu('播放', '循环播放工程');
  await page.getByRole('button', { name: '播放', exact: true }).first().click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.position strong').textContent.includes('1.1.00'));
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await menu('播放', '循环播放工程');
  record('embedded synthetic WAV decodes; realtime transport advances and pauses');
  // Real key events exercise Command translation and avoid matching physical Control.
  await page.locator('.piano-viewport canvas').focus();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+b');
  await page.waitForFunction(() => document.title.startsWith('● '));
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => !document.title.startsWith('● '));
  await page.keyboard.press('Control+b');
  assert.equal((await page.title()).startsWith('● '), false);
  record('Command select-all / duplicate / undo and physical Control isolation');
  await menu('NeoNBS', '设置…'); await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
  record('native Preferences menu');
  await dirty();
  await dialog(1); await desktop.evaluate(({ app }) => app.quit());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  record('cancel Quit preserves the dirty window');
  // Opened files save in place; remove the path by using Save As explicitly to
  // test chooser cancellation without overwriting the fixture.
  await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await menu('文件', '另存为…');
  assert((await page.title()).startsWith('● '));
  await menu('编辑', '撤销'); await page.waitForFunction(() => !document.title.startsWith('● '));
  await menu('文件', '新建工程'); await page.waitForFunction(() => !document.title.includes('macOS 工程验收'));
  await page.locator('.piano-viewport canvas').focus();
  await page.keyboard.press('p'); await page.locator('.piano-viewport canvas').click({ position: { x: 180, y: 200 } });
  await page.waitForFunction(() => document.title.startsWith('● '));
  await dialog(0, true); await desktop.evaluate(({ app }) => app.quit());
  await desktop.evaluate(async () => { for (let i = 0; i < 100 && !globalThis.__macSaveDialogCalls; i++) await new Promise(resolve => setTimeout(resolve, 25)); if (!globalThis.__macSaveDialogCalls) throw new Error('Save chooser was not invoked'); });
  assert.equal(exited, false); assert((await page.title()).startsWith('● '));
  record('cancel Save As during Quit preserves edits');
  await dialog(2); await closeWindow();
  record('close last window keeps the macOS application running');
  await desktop.evaluate(({ app }) => app.emit('activate'));
  await observe(); record('Dock activation recreates the editor');
  // The next event is intentionally sent before the new renderer is ready.
  await desktop.evaluate(({ app }, source) => app.emit('open-file', { preventDefault() {} }, source), source);
  await page.waitForFunction(() => document.title.includes('macOS 工程验收'));
  await closeWindow();
  await desktop.evaluate(({ app }, source) => app.emit('open-file', { preventDefault() {} }, source), source);
  await observe(); await page.waitForFunction(() => document.title.includes('macOS 工程验收'));
  record('Finder open-file recreates a missing window and drains pending files');
  if (executablePath) {
    await closeWindow();
    execFileSync('open', ['-a', path.resolve(path.dirname(executablePath), '../..'), source]);
    await observe(); await page.waitForFunction(() => document.title.includes('macOS 工程验收'));
    record('LaunchServices open -a delivers an actual Finder file-open event');
  }
  await closeWindow();
  await desktop.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, source);
  await menu('文件', '打开 / 导入…'); await observe();
  await page.waitForFunction(() => document.title.includes('macOS 工程验收'));
  record('native menu recreates a missing editor and opens the chosen file');
  await page.screenshot({ path: path.join(root, 'macos-editor.png') });
  await page.locator('.piano-viewport canvas').focus(); await page.keyboard.press('Meta+a');
  await dirty(); await dialog(0);
  const closed = desktop.waitForEvent('close'); await desktop.evaluate(({ app }) => app.quit()); await closed;
  assert.equal(openNbsx(new Uint8Array(await readFile(source))).patterns[0].notes.length, 2);
  record('save-and-Quit writes the edited project and exits');
  assert.deepEqual(errors, []);
  const report = { status: 'passed', packaged: !!executablePath, platform: 'darwin', root, checks, rendererErrors: errors, limitations: ['Dock activation and the initial Finder handler checks use application events; packaged builds additionally use real LaunchServices file opening.', 'Playback checks transport state while muted; audio hardware, hardware MIDI and Minecraft native libraries are not exercised.'] };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  await writeFile(path.join(root, 'report.json'), JSON.stringify({ status: 'failed', root, checks, error: String(error), rendererErrors: errors }, null, 2));
  throw error;
} finally {
  if (!exited) { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
}
