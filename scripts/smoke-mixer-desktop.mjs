import { _electron as electron } from 'playwright';
import { extractFile } from '@electron/asar';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Invoke only existing native menus -> preload IPC -> App. Renderer evaluation
// reads DOM only: no input, DOM actions, React injection or replacement commands.
const argument = name => {
  const index = process.argv.indexOf(name); if (index < 0) return;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[index + 1];
};
const packagedArgument = argument('--packaged'), expectedVersion = argument('--expected-version'), projectArgument = argument('--project');
const live = process.argv.includes('--live');
assert(packagedArgument && expectedVersion, 'Use --packaged <unpacked executable> --expected-version <version> [--project <nbsx>] [--live].');
assert(!live || projectArgument, '--live requires an explicit --project realtime fixture.');
const executable = path.resolve(packagedArgument), appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
assert(!/(?:portable|setup)\.exe$/i.test(executable), 'Use the unpacked executable, not a portable or installer launcher.');
assert((await stat(executable)).isFile()); assert((await stat(appAsar)).isFile());
const sourceFile = path.resolve(projectArgument ?? '.local/mixer-ui/changed.nbsx');
const root = path.resolve('.local/mixer-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const sha256 = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), bytes: (await stat(file)).size, sha256: await sha256(file) });
const normalized = project => { const result = structuredClone(project); delete result.modifiedAt; return result; };
const helper = path.join(root, 'container-reader.mjs'), virtualName = 'mixer-desktop-container.ts';
const helperSource = "export {openNbsx} from './src/core/container.ts';";
const compiled = await build({ stdin: { contents: helperSource, sourcefile: virtualName, resolveDir: process.cwd() }, outfile: helper, platform: 'node', format: 'esm', bundle: true, metafile: true });
const { openNbsx } = await import(pathToFileURL(helper).href);
const project = openNbsx(new Uint8Array(await readFile(sourceFile))), sourceIdentity = await reference(sourceFile);
assert(project.tracks.length > 0, 'Mixer fixture needs at least one track.');
if (live) {
  assert.equal(project.tracks.length, 2, 'Live fixture must contain the two synthetic tracks.');
  assert.equal(project.audio.previewEngine, 'native', 'Live regression fixture must retain the legacy native project preference.');
  assert(project.tracks.every(track => !track.muted), 'Both live fixture tracks must be audible.');
}
const selectedTrackId = project.regions[0]?.trackId ?? project.tracks[0].id;
if (!projectArgument) {
  assert.equal(project.tracks.length, 14, 'Default fixture must contain the actual 14-track mixer checkpoint.');
  assert.equal(project.tracks[0].volume, 2.5); assert.equal(project.tracks[0].pan, -.375); assert.equal(project.audio.masterGain, 1.5);
  assert.equal(selectedTrackId, project.tracks[0].id, 'Default fixture selects track 1 on opening.');
}
const sources = {}, helperInputs = {};
for (const file of ['scripts/smoke-mixer-desktop.mjs', 'src/ui/App.tsx', 'src/ui/Mixer.tsx', 'src/ui/Mixer.css', 'src/ui/TrackInstrumentFilter.tsx', 'src/core/track-filter.ts', 'src/ui/CommitNumberInput.tsx', 'src/audio/engine.ts', 'src/core/types.ts', 'src/core/project.ts', 'src/core/container.ts', 'electron/main.ts', 'electron/preload.ts', 'package.json']) sources[file] = await sha256(file);
for (const input of Object.keys(compiled.metafile.inputs).sort()) if (!input.startsWith('<') && input !== virtualName) helperInputs[input.replaceAll('\\', '/')] = await sha256(path.resolve(input));
const packageJson = extractFile(appAsar, 'package.json'); assert.equal(JSON.parse(packageJson).version, expectedVersion);
const bundleIdentity = {};
const htmlPath = path.join('dist', 'index.html'), html = extractFile(appAsar, htmlPath);
const rendererEntries = [...html.toString().matchAll(/(?:src|href)="(?:\.\/)?([^"?#]+\.(?:js|css))"/g)].map(match => path.join('dist', match[1]));
assert(rendererEntries.some(file => file.endsWith('.js')), 'Packaged renderer entry must be identifiable.');
for (const file of [htmlPath, ...rendererEntries, path.join('dist-electron', 'main.cjs'), path.join('dist-electron', 'preload.cjs')]) {
  const bundled = extractFile(appAsar, file), local = await readFile(path.resolve(file));
  assert.equal(digest(bundled), digest(local), `${file}: package must match the current built bundle`);
  bundleIdentity[file.replaceAll('\\', '/')] = { packagedSha256: digest(bundled), localBuiltSha256: digest(local), bytes: bundled.length };
}
assert(rendererEntries.some(file => file.endsWith('.js') && extractFile(appAsar, file).includes(Buffer.from('mixer-console')) && extractFile(appAsar, file).includes(Buffer.from('mixer-master'))), 'The packaged renderer must contain the actual mixer console.');
const sessions = [], processes = [], observations = [], readbacks = [], screenshots = [], rendererErrors = [], consoleErrors = [], unexpectedDialogs = [], playbackObservations = [];
const reportFile = path.join(root, 'report.json');
const report = { schema: 1, status: 'running', packaged: true, root, profile, expectedVersion, runnerPid: process.pid,
  scope: 'Actual packaged native Open/View Mixer/Save As menus -> preload IPC -> App, dialog-return fixtures, read-only complete mixer DOM, saved ZIP semantic comparison, process restart and reopen/resave.' + (live ? ' Additionally, actual native Play/Pause menus exercise default realtime playback and real track/master meter DOM without changing the legacy project preference.' : ''),
  limitations: ['No DOM click, focus, scroll write, mouse/keyboard synthesis, React-state injection or replacement editor command is used.', 'File-picker results are controlled fixtures, not human chooser acceptance.', 'All offscreen strips are checked through read-only DOM; screenshots show the available viewport.', 'The container helper is compiled from current sources and only reads NBSX files; all project data except root modifiedAt is compared.', live ? 'Playback scope is default realtime Play/Pause and simultaneously nonzero actual two-track/master meters. Parameter edits, acoustic capture, native PCM fidelity, hardware MIDI and physical gestures are not checked by this script.' : 'No playback, native/audio rendering, hardware MIDI, meter-acoustic, gesture or FPS claim.'],
  source: sourceIdentity, defaultCheckpoint: !projectArgument, expected: { tracks: project.tracks.length, master: 1, selectedTrackId,
    track1: { volumePercent: project.tracks[0].volume * 100, panPercent: project.tracks[0].pan * 100 }, masterPercent: project.audio.masterGain * 100,
    ...(live ? { live: { defaultPlaybackMode: 'realtime', unchangedProjectPreviewEngine: project.audio.previewEngine, simultaneousTrackMeters: 2, masterMeterPositive: true, positiveVisualFills: true, maximumPollMs: 5000 } } : {}) },
  sources, images: [await reference(executable), await reference(appAsar)], packageJsonSha256: digest(packageJson), bundleIdentity,
  containerHelper: { file: await reference(helper), virtualEntry: { name: virtualName, sha256: digest(helperSource) }, inputs: helperInputs },
  live, sessions, processes, observations, readbacks, screenshots, rendererErrors, consoleErrors, unexpectedDialogs, playbackObservations };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
const environment = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
let desktop, page, session, terminal;
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readDom = () => page.evaluate(() => {
  const mixer = document.querySelector('section.mixer-console[aria-label="混音器"]');
  const rectangle = element => { const bounds = element?.getBoundingClientRect(); return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, top: bounds.top, bottom: bounds.bottom } : null; };
  const scroller = mixer?.querySelector('.mixer-scroll'), scrollBounds = scroller?.getBoundingClientRect();
  const scrollViewport = scroller && scrollBounds ? { top: scrollBounds.top + scroller.clientTop, bottom: scrollBounds.top + scroller.clientTop + scroller.clientHeight,
    height: scroller.clientHeight, width: scroller.clientWidth, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, scrollHeight: scroller.scrollHeight, scrollWidth: scroller.scrollWidth } : null;
  const masterBounds = rectangle(mixer?.querySelector('.mixer-master'));
  const firstButtons = [...(mixer?.querySelector('.mixer-strip .mixer-channel-buttons')?.querySelectorAll('button') ?? [])].map(button => ({ label: button.getAttribute('aria-label'), bounds: rectangle(button),
    fullyInsideMixerScroll: !!scrollViewport && button.getBoundingClientRect().top >= scrollViewport.top && button.getBoundingClientRect().bottom <= scrollViewport.bottom }));
  const controls = (element, viewport = scrollViewport) => [...(element?.querySelectorAll('input[aria-label]') ?? [])].map(input => ({ label: input.getAttribute('aria-label'), type: input.type, value: Number(input.value), min: Number(input.min), max: Number(input.max), disabled: input.matches(':disabled'), invalid: input.getAttribute('aria-invalid'),
    bounds: rectangle(input), verticallyInsideViewport: !!viewport && input.getBoundingClientRect().top >= viewport.top && input.getBoundingClientRect().bottom <= viewport.bottom }));
  const bounds = mixer?.getBoundingClientRect();
  const meter = element => {
    const raw = element?.getAttribute('aria-valuenow'), fill = element?.querySelector('i');
    return { label: element?.getAttribute('aria-label') ?? null, role: element?.getAttribute('role') ?? null, value: raw === null || raw === undefined ? null : Number(raw),
      visualFillPercent: Number.parseFloat(fill?.style.height ?? '0'), visualFillPixels: fill?.getBoundingClientRect().height ?? 0, title: element?.getAttribute('title') ?? null };
  };
  return { title: document.title, mixerCount: document.querySelectorAll('section.mixer-console[aria-label="混音器"]').length,
    realMixer: !!mixer?.querySelector('.mixer-strips') && !!mixer?.querySelector('.mixer-master .mixer-fader input[type="range"]'),
    strips: [...(mixer?.querySelectorAll('.mixer-strip') ?? [])].map(strip => ({ id: strip.getAttribute('data-track-id'), number: Number(strip.querySelector('.mixer-track-number')?.textContent), name: strip.querySelector('.mixer-track-name')?.textContent,
      active: strip.classList.contains('active'), current: strip.getAttribute('aria-current'), controls: controls(strip), meterCount: strip.querySelectorAll('.mixer-meter').length,
      meter: meter(strip.querySelector('.mixer-meter')),
      buttons: [...strip.querySelectorAll('.mixer-channel-buttons button')].map(button => ({ label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed') })) })),
    masterCount: mixer?.querySelectorAll('.mixer-master').length ?? 0, masterControls: controls(mixer?.querySelector('.mixer-master'), masterBounds), masterMeterCount: mixer?.querySelectorAll('.mixer-master .mixer-meter').length ?? 0,
    masterMeter: meter(mixer?.querySelector('.mixer-master .mixer-meter')),
    filterValue: mixer?.querySelector('select[aria-label="混音器乐器筛选"]')?.value, filterText: mixer?.querySelector('.track-instrument-filter')?.textContent,
    activeArrangementTrack: document.querySelector('.track-header.active .track-info strong')?.textContent ?? null,
    message: document.querySelector('.status-message')?.textContent ?? '', scopeNote: mixer?.querySelector('.mixer-scope-note')?.textContent,
    transport: { position: document.querySelector('[data-testid="transport-position"]')?.textContent ?? null,
      buttonLabel: document.querySelector('.transport .play-button')?.getAttribute('aria-label') ?? null,
      playing: !!document.querySelector('.transport .play-button.is-playing') },
    verticalVisibility: { policy: 'Above 800px renderer height, every strip/master input and first M/S must fit vertically. At 800px or below, clipped strip content requires actual vertical scroll extent.',
      scrollViewport, masterBounds, firstStrip: rectangle(mixer?.querySelector('.mixer-strip')), firstChannelButtons: firstButtons },
    bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null, viewport: { width: innerWidth, height: innerHeight } };
});
async function actualMenu(name) {
  await desktop.evaluate(({ Menu }, name) => {
    const labels = { open: ['文件', '打开 / 导入…'], mixer: ['视图', '混音器'], 'save-as': ['文件', '另存为…'], play: ['播放', '播放 / 暂停'] }, wanted = labels[name];
    if (!wanted) throw new Error('Unsupported native menu fixture command: ' + name);
    const item = Menu.getApplicationMenu()?.items.find(group => group.label.replaceAll('&', '') === wanted[0])?.submenu?.items.find(item => item.label.replaceAll('&', '') === wanted[1]);
    if (!item?.enabled || typeof item.click !== 'function') throw new Error('Actual native menu unavailable: ' + name);
    globalThis.__mixerDesktopFixture.commands.push({ name, label: item.label, delivery: 'actual-native-menu-to-preload-IPC' }); item.click();
  }, name); await flush();
}
async function verifyLiveDefault() {
  const record = { session: session.index, startedAt: new Date().toISOString(), projectPreviewEngine: project.audio.previewEngine, samples: [], status: 'running' };
  playbackObservations.push(record);
  const before = await readDom(); assert.equal(before.transport.playing, false); assert.equal(before.transport.buttonLabel, '播放');
  await actualMenu('play');
  const started = Date.now(), deadline = started + 5000;
  let positive;
  while (Date.now() <= deadline) {
    const dom = await readDom();
    record.samples.push({ elapsedMs: Date.now() - started, transport: dom.transport, message: dom.message, scopeNote: dom.scopeNote,
      tracks: dom.strips.map(strip => ({ id: strip.id, meter: strip.meter })), master: dom.masterMeter });
    const tracks = project.tracks.map(track => dom.strips.find(strip => strip.id === track.id)?.meter);
    if (dom.transport.playing && dom.transport.buttonLabel === '暂停' && dom.transport.position && dom.transport.position !== before.transport.position
      && dom.message.includes('实时试听') && dom.scopeNote?.includes('实时试听') && !dom.scopeNote.includes('离线快照')
      && tracks.every(meter => meter?.role === 'meter' && Number.isFinite(meter.value) && meter.value > 0 && meter.visualFillPercent > 0 && meter.visualFillPixels > 0)
      && dom.masterMeter.role === 'meter' && Number.isFinite(dom.masterMeter.value) && dom.masterMeter.value > 0 && dom.masterMeter.visualFillPercent > 0 && dom.masterMeter.visualFillPixels > 0) { positive = dom; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert(positive, 'Default Play must advance transport and expose both real track meters plus Master > 0 with nonzero visual fills simultaneously within 5 seconds.');
  assert(!positive.title.startsWith('●'), 'Playback must not change the project document.');
  record.positive = positive; record.positiveElapsedMs = Date.now() - started;
  const screenshot = path.join(root, 'live-default-realtime-playing.png'); await page.screenshot({ path: screenshot, fullPage: false }); screenshots.push({ label: 'live-default-realtime-playing', file: await reference(screenshot) });
  await actualMenu('play');
  await page.waitForFunction(() => !document.querySelector('.transport .play-button.is-playing') && document.querySelector('.transport .play-button')?.getAttribute('aria-label') === '播放', undefined, { timeout: 5000 });
  const paused = await readDom(); await new Promise(resolve => setTimeout(resolve, 180)); const settled = await readDom();
  assert.equal(paused.transport.playing, false); assert.equal(settled.transport.playing, false); assert.equal(settled.transport.position, paused.transport.position, 'Transport must stay still after the actual Pause menu.');
  assert(settled.strips.every(strip => strip.meter.role === 'meter' && strip.meter.value === 0), 'Paused real track meters must show zero.'); assert.equal(settled.masterMeter.value, 0);
  assert(!settled.title.startsWith('●'), 'Pause must not dirty the project.');
  record.paused = paused; record.settledAfterPause = settled; record.status = 'passed'; record.endedAt = new Date().toISOString();
  await inspect('live-paused');
}
async function inspect(label) {
  const dom = await readDom(); assert.equal(dom.mixerCount, 1, label); assert.equal(dom.realMixer, true, label); assert.equal(dom.strips.length, project.tracks.length, label); assert.equal(dom.masterCount, 1, label); assert.equal(dom.masterMeterCount, 1, label);
  assert(!dom.title.startsWith('●'), `${label}: read-only checks must not dirty the project`); assert.equal(dom.filterValue, '', label); assert(dom.filterText.includes(`显示 ${project.tracks.length} / ${project.tracks.length} 轨`), label);
  const control = (inputs, label, type, value, min, max, disabled) => { const item = inputs.find(input => input.label === label && input.type === type); assert(item, `Missing ${type} ${label}`); assert.equal(item.value, value, label); assert.equal(item.min, min, label); assert.equal(item.max, max, label); assert.equal(item.disabled, disabled, label); assert.equal(item.invalid, null, label); };
  project.tracks.forEach((track, index) => {
    const strip = dom.strips[index]; assert.equal(strip.id, track.id); assert.equal(strip.name, track.name); assert.equal(strip.number, index + 1); assert.equal(strip.active, track.id === selectedTrackId); assert.equal(strip.current, track.id === selectedTrackId ? 'true' : null); assert.equal(strip.meterCount, 1); assert.equal(strip.controls.length, 4);
    for (const type of ['range', 'number']) {
      control(strip.controls, `${track.name} 音量${type === 'number' ? '百分比' : ''}`, type, track.volume * 100, 0, 400, track.locked);
      control(strip.controls, `${track.name} 声像${type === 'number' ? '百分比' : ''}`, type, track.pan * 100, -100, 100, track.locked);
    }
    assert.deepEqual(strip.buttons, [{ label: `${track.name} 静音`, pressed: String(track.muted) }, { label: `${track.name} 独奏`, pressed: String(track.solo) }]);
  });
  assert.equal(dom.strips.filter(strip => strip.active).length, 1); assert.equal(dom.masterControls.length, 2);
  for (const type of ['range', 'number']) control(dom.masterControls, `总输出音量${type === 'number' ? '百分比' : ''}`, type, project.audio.masterGain * 100, 0, 200, false);
  assert(dom.bounds?.width > 0 && dom.bounds?.height > 0 && dom.bounds.y < dom.viewport.height && dom.bounds.y + dom.bounds.height > 0, 'Actual mixer is laid out in the viewport');
  const allInputsVisible = [...dom.strips.flatMap(strip => strip.controls), ...dom.masterControls].every(input => input.verticallyInsideViewport);
  const buttonsVisible = dom.verticalVisibility.firstChannelButtons.length === 2 && dom.verticalVisibility.firstChannelButtons.every(button => button.fullyInsideMixerScroll);
  if (dom.viewport.height > 800) { assert(allInputsVisible, `${label}: all mixer inputs must fit vertically in the normal-height window`); assert(buttonsVisible, `${label}: first-track M/S must fit without inner scrolling`); }
  else if (!allInputsVisible || !buttonsVisible) assert(dom.verticalVisibility.scrollViewport.scrollHeight > dom.verticalVisibility.scrollViewport.height, `${label}: clipped small-window tracks need real vertical scrolling`);
  observations.push({ label, session: session.index, dom });
  const file = path.join(root, `${label}.png`); await page.screenshot({ path: file, fullPage: false }); screenshots.push({ label, file: await reference(file) });
}
async function open(file, label) {
  await desktop.evaluate((_, file) => { const state = globalThis.__mixerDesktopFixture; if (state.open) throw new Error('Unconsumed Open fixture'); state.open = file; }, file);
  await actualMenu('open');
  await page.waitForFunction(name => document.title.includes(name) && !document.title.startsWith('●'), project.name, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent?.includes('正在查找'), undefined, { timeout: 90000 });
  if ((await readDom()).mixerCount === 0) { await actualMenu('mixer'); await page.waitForFunction(() => document.querySelectorAll('section.mixer-console').length === 1); }
  await inspect(label);
}
async function save(label) {
  const file = path.join(root, `${label}.nbsx`);
  await desktop.evaluate((_, file) => { const state = globalThis.__mixerDesktopFixture; if (state.save) throw new Error('Unconsumed Save fixture'); state.save = file; }, file);
  await actualMenu('save-as');
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('已保存') && !document.title.startsWith('●'), undefined, { timeout: 30000 });
  const reopened = openNbsx(new Uint8Array(await readFile(file))); assert.deepEqual(normalized(reopened), normalized(project), `${label}: complete saved ZIP project mismatch`);
  if (live) assert.equal(reopened.audio.previewEngine, 'native', 'Default realtime playback must not rewrite the legacy project previewEngine field.');
  readbacks.push({ label, session: session.index, file: await reference(file), fullProjectCompared: true, ignoredFields: ['modifiedAt'], tracks: reopened.tracks.length, masterGain: reopened.audio.masterGain, projectPreviewEngine: reopened.audio.previewEngine, firstTrack: { volume: reopened.tracks[0].volume, pan: reopened.tracks[0].pan } });
  await inspect(`${label}-dom`); return file;
}
async function launch() {
  const launchArgs = [...(live ? [] : ['--mute-audio']), `--user-data-dir=${profile}`];
  desktop = await electron.launch({ executablePath: executable, args: launchArgs, env: environment });
  const child = desktop.process(), record = { pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, signal: null }; processes.push(record);
  terminal = new Promise(resolve => child.once('exit', (exitCode, signal) => { Object.assign(record, { exitCode, signal, exitedAt: new Date().toISOString() }); resolve(record); }));
  session = { index: sessions.length + 1, pid: child.pid, launchArgs, audioMutedByHarness: !live }; sessions.push(session);
  let stdout = '', stderr = ''; child.stdout?.on('data', bytes => { stdout += bytes; }); child.stderr?.on('data', bytes => { stderr += bytes; }); session.logs = () => ({ stdout, stderr });
  const identity = await desktop.evaluate(({ app, BrowserWindow }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), evaluatedProcessPid: process.pid, runtime: process.versions,
    appMetrics: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, creationTime: metric.creationTime })),
    windows: BrowserWindow.getAllWindows().map(window => ({ bounds: window.getBounds(), contentBounds: window.getContentBounds() })) }));
  Object.assign(session, identity); assert.equal(identity.version, expectedVersion); assert.equal(identity.packaged, true); assert.equal(path.resolve(identity.userData), profile); assert.equal(path.resolve(identity.appPath), appAsar);
  const browser = identity.appMetrics.find(metric => metric.type === 'Browser'); assert(browser && Number.isInteger(browser.pid) && browser.pid > 0, 'Actual Browser process identity must be observable');
  session.browserPid = browser.pid; record.browserPid = browser.pid; assert(processAlive(browser.pid), 'Owned browser process must be live');
  page = await desktop.firstWindow(); const index = session.index;
  page.on('pageerror', error => rendererErrors.push({ session: index, message: error.message })); page.on('crash', () => rendererErrors.push({ session: index, message: 'Renderer crashed' }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ session: index, message: message.text() }); });
  page.on('dialog', dialog => { unexpectedDialogs.push({ session: index, type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
  await page.waitForFunction(() => !!window.desktop && !!document.querySelector('.piano-viewport canvas'), undefined, { timeout: 60000 }); assert.equal(await page.getByRole('dialog').count(), 0);
  await desktop.evaluate(({ dialog }) => {
    globalThis.__mixerDesktopFixture = { open: null, save: null, commands: [], calls: [], unexpected: [] };
    dialog.showOpenDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.properties)), state = globalThis.__mixerDesktopFixture;
      if (!state.open || !['打开工程或导入 MIDI / NBS', '打开工程或导入 MIDI / NBS / FLP'].includes(options?.title) || !options.properties.includes('openFile')) { state.unexpected.push({ kind: 'open', title: options?.title }); return { canceled: true, filePaths: [] }; }
      const file = state.open; state.open = null; state.calls.push({ kind: 'open', file, title: options.title }); return { canceled: false, filePaths: [file] };
    };
    dialog.showSaveDialog = async (...args) => {
      const options = args.find(value => value && typeof value === 'object' && Array.isArray(value.filters)), state = globalThis.__mixerDesktopFixture;
      if (!state.save || !options?.filters?.some(filter => filter.extensions.includes('nbsx'))) { state.unexpected.push({ kind: 'save', defaultPath: options?.defaultPath }); return { canceled: true }; }
      const file = state.save; state.save = null; state.calls.push({ kind: 'save', file }); return { canceled: false, filePath: file };
    };
  });
}
async function finishSession({ force = false } = {}) {
  if (!desktop) return;
  session.dialogFixture = await desktop.evaluate(() => globalThis.__mixerDesktopFixture).catch(() => null);
  if (!force) {
    assert(!(await page.title()).startsWith('●')); assert.equal(session.dialogFixture.open, null); assert.equal(session.dialogFixture.save, null); assert.deepEqual(session.dialogFixture.unexpected, []);
    assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'open').length, 1); assert.equal(session.dialogFixture.calls.filter(call => call.kind === 'save').length, 1);
    assert.equal(session.dialogFixture.commands.filter(command => command.name === 'play').length, live && session.index === 1 ? 2 : 0);
  } else await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await desktop.close();
  let timeout; const ended = await Promise.race([terminal, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned application did not exit after close')), 30000); })]).finally(() => clearTimeout(timeout));
  if (session.browserPid) {
    const deadline = Date.now() + 10000;
    while (processAlive(session.browserPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    ended.browserExited = !processAlive(session.browserPid); assert(ended.browserExited, 'Owned Browser process must exit after application close');
  }
  const logs = session.logs(); delete session.logs;
  for (const [name, content] of Object.entries(logs)) { const file = path.join(root, `session-${session.index}-${name}.log`); await writeFile(file, content); session[name] = await reference(file); }
  session.closeMethod = force ? 'Failure cleanup: destroy only owned windows, then ElectronApplication.close' : 'ElectronApplication.close after clean saved project';
  desktop = undefined; page = undefined;
  if (!force) { assert.equal(ended.exitCode, 0); assert.equal(ended.signal, null); }
}
try {
  await launch(); await open(sourceFile, 'loaded'); if (live) await verifyLiveDefault(); const savedFile = await save('saved'); await finishSession();
  assert.deepEqual(normalized(openNbsx(new Uint8Array(await readFile(savedFile)))), normalized(project), 'Restart input ZIP must still match the full source');
  await launch(); await open(savedFile, 'reopened-after-process-restart'); await save('resaved-after-restart'); await finishSession();
  assert.equal(sessions.length, 2); assert.equal(readbacks.length, 2); assert.deepEqual(rendererErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(unexpectedDialogs, []);
  assert.deepEqual(await reference(sourceFile), sourceIdentity, 'The original fixture must stay byte-identical');
  for (const image of report.images) assert.equal(await sha256(path.resolve(image.path)), image.sha256, 'Packaged image changed during acceptance');
  for (const [file, expected] of Object.entries(sources)) assert.equal(await sha256(file), expected, `${file}: source changed during acceptance`);
  report.status = 'passed'; report.applicationRestarted = true; report.completeSavedZipReadbacks = readbacks.length;
  if (live) { assert.equal(playbackObservations.length, 1); assert.equal(playbackObservations[0].status, 'passed'); report.defaultRealtimePlaybackVerified = true; report.legacyPreviewEnginePreserved = true; }
  report.sourceUnchanged = true; report.terminalComplete = processes.every(process => process.exitCode === 0 && process.signal === null && process.browserExited);
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  if (page) { report.failureDom = await readDom().catch(() => null); const file = path.join(root, 'failure.png'); await page.screenshot({ path: file }).then(async () => screenshots.push({ label: 'failure', file: await reference(file) })).catch(() => {}); }
  await finishSession({ force: true }).catch(cleanupError => { report.cleanupError = String(cleanupError); });
  process.exitCode = 1;
} finally {
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, expectedVersion, live, report: reportFile, sha256: await sha256(reportFile), sessions: sessions.length, completeSavedZipReadbacks: readbacks.length, defaultRealtimePlaybackVerified: report.defaultRealtimePlaybackVerified ?? false, terminal: processes }));
}
