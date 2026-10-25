import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Actual application menu handlers and preload IPC; no synthesized input, DOM
// focus/scroll writes, React-state injection or replacement editor commands.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return undefined;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[index + 1];
};
const prepareOnly = process.argv.includes('--prepare-only'), packagedArgument = argument('--packaged'), dev = process.argv.includes('--dev');
assert(prepareOnly || packagedArgument || dev, 'Pass --packaged <unpacked executable>, --dev or --prepare-only.');
assert(!(packagedArgument && dev), 'Choose packaged or development mode.');
const packaged = packagedArgument ? path.resolve(packagedArgument) : undefined;
if (packaged) assert(!/portable\.exe$/i.test(packaged), 'Use the unpacked executable, not the portable launcher.');
const expectedVersion = argument('--expected-version') ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const root = path.resolve('.local/locked-editor-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const helper = path.join(root, 'fixture-helper.mjs');
await build({ stdin: { contents: "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx} from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'locked-editor-fixtures.ts' }, outfile: helper, platform: 'node', format: 'esm', bundle: true });
const { createProject, newNote, saveNbsx, openNbsx } = await import(pathToFileURL(helper).href);
const base = createProject('Locked editor command fixture');
base.ppq = 480; base.patterns[0].length = base.regions[0].length = 1920;
base.patterns[0].notes = [
  { ...newNote(0, 60, 120), velocity: .7, pan: -.2, detune: 9, height: .25, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45 } },
  { ...newNote(480, 67, 120), velocity: .4, pan: .3, detune: -12, height: -.5, midiSource: { onOrder: 4, offOrder: 5, releaseVelocity: 73 } },
];
base.patterns[0].midiEvents = [{ id: 'locked-editor-controller', tick: 240, order: 1, event: { deltaTime: 0, type: 'controller', channel: 0, controllerType: 64, value: 127 } }];
// A private, silent instrument prevents portable-save from embedding unrelated
// discovered game samples. This fixture checks editor data, never audio output.
base.instruments = [{ ...base.instruments[0], id: 'locked-editor-fixture', name: 'Editor fixture', englishName: 'Editor fixture', sound: undefined, nbsIndex: undefined }];
base.tracks[0].instrumentId = base.instruments[0].id;
const fixtures = [];
for (const locked of [true, false]) {
  const project = structuredClone(base); project.name = `${locked ? 'Locked' : 'Unlocked'} editor command fixture`; project.tracks[0].locked = locked;
  const file = path.join(root, locked ? 'locked.nbsx' : 'unlocked.nbsx');
  await writeFile(file, saveNbsx(project));
  fixtures.push({ locked, file, project: openNbsx(new Uint8Array(await readFile(file))), identity: await reference(file) });
}
const selectedSourceSha256 = {};
for (const file of ['scripts/smoke-locked-editor.mjs', 'src/ui/App.tsx', 'src/ui/Arrangement.tsx', 'src/ui/PianoRoll.tsx', 'src/core/editor-commands.ts', 'src/core/container.ts', 'src/core/project.ts', 'src/core/meter.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json']) selectedSourceSha256[file] = await sha256(file);
const prepared = { schema: 1, status: 'prepared', applicationLaunched: false, root, profile, expectedVersion, selectedSourceSha256, fixtures: fixtures.map(({ project, file, ...fixture }) => ({ ...fixture, name: project.name, sourceNotes: project.patterns[0].notes.length })) };
await writeFile(path.join(root, 'fixtures.json'), JSON.stringify(prepared, null, 2) + '\n');
if (prepareOnly) {
  console.log(JSON.stringify({ status: 'prepared', applicationLaunched: false, fixtures: fixtures.length, report: path.join(root, 'fixtures.json') }));
} else {
  const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
  if (dev) environment.NBSX_DEV_URL = argument('--dev-url') ?? 'http://127.0.0.1:5173/';
  const rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], observations = [], checkpoints = [], screenshots = [];
  const reportFile = path.join(root, 'report.json');
  const report = { schema: 1, status: 'running', packaged: !!packaged, root, profile, expectedVersion, selectedSourceSha256, fixtures: await reference(path.join(root, 'fixtures.json')), observations, checkpoints, screenshots, rendererErrors, consoleErrors, unexpectedDialogs,
    scope: 'Isolated Electron application. Original main-process native-menu handlers -> menu IPC -> preload -> actual App commands; real file:open/file:save with dialog-return fixtures. Read-only DOM and full saved-project comparison. No synthetic mouse/keyboard, DOM focus/scroll mutation or injected React state.',
    focusProvenance: 'App initial note-command focus and the actual native Select All Notes command establish the piano command domain. Successful Copy and note-only positive controls prove that route. DOM activeElement is recorded separately; no actual canvas pointer-focus or keyboard-delivery claim.',
    limitations: ['Native main-process menus are static; invoking their existing handlers tests the App command guard, not renderer-menu disabled styling.', 'Native dialog results are fixtures, not human file-picker input.', 'Only project.modifiedAt is excluded from full-project equality because production serialization stamps the save time.', 'No mid-drag trim, cancellation gesture, audio, hardware MIDI, FPS or shortcut-delivery acceptance.'] };
  let desktop, page;
  const readDom = () => page.evaluate(() => {
    const footer = [...(document.querySelector('.status-bar')?.querySelectorAll(':scope > span') ?? [])].map(node => node.textContent ?? '').find(text => /轨\s*·.*音符/.test(text)) ?? '';
    const counts = footer.match(/(\d+)\s*轨\s*·\s*([\d,.\s]+)\s*音符/);
    const heading = document.querySelector('.editor-heading > div:last-child > span')?.textContent ?? '';
    const active = document.activeElement;
    return { title: document.title, footer, playbackNotes: counts ? Number(counts[2].replace(/\D/g, '')) : null, tracks: counts ? Number(counts[1]) : null, heading, selectedNotes: Number(heading.match(/已选择\s*(\d+)\s*个音符/)?.[1] ?? 0), regionCount: document.querySelectorAll('[data-testid=region]').length, message: document.querySelector('.status-message')?.textContent ?? '', locked: !!document.querySelector('.track-buttons button[title="锁定"].on'), activeElement: active ? { tag: active.tagName, label: active.getAttribute('aria-label'), isTextInput: active.matches('input,textarea,select,[contenteditable="true"]') } : null };
  });
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const command = async name => {
    await desktop.evaluate(({ Menu }, command) => {
      const labels = { open: ['文件', '打开 / 导入…'], 'save-as': ['文件', '另存为…'], undo: ['编辑', '撤销'], copy: ['编辑', '复制'], cut: ['编辑', '剪切'], paste: ['编辑', '粘贴'], duplicate: ['编辑', '独立复制'], 'select-all': ['编辑', '全选'] };
      const selected = labels[command]; if (!selected) throw new Error(`Unknown fixture command ${command}`);
      const menu = Menu.getApplicationMenu()?.items.find(item => item.label.replaceAll('&', '') === selected[0]);
      const item = menu?.submenu?.items.find(item => item.label.replaceAll('&', '') === selected[1]);
      if (!item?.enabled || typeof item.click !== 'function') throw new Error(`Original native menu command unavailable: ${command}`);
      globalThis.__lockedEditorFixture.commands.push({ command, label: item.label, nativeItemEnabled: item.enabled });
      item.click();
    }, name);
    await flush();
  };
  const state = async (label, notes, selected, locked) => {
    const dom = await readDom();
    assert.equal(dom.playbackNotes, notes, label); assert.equal(dom.selectedNotes, selected, label); assert.equal(dom.locked, locked, label); assert.equal(dom.tracks, 1, label); assert.equal(dom.regionCount, 1, label);
    assert(!dom.activeElement?.isTextInput, 'A text input owns native clipboard commands; this harness does not force piano focus.');
    observations.push({ label, dom }); return dom;
  };
  const screenshot = async name => { const file = path.join(root, name); await page.screenshot({ path: file, fullPage: false }); const result = await reference(file); screenshots.push(result); return result; };
  const normalized = project => { const value = structuredClone(project); delete value.modifiedAt; return value; };
  const open = async fixture => {
    await desktop.evaluate((_, filename) => { const state = globalThis.__lockedEditorFixture; if (state.open) throw new Error('Unconsumed Open fixture'); state.open = filename; }, fixture.file);
    await command('open');
    await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), fixture.project.name, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    await flush();
    await state(`open-${fixture.locked ? 'locked' : 'unlocked'}`, 2, 0, fixture.locked);
  };
  const save = async (label, expected, inserted = []) => {
    const file = path.join(root, `${label}.nbsx`);
    await desktop.evaluate((_, filename) => { const state = globalThis.__lockedEditorFixture; if (state.save) throw new Error('Unconsumed Save fixture'); state.save = filename; }, file);
    await command('save-as');
    await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 });
    const saved = openNbsx(new Uint8Array(await readFile(file)));
    const baselineNotes = expected.patterns[0].notes, originalIds = new Set(baselineNotes.map(note => note.id));
    assert.deepEqual(saved.patterns[0].notes.filter(note => originalIds.has(note.id)), baselineNotes, `${label}: existing notes changed`);
    const clones = saved.patterns[0].notes.filter(note => !originalIds.has(note.id));
    assert.equal(clones.length, inserted.length, `${label}: wrong inserted note count`);
    clones.forEach((clone, index) => { const { id, ...actual } = clone, { id: ignored, ...wanted } = inserted[index]; assert.deepEqual(actual, wanted, `${label}: inserted note properties changed`); assert(!originalIds.has(id)); });
    assert.equal(new Set(saved.patterns[0].notes.map(note => note.id)).size, saved.patterns[0].notes.length);
    const fullComparison = structuredClone(saved); fullComparison.patterns[0].notes = baselineNotes;
    assert.deepEqual(normalized(fullComparison), normalized(expected), `${label}: other project data changed`);
    checkpoints.push({ label, file: await reference(file), sourceNotes: saved.patterns[0].notes.length, originalNotesPreserved: true, completeProjectCompared: true, ignoredFields: ['modifiedAt'], insertedNoteIds: clones.map(note => note.id) });
    return saved;
  };
  try {
    if (packaged) report.images = [await reference(packaged), await reference(path.join(path.dirname(packaged), 'resources', 'app.asar'))];
    desktop = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env: environment });
    page = await desktop.firstWindow(); page.on('pageerror', error => rendererErrors.push(error.message)); page.on('crash', () => rendererErrors.push('Renderer crashed'));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => { unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
    assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile); assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), !!packaged);
    report.applicationVersion = await desktop.evaluate(({ app }) => app.getVersion()); assert.equal(report.applicationVersion, expectedVersion);
    report.runtime = await desktop.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch }));
    await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 });
    assert.equal(await page.getByRole('dialog').count(), 0, 'Fresh profile must have no recovery modal');
    await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    await desktop.evaluate(({ dialog }) => {
      globalThis.__lockedEditorFixture = { open: null, save: null, calls: [], commands: [], unexpected: [] };
      dialog.showOpenDialog = async (...args) => {
        const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties)), state = globalThis.__lockedEditorFixture;
        if (!state.open || options?.title !== '打开工程或导入 MIDI / NBS' || !options.properties.includes('openFile')) { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
        const filename = state.open; state.open = null; state.calls.push({ kind: 'open', file: filename, title: options.title }); return { canceled: false, filePaths: [filename] };
      };
      dialog.showSaveDialog = async (...args) => {
        const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters)), state = globalThis.__lockedEditorFixture;
        if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true }; }
        const filename = state.save; state.save = null; state.calls.push({ kind: 'save', file: filename, defaultPath: options.defaultPath }); return { canceled: false, filePath: filename };
      };
    });
    const [locked, unlocked] = fixtures;
    await open(locked); await command('select-all'); await state('locked-select-all', 2, 2, true);
    await command('copy'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已复制 2 个音符'));
    for (const rejected of ['paste', 'duplicate', 'cut']) { await command(rejected); await state(`locked-${rejected}-rejected`, 2, 2, true); }
    await save('locked-after-rejected-commands', locked.project);
    // Saving clears the previous Copy message, so a new Copy success proves the
    // original valid selection survived rejection; stale clone IDs cannot pass.
    await command('copy'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已复制 2 个音符'));
    await state('locked-copy-still-available', 2, 2, true); await screenshot('locked-preserved.png');
    await open(unlocked); await command('select-all'); await state('unlocked-select-all', 2, 2, false);
    await command('paste'); await state('unlocked-paste-positive', 4, 2, false);
    await save('unlocked-pasted', unlocked.project, unlocked.project.patterns[0].notes);
    await command('undo'); await state('unlocked-paste-undone', 2, 2, false); await save('unlocked-paste-undone', unlocked.project);
    await command('select-all'); await command('duplicate'); await state('unlocked-duplicate-positive', 4, 2, false);
    await save('unlocked-duplicated', unlocked.project, unlocked.project.patterns[0].notes.map(note => ({ ...note, tick: note.tick + 600 })));
    await screenshot('unlocked-positive.png');
    await command('undo'); await state('unlocked-duplicate-undone', 2, 2, false); await save('unlocked-final', unlocked.project);
    await screenshot('restored.png');
    report.dialogFixture = await desktop.evaluate(() => globalThis.__lockedEditorFixture);
    assert.equal(report.dialogFixture.calls.filter(call => call.kind === 'open').length, 2);
    assert.equal(report.dialogFixture.calls.filter(call => call.kind === 'save').length, 5);
    assert.equal(report.dialogFixture.open, null); assert.equal(report.dialogFixture.save, null); assert.deepEqual(report.dialogFixture.unexpected, []);
    assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
    report.status = 'passed'; await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, applicationVersion: report.applicationVersion, lockedCommandsRejectedWithoutSelectionLoss: true, unlockedPasteAndDuplicatePositive: true, completeProjectCheckpoints: checkpoints.length, rendererErrors, report: reportFile, sha256: await sha256(reportFile) }));
  } catch (error) {
    report.status = 'failed'; report.error = String(error);
    if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure.png').catch(() => {}); }
    if (desktop) report.dialogFixture = await desktop.evaluate(() => globalThis.__lockedEditorFixture).catch(() => null);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.error(JSON.stringify({ status: 'failed', error: report.error, report: reportFile })); throw error;
  } finally {
    await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop?.close().catch(() => {});
  }
}
