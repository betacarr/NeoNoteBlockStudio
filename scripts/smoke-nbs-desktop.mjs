import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const prepareOnly = process.argv.includes('--prepare-only');
assert(prepareOnly || argument('--packaged'), 'Pass --packaged <unpacked executable> or --prepare-only.');
const packaged = argument('--packaged') ? path.resolve(argument('--packaged')) : undefined;
if (packaged) assert(!/portable\.exe$/i.test(packaged), 'Use the unpacked executable, not the portable SFX launcher.');
const base = path.resolve('.local/nbs-desktop'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile'); await mkdir(profile);
const sha256 = async file => { const hash = createHash('sha256'); for await (const part of createReadStream(file)) hash.update(part); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: await sha256(file) });
const helper = path.join(root, 'fixture-helper.mjs');
// Inputs come only from the independent specification encoder. The product
// container reader is used solely to inspect files saved by the running app.
await build({ stdin: { contents: "export {nbsFixture} from './tests/fixtures/nbs-interop.ts'; export {openNbsx} from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'nbs-desktop-fixture.ts' }, outfile: helper, bundle: true, platform: 'node', format: 'esm' });
const { nbsFixture, openNbsx } = await import(pathToFileURL(helper).href);
const ordinary = [0, 4, 8].map(tick => ({ tick, instrument: 0 }));
const definitions = [
  { key: 'convertible', name: 'NBS convertible tempo', layers: [{ solo: true }, { locked: true }], events: [{ layer: 1, detune: -300, velocity: 0 }] },
  { key: 'zero', name: 'NBS zero must reject', layers: [{}, {}], events: [{ layer: 1, detune: 0 }], errorParts: ['tick 4', '0 BPM', '零速度'] },
  { key: 'high', name: 'NBS high must reject', layers: [{}, {}], events: [{ layer: 1, detune: 12000 }], errorParts: ['tick 4', '12000', '10000'] },
  { key: 'zero-then-valid', name: 'NBS zero overwritten', layers: [{}, {}, { locked: true }], events: [{ layer: 1, detune: 0 }, { layer: 2, detune: 300 }] },
  { key: 'high-then-valid', name: 'NBS high overwritten', layers: [{}, {}, { locked: true }], events: [{ layer: 1, detune: 12000 }, { layer: 2, detune: -300 }] },
];
const fixtures = [];
for (const definition of definitions) {
  const options = { version: 5, builtinCount: 16, name: definition.name, tempo: 10, layers: definition.layers, custom: [{ name: 'Tempo Changer', soundFile: '' }], notes: [...ordinary, ...definition.events.map(event => ({ tick: 4, instrument: 16, ...event }))] };
  const file = path.join(root, `${definition.key}.nbs`); await writeFile(file, nbsFixture(options));
  fixtures.push({ ...definition, options, file, reference: await reference(file) });
}
const fixtureReport = { schema: 1, status: 'prepared', root, profile, scope: 'Independent NBS binary fixtures prepared; no application launched.', helper: await reference(helper), fixtures, encoder: await reference('tests/fixtures/nbs-interop.ts'), script: await reference('scripts/smoke-nbs-desktop.mjs') };
await writeFile(path.join(root, 'fixtures.json'), JSON.stringify(fixtureReport, null, 2) + '\n');
if (prepareOnly) {
  console.log(JSON.stringify({ status: 'prepared', root, fixtureCount: fixtures.length, report: path.join(root, 'fixtures.json'), applicationLaunched: false }));
} else {
  const expectedVersion = argument('--expected-version') ?? JSON.parse(await readFile('package.json', 'utf8')).version;
  const sources = ['src/core/nbs.ts', 'src/core/container.ts', 'src/core/project.ts', 'src/core/time.ts', 'src/ui/App.tsx', 'electron/main.ts', 'tests/fixtures/nbs-interop.ts', 'scripts/smoke-nbs-desktop.mjs'];
  const implementationSha256 = Object.fromEntries(await Promise.all(sources.map(async file => [file, await sha256(file)])));
  const appAsar = process.platform === 'darwin' ? path.resolve(path.dirname(packaged), '../Resources/app.asar') : path.join(path.dirname(packaged), 'resources', 'app.asar');
  const images = [await reference(packaged), await reference(appAsar)];
  const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
  let desktop, page, applicationVersion;
  const rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], observations = [], savedFiles = [];
  const reportFile = path.join(root, 'report.json');
  const command = name => desktop.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu', name), name);
  const readDom = () => page.evaluate(() => ({ title: document.title, message: document.querySelector('.status-message')?.textContent ?? '', position: document.querySelector('[data-testid=transport-position]')?.textContent ?? '', bpm: Number(document.querySelector('[aria-label="当前位置速度 BPM"]')?.value), regionCount: document.querySelectorAll('[data-testid=region]').length, footerCounts: [...(document.querySelector('.status-bar')?.querySelectorAll('span') ?? [])].map(element => element.textContent).find(text => /轨.*音符/.test(text ?? '')) ?? '' }));
  const identityDom = dom => ({ title: dom.title, position: dom.position, bpm: dom.bpm, regionCount: dom.regionCount, footerCounts: dom.footerCounts });
  const comparable = project => { const copy = structuredClone(project); delete copy.modifiedAt; return copy; };
  async function open(file) {
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await command('open');
  }
  async function saveAs(filename) {
    const file = path.join(root, filename);
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    await command('save-as');
    await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('已保存') && !document.title.startsWith('● '));
    const bytes = new Uint8Array(await readFile(file)), project = openNbsx(bytes); savedFiles.push(await reference(file));
    return { file, project };
  }
  function assertConverted(project, fixture) {
    assert.equal(project.name, fixture.name); assert.equal(project.provenance?.kind, 'nbs');
    assert.deepEqual(project.tempos, [{ tick: 0, bpm: 150 }, { tick: 960, bpm: 300 }]);
    assert.deepEqual(project.patterns.flatMap(pattern => pattern.notes.map(note => note.tick)).sort((a, b) => a - b), [0, 960, 1920]);
    assert.equal(project.tracks.length, fixture.layers.length);
    assert.equal(project.provenance.metadata.functionalEvents.length, fixture.events.length);
  }
  async function importSaveReopen(fixture) {
    await open(fixture.file);
    await page.waitForFunction(name => document.title === `● ${name} — NeoNBS`, fixture.name);
    const importedDom = await readDom(); assert.equal(importedDom.bpm, 150); assert.equal(importedDom.regionCount, fixture.layers.length);
    const saved = await saveAs(`${fixture.key}-saved.nbsx`); assertConverted(saved.project, fixture);
    await open(saved.file);
    await page.waitForFunction(filename => document.querySelector('.status-message')?.textContent.includes(`已打开 ${filename}`), path.basename(saved.file));
    const reopenedDom = await readDom(); assert.equal(reopenedDom.title, `${fixture.name} — NeoNBS`); assert.equal(reopenedDom.bpm, 150); assert.equal(reopenedDom.regionCount, fixture.layers.length);
    observations.push({ case: fixture.key, status: 'passed', importDom: importedDom, reopenDom: reopenedDom, saved: await reference(saved.file), preservedTempoMap: saved.project.tempos, preservedOrdinaryTicks: [0, 960, 1920], functionalEventsInProvenance: fixture.events.length });
    return saved;
  }
  try {
    desktop = await electron.launch({ executablePath: packaged, args: ['--mute-audio', `--user-data-dir=${profile}`], env });
    page = await desktop.firstWindow();
    page.on('pageerror', error => rendererErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => { unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
    assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
    applicationVersion = await desktop.evaluate(({ app }) => app.getVersion()); assert.equal(applicationVersion, expectedVersion);
    // Wait for the actual startup resource discovery to finish, avoiding a late
    // bootstrap status message hiding a subsequent import error. No audio test.
    await page.waitForFunction(() => {
      const message = document.querySelector('.status-message')?.textContent ?? '';
      return document.querySelector('[aria-label="当前位置速度 BPM"]') && (document.querySelectorAll('.sample-dot.loaded').length >= 16 || /未找到|没有找到|加载失败|资源.*失败/.test(message));
    }, undefined, { timeout: 60000 });
    assert.equal(await page.getByRole('dialog').count(), 0, 'Fresh isolated profile must not start inside a recovery modal');
    const first = await importSaveReopen(fixtures.find(fixture => fixture.key === 'convertible'));
    const baselineDom = identityDom(await readDom());
    await page.screenshot({ path: path.join(root, 'convertible-reopened.png') });
    for (const fixture of fixtures.filter(fixture => fixture.errorParts)) {
      await open(fixture.file);
      await page.waitForFunction(parts => parts.every(part => document.querySelector('.status-message')?.textContent.includes(part)), fixture.errorParts);
      const rejectedDom = await readDom(); assert.deepEqual(identityDom(rejectedDom), baselineDom, 'Failed import must retain the visible original project');
      await page.screenshot({ path: path.join(root, `${fixture.key}-rejected.png`) });
      const retained = await saveAs(`retained-after-${fixture.key}.nbsx`);
      assert.deepEqual(comparable(retained.project), comparable(first.project), 'Failed import must retain all serializable project data, including identity and provenance');
      observations.push({ case: fixture.key, status: 'passed', rejectedDom, expectedErrorParts: fixture.errorParts, previousProjectRetained: true, retainedProject: await reference(retained.file) });
    }
    for (const fixture of fixtures.filter(fixture => fixture.key.endsWith('-then-valid'))) await importSaveReopen(fixture);
    assert.deepEqual(rendererErrors, []); assert.deepEqual(unexpectedDialogs, []);
    for (const [file, hash] of Object.entries(implementationSha256)) assert.equal(await sha256(file), hash, `Source changed during smoke: ${file}`);
    const report = { schema: 1, status: 'passed', packaged: true, applicationVersion, platform: process.platform, arch: process.arch, root, profile, fixtures: await reference(path.join(root, 'fixtures.json')), images, implementationSha256, successfulNbsImports: 3, rejectedNbsImports: 2, nbsxSaveReadbacks: savedFiles.length, nbsxUiReopens: 3, observations, savedFiles, rendererErrors, consoleErrors, unexpectedDialogs, scope: 'Actual packaged Electron renderer, existing menu IPC commands and native file-dialog return fixtures; DOM inspection and real saved NBSX readback. No synthetic mouse/keyboard input, no renderer state injection, and no audio/PCM or original GameMaker runtime claim.' };
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, applicationVersion, successfulNbsImports: report.successfulNbsImports, rejectedNbsImports: report.rejectedNbsImports, nbsxSaveReadbacks: report.nbsxSaveReadbacks, nbsxUiReopens: report.nbsxUiReopens, report: reportFile }));
  } catch (error) {
    const failure = { schema: 1, status: 'failed', packaged: true, applicationVersion, root, profile, error: String(error), dom: page ? await readDom().catch(() => null) : null, rendererErrors, consoleErrors, unexpectedDialogs, observations, images, implementationSha256 };
    await writeFile(reportFile, JSON.stringify(failure, null, 2) + '\n');
    await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ status: 'failed', error: String(error), report: reportFile })); throw error;
  } finally {
    await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await desktop?.close().catch(() => {});
  }
}
