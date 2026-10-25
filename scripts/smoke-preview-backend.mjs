import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Real original resources with deliberately absent native archives. Only dialog
// fixtures and normal menu IPC drive the app; audio observers preserve arguments.
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const packagedOption = option('--packaged');
if (process.argv.includes('--packaged')) assert(packagedOption && !packagedOption.startsWith('--'));
const packaged = packagedOption ? path.resolve(packagedOption) : undefined;
if (packaged) { assert(!/(portable|setup)\.exe$/i.test(packaged)); assert((await stat(path.join(path.dirname(packaged), 'resources/app.asar'))).isFile()); }
const root = path.resolve('.local/preview-backend', `run-${Date.now()}`), profile = path.join(root, 'profile'); await mkdir(profile, { recursive: true });
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
await build({ stdin: { contents: "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx} from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'preview-policy-fixture.ts' }, outfile: path.join(root, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createProject, newNote, saveNbsx, openNbsx } = await import(pathToFileURL(path.join(root, 'helper.mjs')).href);
const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const app = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env });
const errors = [], report = { schema: 1, packaged: !!packaged, root, synthesizedInput: false, mockedAudioResults: false, rendererErrors: errors, status: 'starting' };
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  report.application = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') }));
  assert.equal(report.application.packaged, !!packaged); assert.equal(report.application.userData, profile);
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  const roots = await page.evaluate(() => window.desktop.discoverMinecraft());
  const candidates = ['1.14.3', '1.14.2', '1.14.1', '1.13.2', '1.13.1'];
  const version = candidates.find(version => roots.every(location => location.versions.every(item => item !== version && !item.startsWith(`${version}-`))));
  assert(version, 'No isolated historical fixture version: refuse to hide or replace real resource locations');
  const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
  const missing = path.join(root, 'minecraft-without-native'), gameVersion = path.join(missing, 'versions', version);
  await Promise.all([mkdir(gameVersion, { recursive: true }), mkdir(path.join(missing, 'assets', 'indexes'), { recursive: true }), mkdir(path.join(missing, 'libraries'), { recursive: true })]);
  const client = await readFile(path.join(fixture.root, 'versions', version, `${version}.jar`)); assert.equal(sha(client, 'sha1'), metadata.downloads.client.sha1);
  await writeFile(path.join(gameVersion, `${version}.jar`), client);
  await copyFile(path.join(fixture.root, 'versions', version, `${version}.json`), path.join(gameVersion, `${version}.json`));
  const indexBytes = await readFile(path.join(fixture.root, 'assets', 'indexes', `${metadata.assetIndex.id}.json`)); assert.equal(sha(indexBytes, 'sha1'), metadata.assetIndex.sha1);
  await writeFile(path.join(missing, 'assets', 'indexes', `${metadata.assetIndex.id}.json`), indexBytes);
  const index = JSON.parse(indexBytes), samplePaths = new Set(Object.values(fixture.sounds).map(sound => sound.path));
  const objects = Object.entries(index.objects).filter(([name]) => samplePaths.has(name) || name.endsWith('/sounds.json'));
  for (const [name, object] of objects) {
    const bytes = await readFile(path.join(fixture.root, 'assets', 'objects', object.hash.slice(0, 2), object.hash)); assert.equal(sha(bytes, 'sha1'), object.hash, name);
    const destination = path.join(missing, 'assets', 'objects', object.hash.slice(0, 2)); await mkdir(destination, { recursive: true }); await writeFile(path.join(destination, object.hash), bytes);
  }
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, missing);
  await page.evaluate(() => window.desktop.selectMinecraftRoot());
  await page.addInitScript(() => {
    window.__previewStarts = 0;
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) { const source = original.apply(this, args), start = source.start; source.start = function (...values) { window.__previewStarts++; return start.apply(this, values); }; return source; };
  });
  await app.evaluate(({ utilityProcess }) => {
    globalThis.__previewWorkers = 0; const fork = utilityProcess.fork;
    utilityProcess.fork = function (...args) { if (/[\\/]audio-worker\.cjs$/.test(String(args[0]))) globalThis.__previewWorkers++; return Reflect.apply(fork, this, args); };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  const project = createProject('原生试听缺库检查'); project.audio.profileId = `java-${version}`; project.audio.previewEngine = 'native'; project.patterns[0].notes = [newNote(0, 66)];
  const nativeFile = path.join(root, 'native.nbsx'), webFile = path.join(root, 'web.nbsx'), savedFile = path.join(root, 'saved-native.nbsx');
  await writeFile(nativeFile, saveNbsx(project)); const web = structuredClone(project); web.name = '明确选择近似试听'; web.audio.previewEngine = 'web'; await writeFile(webFile, saveNbsx(web));
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu', name), name);
  const open = async (filename, name) => { await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename); await command('open'); await page.waitForFunction(name => document.title.startsWith(name), name); };
  await open(nativeFile, project.name);
  await page.waitForFunction(({ version, count }) => document.querySelector('.resource-card').textContent.includes(version) && document.querySelectorAll('.sample-dot.loaded').length === count, { version, count: Object.keys(fixture.sounds).length });
  report.loadedResourceStatus = await page.locator('.status-message').innerText(); assert(report.loadedResourceStatus.includes('声音库'));
  await command('play'); await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('当前资源没有适用于此应用的原生声音库'));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('button[aria-label="暂停"]').count(), 0); assert.equal(await page.locator('[data-testid=transport-position]').innerText(), '1.1.00');
  assert.equal(await page.evaluate(() => window.__previewStarts), 0); assert.equal(await app.evaluate(() => globalThis.__previewWorkers), 0);
  report.nativeRejectedMessage = await page.locator('.status-message').innerText(); report.nativeRejectedWithoutFallback = true;
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, savedFile); await command('save-as');
  await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('已保存'));
  assert.equal(openNbsx(new Uint8Array(await readFile(savedFile))).audio.previewEngine, 'native'); report.savedPreferenceUnchanged = true;
  await open(webFile, web.name); await command('play'); await page.locator('button[aria-label="暂停"]').waitFor();
  await page.waitForFunction(() => window.__previewStarts > 0 && document.querySelector('[data-testid=transport-position]').textContent !== '1.1.00');
  report.webPlaybackMessage = await page.locator('.status-message').innerText(); assert(report.webPlaybackMessage.includes('Web Audio 快速试听')); await command('stop');
  assert.equal(await app.evaluate(() => globalThis.__previewWorkers), 0); assert.deepEqual(errors, []);
  Object.assign(report, { status: 'passed', version, originalClientSha1: metadata.downloads.client.sha1, resourceObjects: objects.length, explicitlySelectedWebPlayback: true, nativeWorkerRequests: 0, sourceHashes: {} });
  for (const filename of ['src/audio/preview.ts', 'src/ui/App.tsx', 'electron/main.ts', 'scripts/smoke-preview-backend.mjs']) report.sourceHashes[filename] = sha(await readFile(filename));
  await page.screenshot({ path: path.join(root, 'preview-result.png') }); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, version, packaged: !!packaged, report: path.join(root, 'report.json') }));
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); const page = await app.firstWindow().catch(() => undefined); await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error;
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
