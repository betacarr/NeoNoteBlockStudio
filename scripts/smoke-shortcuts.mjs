import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Desktop IPC integration only: no synthesized keyboard/mouse input. Interactive
// import/conflict/keyboard behavior is separately checked through CUA in Edge.
const root = path.resolve('.local/shortcut-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(root, { recursive: true });
await build({ stdin: { contents: "export {createShortcutConfig,parseShortcutConfig} from './src/core/shortcuts.ts';", resolveDir: process.cwd(), sourcefile: 'shortcut-helper.ts' }, outfile: path.join(root, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createShortcutConfig, parseShortcutConfig } = await import(pathToFileURL(path.join(root, 'helper.mjs')).href);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false }); await server.listen();
const env = { ...process.env, NBSX_TEST_USER_DATA: profile, NBSX_DEV_URL: server.resolvedUrls.local[0] }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--mute-audio', `--user-data-dir=${profile}`], env });
const errors = [], keyWarnings = [];
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/same key|unique.*key|encountered two children/i.test(message.text())) keyWarnings.push(message.text()); });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await page.locator('[aria-label="绘制音符"]').waitFor();
  const discovered = await page.evaluate(async () => Promise.all(Array.from({ length: 4 }, () => window.desktop.discoverMinecraft())));
  for (const roots of discovered) {
    const identities = roots.map(item => { const normalized = item.root.replaceAll('\\', '/').replace(/\/+$/, ''); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; });
    assert.equal(new Set(identities).size, roots.length, 'Concurrent real discovery must return unique root identities');
  }
  assert.equal(await page.locator('[data-testid=region]').count(), 4);
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu', name), name);
  await command('settings'); await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await command('duplicate'); await command('delete'); await command('erase');
  assert.equal(await page.locator('[data-testid=region]').count(), 4, 'Native editor commands must not edit the project behind a modal');
  assert.equal(await page.locator('[aria-label="绘制音符"]').getAttribute('aria-pressed'), 'true');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await page.locator('[aria-label="绘制音符"]').waitFor();
  await command('duplicate'); await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 5);
  await command('undo'); await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 4);
  const config = createShortcutConfig({ preset: 'fl', shortcuts: { duplicate: 'Mod+Shift+B', mixer: 'Ctrl+Shift+M' } }, process.platform);
  const filename = path.join(root, 'nbsx-shortcuts.json');
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename);
  const saved = await page.evaluate(async ({ config }) => window.desktop.saveFile('nbsx-shortcuts.json', new TextEncoder().encode(JSON.stringify(config, null, 2))), { config });
  assert.equal(saved, filename);
  const parsed = parseShortcutConfig(await readFile(filename, 'utf8'), process.platform);
  assert.deepEqual(parsed.config, config); assert.equal(parsed.legacy, false);
  assert.deepEqual(Object.keys(parsed.config).sort(), ['format', 'preset', 'shortcuts', 'version']);
  assert.deepEqual(errors, []);
  assert.deepEqual(keyWarnings, [], 'Concurrent discovery must not produce duplicate React keys');
  const report = { root, profile, application: 'development Electron window with current Vite sources', defaultPreset: 'fl', nativeMenuBlockedBehindModal: true, nativeDuplicateAndUndoOutsideModal: true, nativeJsonSaveRoundTrip: filename, independentConfigFields: Object.keys(config), synthesizedInput: false, concurrentDiscoveryCalls: discovered.length, concurrentDiscoveryRootCounts: discovered.map(roots => roots.length), concurrentDiscoveryUniqueRoots: true, duplicateKeyWarnings: keyWarnings, rendererErrors: errors };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {}); await server.close();
}
