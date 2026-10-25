import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { build } from 'esbuild';

// Application integration only: no synthetic input, DOM events, focus/scroll
// writes or injected editor state. Actual tail navigation has separate CUA evidence.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return undefined;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[index + 1];
};
const prepareOnly = process.argv.includes('--prepare-only'), packagedArgument = argument('--packaged');
assert(prepareOnly || packagedArgument, 'Pass --packaged <unpacked executable> or --prepare-only.');
const packaged = packagedArgument ? path.resolve(packagedArgument) : undefined;
if (packaged) assert(!/portable\.exe$/i.test(packaged), 'Use the unpacked executable, not the portable launcher.');
const expectedVersion = argument('--expected-version') ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const root = path.resolve('.local/large-editor-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const part of createReadStream(file)) hash.update(part); return hash.digest('hex'); };
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const evidenceFile = path.resolve(argument('--fixture-manifest') ?? 'docs/evidence/editor-region-preview.json');
const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'));
const definitions = [
  { file: 'offset-beyond-500-cycles.nbsx', playbackNotes: 4, sourceNotes: 1, visiblePreview: true },
  { file: '501-source-cycles.nbsx', playbackNotes: 501, sourceNotes: 1, visiblePreview: true },
  { file: 'phase-offset-far.nbsx', playbackNotes: 8, sourceNotes: 2, visiblePreview: false },
  { file: 'notes-100000.mid', playbackNotes: 100000, sourceNotes: 100000, visiblePreview: true },
];
const fixtures = [];
const fixtureProjects = new Map();
// Parsing supplies source data only. The fit oracle below does not import or
// reproduce planPianoView; it checks actual reported viewport coordinates.
const readerFile = path.join(root, 'fixture-reader.mjs');
const readerBuild = await build({ stdin: { contents: "export {importMidi} from './src/core/midi-import.ts';", resolveDir: process.cwd(), sourcefile: 'large-editor-fixture-reader.ts' }, outfile: readerFile, bundle: true, platform: 'node', format: 'esm', metafile: true });
const { importMidi } = await import(pathToFileURL(readerFile).href);
await mkdir(path.join(root, 'fixtures'));
for (const definition of definitions) {
  const recorded = evidence.fixturesSentForParentRealUiCheck.find(item => path.basename(item.path) === definition.file);
  assert(recorded, `Missing archived fixture identity: ${definition.file}`);
  const original = path.resolve(argument('--fixtures') ? path.join(argument('--fixtures'), definition.file) : recorded.path);
  const identity = await reference(original);
  assert([...evidence.fixturesSentForParentRealUiCheck, ...evidence.fixtures].some(item => path.basename(item.path) === definition.file && item.sha256 === identity.sha256), `Archived fixture hash changed: ${original}`);
  const bytes = await readFile(original);
  const project = definition.file.endsWith('.nbsx') ? JSON.parse(strFromU8(unzipSync(bytes, { filter: item => item.name === 'project.json' })['project.json'])) : importMidi(bytes, definition.file).project;
  const title = project?.name ?? path.basename(definition.file, path.extname(definition.file));
  assert.equal(typeof title, 'string');
  assert.equal(project.regions.length, 1);
  const pattern = project.patterns.find(item => item.id === project.regions[0].patternId);
  assert(pattern); assert.equal(pattern.notes.length, definition.sourceNotes);
  const envelope = pattern.notes.reduce((result, note) => ({ onsetMin: Math.min(result.onsetMin, note.tick), onsetMax: Math.max(result.onsetMax, note.tick), endMax: Math.max(result.endMax, note.tick + note.duration), midiMin: Math.min(result.midiMin, note.midi), midiMax: Math.max(result.midiMax, note.midi) }), { onsetMin: Infinity, onsetMax: -Infinity, endMax: -Infinity, midiMin: Infinity, midiMax: -Infinity });
  fixtureProjects.set(definition.file, { ppq: project.ppq, notes: pattern.notes });
  const copied = path.join(root, 'fixtures', definition.file); await writeFile(copied, bytes);
  assert.equal(await sha256(copied), identity.sha256);
  fixtures.push({ ...definition, title, original: identity, copy: await reference(copied), absolutePath: copied, sourceEnvelope: { ppq: project.ppq, notes: pattern.notes.length, ...envelope } });
}
const sources = {};
for (const file of new Set(['scripts/smoke-large-editor-desktop.mjs', 'src/ui/Arrangement.tsx', 'src/ui/arrangement-preview.ts', 'src/ui/arrangement-note-index.ts', 'src/ui/arrangement-note-cache.ts', 'src/ui/PianoRoll.tsx', 'src/ui/piano-view.ts', 'src/ui/piano-note-index.ts', 'src/ui/piano-preview.ts', 'src/ui/styles.css', 'src/ui/App.tsx', 'src/core/container.ts', 'src/core/project.ts', 'src/core/midi-import.ts', 'src/core/smf.ts', 'electron/main.ts', 'electron/preload.ts', ...Object.keys(readerBuild.metafile.inputs).filter(file => file !== 'large-editor-fixture-reader.ts')])) sources[file] = await sha256(file);
const fixtureReport = { schema: 1, status: 'prepared', applicationLaunched: false, root, profile, expectedVersion, fixtureManifest: await reference(evidenceFile), fixtures, fixtureReader: await reference(readerFile), selectedSourceSha256: sources };
await writeFile(path.join(root, 'fixtures.json'), JSON.stringify(fixtureReport, null, 2) + '\n');
if (prepareOnly) {
  console.log(JSON.stringify({ status: 'prepared', applicationLaunched: false, fixtureCount: fixtures.length, report: path.join(root, 'fixtures.json') }));
} else {
  const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
  const rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], observations = [], screenshots = [];
  const report = { schema: 1, status: 'running', packaged: true, root, profile, expectedVersion, fixtures: await reference(path.join(root, 'fixtures.json')), selectedSourceSha256: sources, images: [await reference(packaged), await reference(path.join(path.dirname(packaged), 'resources', 'app.asar'))], observations, screenshots, rendererErrors, consoleErrors, unexpectedDialogs,
    scope: 'Packaged Electron application; existing native-menu handler -> production menu IPC -> file:open -> dialog return fixture, then existing preload menu IPC piano-fit-all. Read-only DOM/canvas pixels and independent source-note geometry versus observed fit attributes. No synthetic input, scroll/focus mutation, musical playback, audio or frame-rate acceptance.',
    limitations: ['Initial arrangement viewport plus piano fit-all only; no packaged arrangement tail/End navigation claim.', 'The bar601 region remains offscreen in the arrangement at import; validate its count and absence of offscreen canvas allocation.', 'Fit covers the selected source pattern, not every expanded loop copy. MIDI source notes come from the actual import parser; the fit bounds oracle does not call planPianoView.', 'Dialog returns are fixtures, not human manipulation of a native file picker.'] };
  let desktop, page;
  const reportFile = path.join(root, 'report.json');
  const readDom = () => page.evaluate(() => {
    const viewport = document.querySelector('.arrangement-scroll'), piano = document.querySelector('.piano-viewport canvas');
    const text = [...(document.querySelector('.status-bar')?.querySelectorAll(':scope > span') ?? [])].map(node => node.textContent ?? '').find(value => /轨\s*·.*音符/.test(value)) ?? '';
    const counts = text.match(/(\d+)\s*轨\s*·\s*([\d,.\s]+)\s*音符/);
    const sourceText = document.querySelector('.editor-heading > div:last-child > span')?.textContent ?? '';
    const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
    return { title: document.title, message: document.querySelector('.status-message')?.textContent ?? '', footer: text, tracks: counts ? Number(counts[1]) : null, playbackNotes: counts ? Number(counts[2].replace(/\D/g, '')) : null, sourceText, sourceNotes: sourceText ? Number(sourceText.replace(/\D/g, '')) : null, regionCount: document.querySelectorAll('[data-testid=region]').length, devicePixelRatio: window.devicePixelRatio,
      viewport: viewport ? { clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, scrollWidth: viewport.scrollWidth, rect: box(viewport) } : null,
      piano: piano ? { clientWidth: piano.clientWidth, clientHeight: piano.clientHeight, width: piano.width, height: piano.height } : null,
      regions: [...document.querySelectorAll('[data-testid=region]')].map(element => ({ rect: box(element), leftStyle: element.style.left, widthStyle: element.style.width })),
      canvases: [...document.querySelectorAll('.region-notes')].map(canvas => {
        const result = { clientWidth: canvas.clientWidth, cssWidth: Number.parseFloat(getComputedStyle(canvas).width), clientHeight: canvas.clientHeight, width: canvas.width, height: canvas.height, rect: box(canvas), noteInkPixels: 0 };
        try { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < data.length; i += 4) if (data[i] >= 100) result.noteInkPixels++; }
        catch (error) { result.pixelReadbackError = String(error); }
        return result;
      }) };
  });
  const image = async name => { const file = path.join(root, name); await page.screenshot({ path: file, fullPage: false }); const item = await reference(file); screenshots.push(item); return item; };
  const fitAll = async fixture => {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'piano-fit-all'));
    const state = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      await frame(); await frame();
      let previous, stable = 0;
      for (let attempt = 0; attempt < 120; attempt++) {
        const canvas = document.querySelector('.piano-viewport canvas');
        if (!canvas) throw new Error('Piano canvas disappeared during fit-all');
        const style = getComputedStyle(canvas);
        const current = { zoom: Number(canvas.dataset.zoom), rowHeight: Number(canvas.dataset.rowHeight), scrollX: Number(canvas.dataset.scrollX), scrollY: Number(canvas.dataset.scrollY), cssWidth: Number.parseFloat(style.width), cssHeight: Number.parseFloat(style.height), clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
        if (Object.values(current).every(Number.isFinite) && current.zoom > 0 && current.rowHeight > 0 && current.cssWidth > 58 && current.cssHeight > 120) {
          const key = JSON.stringify(current); stable = key === previous ? stable + 1 : 0; previous = key;
          if (stable >= 2) return { ...current, stableAnimationFrames: stable + 1 };
        }
        await frame();
      }
      throw new Error('Fit-all canvas attributes did not stabilize within 120 animation frames');
    });
    const source = fixtureProjects.get(fixture.file), scale = state.zoom / source.ppq;
    const bounds = { left: 58, right: state.cssWidth, top: 42, bottom: state.cssHeight - 78 };
    const envelope = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const note of source.notes) {
      const x = 58 + note.tick * scale - state.scrollX, y = 42 + (127 - note.midi) * state.rowHeight - state.scrollY;
      const width = Math.max(6, note.duration * scale), height = Math.max(1, state.rowHeight - 2);
      assert([x,y,width,height].every(Number.isFinite), `${fixture.file}: nonfinite source-note geometry`);
      envelope.left = Math.min(envelope.left, x); envelope.right = Math.max(envelope.right, x + width);
      envelope.top = Math.min(envelope.top, y); envelope.bottom = Math.max(envelope.bottom, y + height);
    }
    const toleranceCssPixels = 1;
    assert.equal(source.notes.length, fixture.sourceNotes);
    assert(envelope.left >= bounds.left - toleranceCssPixels && envelope.right <= bounds.right + toleranceCssPixels, `${fixture.file}: source-note onset/end envelope escaped fitted horizontal grid: ${JSON.stringify({state,bounds,envelope})}`);
    assert(envelope.top >= bounds.top - toleranceCssPixels && envelope.bottom <= bounds.bottom + toleranceCssPixels, `${fixture.file}: source-note pitch envelope escaped fitted vertical grid: ${JSON.stringify({state,bounds,envelope})}`);
    return { status: 'passed', command: 'piano-fit-all', sourceNotesChecked: source.notes.length, sourceEnvelope: fixture.sourceEnvelope, state, bounds, observedNoteEnvelope: envelope, toleranceCssPixels, oracle: 'Source notes and observed canvas dataset/CSS dimensions only; x=58+tick*zoom/ppq-scrollX, width=max(6,duration*zoom/ppq), y=42+(127-midi)*rowHeight-scrollY, height=max(1,rowHeight-2). No planPianoView call.', screenshot: await image(fixture.file.replace(/\.[^.]+$/, '.fit-all.png')) };
  };
  try {
    desktop = await electron.launch({ executablePath: packaged, args: ['--mute-audio', `--user-data-dir=${profile}`], env: environment });
    page = await desktop.firstWindow();
    page.on('pageerror', error => rendererErrors.push(error.message)); page.on('crash', () => rendererErrors.push('Renderer crashed'));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => { unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
    assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
    report.applicationVersion = await desktop.evaluate(({ app }) => app.getVersion()); assert.equal(report.applicationVersion, expectedVersion);
    report.runtime = await desktop.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch }));
    await page.waitForFunction(() => !!document.querySelector('.arrangement-scroll') && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 });
    assert.equal(await page.getByRole('dialog').count(), 0, 'Fresh profile must not contain a recovery modal');
    await desktop.evaluate(({ dialog }) => {
      globalThis.__largeEditorDialogFixture = { pending: null, calls: [], unexpected: [] };
      dialog.showOpenDialog = async (...args) => {
        const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties));
        const state = globalThis.__largeEditorDialogFixture;
        if (!state.pending || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(options?.title) || !options.properties.includes('openFile')) { state.unexpected.push({ title: options?.title, properties: options?.properties }); return { canceled: true, filePaths: [] }; }
        const file = state.pending; state.pending = null; state.calls.push({ file, title: options.title, properties: options.properties, extensions: options.filters?.flatMap(filter => filter.extensions) }); return { canceled: false, filePaths: [file] };
      };
    });
    // Open MIDI last: an imported MIDI is dirty, unlike the three saved NBSX files.
    for (const fixture of fixtures) {
      await desktop.evaluate(({ Menu }, filename) => {
        const state = globalThis.__largeEditorDialogFixture; if (state.pending) throw new Error('Previous dialog fixture was not consumed'); state.pending = filename;
        const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label.replaceAll('&', '') === '文件');
        const openItem = fileMenu?.submenu?.items.find(item => item.label.replaceAll('&', '') === '打开 / 导入…');
        if (!openItem || !openItem.enabled) throw new Error('Production Open/Import native menu item is unavailable');
        // Invoke its existing main-process handler, which sends the production menu IPC.
        openItem.click();
      }, fixture.absolutePath);
      await page.waitForFunction(expected => {
        const counts = [...(document.querySelector('.status-bar')?.querySelectorAll(':scope > span') ?? [])].map(node => node.textContent ?? '').find(text => /轨\s*·.*音符/.test(text))?.match(/(\d+)\s*轨\s*·\s*([\d,.\s]+)\s*音符/);
        const source = document.querySelector('.editor-heading > div:last-child > span')?.textContent ?? '';
        return document.title.includes(expected.name) && counts && Number(counts[1]) === 1 && Number(counts[2].replace(/\D/g, '')) === expected.playbackNotes && Number(source.replace(/\D/g, '')) === expected.sourceNotes;
      }, { name: fixture.title, playbackNotes: fixture.playbackNotes, sourceNotes: fixture.sourceNotes }, { timeout: 90000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const dom = await readDom();
      assert.equal(dom.tracks, 1); assert.equal(dom.playbackNotes, fixture.playbackNotes); assert.equal(dom.sourceNotes, fixture.sourceNotes); assert.equal(dom.regionCount, 1); assert(dom.piano && dom.piano.width > 0);
      for (const canvas of dom.canvases) {
        assert(canvas.cssWidth > 0 && canvas.cssWidth <= dom.viewport.clientWidth + 4.1, `${fixture.file}: canvas CSS width exceeded viewport bound`);
        assert(canvas.width > 0 && canvas.width <= Math.ceil((dom.viewport.clientWidth + 5) * dom.devicePixelRatio), `${fixture.file}: oversized backing store`);
        assert(!canvas.pixelReadbackError, `${fixture.file}: canvas pixel readback failed`);
      }
      if (fixture.visiblePreview) { assert.equal(dom.canvases.length, 1); assert(dom.canvases[0].noteInkPixels > 0, `${fixture.file}: visible note thumbnail has no note ink`); }
      else {
        assert.equal(dom.canvases.length, 0, 'Far bar601 region should not allocate an offscreen thumbnail at initial import');
        assert(dom.regions[0].rect.x >= dom.viewport.rect.right, 'Far region should initially be outside the viewport');
      }
      const observation = { fixture: fixture.file, status: 'passed', expected: { tracks: 1, playbackNotes: fixture.playbackNotes, sourceNotes: fixture.sourceNotes, visiblePreview: fixture.visiblePreview }, dom, screenshot: await image(fixture.file.replace(/\.[^.]+$/, '.png')) };
      observations.push(observation);
      observation.fitAll = await fitAll(fixture);
    }
    report.dialogFixture = await desktop.evaluate(() => globalThis.__largeEditorDialogFixture);
    assert.equal(report.dialogFixture.calls.length, 4); assert.equal(report.dialogFixture.pending, null); assert.deepEqual(report.dialogFixture.unexpected, []);
    assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
    report.status = 'passed'; await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, applicationVersion: report.applicationVersion, imports: observations.length, report: reportFile, sha256: await sha256(reportFile) }));
  } catch (error) {
    report.status = 'failed'; report.error = String(error);
    if (page) { report.failureDom = await readDom().catch(() => null); await image('failure.png').catch(() => {}); }
    if (desktop) report.dialogFixture = await desktop.evaluate(() => globalThis.__largeEditorDialogFixture).catch(() => null);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); console.error(JSON.stringify({ status: 'failed', error: report.error, report: reportFile })); throw error;
  } finally {
    await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop?.close().catch(() => {});
  }
}
