import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// Native production menu/preload/file flow and read-only DOM checks. The FLP
// confirmation itself is deliberately left to real UI testing. Supply its saved
// NBSX with --project; this harness does not inject a conversion or click buttons.
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const executable = path.resolve(argument('--packaged') ?? ''), source = path.resolve(argument('--source') ?? ''), projectFile = path.resolve(argument('--project') ?? '');
assert(argument('--packaged') && argument('--source') && argument('--project'), 'Use --packaged <unpacked exe> --source <FLP> --project <NBSX saved after real UI import>.');
assert(!/portable\.exe$/i.test(executable));
const expectedVersion = argument('--expected-version') ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const root = path.resolve('.local/flp-desktop', 'run-' + Date.now()); await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ref = async filename => ({ path: path.relative(process.cwd(), filename).replaceAll('\\', '/'), bytes: (await stat(filename)).size, sha256: hash(await readFile(filename)) });
const helper = path.join(root, 'container.mjs');
await build({ stdin: { contents: "export {openNbsx,base64ToBytes} from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'flp-desktop-readback.ts' }, outfile: helper, bundle: true, platform: 'node', format: 'esm' });
const { openNbsx, base64ToBytes } = await import(pathToFileURL(helper).href);
const expected = openNbsx(new Uint8Array(await readFile(projectFile))), sourceBytes = new Uint8Array(await readFile(source));
assert.equal(expected.provenance?.kind, 'flp'); assert.equal(expected.provenance.metadata.sha256, hash(sourceBytes));
assert.deepEqual(base64ToBytes(expected.assets.find(asset => asset.id === expected.provenance.metadata.sourceAssetId).data), sourceBytes);
const normalize = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const report = { schema: 1, status: 'running', expectedVersion, root, scope: 'Packaged native Open -> real FLP review and desktop sample SHA checks; independent process opens/saves/reopens the actual development-browser import result with complete NBSX comparison.',
  limitations: ['No packaged FLP-confirmation click or physical input is synthesized.', 'Native chooser return paths are test fixtures; menus/preload/parsers remain production code.', 'Portable-save additions are explicitly constructed from local Minecraft 1.16 asset-index hashes and object bytes before comparison; only modifiedAt is ignored afterward.', 'No acoustic, plugin, automation, game-world or macOS equivalence claim.'],
  source: await ref(source), project: await ref(projectFile), images: [await ref(executable), await ref(path.join(path.dirname(executable), 'resources', 'app.asar'))], sessions: [], errors: [], readbacks: [] };
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
let desktop, page;
async function includePortableSamples() {
  assert.equal(expected.audio.profileId, 'java-1.16.5', 'This portable fixture check requires the declared 1.16.5 profile.');
  const roots = await page.evaluate(() => window.desktop.discoverMinecraft()); // Read-only native discovery API.
  const starts = [];
  for (const [order, region] of expected.regions.entries()) {
    assert.equal(region.loop, false, 'This fixture uses independent non-looping FLP copies.');
    const track = expected.tracks.find(track => track.id === region.trackId), pattern = expected.patterns.find(pattern => pattern.id === region.patternId);
    for (const note of pattern.notes) if (note.tick >= region.offset && note.tick < region.offset + region.length) starts.push({ tick: region.start + note.tick - region.offset, midi: note.midi, order, instrumentId: note.instrumentId ?? track.instrumentId });
  }
  starts.sort((left, right) => left.tick - right.tick || left.midi - right.midi || left.order - right.order);
  const used = new Set(starts.map(note => note.instrumentId)); report.portableSamples = [];
  for (const id of used) {
    const instrument = expected.instruments.find(instrument => instrument.id === id); if (instrument.assetId) continue;
    let found;
    for (const location of roots) {
      if (!location.indexes.includes('1.16.json')) continue;
      const index = JSON.parse(await readFile(path.join(location.root, 'assets', 'indexes', '1.16.json'), 'utf8'));
      const definition = index.objects['minecraft/sounds.json']; assert(definition);
      const definitionBytes = await readFile(path.join(location.root, 'assets', 'objects', definition.hash.slice(0, 2), definition.hash));
      assert.equal(createHash('sha1').update(definitionBytes).digest('hex'), definition.hash);
      const event = JSON.parse(definitionBytes.toString('utf8'))['block.note_block.' + id];
      assert.equal(event?.sounds?.length, 1, 'Fixture requires one sound entry.');
      const entry = event.sounds[0]; assert(typeof entry === 'string' || !entry.type || entry.type === 'sound');
      const soundName = typeof entry === 'string' ? entry : entry.name;
      const object = index.objects['minecraft/sounds/' + soundName + '.ogg']; if (!object) continue;
      const bytes = await readFile(path.join(location.root, 'assets', 'objects', object.hash.slice(0, 2), object.hash));
      assert.equal(createHash('sha1').update(bytes).digest('hex'), object.hash); found = { bytes, sha1: object.hash }; break;
    }
    assert(found, 'Canonical local 1.16 sample not available: ' + id);
    const assetId = 'sample-' + id; instrument.assetId = assetId;
    expected.assets.push({ id: assetId, name: id + '.ogg', mime: 'audio/ogg', data: Buffer.from(found.bytes).toString('base64'), sha1: found.sha1 });
    report.portableSamples.push({ instrumentId: id, assetId, sha1: found.sha1, bytes: found.bytes.length });
  }
}
const command = async label => desktop.evaluate(({ Menu }, label) => {
  const file = Menu.getApplicationMenu().items.find(item => item.label === '文件'), item = file?.submenu?.items.find(item => item.label === label);
  if (!item?.click || item.enabled === false) throw new Error('Native file menu command unavailable: ' + label);
  item.click(item, undefined, {});
}, label);
async function launch(index) {
  const profile = path.join(root, 'profile-' + index); await mkdir(profile, { recursive: true });
  desktop = await electron.launch({ executablePath: executable, args: ['--mute-audio', '--user-data-dir=' + profile], env: environment });
  const identity = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') }));
  assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(identity.userData, profile);
  page = await desktop.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 });
  await desktop.evaluate(({ dialog }) => {
    globalThis.__flpFileFixture = { open: null, save: null, filters: null };
    dialog.showOpenDialog = async (...args) => { const state = globalThis.__flpFileFixture, options = args.find(arg => Array.isArray(arg?.properties)); state.filters = options?.filters; const file = state.open; state.open = null; return file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] }; };
    dialog.showSaveDialog = async () => { const state = globalThis.__flpFileFixture, filePath = state.save; state.save = null; return filePath ? { canceled: false, filePath } : { canceled: true }; };
  });
  report.sessions.push({ index, ...identity });
}
async function open(filename) {
  await desktop.evaluate((_, filename) => { globalThis.__flpFileFixture.open = filename; }, filename); await command('打开 / 导入…');
}
async function save(label) {
  const filename = path.join(root, label + '.nbsx');
  await desktop.evaluate((_, filename) => { globalThis.__flpFileFixture.save = filename; }, filename); await command('另存为…');
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('已保存'), undefined, { timeout: 30000 });
  assert.deepEqual(normalize(openNbsx(new Uint8Array(await readFile(filename)))), normalize(expected));
  report.readbacks.push({ file: await ref(filename), fullProjectEqual: true, originalFlpEqual: true }); return filename;
}
try {
  await launch(1); const originalTitle = await page.title(); await open(source);
  await page.waitForFunction(() => !!document.querySelector('.flp-import-dialog .flp-import-summary'), undefined, { timeout: 30000 });
  const review = await page.evaluate(() => ({ title: document.title, summary: document.querySelector('.flp-import-summary').textContent,
    selected: [...document.querySelectorAll('.flp-import-channel')].filter(row => row.querySelector('input[aria-label^="导入声道"]')?.checked).map(row => ({ id: Number(row.dataset.channelId), verified: row.querySelector('.flp-channel-status')?.textContent.includes('已按哈希核对'), baseline: row.querySelector('input[type="number"]')?.value })),
    confirmDisabled: document.querySelector('.flp-import-actions .primary').disabled }));
  assert.equal(review.title, originalTitle); assert.equal(review.selected.length, expected.tracks.length); assert(review.selected.every(row => row.verified && row.baseline === '66')); assert.equal(review.confirmDisabled, true);
  const filters = await desktop.evaluate(() => globalThis.__flpFileFixture.filters); assert(filters.some(filter => filter.extensions.includes('flp')));
  report.review = review; await page.screenshot({ path: path.join(root, 'packaged-review.png') }); await desktop.close(); desktop = undefined;
  await launch(2); await open(projectFile);
  await page.waitForFunction(name => document.title.startsWith(name) && !document.querySelector('[role="dialog"]'), expected.name, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.resource-card strong')?.textContent.includes('1.16.5 资源已载入'), undefined, { timeout: 90000 });
  await includePortableSamples();
  const saved = await save('saved'); await desktop.close(); desktop = undefined;
  await launch(3); await open(saved); await page.waitForFunction(name => document.title.startsWith(name), expected.name, { timeout: 60000 });
  await save('saved-after-restart'); await desktop.close(); desktop = undefined;
  assert.equal(hash(await readFile(source)), report.source.sha256); assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally { if (desktop) await desktop.close().catch(() => {}); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, report: path.join(root, 'report.json'), readbacks: report.readbacks.length, error: report.error })); }
