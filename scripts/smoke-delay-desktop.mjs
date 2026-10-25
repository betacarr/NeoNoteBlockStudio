import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Existing production main-menu handlers -> preload IPC -> App. No synthesized
// input, DOM click/focus/scroll writes, React injection, or replacement commands.
const argument = name => { const i = process.argv.indexOf(name); if (i < 0) return; assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), name + ' requires a value'); return process.argv[i + 1]; };
const prepareOnly = process.argv.includes('--prepare-only'), inspectExportRequested = process.argv.includes('--inspect-export'), executableArgument = argument('--packaged');
assert(prepareOnly || executableArgument, 'Use --prepare-only or --packaged <unpacked executable>.');
const executable = executableArgument ? path.resolve(executableArgument) : undefined;
if (executable) assert(!/portable\.exe$/i.test(executable), 'Use the unpacked executable, not the portable launcher.');
const expectedVersion = argument('--expected-version') ?? '0.1.27';
const root = path.resolve('.local/delay-desktop', 'run-' + Date.now()), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalized = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const helper = path.join(root, 'fixture-helper.mjs');
const helperSource = "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx} from './src/core/container.ts';", helperEntry = 'delay-desktop-fixtures.ts';
const bundled = await build({ stdin: { contents: helperSource, resolveDir: process.cwd(), sourcefile: helperEntry }, outfile: helper, platform: 'node', format: 'esm', bundle: true, metafile: true });
const { createProject, newNote, saveNbsx, openNbsx } = await import(pathToFileURL(helper).href);
const helperInputs = {};
for (const input of Object.keys(bundled.metafile.inputs).sort()) if (!input.startsWith('<') && input !== helperEntry) helperInputs[input.replaceAll('\\', '/')] = await sha256(path.resolve(input));
const effects = {
  gate: { enabled: true, mode: 'gate', timeUnit: 'beats', interval: .25, feedback: .5, wet: .75, panAmount: .375, attack: .75, decay: .5, sustain: .35, release: .625, releaseOffset: -1.5, tail: 4.125 },
  tail: { enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .1375, feedback: .375, wet: .625, panAmount: .625, attack: .125, decay: .25, sustain: .55, release: .375, releaseOffset: -.0625, tail: 1.375 },
};
// Literal display answers follow DelayEditor labels/units, without calling its
// renderer, envelope helper, or event-expansion helper as the expected oracle.
const uiExpected = {
  gate: { numeric: { 'Delay 回声间隔': .25, 'Delay 每次保留': 50, 'Delay 回声力度': 75, 'Delay 左右摆幅': 37.5, 'Delay 起音 A': .75, 'Delay 衰减 D': .5, 'Delay 保持 S': 35, 'Delay 释放 R': .625, 'Delay 释放偏移': -1.5 }, curve: { timeUnit: 'beats', noteDuration: 2, releaseStart: .5, releaseLevel: 2 / 3 }, presets: [false, false, true, false] },
  tail: { numeric: { 'Delay 回声间隔': 137.5, 'Delay 每次保留': 37.5, 'Delay 回声力度': 62.5, 'Delay 左右摆幅': 62.5, 'Delay 独立尾长': 1375 }, curve: null, presets: [] },
};
const fixtures = [];
for (const key of ['gate', 'tail']) {
  const p = createProject('Delay ' + key + ' persistence fixture'); p.id = 'delay-desktop-' + key; p.createdAt = p.modifiedAt = '2026-01-01T00:00:00.000Z';
  p.ppq = 480; p.tempos = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }];
  // This is a data/persistence fixture: no inherited game sample can be embedded
  // by the portable-save option, and no sound/play/export-generation command is invoked.
  p.instruments = [{ ...p.instruments[0], id: 'delay-fixture-silent', name: 'Delay persistence fixture', englishName: 'Delay persistence fixture', sound: undefined, nbsIndex: undefined }];
  delete p.instruments[0].sound; delete p.instruments[0].nbsIndex;
  Object.assign(p.tracks[0], { id: key + '-track', name: key === 'gate' ? '提前释放轨道' : '静音锁定尾音轨道', instrumentId: p.instruments[0].id, sourceMidiTrack: 3, midiChannel: 2, locked: key === 'tail', muted: key === 'tail', delay: structuredClone(effects[key]) });
  Object.assign(p.patterns[0], { id: key + '-pattern', name: key + ' source notes', length: 1920, notes: [
    { ...newNote(0, 66, 960), id: key + '-source-a', velocity: .8, pan: -.125, detune: 12.625, height: .25, instrumentId: p.instruments[0].id, midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 3 } },
    { ...newNote(1200.25, 73, 240.5), id: key + '-source-b', velocity: .4, pan: .375, detune: -7.125, height: -.5, midiSource: { onOrder: 4, offOrder: 5, releaseVelocity: 73, offSourceTrack: 4 } },
  ], midiEvents: [{ id: key + '-controller', tick: 240, order: 1, sourceTrack: 3, event: { deltaTime: 0, type: 'controller', channel: 2, controllerType: 64, value: 127 } }] });
  Object.assign(p.regions[0], { id: key + '-region', trackId: p.tracks[0].id, patternId: p.patterns[0].id, start: 0, offset: 0, length: 1920, loop: false });
  const file = path.join(root, key + '.nbsx'); await writeFile(file, saveNbsx(p));
  const project = openNbsx(new Uint8Array(await readFile(file))); assert.deepEqual(normalized(project), normalized(p), key + ': same-source fixture container roundtrip');
  fixtures.push({ key, file, project, identity: await reference(file), expected: uiExpected[key] });
}
const selectedSourceSha256 = {};
for (const file of ['scripts/smoke-delay-desktop.mjs', 'src/ui/App.tsx', 'src/ui/DelayEditor.tsx', 'src/ui/DelayEditor.css', 'src/ui/CommitNumberInput.tsx', 'src/ui/export-context.ts', 'src/audio/engine.ts', 'src/core/types.ts', 'src/core/delay.ts', 'src/core/project.ts', 'src/core/container.ts', 'src/core/time.ts', 'src/core/meter.ts', 'src/core/audition-project.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json']) selectedSourceSha256[file] = await sha256(file);
const preparedFile = path.join(root, 'fixtures.json');
const prepared = { schema: 1, status: 'prepared', applicationLaunched: false, root, profile, expectedVersion, inspectExportRequested, selectedSourceSha256,
  fixtureHelper: { scope: 'same-source Node helper for NBSX fixture construction/readback only; no packaged GUI NBS export claim', file: await reference(helper), virtualEntry: { sourcefile: helperEntry, sha256: createHash('sha256').update(helperSource).digest('hex') }, inputs: helperInputs },
  fixtures: fixtures.map(f => ({ key: f.key, file: f.identity, name: f.project.name, ppq: f.project.ppq, effect: f.project.tracks[0].delay, locked: f.project.tracks[0].locked, muted: f.project.tracks[0].muted, sourceNotes: f.project.patterns[0].notes, storedMidiEvents: f.project.patterns[0].midiEvents, expectedDOM: f.expected })),
  readbacks: { preparedFixtureContainers: 2, plannedPackagedSavedProjects: 4, plannedTotal: 6 }, restartPlanned: true,
  optionalExportInspection: inspectExportRequested ? { scope: 'Original native export menu opens the panel; read-only DOM only. No GUI editing, preparation or export.', activeFormat: 'NBS', tempoPreset: 'bpm-7.5', automaticTPS: '120 BPM ÷ 7.5 = 16 TPS', version: '5', saveDisabled: false, reportCount: 0 } : undefined };
await writeFile(preparedFile, JSON.stringify(prepared, null, 2) + '\n');
if (prepareOnly) console.log(JSON.stringify({ status: 'prepared', applicationLaunched: false, fixtures: fixtures.length, plannedPackagedReadbacks: 4, report: preparedFile, sha256: await sha256(preparedFile) }));
else {
  const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
  const rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], observations = [], checkpoints = [], screenshots = [], processes = [], sessions = [];
  const reportFile = path.join(root, 'report.json');
  const report = { schema: 1, status: 'running', packaged: true, root, profile, expectedVersion, inspectExportRequested, runnerPid: process.pid, selectedSourceSha256, prepared: await reference(preparedFile), observations, checkpoints, screenshots, processes, sessions, rendererErrors, consoleErrors, unexpectedDialogs,
    scope: 'Actual packaged Electron main-menu handlers -> preload -> App Open/Select All/Save As, dialog-return fixtures, read-only DelayEditor DOM, clean application restart, and full saved NBSX semantic comparison.' + (inspectExportRequested ? ' Optional export coverage is limited to the existing native menu opening the panel and read-only DOM; no GUI editing, preparation or file export.' : ''),
    limitations: ['No user gesture, keyboard shortcut, effect edit, pointer, focus or scroll delivery is synthesized or accepted by this harness.', 'Native file-picker returns are fixtures; this is not a human chooser test.', 'Only modifiedAt is excluded from complete-project comparison; source notes, MIDI provenance, stored messages, track effects and all other fields must remain exact.', 'Screenshots record the available viewport; offscreen inspector fields are verified through read-only DOM, without scrolling the application.', 'The Node fixture/readback helper is same-source container checking; no packaged GUI NBS export, native/audio render, audible tail, ADSR listening, hardware MIDI or FPS acceptance is claimed.'] };
  let desktop, page, session, terminal;
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readDom = () => page.evaluate(() => {
    const editor = document.querySelector('[data-testid="delay-editor"]'), curve = editor?.querySelector('.delay-envelope'), active = document.activeElement;
    const controls = Object.fromEntries([...(editor?.querySelectorAll('input[aria-label],select[aria-label]') ?? [])].map(element => [element.getAttribute('aria-label'), { value: element.value, type: element.type, checked: element.type === 'checkbox' ? element.checked : undefined, disabled: element.matches(':disabled'), invalid: element.getAttribute('aria-invalid') }]));
    const presets = [...(editor?.querySelectorAll('.delay-presets button') ?? [])].map(button => ({ label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed'), disabled: button.matches(':disabled') }));
    const heading = document.querySelector('.editor-heading')?.textContent ?? '', rect = editor?.getBoundingClientRect();
    return { title: document.title, selectedNotes: Number(heading.match(/已选择\s*(\d+)\s*个音符/)?.[1] ?? 0), heading, editorCount: document.querySelectorAll('[data-testid="delay-editor"]').length,
      enabled: editor?.dataset.enabled, mode: editor?.dataset.mode, controls, presets, curve: curve ? { timeUnit: curve.getAttribute('data-time-unit'), noteDuration: Number(curve.getAttribute('data-note-duration')), releaseStart: Number(curve.getAttribute('data-release-start')), releaseLevel: Number(curve.getAttribute('data-release-level')), points: curve.querySelector('polyline')?.getAttribute('points'), noteOffLine: !!curve.querySelector('[data-testid="delay-note-off"]') } : null,
      regionCount: document.querySelectorAll('[data-testid=region]').length, locked: !!document.querySelector('.track-buttons button[title="锁定"].on'), muted: !!document.querySelector('.track-buttons button[title="静音"].on'), message: document.querySelector('.status-message')?.textContent ?? '',
      editorBounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, viewport: { width: innerWidth, height: innerHeight },
      activeElement: active ? { tag: active.tagName, label: active.getAttribute('aria-label'), textInput: active.matches('input,textarea,select,[contenteditable="true"]') } : null };
  });
  const screenshot = async label => { const file = path.join(root, label + '.png'); await page.screenshot({ path: file, fullPage: false }); screenshots.push({ label, file: await reference(file) }); };
  const command = async name => {
    await desktop.evaluate(({ Menu }, name) => {
      const labels = { open: ['文件', '打开 / 导入…'], 'save-as': ['文件', '另存为…'], 'select-all': ['编辑', '全选'], export: ['文件', '导出…'] }, wanted = labels[name];
      if (!wanted) throw new Error('Unsupported fixture menu command: ' + name);
      const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]);
      if (!item?.enabled || typeof item.click !== 'function') throw new Error('Original native menu unavailable: ' + name);
      globalThis.__delayDesktopFixture.commands.push({ name, label: item.label, delivery: 'original-native-menu-to-preload-IPC' }); item.click();
    }, name); await flush();
  };
  const inspect = async (label, fixture) => {
    const dom = await readDom(), effect = fixture.project.tracks[0].delay, locked = fixture.project.tracks[0].locked;
    assert.equal(dom.editorCount, 1, label); assert.equal(dom.selectedNotes, 2, label); assert.equal(dom.regionCount, 1, label); assert(!dom.title.startsWith('●'), label + ': read-only checks dirtied the project');
    assert.equal(dom.enabled, 'true', label); assert.equal(dom.mode, effect.mode, label); assert.equal(dom.locked, locked, label); assert.equal(dom.muted, fixture.project.tracks[0].muted, label);
    assert.equal(dom.controls['启用轨道 Delay']?.checked, true, label); assert.equal(dom.controls['Delay 模式']?.value, effect.mode, label); assert.equal(dom.controls['Delay 时间单位']?.value, effect.timeUnit, label);
    for (const [name, expected] of Object.entries(fixture.expected.numeric)) { const control = dom.controls[name]; assert(control, label + ': missing ' + name); assert.equal(Number(control.value), expected, label + ': ' + name); assert.equal(control.invalid, null, label + ': ' + name); }
    for (const [name, control] of Object.entries(dom.controls)) assert.equal(control.disabled, locked, label + ': disabled ' + name);
    assert.equal(Object.keys(dom.controls).length, Object.keys(fixture.expected.numeric).length + 3, label + ': unexpected controls');
    assert.deepEqual(dom.presets.map(preset => preset.pressed === 'true'), fixture.expected.presets, label + ': interval presets');
    if (fixture.expected.curve) {
      assert(dom.curve && dom.curve.noteOffLine && dom.curve.points?.length > 10, label + ': missing envelope geometry');
      assert.equal(dom.curve.timeUnit, fixture.expected.curve.timeUnit); assert.equal(dom.curve.noteDuration, 2); assert.equal(dom.curve.releaseStart, .5);
      assert(Math.abs(dom.curve.releaseLevel - 2 / 3) < 1e-12, label + ': early release must start at the actual attack level');
    } else assert.equal(dom.curve, null, label + ': tail mode must not display a Gate curve');
    observations.push({ label, fixture: fixture.key, session: session.index, dom }); return dom;
  };
  const open = async (fixture, file, label) => {
    await desktop.evaluate((_, file) => { const state = globalThis.__delayDesktopFixture; if (state.open) throw new Error('Unconsumed Open fixture'); state.open = file; }, file);
    await command('open'); await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), fixture.project.name, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    await command('select-all'); await inspect(label, fixture);
  };
  const save = async (fixture, label) => {
    const file = path.join(root, label + '.nbsx');
    await desktop.evaluate((_, file) => { const state = globalThis.__delayDesktopFixture; if (state.save) throw new Error('Unconsumed Save fixture'); state.save = file; }, file);
    await command('save-as'); await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 });
    const project = openNbsx(new Uint8Array(await readFile(file)));
    assert.deepEqual(normalized(project), normalized(fixture.project), label + ': complete saved-project semantic mismatch');
    assert.equal(project.ppq, 480); assert.equal(project.patterns[0].notes.length, 2); assert(project.patterns[0].notes.every(note => !Object.hasOwn(note, 'delaySource')), label + ': derived echo persisted as a source note');
    checkpoints.push({ label, fixture: fixture.key, session: session.index, file: await reference(file), completeProjectCompared: true, ignoredFields: ['modifiedAt'], ppq: project.ppq, sourceNotes: project.patterns[0].notes.length, effect: project.tracks[0].delay, midiSource: project.patterns[0].notes.map(note => note.midiSource), sourceMidiEvents: project.patterns[0].midiEvents });
    await inspect(label + '-dom', fixture); return file;
  };
  const launch = async () => {
    desktop = await electron.launch({ executablePath: executable, args: ['--mute-audio', `--user-data-dir=${profile}`], env: environment });
    const child = desktop.process(), record = { pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, signal: null }; processes.push(record);
    terminal = new Promise(resolve => child.once('exit', (code, signal) => { Object.assign(record, { exitCode: code, signal, exitedAt: new Date().toISOString() }); resolve(record); }));
    session = { index: sessions.length + 1, pid: child.pid }; sessions.push(session);
    // Identity/version precede all file or editor actions in every new process.
    const identity = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), runtime: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch } }));
    Object.assign(session, identity); assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(identity.userData, profile);
    page = await desktop.firstWindow(); page.on('pageerror', error => rendererErrors.push({ session: session.index, message: error.message })); page.on('crash', () => rendererErrors.push({ session: session.index, message: 'Renderer crashed' }));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ session: session.index, message: message.text() }); });
    page.on('dialog', dialog => { unexpectedDialogs.push({ session: session.index, type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
    await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 }); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
    await desktop.evaluate(({ dialog }) => {
      globalThis.__delayDesktopFixture = { open: null, save: null, calls: [], commands: [], unexpected: [] };
      dialog.showOpenDialog = async (...args) => {
        const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties)), state = globalThis.__delayDesktopFixture;
        if (!state.open || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(options?.title) || !options.properties.includes('openFile')) { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
        const file = state.open; state.open = null; state.calls.push({ kind: 'open', file, title: options.title }); return { canceled: false, filePaths: [file] };
      };
      dialog.showSaveDialog = async (...args) => {
        const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters)), state = globalThis.__delayDesktopFixture;
        if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true }; }
        const file = state.save; state.save = null; state.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file };
      };
    });
  };
  const close = async () => {
    assert(!(await page.title()).startsWith('●'), 'Restart must close a clean saved project');
    session.dialogFixture = await desktop.evaluate(() => globalThis.__delayDesktopFixture);
    assert.equal(session.dialogFixture.open, null); assert.equal(session.dialogFixture.save, null); assert.deepEqual(session.dialogFixture.unexpected, []);
    assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'open').length, 2); assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'save').length, 2);
    await desktop.close();
    let timeout; const ended = await Promise.race([terminal, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned application did not exit after clean close')), 30000); })]).finally(() => clearTimeout(timeout));
    assert.equal(ended.exitCode, 0); assert.equal(ended.signal, null); session.closeMethod = 'ElectronApplication.close after clean saved project'; desktop = undefined; page = undefined;
  };
  try {
    report.images = [await reference(executable), await reference(path.join(path.dirname(executable), 'resources', 'app.asar'))];
    await launch();
    const savedFiles = new Map();
    for (const fixture of fixtures) {
      await open(fixture, fixture.file, fixture.key + '-loaded'); await screenshot(fixture.key + '-before-save');
      savedFiles.set(fixture.key, await save(fixture, fixture.key + '-saved')); await screenshot(fixture.key + '-after-save');
    }
    await close(); await launch();
    for (const fixture of fixtures) {
      await open(fixture, savedFiles.get(fixture.key), fixture.key + '-reopened-after-process-restart'); await screenshot(fixture.key + '-after-restart');
      await save(fixture, fixture.key + '-resaved-after-restart');
    }
    if (inspectExportRequested) {
      await command('export');
      await page.waitForFunction(() => !!document.querySelector('[role="dialog"][aria-label="导出"] select[aria-label="NBS TPS 换算预设"]'), undefined, { timeout: 10000 });
      const dom = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"][aria-label="导出"]'), preset = modal?.querySelector('select[aria-label="NBS TPS 换算预设"]'), version = modal?.querySelector('select[aria-label="NBS 导出版本"]');
        const save = [...(modal?.querySelectorAll('button') ?? [])].find(button => button.textContent?.trim() === '导出文件…');
        return { title: document.title, modalCount: document.querySelectorAll('[role="dialog"][aria-label="导出"]').length, activeFormats: [...(modal?.querySelectorAll('.export-formats button.active strong') ?? [])].map(element => element.textContent?.trim()),
          preset: preset ? { label: preset.getAttribute('aria-label'), value: preset.value } : null, automaticTPS: modal?.querySelector('[aria-label="NBS 自动 TPS"]')?.textContent ?? null, exportActionCount: modal?.querySelectorAll('.button-row button').length ?? null,
          version: version ? { label: version.getAttribute('aria-label'), value: version.value } : null, savePresent: !!save, saveDisabled: save?.matches(':disabled') ?? null, reportCount: modal?.querySelectorAll('.export-report').length ?? null };
      });
      assert.equal(dom.modalCount, 1); assert.deepEqual(dom.activeFormats, ['NBS']);
      assert.deepEqual(dom.preset, { label: 'NBS TPS 换算预设', value: 'bpm-7.5' }); assert.equal(dom.automaticTPS, '120 BPM ÷ 7.5 = 16 TPS'); assert.equal(dom.exportActionCount, 1);
      assert.deepEqual(dom.version, { label: 'NBS 导出版本', value: '5' }); assert.equal(dom.savePresent, true); assert.equal(dom.saveDisabled, false); assert.equal(dom.reportCount, 0);
      assert(!dom.title.startsWith('●'), 'Opening the export panel dirtied the saved project');
      report.exportInspection = { status: 'passed', session: session.index, delivery: 'original-native-menu-to-preload-IPC', scope: 'Open panel and read DOM only; no GUI editing, preparation, export or product-state injection.', dom };
      await screenshot('export-panel-readonly');
    }
    await close();
    assert.equal(checkpoints.length, 4); assert.equal(sessions.length, 2); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
    report.status = 'passed'; report.readbacks = { preparedFixtureContainers: 2, packagedSavedProjects: checkpoints.length, total: 2 + checkpoints.length }; report.applicationRestarted = true;
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, expectedVersion, fixtures: 2, packagedReadbacks: checkpoints.length, actualProcessRestarts: 1, rendererErrors, report: reportFile, sha256: await sha256(reportFile) }));
  } catch (error) {
    report.status = 'failed'; report.error = error.stack ?? String(error);
    if (page) { report.failureDom = await readDom().catch(() => null); await screenshot('failure').catch(() => {}); }
    if (desktop) report.dialogFixtureAtFailure = await desktop.evaluate(() => globalThis.__delayDesktopFixture).catch(() => null);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.error(JSON.stringify({ status: 'failed', report: reportFile, error: String(error) })); throw error;
  } finally {
    await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop?.close().catch(() => {});
  }
}
