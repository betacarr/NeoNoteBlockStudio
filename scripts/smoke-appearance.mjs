import { INTERNAL_LIQUID_GLASS } from '../src/core/appearance.ts';
import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import asar from '@electron/asar';

// This optical fixture is for separate internal builds only.
if (!INTERNAL_LIQUID_GLASS) { console.log('SKIP: Liquid Glass is internal-only; the public build has no appearance entry.'); process.exit(0); }

// This is an application integration fixture. It never synthesizes pointer or keyboard input.
// The human-facing appearance switch is exercised separately through real UI automation.
const packagedAt = process.argv.indexOf('--packaged');
if (packagedAt >= 0 && !process.argv[packagedAt + 1]) throw new Error('--packaged requires an unpacked application executable.');
const packaged = packagedAt < 0 ? undefined : path.resolve(process.argv[packagedAt + 1]);
if (packaged && /portable\.exe$/i.test(packaged)) throw new Error('Use the unpacked executable, not the portable SFX launcher.');
const root = path.resolve('.local/appearance-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(profile, { recursive: true });
const environment = { ...process.env, NBSX_TEST_USER_DATA: profile };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
const errors = [], consoleErrors = [], screenshots = [];
const report = { packaged: !!packaged, profile, screenshots, rendererErrors: errors, consoleErrors, reloads: [] };
let desktop, page;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function instrumentation() {
  if (window.__appearanceSmoke) return;
  const stats = { token: `${Date.now()}-${Math.random()}`, encodes: 0, resize: [], mutations: [], media: [] };
  Object.defineProperty(window, '__appearanceSmoke', { value: stats, configurable: true });
  const encode = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) { stats.encodes++; return encode.apply(this, args); };
  const Resize = window.ResizeObserver;
  if (Resize) window.ResizeObserver = class extends Resize {
    constructor(callback) { super(callback); this.record = { theme: false, targets: new Set() }; stats.resize.push(this.record); }
    observe(target, options) { this.record.theme ||= target.classList?.contains('liquid-glass-surface'); this.record.targets.add(target); return super.observe(target, options); }
    unobserve(target) { this.record.targets.delete(target); return super.unobserve(target); }
    disconnect() { this.record.targets.clear(); return super.disconnect(); }
  };
  const Mutation = window.MutationObserver;
  window.MutationObserver = class extends Mutation {
    constructor(callback) { super(callback); this.record = { theme: false, targets: new Set() }; stats.mutations.push(this.record); }
    observe(target, options) { this.record.theme ||= target.classList?.contains('studio'); this.record.targets.add(target); return super.observe(target, options); }
    disconnect() { this.record.targets.clear(); return super.disconnect(); }
  };
  const add = MediaQueryList.prototype.addEventListener, remove = MediaQueryList.prototype.removeEventListener;
  MediaQueryList.prototype.addEventListener = function (type, listener, options) {
    if (type === 'change' && /forced-colors|prefers-reduced-transparency/.test(this.media)) stats.media.push({ target: this, listener, active: true });
    return add.call(this, type, listener, options);
  };
  MediaQueryList.prototype.removeEventListener = function (type, listener, options) {
    if (type === 'change') for (const item of stats.media) if (item.target === this && item.listener === listener) item.active = false;
    return remove.call(this, type, listener, options);
  };
  // Explicit unsupported-engine fixture, scoped to this isolated profile and reload only.
  if (localStorage.getItem('__appearanceSmokeNoFilter') === '1') {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => /backdrop-filter/.test(args.join(' ')) ? false : supports(...args);
  }
}

async function reload() {
  const token = await page.evaluate(() => window.__appearanceSmoke?.token);
  const before = await page.evaluate(() => ({ token: window.__appearanceSmoke?.token, title: document.title, savedAppearance: JSON.parse(localStorage.getItem('nbsx-preferences') ?? '{}').appearance }));
  const navigation = await desktop.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const record = { webContentsId: contents.id, started: false, finished: false, beforeUnloadAuthorizations: 0 };
    // Explicit fixture authorization for this reload only. Keep the application's
    // dirty state and beforeunload handler; never remove or replace them.
    const authorize = event => { record.beforeUnloadAuthorizations++; event.preventDefault(); };
    const started = () => { record.started = true; };
    const cleanup = () => { clearTimeout(timer); contents.removeListener('will-prevent-unload', authorize); contents.removeListener('did-start-loading', started); contents.removeListener('did-finish-load', finished); contents.removeListener('did-fail-load', failed); };
    const finished = () => { record.finished = true; cleanup(); resolve(record); };
    const failed = (_event, code, description, url, mainFrame) => { if (mainFrame) { cleanup(); reject(new Error(`Appearance fixture reload failed: ${code} ${description} ${url}`)); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Appearance fixture reload did not finish: ${JSON.stringify(record)}`)); }, 30000);
    contents.once('will-prevent-unload', authorize); contents.once('did-start-loading', started); contents.once('did-finish-load', finished); contents.on('did-fail-load', failed);
    contents.reload();
  }));
  await page.waitForFunction(old => typeof window.__appearanceSmoke?.token === 'string' && window.__appearanceSmoke.token !== old && document.readyState === 'complete' && !!document.querySelector('.piano-viewport canvas'), token, { timeout: 30000 });
  const after = await page.evaluate(() => ({ token: window.__appearanceSmoke.token, title: document.title, appearance: document.querySelector('.studio').dataset.appearance, savedAppearance: JSON.parse(localStorage.getItem('nbsx-preferences') ?? '{}').appearance }));
  assert.notEqual(after.token, token, 'A real new document must finish before checking a seeded preference');
  report.reloads.push({ before, navigation, after });
}
async function launch() {
  desktop = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env: environment });
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => errors.push('Renderer crashed'));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), !!packaged);
  report.version = await desktop.evaluate(({ app }) => app.getVersion());
  report.runtime = await desktop.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch }));
  await page.waitForFunction(() => !!document.querySelector('.piano-viewport canvas'), null, { timeout: 30000 });
  await page.addInitScript(instrumentation); await page.evaluate(instrumentation); await reload();
}
async function close() {
  await desktop?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await desktop?.close().catch(() => {}); desktop = undefined; page = undefined;
}
async function command(name) { await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('menu', value), name); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function screenshot(name, options = {}) {
  const filename = path.join(root, name); await page.screenshot({ path: filename, ...options }); screenshots.push(filename); return filename;
}
async function seedAppearance(appearance, noFilter = false) {
  await page.evaluate(({ appearance, noFilter }) => {
    const saved = JSON.parse(localStorage.getItem('nbsx-preferences') ?? '{}');
    localStorage.setItem('nbsx-preferences', JSON.stringify({ ...saved, appearance }));
    if (noFilter) localStorage.setItem('__appearanceSmokeNoFilter', '1'); else localStorage.removeItem('__appearanceSmokeNoFilter');
  }, { appearance, noFilter });
  await reload();
}
async function snapshot() {
  return page.evaluate(() => {
    const stats = window.__appearanceSmoke, studio = document.querySelector('.studio');
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { width: r.width, height: r.height }; };
    const filters = [...document.querySelectorAll('.liquid-glass-definitions filter')].map(filter => ({
      id: filter.id, width: Number(filter.getAttribute('width')), height: Number(filter.getAttribute('height')),
      href: filter.querySelector('feImage')?.getAttribute('href'), scale: Number(filter.querySelector('feDisplacementMap')?.getAttribute('scale')),
      result: filter.querySelector('feImage')?.getAttribute('result'), input: filter.querySelector('feDisplacementMap')?.getAttribute('in2'),
    }));
    return {
      appearance: studio.dataset.appearance, mode: studio.dataset.glassMode ?? null,
      savedAppearance: JSON.parse(localStorage.getItem('nbsx-preferences') ?? '{}').appearance,
      layers: document.querySelectorAll('.liquid-glass-backdrop').length, surfaces: document.querySelectorAll('.liquid-glass-surface').length,
      definitions: document.querySelectorAll('.liquid-glass-definitions').length,
      filters: filters.map(({ href, ...item }) => ({ ...item, mapBytes: href?.length ?? 0, hasPng: href?.startsWith('data:image/png') ?? false })),
      encodes: stats.encodes,
      activeThemeResizeObservers: stats.resize.filter(item => item.theme && item.targets.size).length,
      activeThemeMutationObservers: stats.mutations.filter(item => item.theme && item.targets.size).length,
      activeThemeMediaListeners: stats.media.filter(item => item.active).length,
      musicalCanvasFilters: ['.piano-surface', '.piano-viewport', '.piano-viewport canvas'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector)); return { selector, filter: style.filter, backdropFilter: style.backdropFilter };
      }),
      decorativeLayersIgnoreInput: [...document.querySelectorAll('.liquid-glass-backdrop')].every(layer => getComputedStyle(layer).pointerEvents === 'none'),
      geometry: { play: rect('.play-button'), toolbar: rect('.toolbar'), pianoZoom: rect('input[aria-label="钢琴卷帘缩放"]') },
    };
  });
}
async function waitForGlass() {
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.glassMode === 'refracted' && document.querySelectorAll('.liquid-glass-backdrop').length >= 7 && [...document.querySelectorAll('.liquid-glass-definitions feImage')].every(image => image.getAttribute('href')?.startsWith('data:image/png')), null, { timeout: 30000 });
  await frames();
}
function assertClassic(state) {
  assert.equal(state.appearance, 'classic'); assert.equal(state.mode, null);
  for (const field of ['layers', 'surfaces', 'definitions', 'encodes', 'activeThemeResizeObservers', 'activeThemeMutationObservers', 'activeThemeMediaListeners']) assert.equal(state[field], 0, `Classic must have no ${field}`);
  assert.deepEqual(state.filters, []);
}
function assertGlass(state) {
  assert.equal(state.appearance, 'liquid-glass'); assert.equal(state.mode, 'refracted'); assert(state.layers >= 7);
  assert.equal(state.layers, state.filters.length); assert.equal(state.layers, state.surfaces);
  assert(state.encodes > 0); assert(state.activeThemeResizeObservers > 0); assert(state.activeThemeMutationObservers > 0);
  assert.equal(state.activeThemeMediaListeners, 2); assert(state.decorativeLayersIgnoreInput);
  for (const filter of state.filters) { assert(filter.width > 0 && filter.height > 0 && filter.scale > 0 && filter.hasPng && filter.mapBytes > 100); assert.equal(filter.result, filter.input); }
  for (const item of state.musicalCanvasFilters) { assert.equal(item.filter, 'none'); assert.equal(item.backdropFilter, 'none'); }
}

async function opticalPixels() {
  // An isolated, static checkerboard samples the REAL application's map, dimensions and scale.
  // Neutral and refracted captures retain the identical SVG URL / blur / saturation chain.
  // Only feDisplacementMap.scale changes, so CSS parser support or a blur alone cannot pass.
  const fixture = await page.evaluate(async () => {
    const layer = document.querySelector('.control-bar > .liquid-glass-backdrop');
    const id = /url\(["']?#([^"')]+)/.exec(layer.style.backdropFilter)?.[1], source = document.getElementById(id);
    if (!source) throw new Error('No real control-bar displacement filter');
    const filter = source.cloneNode(true); filter.id = 'appearance-smoke-optics';
    const width = Number(filter.getAttribute('width')), height = Number(filter.getAttribute('height'));
    const scale = Number(filter.querySelector('feDisplacementMap').getAttribute('scale'));
    const box = document.createElement('div'); box.id = 'appearance-smoke-optical-fixture';
    const y = Math.max(0, Math.min(300, innerHeight - height - 10));
    box.style.cssText = `position:fixed;left:0;top:${y}px;width:${width}px;height:${height}px;z-index:2147483647;overflow:hidden;background:repeating-conic-gradient(#061c48 0% 25%,#f4fae8 0% 50%) 0 0 / 12px 12px;`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.cssText = 'position:absolute;pointer-events:none;overflow:visible'; defs.append(filter); svg.append(defs);
    const backdrop = document.createElement('div'); backdrop.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    backdrop.style.backdropFilter = layer.style.backdropFilter.replace(/url\([^)]*\)/, 'url("#appearance-smoke-optics")');
    filter.querySelector('feDisplacementMap').setAttribute('scale', '0');
    box.append(svg, backdrop); document.body.append(box);
    const image = new Image(); image.src = filter.querySelector('feImage').getAttribute('href'); await image.decode();
    return { clip: { x: 0, y, width, height }, scale, mapBytes: image.src.length, mapWidth: image.naturalWidth, mapHeight: image.naturalHeight };
  });
  try {
    await frames(); const neutral = await page.screenshot({ path: path.join(root, 'optical-neutral.png'), clip: fixture.clip }); screenshots.push(path.join(root, 'optical-neutral.png'));
    await page.evaluate(scale => document.querySelector('#appearance-smoke-optics feDisplacementMap').setAttribute('scale', String(scale)), fixture.scale);
    await frames(); const refracted = await page.screenshot({ path: path.join(root, 'optical-refracted.png'), clip: fixture.clip }); screenshots.push(path.join(root, 'optical-refracted.png'));
    await frames(); const repeated = await page.screenshot({ clip: fixture.clip });
    const pixels = await desktop.evaluate(({ nativeImage }, inputs) => {
      const images = inputs.slice(0, 3).map(value => nativeImage.createFromBuffer(Buffer.from(value, 'base64'))), size = images[0].getSize();
      const [neutral, refracted, repeated] = images.map(image => image.toBitmap());
      if (neutral.length !== refracted.length || refracted.length !== repeated.length) throw new Error('Optical capture dimensions changed');
      let changed = 0, sum = 0, maximum = 0, repeatChanges = 0, edgeChanged = 0, interiorChanged = 0, edgeSum = 0, interiorSum = 0, edgePixels = 0, interiorPixels = 0;
      const band = Math.max(2, Math.round(22 * size.width / inputs[3]));
      for (let offset = 0; offset < neutral.length; offset += 4) {
        const pixel = offset / 4, x = pixel % size.width, y = Math.floor(pixel / size.width);
        const difference = Math.max(...[0, 1, 2].map(channel => Math.abs(neutral[offset + channel] - refracted[offset + channel])));
        if (difference > 8) changed++; sum += difference; maximum = Math.max(maximum, difference);
        if ([0, 1, 2, 3].some(channel => refracted[offset + channel] !== repeated[offset + channel])) repeatChanges++;
        const edge = x < band || y < band || x >= size.width - band || y >= size.height - band;
        if (edge) { edgePixels++; edgeSum += difference; if (difference > 8) edgeChanged++; }
        else { interiorPixels++; interiorSum += difference; if (difference > 8) interiorChanged++; }
      }
      return { ...size, changedPixels: changed, changedFraction: changed / (neutral.length / 4), meanMaximumChannelDifference: sum / (neutral.length / 4), maximumDifference: maximum, repeatedCaptureChangedPixels: repeatChanges,
        edgeChangedPixels: edgeChanged, interiorChangedPixels: interiorChanged, edgeMeanDifference: edgeSum / edgePixels, interiorMeanDifference: interiorSum / Math.max(1, interiorPixels) };
    }, [neutral.toString('base64'), refracted.toString('base64'), repeated.toString('base64'), fixture.clip.width]);
    assert(pixels.changedPixels > 500, 'Actual displacement must visibly change the checkerboard versus the same SVG filter at scale zero');
    assert(pixels.edgeChangedPixels > 200); assert(pixels.edgeMeanDifference > pixels.interiorMeanDifference + .1, 'The edge map must refract the border more than the flat interior');
    assert.equal(pixels.repeatedCaptureChangedPixels, 0, 'A static optical fixture must render deterministically');
    return { status: 'passed', setup: 'Same real application map, same CSS filter chain and checkerboard; only SVG displacement scale changes from zero to its original value.', ...fixture, pixels };
  } finally { await page.evaluate(() => document.getElementById('appearance-smoke-optical-fixture')?.remove()); }
}

try {
  await launch(); report.defaultClassic = await snapshot(); assertClassic(report.defaultClassic); await screenshot('classic-default.png');
  const appPath = await desktop.evaluate(({ app }) => app.getAppPath());
  // @electron/asar traverses using path.sep, including when inspecting Windows archives.
  const licensePath = path.join('third_party', 'liquid-glass', 'LICENSE'), noticePath = path.join('third_party', 'liquid-glass', 'NOTICE.txt');
  const license = packaged ? asar.extractFile(appPath, licensePath) : await readFile(path.join(appPath, licensePath));
  const notice = packaged ? asar.extractFile(appPath, noticePath) : await readFile(path.join(appPath, noticePath));
  assert.equal(sha256(license), '30677f167845a6aa93e5f8a239a9de7d62f63f2b7fd351466e8fe25fe54ed0ec');
  assert(license.toString().includes('Copyright (c) 2025 Shu Ding')); assert(notice.toString().includes('a2d2e847f793430e3409a52927af815a23f4d372'));
  if (packaged) assert(appPath.endsWith('.asar'), 'Production license must be inside the actual application ASAR');
  report.license = { status: packaged ? 'verified-inside-production-asar' : 'verified-source-license-only', appPath, path: licensePath, sha256: sha256(license) };
  await seedAppearance('liquid-glass'); await waitForGlass(); report.glass = await snapshot(); assertGlass(report.glass);
  assert.deepEqual(report.glass.geometry, report.defaultClassic.geometry, 'The theme must retain control hit-box sizes'); await screenshot('glass-main.png');
  const beforeIdle = report.glass.encodes; await page.waitForTimeout(300); assert.equal((await snapshot()).encodes, beforeIdle, 'Idle rendering must not regenerate maps');
  const originalSize = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0] + 32, size[1], false), originalSize);
  await page.waitForFunction(width => innerWidth === width + 32, originalSize[0]); await waitForGlass(); await page.waitForTimeout(150);
  const expanded = await snapshot(); assert(expanded.encodes > beforeIdle, 'A genuinely new surface width must generate maps');
  await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1], false), originalSize);
  await page.waitForFunction(width => innerWidth === width, originalSize[0]); await waitForGlass(); await page.waitForTimeout(150);
  const restored = await snapshot(); assert.equal(restored.encodes, expanded.encodes, 'Returning to cached dimensions must not generate maps again');
  report.mapCache = { status: 'passed', beforeIdle, afterIdle: beforeIdle, afterNewWidth: expanded.encodes, afterOriginalWidth: restored.encodes };
  report.actualOpticalRendering = await opticalPixels();
  await command('settings'); await page.getByRole('dialog', { name: '设置' }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('.modal > .liquid-glass-backdrop'));
  assert((await page.locator('.settings-tabs').innerText()).includes('外观')); await screenshot('glass-settings.png');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await page.waitForFunction(() => matchMedia('(forced-colors: active)').matches && document.querySelector('.studio').dataset.glassMode === 'solid' && !document.querySelector('.liquid-glass-backdrop'));
  report.forcedColors = await snapshot(); assert.equal(report.forcedColors.activeThemeResizeObservers, 0); assert.equal(report.forcedColors.activeThemeMutationObservers, 0); assert.equal(report.forcedColors.filters.length, 0); await screenshot('glass-forced-colors.png');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] }); await waitForGlass();
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const transparencyMatches = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
  if (transparencyMatches) {
    await page.waitForFunction(() => document.querySelector('.studio').dataset.glassMode === 'solid' && !document.querySelector('.liquid-glass-backdrop'));
    report.reducedTransparency = { status: 'passed', state: await snapshot() }; await screenshot('glass-reduced-transparency.png');
  } else report.reducedTransparency = { status: 'not-supported-by-this-chromium-emulator' };
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await waitForGlass();
  assert(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  const motion = await page.evaluate(() => [...document.querySelectorAll('.liquid-glass-backdrop')].map(layer => ({ animation: getComputedStyle(layer).animationName, transition: getComputedStyle(layer).transitionDuration })));
  assert(motion.every(item => item.animation === 'none' && item.transition === '0s')); report.reducedMotion = { status: 'passed', opticalLayers: motion.length };
  await cdp.send('Emulation.setEmulatedMedia', { features: [] }); await cdp.detach(); await waitForGlass();
  await seedAppearance('liquid-glass', true); await page.waitForFunction(() => document.querySelector('.studio').dataset.glassMode === 'solid');
  report.unsupportedFilterFixture = await snapshot(); assert.equal(report.unsupportedFilterFixture.layers, 0); assert.equal(report.unsupportedFilterFixture.encodes, 0);
  await seedAppearance('liquid-glass'); await waitForGlass(); await close();
  await launch(); await waitForGlass(); report.persistedGlassAfterRestart = await snapshot(); assertGlass(report.persistedGlassAfterRestart); await screenshot('glass-after-restart.png');
  await seedAppearance('classic'); report.classicAfterDisableAndReload = await snapshot(); assertClassic(report.classicAfterDisableAndReload); await screenshot('classic-restored.png');
  await close(); await launch(); report.persistedClassicAfterRestart = await snapshot(); assertClassic(report.persistedClassicAfterRestart);
  assert.deepEqual(report.persistedClassicAfterRestart.geometry, report.defaultClassic.geometry);
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  if (page) { await screenshot('failure.png').catch(() => {}); report.failureState = await snapshot().catch(() => null); }
  throw error;
} finally {
  await close(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, packaged: !!packaged, report: path.join(root, 'report.json'), rendererErrors: errors, opticalPixels: report.actualOpticalRendering?.pixels }));
}
